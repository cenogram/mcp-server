import { describe, it, expect, afterEach } from "vitest";
import { registerTools } from "../tools.js";

// Guards the contract `scripts/generate-tool-reference.ts` relies on: registering tools onto a
// recorder captures name/description/schema, and the experimental flag is the dividing line for
// what the generated TOOLS.md includes. If registerTools' shape or the flag gate changes, the
// docs generator would silently drift — this catches it.

interface Recorded {
  name: string;
  description: string;
  schema: Record<string, unknown> | undefined;
}

// Same positional scan as the generator's RecordingServer.
function record(): { tools: Recorded[]; tool: (...a: unknown[]) => void } {
  const tools: Recorded[] = [];
  return {
    tools,
    tool(...args: unknown[]) {
      let i = 1;
      let description = "";
      if (typeof args[i] === "string") { description = args[i] as string; i++; }
      const schema = args[i] && typeof args[i] === "object" ? (args[i] as Record<string, unknown>) : undefined;
      tools.push({ name: String(args[0] ?? ""), description, schema });
    },
  };
}

const EXPERIMENTAL = [
  "get_rental_yield", "list_rental_yield_locations",
  "get_price_spread", "list_price_spread_locations",
  "get_flood_risk", "list_flood_risk_locations",
];

describe("tool reference generator contract", () => {
  afterEach(() => { delete process.env.CENOGRAM_EXPERIMENTAL_TOOLS; });

  it("captures a non-empty set with usable metadata when the flag is off", () => {
    delete process.env.CENOGRAM_EXPERIMENTAL_TOOLS;
    const rec = record();
    registerTools(rec as unknown as Parameters<typeof registerTools>[0]);

    expect(rec.tools.length).toBeGreaterThan(10);
    const search = rec.tools.find((t) => t.name === "search_transactions");
    expect(search).toBeDefined();
    expect(search!.description.length).toBeGreaterThan(0);
    expect(search!.schema && Object.keys(search!.schema).length).toBeGreaterThan(0);
  });

  it("omits flag-gated tools when the flag is off (what TOOLS.md documents)", () => {
    delete process.env.CENOGRAM_EXPERIMENTAL_TOOLS;
    const rec = record();
    registerTools(rec as unknown as Parameters<typeof registerTools>[0]);
    const names = rec.tools.map((t) => t.name);
    for (const exp of EXPERIMENTAL) expect(names).not.toContain(exp);
  });

  it("includes flag-gated tools when the flag is on (proves the flag is the dividing line)", () => {
    process.env.CENOGRAM_EXPERIMENTAL_TOOLS = "1";
    const rec = record();
    registerTools(rec as unknown as Parameters<typeof registerTools>[0]);
    const names = rec.tools.map((t) => t.name);
    for (const exp of EXPERIMENTAL) expect(names).toContain(exp);
  });
});
