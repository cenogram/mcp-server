import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { InMemoryTransport } from "@modelcontextprotocol/sdk/inMemory.js";
import type { Tool } from "@modelcontextprotocol/sdk/types.js";

// Every conversation loads the whole tools/list plus `instructions`, so their size is a per-chat cost.
// Budget = JSON.stringify(tools).length + instructions.length; raise it only on purpose.
const BUDGET_FLAG_OFF = 80_000;
const BUDGET_FLAG_ON = 90_000;

interface Listing {
  tools: Tool[];
  instructions: string;
}

// The flag is read when tools are registered, so each variant gets its own server built under its env.
async function listUnderFlag(flag: "1" | undefined): Promise<Listing> {
  const prev = process.env.CENOGRAM_EXPERIMENTAL_TOOLS;
  if (flag === undefined) delete process.env.CENOGRAM_EXPERIMENTAL_TOOLS;
  else process.env.CENOGRAM_EXPERIMENTAL_TOOLS = flag;
  try {
    const { createMcpServer } = await import("../index.js");
    const server = createMcpServer("test-api-key");
    const [clientTransport, serverTransport] = InMemoryTransport.createLinkedPair();
    await server.connect(serverTransport);
    const client = new Client({ name: "budget-client", version: "1.0.0" });
    await client.connect(clientTransport);
    const { tools } = await client.listTools();
    return { tools, instructions: client.getInstructions() ?? "" };
  } finally {
    if (prev === undefined) delete process.env.CENOGRAM_EXPERIMENTAL_TOOLS;
    else process.env.CENOGRAM_EXPERIMENTAL_TOOLS = prev;
  }
}

function overBudgetMessage(label: string, { tools, instructions }: Listing, budget: number): string {
  const toolsLen = JSON.stringify(tools).length;
  const largest = tools
    .map((t) => ({ name: t.name, size: JSON.stringify(t).length }))
    .sort((a, b) => b.size - a.size)
    .slice(0, 5)
    .map((t) => `${t.name} (${t.size})`)
    .join(", ");
  return (
    `tools/list (${label}) measures ${toolsLen + instructions.length} chars ` +
    `(tools ${toolsLen} + instructions ${instructions.length}), budget ${budget}. ` +
    `Largest tools: ${largest}`
  );
}

describe("tools/list size budget", () => {
  let prevFlag: string | undefined;
  let flagOff: Listing;
  let flagOn: Listing;

  beforeAll(async () => {
    prevFlag = process.env.CENOGRAM_EXPERIMENTAL_TOOLS;
    flagOff = await listUnderFlag(undefined);
    flagOn = await listUnderFlag("1");
  });

  afterAll(() => {
    if (prevFlag === undefined) delete process.env.CENOGRAM_EXPERIMENTAL_TOOLS;
    else process.env.CENOGRAM_EXPERIMENTAL_TOOLS = prevFlag;
  });

  it("stays within the budget with the optional tools off", () => {
    const total = JSON.stringify(flagOff.tools).length + flagOff.instructions.length;
    expect(total, overBudgetMessage("flag off", flagOff, BUDGET_FLAG_OFF)).toBeLessThanOrEqual(BUDGET_FLAG_OFF);
  });

  it("stays within the budget with the optional tools on", () => {
    const total = JSON.stringify(flagOn.tools).length + flagOn.instructions.length;
    expect(total, overBudgetMessage("flag on", flagOn, BUDGET_FLAG_ON)).toBeLessThanOrEqual(BUDGET_FLAG_ON);
  });

  it("keeps every tool read-only and non-destructive, flag off and on", () => {
    for (const [label, listing] of [["flag off", flagOff], ["flag on", flagOn]] as const) {
      expect(listing.tools.length, `${label}: no tools listed`).toBeGreaterThan(0);
      for (const tool of listing.tools) {
        expect(tool.annotations?.readOnlyHint, `${label}: ${tool.name} readOnlyHint`).toBe(true);
        expect(tool.annotations?.destructiveHint, `${label}: ${tool.name} destructiveHint`).toBe(false);
      }
    }
  });
});
