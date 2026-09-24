// Generates TOOLS.md — the tool reference for the Cenogram MCP server — straight from the live
// tool definitions in src/tools.ts, so the doc can never drift from the code.
//
// How it works: registerTools() is the single source of truth. We hand it a *recording* server
// that implements only `.tool(...)`, capturing each tool's name, description, input schema and
// annotations instead of wiring a real MCP handler. Nothing is executed — no network, no server,
// no handler runs — so this is safe to run anywhere and cannot change runtime behaviour.
//
// Scope: document ONLY the tools registered when the experimental flag is
// OFF. Tools guarded by `experimentalToolsEnabled()` are omitted entirely (not marked). The flag
// is the dividing line; a tool whose *title* says "[Beta]" but which registers unconditionally is
// still part of the default surface, so it is documented (its title carries the caveat).
//
// Run: npm run docs:generate   →   writes TOOLS.md at the package root.

import { writeFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";
import { registerTools } from "../src/tools.js";

// A tool definition as captured from a server.tool(...) call.
interface RecordedTool {
  name: string;
  description: string;
  schema: Record<string, unknown> | undefined;
  annotations: Record<string, unknown> | undefined;
}

// Minimal stand-in for McpServer that records tool definitions. server.tool has a few overloads:
// (name, description, schema, annotations, cb) is the common one; annotations may be absent. We
// scan positionally: string after the name is the description, the first plain object is the input
// schema, a second plain object (if any) is the annotations, functions are handlers (ignored).
class RecordingServer {
  readonly tools: RecordedTool[] = [];

  tool(...args: unknown[]): void {
    const name = String(args[0] ?? "");
    let i = 1;
    let description = "";
    if (typeof args[i] === "string") {
      description = args[i] as string;
      i++;
    }
    const schema =
      args[i] && typeof args[i] === "object" ? (args[i] as Record<string, unknown>) : undefined;
    if (schema) i++;
    const annotations =
      args[i] && typeof args[i] === "object" && typeof args[i] !== "function"
        ? (args[i] as Record<string, unknown>)
        : undefined;
    this.tools.push({ name, description, schema, annotations });
  }
}

// ── zod introspection (shallow, docs-grade) ─────────────────────────────────
// We read zod internals (_def) rather than pull in zod-to-json-schema: the reference only needs a
// human-readable "name (type, required/optional) — description" per parameter, not a full JSON
// Schema. Kept defensive — an unrecognised type degrades to its typeName, never throws.

interface FieldInfo {
  optional: boolean;
  defaultValue: unknown;
  type: string;
  description: string | undefined;
}

function zdef(zt: unknown): Record<string, unknown> | undefined {
  return (zt as { _def?: Record<string, unknown> })?._def;
}

function typeName(zt: unknown): string | undefined {
  return zdef(zt)?.typeName as string | undefined;
}

function renderType(zt: unknown): string {
  const tn = typeName(zt);
  switch (tn) {
    case "ZodString":
      return "string";
    case "ZodNumber":
      return "number";
    case "ZodBoolean":
      return "boolean";
    case "ZodEnum": {
      const values = (zdef(zt)?.values as string[] | undefined) ?? [];
      return `enum: ${values.join(" | ")}`;
    }
    case "ZodNativeEnum": {
      const values = Object.values((zdef(zt)?.values as Record<string, unknown>) ?? {});
      return `enum: ${values.join(" | ")}`;
    }
    case "ZodArray": {
      const inner = zdef(zt)?.type;
      return `array of ${renderType(inner)}`;
    }
    case "ZodLiteral":
      return `literal: ${String(zdef(zt)?.value)}`;
    default:
      return tn ? tn.replace(/^Zod/, "").toLowerCase() : "unknown";
  }
}

function describeField(zt: unknown): FieldInfo {
  let cur = zt;
  let optional = false;
  let defaultValue: unknown;
  // The description sits on whichever wrapper .describe() was called on; check outermost first.
  const description = (zt as { description?: string }).description;

  // Unwrap optionality/default/nullable to reach the concrete type for `type`.
  for (let guard = 0; guard < 10; guard++) {
    const tn = typeName(cur);
    if (tn === "ZodOptional") {
      optional = true;
      cur = zdef(cur)?.innerType;
    } else if (tn === "ZodDefault") {
      optional = true;
      const dv = zdef(cur)?.defaultValue;
      defaultValue = typeof dv === "function" ? (dv as () => unknown)() : dv;
      cur = zdef(cur)?.innerType;
    } else if (tn === "ZodNullable") {
      cur = zdef(cur)?.innerType;
    } else {
      break;
    }
  }

  return {
    optional,
    defaultValue,
    type: renderType(cur),
    description: description ?? (cur as { description?: string })?.description,
  };
}

// ── markdown rendering ──────────────────────────────────────────────────────

function renderTool(t: RecordedTool, index: number): string {
  const title = t.annotations?.title as string | undefined;
  const lines: string[] = [];
  lines.push(`### ${index}. \`${t.name}\``);
  if (title && title !== t.name) lines.push(`**${title}**`);
  lines.push("");
  lines.push(t.description.trim());
  lines.push("");

  const entries = t.schema ? Object.entries(t.schema) : [];
  if (entries.length === 0) {
    lines.push("_No parameters._");
  } else {
    lines.push("**Parameters:**");
    lines.push("");
    for (const [key, zt] of entries) {
      const f = describeField(zt);
      const meta = [f.type, f.optional ? "optional" : "required"];
      if (f.defaultValue !== undefined) meta.push(`default: ${JSON.stringify(f.defaultValue)}`);
      const desc = f.description ? ` — ${f.description.replace(/\s+/g, " ").trim()}` : "";
      lines.push(`- \`${key}\` (${meta.join(", ")})${desc}`);
    }
  }
  lines.push("");
  return lines.join("\n");
}

// ── main ────────────────────────────────────────────────────────────────────

function main(): void {
  // Belt-and-suspenders: force the experimental flag OFF so flag-gated tools never register into
  // the recorder, regardless of the caller's environment.
  delete process.env.CENOGRAM_EXPERIMENTAL_TOOLS;

  const server = new RecordingServer();
  // registerTools expects an McpServer; the recorder implements the only method it calls (.tool).
  registerTools(server as unknown as Parameters<typeof registerTools>[0]);

  const tools = server.tools;
  if (tools.length === 0) throw new Error("No tools captured — registerTools contract changed?");

  const header = [
    "# Cenogram MCP Server — Tool Reference",
    "",
    "> Auto-generated from the server's tool definitions by `npm run docs:generate`. Do not edit by hand.",
    "",
    "8M+ verified real estate transactions from Poland's official RCN registry (Rejestr Cen",
    "Nieruchomości) — transaction prices from notarial deeds, not asking prices. Data from 2003,",
    "380 counties, refreshed roughly every two weeks.",
    "",
    `This reference lists the **${tools.length}** tools available by default. Additional`,
    "experimental tools may be enabled server-side and are intentionally not documented here.",
    "",
    "---",
    "",
  ].join("\n");

  const body = tools.map((t, idx) => renderTool(t, idx + 1)).join("\n---\n\n");

  const outPath = join(dirname(dirname(fileURLToPath(import.meta.url))), "TOOLS.md");
  writeFileSync(outPath, header + body + "\n");
  // eslint-disable-next-line no-console
  console.log(`Wrote ${outPath} (${tools.length} tools)`);
}

main();
