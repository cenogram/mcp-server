import { describe, it, expect, vi, beforeAll, afterAll, beforeEach } from "vitest";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { InMemoryTransport } from "@modelcontextprotocol/sdk/inMemory.js";
import { ApiHttpError, parseLocationCandidates } from "../api-client.js";
import { authErrorMessage } from "../error-messages.js";

// Only the API calls are replaced; ApiHttpError and the rest stay real so the error path is the production one.
const mocks = vi.hoisted(() => ({
  getFloodRisk: vi.fn(),
  getRentalYield: vi.fn(),
  getPriceSpread: vi.fn(),
  getDemographics: vi.fn(),
  getInfrastructureSignals: vi.fn(),
  listParcels: vi.fn(),
  resolveParcel: vi.fn(),
  getTransactions: vi.fn(),
  getTransactionsSummary: vi.fn(),
  captureException: vi.fn(),
}));

vi.mock("../api-client.js", async () => {
  const actual = await vi.importActual<typeof import("../api-client.js")>("../api-client.js");
  return {
    ...actual,
    getFloodRisk: (...a: unknown[]) => mocks.getFloodRisk(...a),
    getRentalYield: (...a: unknown[]) => mocks.getRentalYield(...a),
    getPriceSpread: (...a: unknown[]) => mocks.getPriceSpread(...a),
    getDemographics: (...a: unknown[]) => mocks.getDemographics(...a),
    getInfrastructureSignals: (...a: unknown[]) => mocks.getInfrastructureSignals(...a),
    listParcels: (...a: unknown[]) => mocks.listParcels(...a),
    resolveParcel: (...a: unknown[]) => mocks.resolveParcel(...a),
    getTransactions: (...a: unknown[]) => mocks.getTransactions(...a),
    getTransactionsSummary: (...a: unknown[]) => mocks.getTransactionsSummary(...a),
  };
});

vi.mock("../client-id.js", () => ({ getClientId: () => "test-client-uuid" }));

vi.mock("../sentry.js", () => ({
  Sentry: {
    withScope: (cb: (scope: { setUser: (u: unknown) => void }) => unknown) => cb({ setUser: () => undefined }),
    captureException: (...args: unknown[]) => mocks.captureException(...args),
  },
}));

const UNKNOWN =
  "Unknown location: Bronowice. Look up the code with /api/locations?search=<fragment> (free, returns a TERYT code to pass as teryt=), or pass a 4-digit county TERYT directly.";
const HINT = "Pass the code of the unit you mean as teryt= (for a precinct, the first 6 digits of its code).";

// What the REST error body carries: voivodeship, county, gmina and precinct rows.
const restCandidates = [
  { code: "06", name: "Lubelskie", typeName: null, level: "voivodeship", parent_name: null },
  { code: "0618", name: "puławski", typeName: null, level: "county", parent_name: "Lubelskie" },
  { code: "061806", name: "Puławy", typeName: "gmina miejska", level: "municipality", parent_name: "Puławski" },
  { code: "061806_1.0002", name: "Bronowice", typeName: null, level: "precinct", parent_name: "Puławy" },
];

function locationError(status: 400 | 404, detail: string, extra: { candidates?: unknown; hint?: string } = {}): ApiHttpError {
  const message = authErrorMessage(status, "api_key", { error: detail, hint: extra.hint });
  return new ApiHttpError(message, {
    status,
    authMode: "api_key",
    code: detail,
    detail,
    hint: extra.hint,
    candidates: parseLocationCandidates(extra.candidates),
  });
}

function text(result: unknown): string {
  const typed = result as { content?: Array<{ type: string; text?: string }> };
  return typed.content?.find((c) => c.type === "text")?.text ?? "";
}

let client: Client;
let prevFlag: string | undefined;

beforeAll(async () => {
  prevFlag = process.env.CENOGRAM_EXPERIMENTAL_TOOLS;
  process.env.CENOGRAM_EXPERIMENTAL_TOOLS = "1";
  const { createMcpServer } = await import("../index.js");
  const server = createMcpServer("test-api-key");
  const [clientTransport, serverTransport] = InMemoryTransport.createLinkedPair();
  await server.connect(serverTransport);
  client = new Client({ name: "test-client", version: "1.0.0" });
  await client.connect(clientTransport);
});

afterAll(() => {
  if (prevFlag === undefined) delete process.env.CENOGRAM_EXPERIMENTAL_TOOLS;
  else process.env.CENOGRAM_EXPERIMENTAL_TOOLS = prevFlag;
});

beforeEach(() => {
  vi.clearAllMocks();
});

describe("a failed location= in a tool call", () => {
  it("get_flood_risk: keeps the voivodeship out, sends a precinct to its gmina, never names a REST path", async () => {
    mocks.getFloodRisk.mockRejectedValueOnce(locationError(404, UNKNOWN, { candidates: restCandidates, hint: HINT }));
    const result = await client.callTool({ name: "get_flood_risk", arguments: { location: "Bronowice" } });
    const out = text(result);
    expect(result.isError).toBe(true);
    expect(out).toContain("Unknown location: Bronowice.");
    expect(out).not.toContain("/api/");
    expect(out).not.toContain("06 - Lubelskie");
    expect(out).not.toContain('teryt="06"');
    expect(out).toContain('get_flood_risk(teryt="0618")');
    expect(out).toContain('get_flood_risk(teryt="061806")');
    expect(mocks.captureException).not.toHaveBeenCalled();
  });

  it("get_flood_risk: an API that sends no candidates still gets the tool form of the lookup", async () => {
    mocks.getFloodRisk.mockRejectedValueOnce(locationError(404, UNKNOWN));
    const out = text(await client.callTool({ name: "get_flood_risk", arguments: { location: "Bronowice" } }));
    expect(out).toContain('list_locations(search="Bronowice")');
    expect(out).not.toContain("/api/");
    expect(out).not.toContain("Closest matches");
  });

  it("get_rental_yield: a ready call for a county and for a gmina, plus the catalog pointer", async () => {
    mocks.getRentalYield.mockRejectedValueOnce(locationError(404, UNKNOWN.replace("Bronowice", "Puławy"), { candidates: restCandidates, hint: HINT }));
    const out = text(await client.callTool({ name: "get_rental_yield", arguments: { location: "Puławy" } }));
    expect(out).toContain("061806 - Puławy (gmina miejska), Puławski");
    expect(out).toContain('get_rental_yield(teryt="0618")');
    expect(out).toContain('get_rental_yield(teryt="061806")');
    expect(out).not.toContain('get_rental_yield(teryt="06")');
    expect(out).toContain('list_rental_yield_locations(search="Puławy")');
    expect(out).not.toContain("/api/");
  });

  it("get_price_spread: points at its own catalog", async () => {
    mocks.getPriceSpread.mockRejectedValueOnce(locationError(404, UNKNOWN));
    const out = text(await client.callTool({ name: "get_price_spread", arguments: { location: "Bronowice" } }));
    expect(out).toContain('list_price_spread_locations(search="Bronowice")');
    expect(out).not.toContain("answers only");
  });

  it.each([
    ["get_rental_yield", mocks.getRentalYield, "list_rental_yield_locations"],
    ["get_price_spread", mocks.getPriceSpread, "list_price_spread_locations"],
  ] as const)("%s: an ambiguous gmina name lists the candidates with teryt= calls and no catalog pointer", async (name, mock, catalog) => {
    const detail = "Ambiguous location: Dąbrowa — 2 municipalities share this name: 061806 (gmina miejska, powiat puławski), 280502 (gmina wiejska, powiat ełcki). Pass teryt=<code> instead.";
    mock.mockRejectedValueOnce(locationError(400, detail, {
      hint: HINT,
      candidates: [restCandidates[2], { ...restCandidates[2], code: "280502", parent_name: "Ełcki" }],
    }));
    const out = text(await client.callTool({ name, arguments: { location: "Dąbrowa" } }));
    expect(out.startsWith(`Error: Invalid request: ${detail}`)).toBe(true);
    expect(out).toContain(`${name}(teryt="061806")`);
    expect(out).toContain(`${name}(teryt="280502")`);
    expect(out).not.toContain(catalog);
    expect(out).not.toContain("answers only");
  });

  it("list_parcels_in_area: offers the voivodeship and the exact precinct code", async () => {
    mocks.listParcels.mockRejectedValueOnce(locationError(404, UNKNOWN, { candidates: restCandidates, hint: HINT }));
    const out = text(await client.callTool({ name: "list_parcels_in_area", arguments: { location: "Bronowice" } }));
    expect(out).toContain('list_parcels_in_area(teryt="06")');
    expect(out).toContain('list_parcels_in_area(teryt="061806_1.0002")');
    expect(out).not.toContain("/api/");
  });

  it("get_demographics: a 6-digit gmina prefix for the precinct, the voivodeship allowed", async () => {
    mocks.getDemographics.mockRejectedValueOnce(locationError(404, UNKNOWN, { candidates: restCandidates, hint: HINT }));
    const out = text(await client.callTool({ name: "get_demographics", arguments: { location: "Bronowice" } }));
    expect(out).toContain('get_demographics(teryt="06")');
    expect(out).toContain('get_demographics(teryt="061806")');
    expect(out).not.toContain("061806_1.0002\")");
  });

  it("get_infrastructure_signals: a 400 for an ambiguous gmina keeps its text and lists ready calls", async () => {
    const detail = "Ambiguous location: Dąbrowa — 2 municipalities share this name: 061806 (gmina miejska, powiat puławski), 280502 (gmina wiejska, powiat ełcki). Pass teryt=<code> instead.";
    mocks.getInfrastructureSignals.mockRejectedValueOnce(locationError(400, detail, {
      hint: HINT,
      candidates: [restCandidates[2], { ...restCandidates[2], code: "280502", parent_name: "Ełcki" }],
    }));
    const out = text(await client.callTool({ name: "get_infrastructure_signals", arguments: { location: "Dąbrowa" } }));
    expect(out.startsWith(`Error: Invalid request: ${detail}`)).toBe(true);
    expect(out).toContain('get_infrastructure_signals(teryt="061806")');
    expect(out).toContain('get_infrastructure_signals(teryt="280502")');
  });

  it("resolve_parcel: a 400 'Provide a parcel number' carries its hint, with the parcels path as a tool call", async () => {
    const hint = "This looks like a street address; look it up with GET /api/parcels?location=<locality>&street=<street>&buildingNumber=<number> (if the locality name is ambiguous, use teryt= from the candidates).";
    mocks.resolveParcel.mockRejectedValueOnce(locationError(400, "Provide a parcel number", { hint }));
    const result = await client.callTool({ name: "resolve_parcel", arguments: { q: "Armii Krajowej 10 Ełk" } });
    const out = text(result);
    expect(result.isError).toBe(true);
    expect(out).toContain("Provide a parcel number");
    expect(out).toContain('list_parcels_in_area(location="<locality>", street="<street>", buildingNumber="<number>")');
    expect(out).not.toContain("/api/");
  });

  it("resolve_parcel: a plain hint is relayed as the API sent it", async () => {
    mocks.resolveParcel.mockRejectedValueOnce(locationError(400, "Provide a parcel number", { hint: "q= needs a parcel number at the end, e.g. 'Sabnie 342/5'." }));
    const out = text(await client.callTool({ name: "resolve_parcel", arguments: { q: "Sabnie" } }));
    expect(out).toBe("Error: Invalid request: Provide a parcel number. q= needs a parcel number at the end, e.g. 'Sabnie 342/5'.");
  });

  it("leaves an error that is not about the location exactly as it was", async () => {
    mocks.listParcels.mockRejectedValueOnce(locationError(400, "cursor is not valid", { hint: "Pass back the value of pagination.next_cursor, unchanged." }));
    const out = text(await client.callTool({ name: "list_parcels_in_area", arguments: { teryt: "1465", cursor: "x" } }));
    expect(out).toBe("Error: Invalid request: cursor is not valid. Pass back the value of pagination.next_cursor, unchanged.");
  });
});

describe("search_transactions with a misspelt location", () => {
  const empty = (suggestions?: string[]) => ({
    data: { data: [], pagination: { page: 1, limit: 20, total: 0, pages: 0 }, ...(suggestions ? { suggestions } : {}) },
    creditInfo: { balance: 48, cost: 0 },
  });

  it("answers with the API's suggestions and the lookup call", async () => {
    mocks.getTransactions.mockResolvedValueOnce(empty(["Wieliczka"]));
    mocks.getTransactionsSummary.mockResolvedValueOnce({ data: null, creditInfo: null });
    const out = text(await client.callTool({ name: "search_transactions", arguments: { location: "Wieliczkaa" } }));
    expect(out).toContain('No location named "Wieliczkaa". Did you mean: Wieliczka?');
    expect(out).toContain('list_locations(search="Wieliczkaa")');
  });

  it("falls back to the plain message when the API sends no suggestions", async () => {
    mocks.getTransactions.mockResolvedValueOnce(empty());
    mocks.getTransactionsSummary.mockResolvedValueOnce({ data: null, creditInfo: null });
    const out = text(await client.callTool({ name: "search_transactions", arguments: { location: "Wieliczkaa" } }));
    expect(out).toContain("No transactions found matching the criteria.");
    expect(out).not.toContain("Did you mean");
  });
});
