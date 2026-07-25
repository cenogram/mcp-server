import { describe, it, expect, vi, beforeAll, afterAll, beforeEach, afterEach } from "vitest";
import { findGuardToken } from "./guard-tokens.js";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { InMemoryTransport } from "@modelcontextprotocol/sdk/inMemory.js";
import type {
  TransactionsResponse,
  TransactionsSummary,
  StatsResponse,
  PricePerM2Row,
  HistogramBin,
  ParcelSearchResponse,
  ParcelResolveResponse,
  SpatialSearchResponse,
  CompareResponse,
  CreditInfo,
  ApiResponse,
  LocationItem,
  ValuationResponse,
} from "../api-client.js";
import { encodeOAuthCtx } from "../api-client.js";

// ── Mock api-client (replaces entire module, including module-level API_KEY) ──

const mockGetTransactions = vi.fn();
const mockGetTransactionsSummary = vi.fn();
const mockGetStats = vi.fn();
const mockGetPricePerM2 = vi.fn();
const mockGetDistricts = vi.fn();
const mockGetLocations = vi.fn();
const mockGetPriceHistogram = vi.fn();
const mockSearchParcels = vi.fn();
const mockResolveParcel = vi.fn();
const mockSearchByPolygon = vi.fn();
const mockCompareLocations = vi.fn();
const mockGetRentalYield = vi.fn();
const mockGetRentalYieldLocations = vi.fn();
const mockGetPriceSpread = vi.fn();
const mockGetPriceSpreadLocations = vi.fn();
const mockGetValuation = vi.fn();
const mockGetBuildingBreakdown = vi.fn();
const mockGetTransactionFlood = vi.fn();
const mockGetTransactionHeritage = vi.fn();
const mockGetTransactionLandslide = vi.fn();
const mockGetTransactionSurroundings = vi.fn();
const mockGetTransactionTransit = vi.fn();
const mockGetTransactionFarmland = vi.fn();
const mockGetDemographics = vi.fn();
const mockGetInfrastructureSignals = vi.fn();

// tools.ts imports decodeOAuthCtx + OAUTH_CTX_PREFIX from api-client for identity logging, and the
// identity tests below build OAuth keys via encodeOAuthCtx — pass those three through from the real
// module so the mock doesn't shadow them (otherwise decodeOAuthCtx is undefined → every tool call throws).
vi.mock("../api-client.js", async () => {
  const actual = await vi.importActual<typeof import("../api-client.js")>("../api-client.js");
  return {
  encodeOAuthCtx: actual.encodeOAuthCtx,
  decodeOAuthCtx: actual.decodeOAuthCtx,
  OAUTH_CTX_PREFIX: actual.OAUTH_CTX_PREFIX,
  getTransactions: (...args: unknown[]) => mockGetTransactions(...args),
  getTransactionsSummary: (...args: unknown[]) => mockGetTransactionsSummary(...args),
  getStats: (...args: unknown[]) => mockGetStats(...args),
  getPricePerM2: (...args: unknown[]) => mockGetPricePerM2(...args),
  getDistricts: (...args: unknown[]) => mockGetDistricts(...args),
  getLocations: (...args: unknown[]) => mockGetLocations(...args),
  getPriceHistogram: (...args: unknown[]) => mockGetPriceHistogram(...args),
  searchParcels: (...args: unknown[]) => mockSearchParcels(...args),
  resolveParcel: (...args: unknown[]) => mockResolveParcel(...args),
  searchByPolygon: (...args: unknown[]) => mockSearchByPolygon(...args),
  compareLocations: (...args: unknown[]) => mockCompareLocations(...args),
  getRentalYield: (...args: unknown[]) => mockGetRentalYield(...args),
  getRentalYieldLocations: (...args: unknown[]) => mockGetRentalYieldLocations(...args),
  getPriceSpread: (...args: unknown[]) => mockGetPriceSpread(...args),
  getPriceSpreadLocations: (...args: unknown[]) => mockGetPriceSpreadLocations(...args),
  getValuation: (...args: unknown[]) => mockGetValuation(...args),
  getBuildingBreakdown: (...args: unknown[]) => mockGetBuildingBreakdown(...args),
  getTransactionFlood: (...args: unknown[]) => mockGetTransactionFlood(...args),
  getTransactionHeritage: (...args: unknown[]) => mockGetTransactionHeritage(...args),
  getTransactionLandslide: (...args: unknown[]) => mockGetTransactionLandslide(...args),
  getTransactionSurroundings: (...args: unknown[]) => mockGetTransactionSurroundings(...args),
  getTransactionTransit: (...args: unknown[]) => mockGetTransactionTransit(...args),
  getTransactionFarmland: (...args: unknown[]) => mockGetTransactionFarmland(...args),
  getDemographics: (...args: unknown[]) => mockGetDemographics(...args),
  getInfrastructureSignals: (...args: unknown[]) => mockGetInfrastructureSignals(...args),
  };
});

vi.mock("../client-id.js", () => ({
  getClientId: () => "test-client-uuid",
}));

// Fake Sentry so the identity tests can assert per-call setUser + captureException. withScope must
// return the callback's result (a Promise) so `return await Sentry.withScope(...)` in tools.ts works.
const mockSentrySetUser = vi.fn();
const mockSentryCaptureException = vi.fn();
vi.mock("../sentry.js", () => ({
  Sentry: {
    withScope: (cb: (scope: { setUser: (u: { id: string }) => void }) => unknown) =>
      cb({ setUser: (u: { id: string }) => mockSentrySetUser(u) }),
    captureException: (...args: unknown[]) => mockSentryCaptureException(...args),
  },
}));

// ── Test fixtures ──────────────────────────────────────────────────

const creditInfo: CreditInfo = { balance: 48, cost: 2 };

function withCredits<T>(data: T): ApiResponse<T> {
  return { data, creditInfo };
}

const sampleTransaction = {
  id: "tx-1",
  transaction_date: "2024-11-15",
  property_type: 4,
  market_type: 2,
  price_gross: 890000,
  usable_area_m2: 62.5,
  price_per_m2: 14240,
  rooms: 3,
  floor: 4,
  district: "Mokotów",
  street: "ul. Puławska",
  building_number: "15",
  city: "Warszawa",
  parcel_area: null,
  unit_function: 1,
  parcel_id: "146509_8.0501.12",
  parcel_number: "12",
  county_name: "Warszawa",
  voivodeship_name: "mazowieckie",
  centroid: { type: "Point", coordinates: [21.006, 52.2317] as [number, number] },
};

const sampleTransactionsResponse: TransactionsResponse = {
  data: [sampleTransaction],
  pagination: { page: 1, limit: 10, total: 1234, pages: 124 },
};

const sampleSummary: TransactionsSummary = {
  median_price_m2: 15200,
  avg_area: 58.3,
  min_date: "2024-01-01",
  max_date: "2024-12-31",
  total: 1234,
};

const sampleStats: StatsResponse = {
  counts: { transactions: 8194025, parcels: 681000, buildings: 50000, units: 30000, addresses: 20000 },
  prices: { total: 8194025, avg_price: 456789, median_price: 280000, min_price: 1, max_price: 999999999 },
  dateRange: { min_date: "2003-01-02", max_date: "2024-12-31" },
  byDistrict: [{ district: "Mokotów", transaction_count: 312456 }],
  byPropertyType: [{ type: 4, total: 3245678, label: "Lokal" }],
  byMarketType: [{ type: 2, total: 5890123, label: "Wtórny" }],
};

const samplePriceRows: PricePerM2Row[] = [
  { district: "Mokotów", avg_price_m2: 16000, median_price_m2: 15200, count: 5000 },
  { district: "Kraków-Podgórze", avg_price_m2: 12000, median_price_m2: 11500, count: 3000 },
  { district: "Wola", avg_price_m2: 14000, median_price_m2: 13500, count: 4000 },
];

const sampleHistogramBins: HistogramBin[] = [
  { bucket: 0, count: 100, range_min: 0, range_max: 150000 },
  { bucket: 1, count: 500, range_min: 150000, range_max: 300000 },
  { bucket: 2, count: 200, range_min: 300000, range_max: 450000 },
];

const sampleParcels: ParcelSearchResponse = {
  results: [
    { parcel_id: "146518_8.0108.27", district: "Wawer", area_m2: 1200, lat: 52.1234, lng: 21.0567 },
    { parcel_id: "146518_8.0108.28", district: "Wawer", area_m2: 800, lat: 52.1235, lng: 21.0568 },
  ],
};

const sampleParcelResolve: ParcelResolveResponse = {
  query: { mode: "q", q: "Wawer 27" },
  coverage: "covered",
  as_of: "2026-06-30T00:00:00.000Z",
  matches: [
    {
      id: "uuid-1", parcel_id: "146518_8.0108.27", parcel_key: "146518_8.0108.27",
      district: "Wawer", county_code: "1465", parcel_number: "27", area_m2: 1200,
      has_geometry: true, centroid: { lat: 52.1234, lng: 21.0567 },
    },
  ],
  truncated: false,
};

const sampleSpatialResponse: SpatialSearchResponse = {
  type: "FeatureCollection",
  features: [{
    type: "Feature",
    geometry: { type: "Point", coordinates: [21.05, 52.22] },
    properties: {
      id: "sp-1",
      price_gross: 500000,
      transaction_date: "2024-06-15",
      property_type: 4,
      market_type: 2,
      usable_area_m2: 55.0,
      price_per_m2: 9091,
      rooms: 3,
      floor: 2,
      street: "Puławska",
      building_number: "12",
      city: "Warszawa",
      district: "Mokotów",
      parcel_area: null,
      parcel_number: null,
    },
  }],
  truncated: false,
  total: 1,
};

const sampleCompareResponse: CompareResponse = {
  "Mokotów": { median_price_m2: 15200, avg_area: 58.3, min_date: "2024-01-01", max_date: "2024-12-31", total: 1234 },
  "Wola": { median_price_m2: 12100, avg_area: 45.0, min_date: "2024-02-15", max_date: "2024-11-30", total: 987 },
};

// ── Setup MCP client ───────────────────────────────────────────────

let client: Client;

beforeAll(async () => {
  const { createMcpServer } = await import("../index.js");
  const server = createMcpServer("test-api-key");
  const [clientTransport, serverTransport] = InMemoryTransport.createLinkedPair();
  await server.connect(serverTransport);
  client = new Client({ name: "test-client", version: "1.0.0" });
  await client.connect(clientTransport);
});

beforeEach(() => {
  vi.clearAllMocks();
});

// ── Helper ─────────────────────────────────────────────────────────

function getTextContent(result: unknown): string {
  const typed = result as { content?: Array<{ type: string; text?: string }> };
  const textBlock = typed.content?.find((c) => c.type === "text");
  return textBlock?.text ?? "";
}

// ── Tests: Tool discovery ──────────────────────────────────────────

describe("tool discovery", () => {
  it("registers exactly this set of tools by default", async () => {
    // The published package is what a stranger sees, so the default set is a release
    // decision, not an implementation detail. Asserted by name rather than by count: a
    // count survives one tool silently replacing another.
    const { tools } = await client.listTools();
    expect(tools.map((t) => t.name).sort()).toEqual([
      "compare_locations",
      "estimate_value",
      "get_building_breakdown",
      "get_demographics",
      "get_infrastructure_signals",
      "get_market_overview",
      "get_parcel_report",
      "get_price_distribution",
      "get_price_statistics",
      "get_transaction_farmland",
      "get_transaction_flood",
      "get_transaction_heritage",
      "get_transaction_landslide",
      "get_transaction_permits",
      "get_transaction_planning",
      "get_transaction_surroundings",
      "get_transaction_transit",
      "list_locations",
      "resolve_parcel",
      "search_by_area",
      "search_by_polygon",
      "search_parcels",
      "search_transactions",
    ]);
  });

  it("all tools have readOnlyHint annotation", async () => {
    const { tools } = await client.listTools();
    for (const tool of tools) {
      expect(tool.annotations?.readOnlyHint, `${tool.name} missing readOnlyHint`).toBe(true);
    }
  });

  it("all tools have title + destructiveHint:false annotations", async () => {
    // Anthropic Connectors Directory (Software Directory Policy) requires applicable
    // annotations — in particular title and destructiveHint. Missing annotations are a
    // leading rejection cause. Guards the submission requirement against regressions.
    const { tools } = await client.listTools();
    for (const tool of tools) {
      expect(
        typeof tool.annotations?.title === "string" && tool.annotations.title.length > 0,
        `${tool.name} missing title`,
      ).toBe(true);
      expect(tool.annotations?.destructiveHint, `${tool.name} missing destructiveHint:false`).toBe(false);
    }
  });

  it("no tool description leaks the rent-data source brand", async () => {
    // Formatters scrub the brand from data output; tool descriptions (sent to the LLM/clients)
    // must stay clean too. Guards against a data-source brand leaking into a tool description.
    const { tools } = await client.listTools();
    for (const tool of tools) {
      const desc = (tool.description ?? "").toLowerCase();
      // A description states what the caller gets back, never which register it came from.
      expect(findGuardToken(desc), `${tool.name} description leaks a guarded term`).toBeNull();
    }
  });

  it("surfaces the deep-link permalink recipe in the search tool descriptions", async () => {
    // The recipe MUST live in the tool descriptions, not only the server `instructions` field:
    // claude.ai's connector doesn't surface `instructions` to the model.
    // Guards against the recipe silently dropping back to instructions-only.
    const { tools } = await client.listTools();
    for (const name of ["search_transactions", "search_by_area", "search_by_polygon"]) {
      const desc = tools.find((t) => t.name === name)?.description ?? "";
      expect(desc, `${name} missing deep-link recipe`).toContain("ceny-transakcyjne?src=mcpstdio#v=1");
      expect(desc, `${name} deep-link recipe missing tx anchor`).toContain("tx=<id>");
    }
  });

  it("has all expected tool names (default set, no optional tools)", async () => {
    const { tools } = await client.listTools();
    const names = tools.map((t) => t.name).sort();
    expect(names).toEqual([
      "compare_locations",
      "estimate_value",
      "get_building_breakdown",
      "get_demographics",
      "get_infrastructure_signals",
      "get_market_overview",
      "get_parcel_report",
      "get_price_distribution",
      "get_price_statistics",
      "get_transaction_farmland",
      "get_transaction_flood",
      "get_transaction_heritage",
      "get_transaction_landslide",
      "get_transaction_permits",
      "get_transaction_planning",
      "get_transaction_surroundings",
      "get_transaction_transit",
      "list_locations",
      "resolve_parcel",
      "search_by_area",
      "search_by_polygon",
      "search_parcels",
      "search_transactions",
    ]);
  });

  it("does NOT register the optional tools by default", async () => {
    const { tools } = await client.listTools();
    const names = tools.map((t) => t.name);
    for (const gated of ["get_rental_yield", "list_rental_yield_locations", "get_price_spread", "list_price_spread_locations"]) {
      expect(names, `${gated} should be gated off`).not.toContain(gated);
    }
  });

  it("instructions omit the rental-yield workflow when the tools are gated off (cross-check)", () => {
    // Consistency guard: the instructions line and the tool registration read the SAME flag.
    // Flag off → neither the workflow line nor the tools should appear.
    const instructions = client.getInstructions() ?? "";
    expect(instructions).not.toContain("Rental yield:");
    expect(instructions).not.toContain("Price spread:");
  });
});

// ── Tests: search_transactions ─────────────────────────────────────

describe("search_transactions", () => {
  it("returns formatted transactions with credit footer", async () => {
    mockGetTransactions.mockResolvedValueOnce(withCredits(sampleTransactionsResponse));
    mockGetTransactionsSummary.mockResolvedValueOnce(withCredits(sampleSummary));

    const result = await client.callTool({ name: "search_transactions", arguments: { location: "Mokotów", limit: 10 } });
    const text = getTextContent(result);

    expect(text).toContain("Puławska");
    expect(text).toContain("Mokotów");
    expect(text).toContain("890");
    expect(text).toMatch(/API tokens.*48/);
  });

  it("maps location to district and propertyType string to number", async () => {
    mockGetTransactions.mockResolvedValueOnce(withCredits(sampleTransactionsResponse));
    mockGetTransactionsSummary.mockResolvedValueOnce(withCredits(sampleSummary));

    await client.callTool({ name: "search_transactions", arguments: { location: "Mokotów", propertyType: "unit" } });

    expect(mockGetTransactions).toHaveBeenCalledWith(
      expect.objectContaining({ district: "Mokotów", propertyType: 4 }),
      "test-api-key",
    );
  });

  it("calls both getTransactions and getTransactionsSummary", async () => {
    mockGetTransactions.mockResolvedValueOnce(withCredits(sampleTransactionsResponse));
    mockGetTransactionsSummary.mockResolvedValueOnce(withCredits(sampleSummary));

    await client.callTool({ name: "search_transactions", arguments: {} });

    expect(mockGetTransactions).toHaveBeenCalledTimes(1);
    expect(mockGetTransactionsSummary).toHaveBeenCalledTimes(1);
  });

  it("returns Error text with isError flag when API throws", async () => {
    mockGetTransactions.mockRejectedValueOnce(new Error("API error: HTTP 500"));
    mockGetTransactionsSummary.mockRejectedValueOnce(new Error("API error: HTTP 500"));

    const result = await client.callTool({ name: "search_transactions", arguments: {} });
    const text = getTextContent(result);

    expect(text).toContain("Error:");
    expect(text).toContain("500");
    expect(result.isError).toBe(true);
  });

  it("passes pagination params correctly", async () => {
    mockGetTransactions.mockResolvedValueOnce(withCredits(sampleTransactionsResponse));
    mockGetTransactionsSummary.mockResolvedValueOnce(withCredits(sampleSummary));

    await client.callTool({
      name: "search_transactions",
      arguments: { page: 3, limit: 20, sort: "price", order: "asc" },
    });

    expect(mockGetTransactions).toHaveBeenCalledWith(
      expect.objectContaining({ page: 3, limit: 20, sort: "price", order: "asc" }),
      "test-api-key",
    );
  });

  it("handles summary failure gracefully (still returns transactions)", async () => {
    mockGetTransactions.mockResolvedValueOnce(withCredits(sampleTransactionsResponse));
    mockGetTransactionsSummary.mockRejectedValueOnce(new Error("timeout"));

    const result = await client.callTool({ name: "search_transactions", arguments: {} });
    const text = getTextContent(result);

    // Should still show transactions even if summary fails
    expect(text).toContain("Puławska");
    expect(text).not.toContain("Error:");
  });

  it("passes valid floor buckets through to api-client as CSV", async () => {
    mockGetTransactions.mockResolvedValueOnce(withCredits(sampleTransactionsResponse));
    mockGetTransactionsSummary.mockResolvedValueOnce(withCredits(sampleSummary));

    await client.callTool({
      name: "search_transactions",
      arguments: { location: "Mokotów", floor: ["0", "-1", "10plus", "unknown"] },
    });

    expect(mockGetTransactions).toHaveBeenCalledWith(
      expect.objectContaining({ floor: "0,-1,10plus,unknown" }),
      "test-api-key",
    );
  });

  it("rejects malformed floor tokens at the schema (no silent full-set)", async () => {
    const result = await client.callTool({
      name: "search_transactions",
      arguments: { location: "Mokotów", floor: ["abc"] },
    });

    // Schema validation surfaces an actionable error instead of silently
    // dropping the token and returning the full unfiltered set.
    expect(result.isError).toBe(true);
    expect(getTextContent(result)).toContain("Invalid floor token");
    expect(mockGetTransactions).not.toHaveBeenCalled();
  });

  it("rejects a mixed valid+invalid floor array (per-element validation)", async () => {
    // The original bug was partial-drop: a bad token silently vanished while
    // the good ones filtered. Zod must validate EVERY element, so one garbage
    // member rejects the whole array rather than filtering by the rest.
    const result = await client.callTool({
      name: "search_transactions",
      arguments: { location: "Mokotów", floor: ["1", "abc"] },
    });

    expect(result.isError).toBe(true);
    expect(getTextContent(result)).toContain("Invalid floor token");
    expect(mockGetTransactions).not.toHaveBeenCalled();
  });

  it("accepts case-insensitive floor tokens (parity with parser toLowerCase)", async () => {
    mockGetTransactions.mockResolvedValueOnce(withCredits(sampleTransactionsResponse));
    mockGetTransactionsSummary.mockResolvedValueOnce(withCredits(sampleSummary));

    await client.callTool({
      name: "search_transactions",
      arguments: { location: "Mokotów", floor: ["10Plus", "UNKNOWN"] },
    });

    expect(mockGetTransactions).toHaveBeenCalledWith(
      expect.objectContaining({ floor: "10Plus,UNKNOWN" }),
      "test-api-key",
    );
  });
});

// ── Tests: get_price_statistics ────────────────────────────────────

describe("get_price_statistics", () => {
  it("returns all rows without location filter", async () => {
    mockGetPricePerM2.mockResolvedValueOnce(withCredits(samplePriceRows));

    const result = await client.callTool({ name: "get_price_statistics", arguments: {} });
    const text = getTextContent(result);

    expect(text).toContain("Mokotów");
    expect(text).toContain("Kraków-Podgórze");
    expect(text).toContain("Wola");
    expect(text).toContain("residential");
  });

  it("filters by location (case-insensitive)", async () => {
    mockGetPricePerM2.mockResolvedValueOnce(withCredits(samplePriceRows));
    mockGetDistricts.mockResolvedValueOnce(withCredits(["Mokotów", "Kraków-Podgórze", "Wola"]));

    const result = await client.callTool({ name: "get_price_statistics", arguments: { location: "krak" } });
    const text = getTextContent(result);

    expect(text).toContain("Kraków-Podgórze");
    expect(text).not.toContain("Mokotów");
    expect(text).not.toContain("Wola");
  });

  it("shows helpful message when no results", async () => {
    mockGetPricePerM2.mockResolvedValueOnce(withCredits([]));
    mockGetDistricts.mockResolvedValueOnce(withCredits(["Mokotów", "Kraków-Podgórze", "Wola"]));

    const result = await client.callTool({ name: "get_price_statistics", arguments: { location: "Atlantyda" } });
    const text = getTextContent(result);

    expect(text).toContain("No price statistics");
    expect(text).toContain("list_locations");
  });

  it("expands 'Warszawa' to all sub-districts including city-level entry (not substring match)", async () => {
    const warsawRows: PricePerM2Row[] = [
      { district: "Warszawa", avg_price_m2: 18000, median_price_m2: 17000, count: 100 },
      { district: "Mokotów", avg_price_m2: 16000, median_price_m2: 15200, count: 5000 },
      { district: "Wola", avg_price_m2: 14000, median_price_m2: 13500, count: 4000 },
      { district: "Śródmieście", avg_price_m2: 22000, median_price_m2: 21000, count: 3000 },
      { district: "Bemowo", avg_price_m2: 12000, median_price_m2: 11500, count: 2000 },
      { district: "Kraków-Podgórze", avg_price_m2: 12000, median_price_m2: 11500, count: 3000 },
    ];
    mockGetPricePerM2.mockResolvedValueOnce(withCredits(warsawRows));
    // 'Warszawa' is a city key — resolved from static map, no getDistricts call.

    const result = await client.callTool({ name: "get_price_statistics", arguments: { location: "Warszawa" } });
    const text = getTextContent(result);

    expect(mockGetDistricts).not.toHaveBeenCalled();
    // Warsaw districts + city-level entry should be present
    expect(text).toContain("Mokotów");
    expect(text).toContain("Wola");
    expect(text).toContain("Śródmieście");
    expect(text).toContain("Bemowo");
    expect(text).toContain("Warszawa");
    // Non-Warsaw districts should be filtered out
    expect(text).not.toContain("Kraków-Podgórze");
  });

  // City keys resolve from the static map — no /api/districts fetch.
  it("'Warszawa' filters without calling getDistricts (lazy city key)", async () => {
    const warsawRows: PricePerM2Row[] = [
      { district: "Mokotów", avg_price_m2: 16000, median_price_m2: 15200, count: 5000 },
      { district: "Wola", avg_price_m2: 14000, median_price_m2: 13500, count: 4000 },
      { district: "Kraków-Podgórze", avg_price_m2: 12000, median_price_m2: 11500, count: 3000 },
    ];
    mockGetPricePerM2.mockResolvedValueOnce(withCredits(warsawRows));

    const result = await client.callTool({ name: "get_price_statistics", arguments: { location: "Warszawa" } });
    const text = getTextContent(result);

    expect(mockGetDistricts).not.toHaveBeenCalled();
    expect(mockGetPricePerM2).toHaveBeenCalledTimes(1);
    expect(text).toContain("Mokotów");
    expect(text).toContain("Wola");
    expect(text).not.toContain("Kraków-Podgórze");
  });

  it("non-city location still fetches getDistricts (else branch)", async () => {
    mockGetPricePerM2.mockResolvedValueOnce(withCredits(samplePriceRows));
    mockGetDistricts.mockResolvedValueOnce(withCredits(["Mokotów", "Kraków-Podgórze", "Wola"]));

    await client.callTool({ name: "get_price_statistics", arguments: { location: "krak" } });

    expect(mockGetDistricts).toHaveBeenCalledTimes(1);
  });
});

// ── Tests: get_price_distribution ──────────────────────────────────

describe("get_price_distribution", () => {
  it("passes bins and maxPrice to API", async () => {
    mockGetPriceHistogram.mockResolvedValueOnce(withCredits(sampleHistogramBins));

    await client.callTool({ name: "get_price_distribution", arguments: { bins: 30, maxPrice: 5000000 } });

    expect(mockGetPriceHistogram).toHaveBeenCalledWith(30, 5000000, "test-api-key");
  });

  it("returns ASCII histogram with bars", async () => {
    mockGetPriceHistogram.mockResolvedValueOnce(withCredits(sampleHistogramBins));

    const result = await client.callTool({ name: "get_price_distribution", arguments: {} });
    const text = getTextContent(result);

    expect(text).toContain("█");
    expect(text).toContain("Price distribution");
  });
});

// ── Tests: search_by_area ──────────────────────────────────────────

describe("search_by_area", () => {
  it("converts lat/lng/radius to bbox param", async () => {
    mockGetTransactions.mockResolvedValueOnce(withCredits(sampleTransactionsResponse));
    mockGetTransactionsSummary.mockResolvedValueOnce(withCredits(sampleSummary));

    await client.callTool({
      name: "search_by_area",
      arguments: { latitude: 52.23, longitude: 21.01, radiusKm: 2 },
    });

    expect(mockGetTransactions).toHaveBeenCalledWith(
      expect.objectContaining({ bbox: expect.stringContaining(",") }),
      "test-api-key",
    );
    // bbox should be a comma-separated string of 4 numbers
    const callArgs = mockGetTransactions.mock.calls[0]![0] as { bbox: string };
    const bboxParts = callArgs.bbox.split(",");
    expect(bboxParts).toHaveLength(4);
    bboxParts.forEach((p) => expect(Number(p)).not.toBeNaN());
  });

  it("maps propertyType and marketType", async () => {
    mockGetTransactions.mockResolvedValueOnce(withCredits(sampleTransactionsResponse));
    mockGetTransactionsSummary.mockResolvedValueOnce(withCredits(sampleSummary));

    await client.callTool({
      name: "search_by_area",
      arguments: { latitude: 52.23, longitude: 21.01, radiusKm: 2, propertyType: "unit", marketType: "secondary" },
    });

    expect(mockGetTransactions).toHaveBeenCalledWith(
      expect.objectContaining({ propertyType: 4, marketType: 2 }),
      "test-api-key",
    );
  });

  it("forwards floodRisk (joined) to backend", async () => {
    mockGetTransactions.mockResolvedValueOnce(withCredits(sampleTransactionsResponse));
    mockGetTransactionsSummary.mockResolvedValueOnce(withCredits(sampleSummary));

    await client.callTool({
      name: "search_by_area",
      arguments: { latitude: 52.23, longitude: 21.01, radiusKm: 2, floodRisk: ["medium", "high"] },
    });

    expect(mockGetTransactions).toHaveBeenCalledWith(
      expect.objectContaining({ floodRisk: "medium,high" }),
      "test-api-key",
    );
  });

  it("forwards heritageStatus (joined) to backend", async () => {
    mockGetTransactions.mockResolvedValueOnce(withCredits(sampleTransactionsResponse));
    mockGetTransactionsSummary.mockResolvedValueOnce(withCredits(sampleSummary));

    await client.callTool({
      name: "search_by_area",
      arguments: { latitude: 52.23, longitude: 21.01, radiusKm: 2, heritageStatus: ["listed", "zone"] },
    });

    expect(mockGetTransactions).toHaveBeenCalledWith(
      expect.objectContaining({ heritageStatus: "listed,zone" }),
      "test-api-key",
    );
  });

  it("forwards landslideRisk (joined) to both rows and summary count", async () => {
    mockGetTransactions.mockResolvedValueOnce(withCredits(sampleTransactionsResponse));
    mockGetTransactionsSummary.mockResolvedValueOnce(withCredits(sampleSummary));

    await client.callTool({
      name: "search_by_area",
      arguments: { latitude: 52.23, longitude: 21.01, radiusKm: 2, landslideRisk: ["landslide", "threatened"] },
    });

    expect(mockGetTransactions).toHaveBeenCalledWith(
      expect.objectContaining({ landslideRisk: "landslide,threatened" }),
      "test-api-key",
    );
    // Summary call must carry the same filter so the "Found N" count matches the rows.
    expect(mockGetTransactionsSummary).toHaveBeenCalledWith(
      expect.objectContaining({ landslideRisk: "landslide,threatened" }),
      "test-api-key",
    );
  });

  it("returns Error with isError flag on API failure", async () => {
    mockGetTransactions.mockRejectedValueOnce(new Error("Too many requests."));
    mockGetTransactionsSummary.mockRejectedValueOnce(new Error("Too many requests."));

    const result = await client.callTool({
      name: "search_by_area",
      arguments: { latitude: 52.23, longitude: 21.01, radiusKm: 2 },
    });
    const text = getTextContent(result);

    expect(text).toContain("Error:");
    expect(result.isError).toBe(true);
  });

  it("forwards minArea and maxArea to backend", async () => {
    mockGetTransactions.mockResolvedValueOnce(withCredits(sampleTransactionsResponse));
    mockGetTransactionsSummary.mockResolvedValueOnce(withCredits(sampleSummary));

    await client.callTool({
      name: "search_by_area",
      arguments: { latitude: 52.23, longitude: 21.01, radiusKm: 5, propertyType: "land", minArea: 1000, maxArea: 2000 },
    });

    expect(mockGetTransactions).toHaveBeenCalledWith(
      expect.objectContaining({ minArea: 1000, maxArea: 2000, propertyType: 1 }),
      "test-api-key",
    );
  });
});

// ── Tests: get_market_overview ─────────────────────────────────────

describe("get_market_overview", () => {
  it("returns formatted overview with Cenogram branding", async () => {
    mockGetStats.mockResolvedValueOnce(withCredits(sampleStats));

    const result = await client.callTool({ name: "get_market_overview", arguments: {} });
    const text = getTextContent(result);

    expect(text).toContain("Cenogram");
    expect(text).toMatch(/8.?194.?025/); // total count with possible separators
    expect(text).toContain("2003");
  });

  it("includes credit footer", async () => {
    mockGetStats.mockResolvedValueOnce(withCredits(sampleStats));

    const result = await client.callTool({ name: "get_market_overview", arguments: {} });
    const text = getTextContent(result);

    expect(text).toMatch(/API tokens.*48/);
    expect(text).toContain("query cost: 2");
  });

  it("returns isError flag on API failure", async () => {
    mockGetStats.mockRejectedValueOnce(new Error("API error"));

    const result = await client.callTool({ name: "get_market_overview", arguments: {} });
    const text = getTextContent(result);

    expect(result.isError).toBe(true);
    expect(text).toContain("Error: API error");
  });
});

// ── Tests: list_locations ──────────────────────────────────────────

describe("list_locations", () => {
  it("returns voivodeships when called without params (hierarchy mode)", async () => {
    const voivodeships: LocationItem[] = [
      { code: "02", name: "dolnośląskie", typeName: null, level: "voivodeship" },
      { code: "14", name: "mazowieckie", typeName: null, level: "voivodeship" },
    ];
    mockGetLocations.mockResolvedValueOnce(withCredits(voivodeships));

    const result = await client.callTool({ name: "list_locations", arguments: {} });
    const text = getTextContent(result);

    expect(mockGetLocations).toHaveBeenCalledWith(undefined, "test-api-key");
    expect(text).toContain("voivodeship");
    expect(text).toContain("dolnośląskie");
  });

  it("filters by search term (legacy mode, non-city)", async () => {
    mockGetDistricts.mockResolvedValueOnce(withCredits(["Mokotów", "Śródmieście", "Wola"]));

    const result = await client.callTool({ name: "list_locations", arguments: { search: "Śród" } });
    const text = getTextContent(result);

    expect(mockGetDistricts).toHaveBeenCalled();
    expect(mockGetLocations).not.toHaveBeenCalled();
    expect(text).toContain("Śródmieście");
    expect(text).not.toContain("Mokotów");
    expect(text).not.toContain("Wola");
  });

  // 'Krakow' (no diacritics) resolves to the Kraków city key lazily — no getDistricts.
  it("search matches diacritics-insensitive ('Krakow' → Kraków districts, lazy)", async () => {
    const result = await client.callTool({ name: "list_locations", arguments: { search: "Krakow" } });
    const text = getTextContent(result);

    expect(mockGetDistricts).not.toHaveBeenCalled();
    expect(text).toContain("Kraków-Podgórze");
    expect(text).toContain("Kraków-Śródmieście");
    expect(text).not.toContain("Mokotów");
  });

  it("search matches diacritics-insensitive ('Lodz' → Łódź districts, lazy)", async () => {
    const result = await client.callTool({ name: "list_locations", arguments: { search: "Lodz" } });
    const text = getTextContent(result);

    expect(mockGetDistricts).not.toHaveBeenCalled();
    expect(text).toContain("Łódź-Bałuty");
    expect(text).toContain("Łódź-Górna");
    expect(text).not.toContain("Mokotów");
  });

  it("returns 'no locations' message for no match", async () => {
    mockGetDistricts.mockResolvedValueOnce(withCredits(["Mokotów", "Wola"]));

    const result = await client.callTool({ name: "list_locations", arguments: { search: "Atlantyda" } });
    const text = getTextContent(result);

    expect(text).toContain("No locations found");
  });
});

// ── Tests: list_locations lazy city resolution ──
describe("list_locations lazy city key", () => {
  it("'Warszawa' returns all 19 sub-districts without calling getDistricts", async () => {
    const result = await client.callTool({ name: "list_locations", arguments: { search: "Warszawa" } });
    const text = getTextContent(result);

    expect(mockGetDistricts).not.toHaveBeenCalled();
    expect(text).toContain("Found 19 locations");
    expect(text).toContain("Mokotów");
    expect(text).toContain("Żoliborz");
    expect(text).toContain("Praga-Południe");
    // No credit footer for city-key matches (zero API call = zero cost)
    expect(text).not.toContain("API tokens");
  });

  it("trailing whitespace 'Warszawa ' still resolves lazily", async () => {
    const result = await client.callTool({ name: "list_locations", arguments: { search: "Warszawa " } });
    const text = getTextContent(result);

    expect(mockGetDistricts).not.toHaveBeenCalled();
    expect(text).toContain("Found 19 locations");
  });

  it("lowercase 'warszawa' still resolves lazily", async () => {
    const result = await client.callTool({ name: "list_locations", arguments: { search: "warszawa" } });
    const text = getTextContent(result);

    expect(mockGetDistricts).not.toHaveBeenCalled();
    expect(text).toContain("Found 19 locations");
  });

  it("'Kraków' returns 5 sub-districts without getDistricts", async () => {
    const result = await client.callTool({ name: "list_locations", arguments: { search: "Kraków" } });
    const text = getTextContent(result);

    expect(mockGetDistricts).not.toHaveBeenCalled();
    expect(text).toContain("Found 5 locations");
    expect(text).toContain("Kraków-Podgórze");
  });

  it("'Łódź' returns 6 sub-districts without getDistricts", async () => {
    const result = await client.callTool({ name: "list_locations", arguments: { search: "Łódź" } });
    const text = getTextContent(result);

    expect(mockGetDistricts).not.toHaveBeenCalled();
    expect(text).toContain("Found 6 locations");
    expect(text).toContain("Łódź-Bałuty");
  });

  it("partial 'Mok' is NOT a city key — falls through to getDistricts", async () => {
    mockGetDistricts.mockResolvedValueOnce(withCredits(["Mokotów", "Wola", "Kraków-Podgórze"]));

    const result = await client.callTool({ name: "list_locations", arguments: { search: "Mok" } });
    const text = getTextContent(result);

    expect(mockGetDistricts).toHaveBeenCalledTimes(1);
    expect(text).toContain("Mokotów");
    expect(text).not.toContain("Wola");
  });

  it("multi-word 'Warszawa Mokotów' is NOT a city key — falls through to getDistricts", async () => {
    mockGetDistricts.mockResolvedValueOnce(withCredits(["Mokotów", "Wola"]));

    await client.callTool({ name: "list_locations", arguments: { search: "Warszawa Mokotów" } });

    expect(mockGetDistricts).toHaveBeenCalledTimes(1);
  });
});

// ── Tests: search_parcels ──────────────────────────────────────────

describe("search_parcels", () => {
  it("passes q and limit to API", async () => {
    mockSearchParcels.mockResolvedValueOnce(withCredits(sampleParcels));

    await client.callTool({ name: "search_parcels", arguments: { q: "146518_8.01", limit: 5 } });

    expect(mockSearchParcels).toHaveBeenCalledWith("146518_8.01", 5, "test-api-key");
  });

  it("formats results with parcel IDs and coordinates", async () => {
    mockSearchParcels.mockResolvedValueOnce(withCredits(sampleParcels));

    const result = await client.callTool({ name: "search_parcels", arguments: { q: "146518" } });
    const text = getTextContent(result);

    expect(text).toContain("146518_8.0108.27");
    expect(text).toContain("Wawer");
    expect(text).toContain("52.1234");
  });
});

// ── Tests: resolve_parcel ──────────────────────────────────────────

describe("resolve_parcel", () => {
  it("passes q to the API and formats matches", async () => {
    mockResolveParcel.mockResolvedValueOnce(withCredits(sampleParcelResolve));

    const result = await client.callTool({ name: "resolve_parcel", arguments: { q: "Wawer 27" } });
    const text = getTextContent(result);

    expect(mockResolveParcel).toHaveBeenCalledWith(
      { q: "Wawer 27", parcelId: undefined, lat: undefined, lng: undefined },
      "test-api-key",
    );
    expect(text).toContain("146518_8.0108.27");
    expect(text).toContain("Wawer");
    expect(text).toContain("52.1234");
    expect(text).toContain("API tokens: 48 remaining");
  });

  it("passes parcelId to the API", async () => {
    mockResolveParcel.mockResolvedValueOnce(withCredits(sampleParcelResolve));

    await client.callTool({ name: "resolve_parcel", arguments: { parcelId: "146518_8.0108.27" } });

    expect(mockResolveParcel).toHaveBeenCalledWith(
      { q: undefined, parcelId: "146518_8.0108.27", lat: undefined, lng: undefined },
      "test-api-key",
    );
  });

  it("passes lat/lng together to the API", async () => {
    mockResolveParcel.mockResolvedValueOnce(withCredits(sampleParcelResolve));

    await client.callTool({ name: "resolve_parcel", arguments: { lat: 52.12, lng: 21.05 } });

    expect(mockResolveParcel).toHaveBeenCalledWith(
      { q: undefined, parcelId: undefined, lat: 52.12, lng: 21.05 },
      "test-api-key",
    );
  });

  it("rejects zero modes without calling the API", async () => {
    const result = await client.callTool({ name: "resolve_parcel", arguments: {} });
    expect(getTextContent(result)).toContain("exactly one lookup mode");
    expect(mockResolveParcel).not.toHaveBeenCalled();
  });

  it("rejects two modes without calling the API", async () => {
    const result = await client.callTool({
      name: "resolve_parcel",
      arguments: { q: "Wawer 27", parcelId: "146518_8.0108.27" },
    });
    expect(getTextContent(result)).toContain("exactly one lookup mode");
    expect(mockResolveParcel).not.toHaveBeenCalled();
  });

  it("rejects a lone lat without lng", async () => {
    const result = await client.callTool({ name: "resolve_parcel", arguments: { lat: 52.12 } });
    expect(getTextContent(result)).toContain("lat and lng must be provided together");
    expect(mockResolveParcel).not.toHaveBeenCalled();
  });

  it("surfaces not_covered as a refunded miss", async () => {
    mockResolveParcel.mockResolvedValueOnce(withCredits({
      query: { mode: "q", q: "Nieznane 999" },
      coverage: "not_covered",
      as_of: null,
      matches: [],
      truncated: false,
    } satisfies ParcelResolveResponse));

    const result = await client.callTool({ name: "resolve_parcel", arguments: { q: "Nieznane 999" } });
    const text = getTextContent(result);
    expect(text).toContain("No parcel matched");
    expect(text).toContain("refunded");
  });
});

// ── Tests: estimate_value ──────────────────────────────────────────

const sampleValuation: ValuationResponse = {
  location: { country_code: "PL", lat: 52.2297, lng: 21.0122, county_code: "1465" },
  metric: "estimated_apartment_value",
  currency: "PLN",
  segment: { property_type: "apartment", market_type: "all", area_m2: 55, rooms: null },
  result: {
    estimated_value: 1210000,
    price_per_m2: 22000,
    value_range_likely: { low: 1100000, high: 1320000 },
    value_range_wide: { low: 950000, high: 1450000 },
    confidence: 0.82,
    confidence_band: "high",
  },
  inputs: {
    comps_total: 34,
    radius_m: 1000,
    window_months: 24,
    comparables: [
      { distance_m: 210, transaction_date: "2025-08-12", area_m2: 54, price_per_m2: 21500, rooms: 3, floor: 4, market_type: "secondary", district: "Mokotów", has_unit_number: true, unit_number: "11_LOK" },
    ],
  },
  quality: {
    coverage: "covered",
    as_of: "2025-11-23",
    price_basis: "apartment",
    ess: 18.4,
    accuracy_segment: "wwa",
    note: "Indicative market-value estimate for an apartment. This is an orientation estimate, NOT a certified appraisal (operat szacunkowy).",
  },
};

describe("estimate_value", () => {
  it("passes lat/lng + area and formats the estimate (comps included by default)", async () => {
    mockGetValuation.mockResolvedValueOnce(withCredits(sampleValuation));

    const result = await client.callTool({ name: "estimate_value", arguments: { lat: 52.2297, lng: 21.0122, area: 55 } });
    const text = getTextContent(result);

    expect(mockGetValuation).toHaveBeenCalledWith(
      { lat: 52.2297, lng: 21.0122, parcelId: undefined, area: 55, rooms: undefined, market: undefined, includeComps: true },
      "test-api-key",
    );
    expect(text).toContain("Apartment value estimate");
    expect(text).toContain("Confidence: high");
    expect(text).toContain("Mokotów");
    expect(text).toContain("operat szacunkowy");
    expect(text).toContain("API tokens: 48 remaining");
  });

  it("passes parcelId + optional rooms/market", async () => {
    mockGetValuation.mockResolvedValueOnce(withCredits(sampleValuation));

    await client.callTool({ name: "estimate_value", arguments: { parcelId: "146502_8.0403.10", area: 62, rooms: 3, market: "secondary" } });

    expect(mockGetValuation).toHaveBeenCalledWith(
      { lat: undefined, lng: undefined, parcelId: "146502_8.0403.10", area: 62, rooms: 3, market: "secondary", includeComps: true },
      "test-api-key",
    );
  });

  it("forwards includeComps=false", async () => {
    mockGetValuation.mockResolvedValueOnce(withCredits(sampleValuation));

    await client.callTool({ name: "estimate_value", arguments: { lat: 52.2, lng: 21.0, area: 40, includeComps: false } });

    expect(mockGetValuation).toHaveBeenCalledWith(
      expect.objectContaining({ includeComps: false }),
      "test-api-key",
    );
  });

  it("rejects zero location modes without calling the API", async () => {
    const result = await client.callTool({ name: "estimate_value", arguments: { area: 55 } });
    expect(getTextContent(result)).toContain("exactly one location");
    expect(mockGetValuation).not.toHaveBeenCalled();
  });

  it("rejects both lat/lng and parcelId without calling the API", async () => {
    const result = await client.callTool({
      name: "estimate_value",
      arguments: { lat: 52.2, lng: 21.0, parcelId: "146502_8.0403.10", area: 55 },
    });
    expect(getTextContent(result)).toContain("exactly one location");
    expect(mockGetValuation).not.toHaveBeenCalled();
  });

  it("rejects a lone lat without lng", async () => {
    const result = await client.callTool({ name: "estimate_value", arguments: { lat: 52.2, area: 55 } });
    expect(getTextContent(result)).toContain("lat and lng must be provided together");
    expect(mockGetValuation).not.toHaveBeenCalled();
  });

  it("rejects area below 10 at the schema (no API call)", async () => {
    const result = await client.callTool({ name: "estimate_value", arguments: { lat: 52.2, lng: 21.0, area: 5 } });
    expect(result.isError).toBe(true);
    expect(mockGetValuation).not.toHaveBeenCalled();
  });

  // Latitude bounds mirror search_by_area — only points inside Poland are meaningful.
  it("rejects a pin outside Poland at the schema (no API call)", async () => {
    for (const args of [
      { lat: 90, lng: 0 },
      { lat: -90, lng: 180 },
      { lat: 89.99, lng: 21 },
      { lat: 48.5, lng: 21 },
      { lat: 52.2, lng: 30 },
    ]) {
      const result = await client.callTool({ name: "estimate_value", arguments: { ...args, area: 55 } });
      expect(result.isError).toBe(true);
    }
    expect(mockGetValuation).not.toHaveBeenCalled();
  });

  it("surfaces no_data as a refunded miss (no estimate)", async () => {
    mockGetValuation.mockResolvedValueOnce(withCredits({
      ...sampleValuation,
      location: { country_code: "PL", lat: 52.9, lng: 19.1, county_code: null },
      result: {
        estimated_value: null, price_per_m2: null,
        value_range_likely: { low: null, high: null }, value_range_wide: { low: null, high: null },
        confidence: null, confidence_band: null,
      },
      inputs: { comps_total: 2, radius_m: null, window_months: 24, comparables: null },
      quality: { ...sampleValuation.quality, coverage: "no_data", as_of: null, accuracy_segment: null, ess: null },
    } satisfies ValuationResponse));

    const result = await client.callTool({ name: "estimate_value", arguments: { lat: 52.9, lng: 19.1, area: 55 } });
    const text = getTextContent(result);
    expect(text).toContain("No estimate");
    expect(text).toContain("refunded");
  });
});

// ── Tests: search_by_polygon ───────────────────────────────────────

describe("search_by_polygon", () => {
  const polygon = {
    type: "Polygon" as const,
    coordinates: [[[21.0, 52.2], [21.01, 52.2], [21.01, 52.21], [21.0, 52.21], [21.0, 52.2]]],
  };

  it("passes polygon and maps propertyType to number", async () => {
    mockSearchByPolygon.mockResolvedValueOnce(withCredits(sampleSpatialResponse));

    await client.callTool({
      name: "search_by_polygon",
      arguments: { polygon, propertyType: "unit" },
    });

    expect(mockSearchByPolygon).toHaveBeenCalledWith(
      expect.objectContaining({
        polygon,
        propertyType: 4,
      }),
      "test-api-key",
    );
  });

  it("passes optional filters", async () => {
    mockSearchByPolygon.mockResolvedValueOnce(withCredits(sampleSpatialResponse));

    await client.callTool({
      name: "search_by_polygon",
      arguments: { polygon, minPrice: 300000, dateFrom: "2024-01-01", limit: 50 },
    });

    expect(mockSearchByPolygon).toHaveBeenCalledWith(
      expect.objectContaining({
        minPrice: 300000,
        dateFrom: "2024-01-01",
        limit: 50,
      }),
      "test-api-key",
    );
  });

  it("shows truncation warning when response is truncated", async () => {
    const truncated: SpatialSearchResponse = {
      ...sampleSpatialResponse,
      truncated: true,
      total: 5000,
    };
    mockSearchByPolygon.mockResolvedValueOnce(withCredits(truncated));

    const result = await client.callTool({
      name: "search_by_polygon",
      arguments: { polygon },
    });
    const text = getTextContent(result);

    expect(text).toContain("truncated");
    expect(text).toContain("5");
  });
});

// ── Tests: optional tools (CENOGRAM_EXPERIMENTAL_TOOLS=1) ──
// These 4 tools are gated off by default; the default suite above asserts their absence.
// Here we flip the flag and build a SEPARATE server/client so the nested describes
// register + exercise them. `client` is shadowed → the describes below bind lexically to
// this flag-on client, not the module-level (flag-off) one. Env is restored in afterAll.
describe("optional tools (flag on)", () => {
  let client: Client;
  let prevFlag: string | undefined;

  beforeAll(async () => {
    prevFlag = process.env.CENOGRAM_EXPERIMENTAL_TOOLS;
    process.env.CENOGRAM_EXPERIMENTAL_TOOLS = "1";
    const { createMcpServer } = await import("../index.js");
    const server = createMcpServer("test-api-key");
    const [clientTransport, serverTransport] = InMemoryTransport.createLinkedPair();
    await server.connect(serverTransport);
    client = new Client({ name: "test-client-exp", version: "1.0.0" });
    await client.connect(clientTransport);
  });

  afterAll(() => {
    if (prevFlag === undefined) delete process.env.CENOGRAM_EXPERIMENTAL_TOOLS;
    else process.env.CENOGRAM_EXPERIMENTAL_TOOLS = prevFlag;
  });

  it("registers all 27 tools including the 4 optional tools", async () => {
    const { tools } = await client.listTools();
    expect(tools).toHaveLength(27);
    const names = tools.map((t) => t.name);
    expect(names).toEqual(expect.arrayContaining([
      "get_rental_yield",
      "list_rental_yield_locations",
      "get_price_spread",
      "list_price_spread_locations",
    ]));
  });

  it("instructions surface the rental-yield workflow when the tools are registered (cross-check)", () => {
    // Same flag drives both the instructions line and the registration — flag on → both present.
    const instructions = client.getInstructions() ?? "";
    expect(instructions).toContain("Rental yield:");
    expect(instructions).toContain("Price spread:");
  });

describe("get_rental_yield", () => {
  const sampleYield = {
    location: { name: "Warszawa", country_code: "PL", location_type: "city", teryt: "1465" },
    metric: "indicative_gross_rental_yield",
    currency: "PLN",
    segment: { market_type: "secondary", property_type: "apartment", area_bucket: null },
    result: { gross_yield_pct: 5.5, calculation_method: "ratio_of_market_medians", matched_observations: false },
    inputs: {
      rent: { median_monthly_asking_per_m2: 75.49, annualized_per_m2: 905.88, sample_n: 7468, snapshot_date: "2025-11-20" },
      transaction: { median_price_per_m2: 16472, sample_n: 13263, window: { from: "2024-11-20", to: "2025-11-23" } },
    },
    distribution: {
      asking_rent_monthly_per_m2: { p10: 50, p25: 62, p50: 75.49, p75: 90, p90: 110 },
      transaction_price_per_m2: { p10: 12000, p25: 14000, p50: 16472, p75: 19000, p90: 22000 },
    },
    assumptions: { vacancy_included: false, tax_included: false, maintenance_included: false, transaction_costs_included: false },
    quality: { coverage: "full", confidence: "high", as_of: "2025-11-23", stale: false, notes: ["indicative gross yield, excludes vacancy and tax"] },
  };

  it("returns a friendly message when neither location nor teryt is given", async () => {
    const result = await client.callTool({ name: "get_rental_yield", arguments: {} });
    const text = getTextContent(result);
    expect(text).toContain("location");
    expect(text).toContain("teryt");
    expect(mockGetRentalYield).not.toHaveBeenCalled();
  });

  it("formats a yield result and passes location through", async () => {
    mockGetRentalYield.mockResolvedValueOnce(withCredits(sampleYield));
    const result = await client.callTool({ name: "get_rental_yield", arguments: { location: "Warszawa" } });
    const text = getTextContent(result);
    expect(text).toContain("Warszawa");
    expect(text).toContain("5.5%");
    expect(text).toContain("secondary market");
    expect(mockGetRentalYield).toHaveBeenCalledWith({ location: "Warszawa", teryt: undefined, areaBucket: undefined }, expect.any(String));
  });

  it("no_rental_data coverage → tip points at list_rental_yield_locations, REST-URL note hidden", async () => {
    const noData = {
      ...sampleYield,
      result: { ...sampleYield.result, gross_yield_pct: null },
      inputs: { rent: { ...sampleYield.inputs.rent, sample_n: null }, transaction: sampleYield.inputs.transaction },
      quality: { ...sampleYield.quality, coverage: "no_rental_data", notes: ["Brak danych czynszowych dla tej lokalizacji — listę pokrytych miast zwraca GET /api/v1/rental-yield/locations"] },
    };
    mockGetRentalYield.mockResolvedValueOnce(withCredits(noData));
    const result = await client.callTool({ name: "get_rental_yield", arguments: { teryt: "0215" } });
    const text = getTextContent(result);
    expect(text).toContain("list_rental_yield_locations");
    // REST path note suppressed in MCP output (LLM gets a tool name, not a URL)
    expect(text).not.toContain("/api/v1/rental-yield/locations");
  });
});

describe("list_rental_yield_locations", () => {
  const sampleCatalog = {
    data: [
      { location: "Warszawa", county_code: "1465", voivodeship: "Mazowieckie", type: "city", rent_sample_n: 7040, confidence: "high" },
      { location: "legionowski", county_code: "1408", voivodeship: "Mazowieckie", type: "county", rent_sample_n: 120, confidence: "high" },
    ],
    meta: { total: 2, snapshot_date: "2026-06-02" },
  };

  it("formats the catalog with header, snapshot date, and per-location lines", async () => {
    mockGetRentalYieldLocations.mockResolvedValueOnce(withCredits(sampleCatalog));
    const result = await client.callTool({ name: "list_rental_yield_locations", arguments: {} });
    const text = getTextContent(result);
    expect(text).toContain("2 locations");
    expect(text).toContain("2026-06-02");
    expect(text).toContain("Warszawa (teryt 1465, Mazowieckie, city)");
    expect(text).toContain("legionowski (teryt 1408, Mazowieckie, county)");
    expect(mockGetRentalYieldLocations).toHaveBeenCalledWith({ search: undefined }, expect.any(String));
  });

  it("passes search through to the API", async () => {
    mockGetRentalYieldLocations.mockResolvedValueOnce(withCredits({ data: [sampleCatalog.data[0]], meta: { total: 1, snapshot_date: "2026-06-02" } }));
    const result = await client.callTool({ name: "list_rental_yield_locations", arguments: { search: "warsz" } });
    const text = getTextContent(result);
    expect(text).toContain("Warszawa");
    expect(mockGetRentalYieldLocations).toHaveBeenCalledWith({ search: "warsz" }, expect.any(String));
  });

  it("empty catalog → friendly no-match message", async () => {
    mockGetRentalYieldLocations.mockResolvedValueOnce(withCredits({ data: [], meta: { total: 0, snapshot_date: null } }));
    const result = await client.callTool({ name: "list_rental_yield_locations", arguments: { search: "zzz" } });
    const text = getTextContent(result);
    expect(text).toContain("No rental-yield-covered locations match");
  });
});

describe("get_price_spread", () => {
  const sampleSpread = {
    location: { name: "Warszawa", country_code: "PL", location_type: "city", teryt: "1465" },
    metric: "asking_to_transaction_price_spread",
    currency: "PLN",
    segment: { market_type: "all", property_type: "apartment", area_bucket: null },
    result: { spread_pct: 8.41, calculation_method: "relative_difference_of_market_medians", matched_observations: false },
    inputs: {
      asking: { median_price_per_m2: 16585, sample_n: 200, snapshot_date: "2026-06-01" },
      transaction: { median_price_per_m2: 15298, sample_n: 500, window: { from: "2025-06-01", to: "2026-06-01" } },
    },
    distribution: {
      asking_sale_per_m2: { p10: 12000, p25: 14500, p50: 16585, p75: 19000, p90: 23000 },
      transaction_price_per_m2: { p10: 11000, p25: 13200, p50: 15298, p75: 18000, p90: 21000 },
    },
    quality: { coverage: "full", confidence: "high", as_of: "2026-06-01", stale: false, notes: ["spread = how far the median asking price exceeds the median transaction price (may be negative)"] },
  };

  it("returns a friendly message when neither location nor teryt is given", async () => {
    const result = await client.callTool({ name: "get_price_spread", arguments: {} });
    const text = getTextContent(result);
    expect(text).toContain("location");
    expect(text).toContain("teryt");
    expect(mockGetPriceSpread).not.toHaveBeenCalled();
  });

  it("formats a spread result and passes location + marketType through", async () => {
    mockGetPriceSpread.mockResolvedValueOnce(withCredits(sampleSpread));
    const result = await client.callTool({ name: "get_price_spread", arguments: { location: "Warszawa", marketType: "all" } });
    const text = getTextContent(result);
    expect(text).toContain("Warszawa");
    expect(text).toContain("+8.41%");
    expect(text).toContain("all market");
    expect(mockGetPriceSpread).toHaveBeenCalledWith({ location: "Warszawa", teryt: undefined, marketType: "all", areaBucket: undefined }, expect.any(String));
  });

  it("negative spread rendered as 'below transaction'", async () => {
    mockGetPriceSpread.mockResolvedValueOnce(withCredits({ ...sampleSpread, result: { ...sampleSpread.result, spread_pct: -6.67 } }));
    const result = await client.callTool({ name: "get_price_spread", arguments: { location: "Warszawa" } });
    const text = getTextContent(result);
    expect(text).toContain("-6.67%");
    expect(text).toContain("below transaction");
  });

  it("no_asking_data coverage → tip points at list_price_spread_locations, REST-URL note hidden", async () => {
    const noData = {
      ...sampleSpread,
      result: { ...sampleSpread.result, spread_pct: null },
      inputs: { asking: { ...sampleSpread.inputs.asking, sample_n: null }, transaction: sampleSpread.inputs.transaction },
      quality: { ...sampleSpread.quality, coverage: "no_asking_data", notes: ["Brak danych ofertowych sprzedaży dla tej lokalizacji — listę pokrytych miast zwraca GET /api/v1/price-spread/locations"] },
    };
    mockGetPriceSpread.mockResolvedValueOnce(withCredits(noData));
    const result = await client.callTool({ name: "get_price_spread", arguments: { teryt: "0215" } });
    const text = getTextContent(result);
    expect(text).toContain("list_price_spread_locations");
    // REST path note suppressed in MCP output (LLM gets a tool name, not a URL)
    expect(text).not.toContain("/api/v1/price-spread/locations");
  });
});

describe("list_price_spread_locations", () => {
  const sampleCatalog = {
    data: [
      { location: "Warszawa", county_code: "1465", voivodeship: "Mazowieckie", type: "city", asking_sample_n: 5000, confidence: "high" },
      { location: "Kraków", county_code: "1261", voivodeship: "Małopolskie", type: "city", asking_sample_n: 900, confidence: "high" },
    ],
    meta: { total: 2, snapshot_date: "2026-06-02" },
  };

  it("formats the catalog with header, snapshot date, and per-location lines", async () => {
    mockGetPriceSpreadLocations.mockResolvedValueOnce(withCredits(sampleCatalog));
    const result = await client.callTool({ name: "list_price_spread_locations", arguments: {} });
    const text = getTextContent(result);
    expect(text).toContain("2 locations");
    expect(text).toContain("2026-06-02");
    expect(text).toContain("Warszawa (teryt 1465, Mazowieckie, city)");
    expect(text).toContain("Kraków (teryt 1261, Małopolskie, city)");
    expect(mockGetPriceSpreadLocations).toHaveBeenCalledWith({ search: undefined }, expect.any(String));
  });

  it("passes search through to the API", async () => {
    mockGetPriceSpreadLocations.mockResolvedValueOnce(withCredits({ data: [sampleCatalog.data[0]], meta: { total: 1, snapshot_date: "2026-06-02" } }));
    const result = await client.callTool({ name: "list_price_spread_locations", arguments: { search: "warsz" } });
    const text = getTextContent(result);
    expect(text).toContain("Warszawa");
    expect(mockGetPriceSpreadLocations).toHaveBeenCalledWith({ search: "warsz" }, expect.any(String));
  });

  it("empty catalog → friendly no-match message", async () => {
    mockGetPriceSpreadLocations.mockResolvedValueOnce(withCredits({ data: [], meta: { total: 0, snapshot_date: null } }));
    const result = await client.callTool({ name: "list_price_spread_locations", arguments: { search: "zzz" } });
    const text = getTextContent(result);
    expect(text).toContain("No price-spread-covered locations match");
  });
});

}); // end optional tools (flag on)

describe("compare_locations", () => {
  it("passes districts string and maps filters", async () => {
    mockCompareLocations.mockResolvedValueOnce(withCredits(sampleCompareResponse));

    await client.callTool({
      name: "compare_locations",
      arguments: { districts: "Mokotów,Wola", propertyType: "unit", dateFrom: "2024-01-01" },
    });

    expect(mockCompareLocations).toHaveBeenCalledWith(
      expect.objectContaining({
        districts: "Mokotów,Wola",
        propertyType: 4,
        dateFrom: "2024-01-01",
      }),
      "test-api-key",
    );
  });

  it("forwards mpzpDesignation to backend", async () => {
    mockCompareLocations.mockResolvedValueOnce(withCredits(sampleCompareResponse));

    await client.callTool({
      name: "compare_locations",
      arguments: { districts: "Mokotów,Wola", propertyType: "land", mpzpDesignation: "terenRolniczy" },
    });

    expect(mockCompareLocations).toHaveBeenCalledWith(
      expect.objectContaining({
        districts: "Mokotów,Wola",
        propertyType: 1,
        mpzpDesignation: "terenRolniczy",
      }),
      "test-api-key",
    );
  });

  it("renders comparison table", async () => {
    mockCompareLocations.mockResolvedValueOnce(withCredits(sampleCompareResponse));

    const result = await client.callTool({
      name: "compare_locations",
      arguments: { districts: "Mokotów,Wola", propertyType: "unit" },
    });
    const text = getTextContent(result);

    expect(text).toContain("Location comparison");
    expect(text).toContain("Mokotów");
    expect(text).toContain("Wola");
    expect(text).toContain("2024-01-01");
  });

  it("shows suggestions for unmatched districts", async () => {
    const withSuggestion: CompareResponse = {
      "Mokotow": { median_price_m2: null, avg_area: null, min_date: null, max_date: null, total: 0, suggestions: ["Mokotów"] },
    };
    mockCompareLocations.mockResolvedValueOnce(withCredits(withSuggestion));

    const result = await client.callTool({
      name: "compare_locations",
      arguments: { districts: "Mokotow,Wola", propertyType: "unit" },
    });
    const text = getTextContent(result);

    expect(text).toContain("Did you mean: Mokotów");
  });

  it("rejects 6 districts client-side (zod refinement)", async () => {
    const result = await client.callTool({
      name: "compare_locations",
      arguments: { districts: "A,B,C,D,E,F", propertyType: "unit" },
    });
    expect(getTextContent(result)).toContain("2-5 unique");
    expect(mockCompareLocations).not.toHaveBeenCalled();
  });

  it("rejects 1 district client-side (zod refinement)", async () => {
    const result = await client.callTool({
      name: "compare_locations",
      arguments: { districts: "Mokotów", propertyType: "unit" },
    });
    expect(getTextContent(result)).toContain("2-5 unique");
    expect(mockCompareLocations).not.toHaveBeenCalled();
  });

  it("rejects duplicate-collapsed list below 2 unique (zod refinement)", async () => {
    const result = await client.callTool({
      name: "compare_locations",
      arguments: { districts: "Mokotów,Mokotów,Mokotów", propertyType: "unit" },
    });
    expect(getTextContent(result)).toContain("2-5 unique");
    expect(mockCompareLocations).not.toHaveBeenCalled();
  });

  it("rejects empty filter list (handler-side)", async () => {
    const result = await client.callTool({
      name: "compare_locations",
      arguments: { districts: "Mokotów,Wola" },
    });
    expect(getTextContent(result)).toContain("at least one filter");
    expect(mockCompareLocations).not.toHaveBeenCalled();
  });

  it("rejects trailing comma collapsing to 1 unique (zod refinement)", async () => {
    const result = await client.callTool({
      name: "compare_locations",
      arguments: { districts: "Mokotów,", propertyType: "unit" },
    });
    expect(getTextContent(result)).toContain("2-5 unique");
    expect(mockCompareLocations).not.toHaveBeenCalled();
  });

  it("rejects empty districts string (zod refinement)", async () => {
    const result = await client.callTool({
      name: "compare_locations",
      arguments: { districts: "", propertyType: "unit" },
    });
    expect(getTextContent(result)).toContain("2-5 unique");
    expect(mockCompareLocations).not.toHaveBeenCalled();
  });

  it("rejects empty-string street as sole filter (handler-side)", async () => {
    const result = await client.callTool({
      name: "compare_locations",
      arguments: { districts: "Mokotów,Wola", street: "" },
    });
    expect(getTextContent(result)).toContain("at least one filter");
    expect(mockCompareLocations).not.toHaveBeenCalled();
  });

  it("rejects whitespace-only string filters (mirror of server's safeString)", async () => {
    const result = await client.callTool({
      name: "compare_locations",
      arguments: { districts: "Mokotów,Wola", street: "   ", dateFrom: "  " },
    });
    expect(getTextContent(result)).toContain("at least one filter");
    expect(mockCompareLocations).not.toHaveBeenCalled();
  });

  it("includeDemographics=true sends include=demographics to the backend", async () => {
    mockCompareLocations.mockResolvedValueOnce(withCredits(sampleCompareResponse));
    await client.callTool({
      name: "compare_locations",
      arguments: { districts: "Mokotów,Wola", propertyType: "unit", includeDemographics: true },
    });
    expect(mockCompareLocations).toHaveBeenCalledWith(
      expect.objectContaining({ include: "demographics" }),
      "test-api-key",
    );
  });

  it("omits include when includeDemographics is not set", async () => {
    mockCompareLocations.mockResolvedValueOnce(withCredits(sampleCompareResponse));
    await client.callTool({
      name: "compare_locations",
      arguments: { districts: "Mokotów,Wola", propertyType: "unit" },
    });
    expect(mockCompareLocations).toHaveBeenCalledWith(
      expect.objectContaining({ include: undefined }),
      "test-api-key",
    );
  });

  it("renders the demographics block for districts that carry it, tolerating absence", async () => {
    const withDemo: CompareResponse = {
      "Mokotów": {
        ...sampleCompareResponse["Mokotów"]!,
        demographics: {
          unemployment_rate: { value: 3.2, year: 2024, unit: "%" },
          price_to_income_years: { value: 14.5, year: null, unit: "years", derived: true, cross_source: true },
        },
      },
      // Wola has no demographics key (REST omits it for unresolved districts) → must not crash.
      "Wola": { ...sampleCompareResponse["Wola"]! },
    };
    mockCompareLocations.mockResolvedValueOnce(withCredits(withDemo));
    const result = await client.callTool({
      name: "compare_locations",
      arguments: { districts: "Mokotów,Wola", propertyType: "unit", includeDemographics: true },
    });
    const text = getTextContent(result);
    expect(text).toContain("Demographics (GUS BDL");
    expect(text).toContain("unemployment_rate");
    expect(text).toContain("cross-source");
    expect(text).toContain("no demographic data for Wola");
  });
});

// ── Tests: get_demographics ────────────────────────────────────────

describe("get_demographics", () => {
  const sampleDemographics = {
    location: {
      name: "Warszawa",
      country_code: "PL" as const,
      location_type: "city" as const,
      teryt: "1465",
      level: "powiat",
      hierarchy: { wojewodztwo: { teryt: "14", name: "Mazowieckie" } },
    },
    coverage: "full" as const,
    indicators: {
      population_density: { name: "Gęstość zaludnienia", unit: "osoba/km²", variable_id: 60559, category: "demographics", level: "powiat", values: { "2024": 3500 } },
      unemployment_rate: { name: "Stopa bezrobocia", unit: "%", variable_id: 60270, category: "economy", level: "powiat", values: { "2024": 3.2 } },
      higher_education_pct: { name: "% z wyższym wykształceniem", unit: "%", variable_id: null, category: "education", level: "powiat", values: { "2021": 45.6 }, derived: true, snapshot: true },
    },
    meta: { variables_count: 3, categories: ["demographics", "economy", "education"], levels_included: ["powiat", "wojewodztwo"], data_source: "GUS BDL (Bank Danych Lokalnych)", as_of: "2024" },
  };

  it("returns a friendly message when neither location nor teryt is given", async () => {
    const result = await client.callTool({ name: "get_demographics", arguments: {} });
    const text = getTextContent(result);
    expect(text).toContain("location");
    expect(text).toContain("teryt");
    expect(mockGetDemographics).not.toHaveBeenCalled();
  });

  it("rejects a malformed teryt before the API call", async () => {
    const result = await client.callTool({ name: "get_demographics", arguments: { teryt: "146" } });
    expect(getTextContent(result)).toContain("Invalid teryt");
    expect(mockGetDemographics).not.toHaveBeenCalled();
  });

  it("formats grouped indicators and passes location through", async () => {
    mockGetDemographics.mockResolvedValueOnce(withCredits(sampleDemographics));
    const result = await client.callTool({ name: "get_demographics", arguments: { location: "Warszawa" } });
    const text = getTextContent(result);
    expect(text).toContain("Warszawa");
    expect(text).toContain("Demographics");
    expect(text).toContain("Economy");
    expect(text).toContain("Gęstość zaludnienia");
    expect(text).toContain("as of 2024");
    expect(text).toContain("[derived, snapshot]");
    expect(mockGetDemographics).toHaveBeenCalledWith(
      expect.objectContaining({ location: "Warszawa", teryt: undefined }),
      "test-api-key",
    );
  });

  it("joins a category array into a CSV param", async () => {
    mockGetDemographics.mockResolvedValueOnce(withCredits(sampleDemographics));
    await client.callTool({ name: "get_demographics", arguments: { teryt: "14", category: ["housing", "economy"] } });
    expect(mockGetDemographics).toHaveBeenCalledWith(
      expect.objectContaining({ teryt: "14", category: "housing,economy" }),
      "test-api-key",
    );
  });

  it("renders a readable message for coverage:no_data", async () => {
    mockGetDemographics.mockResolvedValueOnce(withCredits({
      location: { name: null, country_code: "PL", location_type: "county", teryt: "9999", level: "powiat", hierarchy: {} },
      coverage: "no_data",
      indicators: {},
      meta: { variables_count: 0, categories: [], levels_included: [], data_source: "GUS BDL (Bank Danych Lokalnych)", as_of: null },
    }));
    const result = await client.callTool({ name: "get_demographics", arguments: { teryt: "9999" } });
    const text = getTextContent(result);
    expect(text).toContain("No GUS BDL indicators are available");
    expect(text).toContain("9999");
  });
});

// ── Tests: get_infrastructure_signals ──────────────────────────────

describe("get_infrastructure_signals", () => {
  const sampleSignals = {
    location: { name: "Warszawa", country_code: "PL" as const, location_type: "municipality" as const, teryt: "146501", level: "gmina" },
    coverage: "full" as const,
    tenders: {
      window_months: 12,
      by_category: { roads: 6, sewerage: 2 },
      recent: [
        { title: "Budowa kanalizacji", category: "sewerage", notice_type: "ContractNotice", published_at: "2026-07-07", value_pln: 1234567.89, value_kind: "estimated", attribution_confidence: "high", bzp_url: "https://example.test/1" },
        { title: "Przebudowa drogi powiatowej", category: "roads", notice_type: "ContractNotice", published_at: "2026-07-01", value_pln: null, value_kind: null, attribution_confidence: "low", bzp_url: null },
      ],
      truncated: false,
    },
    kposk: { in_agglomeration: true, agglomerations: [{ name: "Warszawa", rlm: 2500000 }], truncated: false },
    capex: { by_year: { "2026": { value_pln: 4506814136, doc_category: "ZmianaWPF", resolution_date: "2026-03-12", gmina_count: 1 } } },
    meta: { coverage_note: "Tenders come from the national public procurement bulletin, which carries below-EU-threshold contracts only (from 2021).", as_of: "2026-07-07" },
  };

  it("returns a friendly message when neither location nor teryt is given", async () => {
    const result = await client.callTool({ name: "get_infrastructure_signals", arguments: {} });
    const text = getTextContent(result);
    expect(text).toContain("location");
    expect(text).toContain("teryt");
    expect(mockGetInfrastructureSignals).not.toHaveBeenCalled();
  });

  it("rejects a malformed teryt before the API call (no credit spent)", async () => {
    const result = await client.callTool({ name: "get_infrastructure_signals", arguments: { teryt: "146" } });
    expect(getTextContent(result)).toContain("Invalid teryt");
    expect(mockGetInfrastructureSignals).not.toHaveBeenCalled();
  });

  it("formats the three overlays and flags non-municipal attribution", async () => {
    mockGetInfrastructureSignals.mockResolvedValueOnce(withCredits(sampleSignals));
    const result = await client.callTool({ name: "get_infrastructure_signals", arguments: { teryt: "146501" } });
    const text = getTextContent(result);
    expect(text).toContain("Infrastructure signals — Warszawa");
    expect(text).toContain("Roads: 6");
    expect(text).toContain("estimated value");
    // The caveat belongs on the low-confidence notice ONLY. Assert per line: a substring check on
    // the whole text would pass even if every notice carried it.
    const lines = text.split("\n");
    const municipal = lines.find((l) => l.includes("Budowa kanalizacji")) ?? "";
    const county = lines.find((l) => l.includes("Przebudowa drogi powiatowej")) ?? "";
    expect(municipal).not.toContain("authority based here");
    expect(county).toContain("authority based here, works may be elsewhere");
    expect(text).toContain("In a designated agglomeration");
    expect(text).toContain("Planned capital expenditure");
    expect(text).toContain("below-EU-threshold");
    expect(mockGetInfrastructureSignals).toHaveBeenCalledWith(
      expect.objectContaining({ teryt: "146501", location: undefined }),
      "test-api-key",
    );
  });

  it("county aggregation says so and reports how many municipalities were summed", async () => {
    mockGetInfrastructureSignals.mockResolvedValueOnce(withCredits({
      ...sampleSignals,
      location: { name: "krotoszyński", country_code: "PL", location_type: "county", teryt: "3004", level: "powiat" },
      capex: { by_year: { "2026": { value_pln: 1000, doc_category: "mixed", resolution_date: "2026-03-12", gmina_count: 7 } } },
    }));
    const text = getTextContent(await client.callTool({ name: "get_infrastructure_signals", arguments: { location: "krotoszyński" } }));
    expect(text).toContain("aggregated over every municipality in this county");
    expect(text).toContain("summed across 7 municipalities");
  });

  // Dual-state: the tool must never let the model conclude "this gmina is not investing".
  it("coverage:no_data renders the dual-state disclaimer, not an affirmative negative", async () => {
    mockGetInfrastructureSignals.mockResolvedValueOnce(withCredits({
      location: { name: "Testowo", country_code: "PL", location_type: "municipality", teryt: "026402", level: "gmina" },
      coverage: "no_data",
      tenders: { window_months: 12, by_category: {}, recent: [], truncated: false },
      kposk: { in_agglomeration: false, agglomerations: [], truncated: false },
      capex: { by_year: {} },
      meta: { coverage_note: "Tenders come from the national public procurement bulletin.", as_of: null },
    }));
    const text = getTextContent(await client.callTool({ name: "get_infrastructure_signals", arguments: { teryt: "026402" } }));
    expect(text).toContain("No infrastructure signals are recorded");
    expect(text).toContain("does NOT mean the municipality is not investing");
  });
});

// ── Tests: get_building_breakdown ──────────────────────────────────

describe("get_building_breakdown", () => {
  const VALID_UUID = "11111111-2222-3333-4444-555555555555";

  it("renders a multi-building breakdown with credit footer", async () => {
    mockGetBuildingBreakdown.mockResolvedValueOnce(withCredits({
      data: [
        { building_type: 110, footprint_area_m2: "250.00", footprint_area_alt_m2: null, footprint_divergent: null, storeys: 3, est_total_area_m2: "750.00", match_confidence: "high" },
        { building_type: 127, footprint_area_m2: "40.00", footprint_area_alt_m2: null, footprint_divergent: null, storeys: 1, est_total_area_m2: "40.00", match_confidence: "low" },
      ],
      truncated: false,
    }));

    const result = await client.callTool({ name: "get_building_breakdown", arguments: { transaction_id: VALID_UUID } });
    const text = getTextContent(result);

    expect(mockGetBuildingBreakdown).toHaveBeenCalledWith(VALID_UUID, "test-api-key");
    expect(text).toContain("Per-building breakdown (2 buildings)");
    expect(text).toContain("Residential (Mieszkalny)");
    expect(text).toContain("Farm/Utility (Gospodarczy)");
    expect(text).toContain("storeys 3");
    expect(text).toContain("est. total floor area");
    expect(text).toContain("match confidence: high");
    expect(text).toMatch(/API tokens.*48/);
  });

  it("surfaces the alternate footprint only when the two measurements diverge", async () => {
    mockGetBuildingBreakdown.mockResolvedValueOnce(withCredits({
      data: [
        { building_type: 110, footprint_area_m2: "250.00", footprint_area_alt_m2: "280.00", footprint_divergent: true, storeys: 2, est_total_area_m2: "500.00", match_confidence: "high" },
      ],
      truncated: false,
    }));

    const result = await client.callTool({ name: "get_building_breakdown", arguments: { transaction_id: VALID_UUID } });
    const text = getTextContent(result);

    expect(text).toContain("alt. measurement");
    expect(text).toContain("diverge");
    expect(text).toMatch(/280/);
  });

  it("single building without a second measurement renders no alt/confidence noise", async () => {
    mockGetBuildingBreakdown.mockResolvedValueOnce(withCredits({
      data: [
        { building_type: 110, footprint_area_m2: "120.00", footprint_area_alt_m2: null, footprint_divergent: null, storeys: 1, est_total_area_m2: "120.00", match_confidence: null },
      ],
      truncated: false,
    }));

    const result = await client.callTool({ name: "get_building_breakdown", arguments: { transaction_id: VALID_UUID } });
    const text = getTextContent(result);

    expect(text).toContain("footprint");
    expect(text).not.toContain("alt. measurement");
    expect(text).not.toContain("match confidence");
    expect(text).not.toContain("null");
  });

  it("empty data (no buildings / unknown id) → friendly message", async () => {
    mockGetBuildingBreakdown.mockResolvedValueOnce(withCredits({ data: [], truncated: false }));

    const result = await client.callTool({ name: "get_building_breakdown", arguments: { transaction_id: VALID_UUID } });
    const text = getTextContent(result);

    expect(text).toContain("No per-building data available");
  });

  it("truncated response → shows the 500-building note", async () => {
    mockGetBuildingBreakdown.mockResolvedValueOnce(withCredits({
      data: [{ building_type: 110, footprint_area_m2: "100.00", footprint_area_alt_m2: null, footprint_divergent: null, storeys: 1, est_total_area_m2: "100.00", match_confidence: "high" }],
      truncated: true,
    }));

    const result = await client.callTool({ name: "get_building_breakdown", arguments: { transaction_id: VALID_UUID } });
    const text = getTextContent(result);

    expect(text).toContain("first 500 buildings");
  });

  it("rejects a malformed transaction_id via zod, no API call (protects credit)", async () => {
    const result = await client.callTool({ name: "get_building_breakdown", arguments: { transaction_id: "not-a-uuid" } });

    expect(result.isError).toBe(true);
    expect(getTextContent(result)).toContain("UUID");
    expect(mockGetBuildingBreakdown).not.toHaveBeenCalled();
  });

  it("never names the source register", async () => {
    mockGetBuildingBreakdown.mockResolvedValueOnce(withCredits({
      data: [{ building_type: 110, footprint_area_m2: "250.00", footprint_area_alt_m2: "280.00", footprint_divergent: true, storeys: 3, est_total_area_m2: "750.00", match_confidence: "high" }],
      truncated: false,
    }));

    const result = await client.callTool({ name: "get_building_breakdown", arguments: { transaction_id: VALID_UUID } });
    const text = getTextContent(result).toLowerCase();

    expect(findGuardToken(text)).toBeNull();
  });
});

// ── Tests: get_transaction_flood ───────────────────────────────────

describe("get_transaction_flood", () => {
  const VALID_UUID = "11111111-2222-3333-4444-555555555555";

  it("renders a per-parcel flood breakdown with credit footer", async () => {
    mockGetTransactionFlood.mockResolvedValueOnce(withCredits({
      data: [
        // Input mirrors the API's already-scrubbed shape (neutral EN labels, no source-register fingerprint).
        {
          flood_risk: "high", severity_rank: 1, worst_scenario: "river flood, 1-in-10-year", source: "river",
          depth_class: null, pct_in_zone: "45.00", nearest_zone_m: 0,
          scenarios: [{ scenario: "river flood, 1-in-10-year", source: "river", returnPeriod: 10, severity: 1, isLeveeFailure: false, depthClass: null }],
        },
      ],
      truncated: false,
    }));

    const result = await client.callTool({ name: "get_transaction_flood", arguments: { transaction_id: VALID_UUID } });
    const text = getTextContent(result);

    expect(mockGetTransactionFlood).toHaveBeenCalledWith(VALID_UUID, "test-api-key");
    expect(text).toContain("Per-parcel flood-zone breakdown (1 parcel in");
    expect(text).toContain("risk: high (~1-in-10-year)");
    expect(text).toContain("source: river");
    expect(findGuardToken(text)).toBeNull();
    expect(text).toMatch(/API tokens.*48/);
  });

  it("two-state empty data → neutral message that never asserts safety", async () => {
    mockGetTransactionFlood.mockResolvedValueOnce(withCredits({ data: [], truncated: false }));

    const result = await client.callTool({ name: "get_transaction_flood", arguments: { transaction_id: VALID_UUID } });
    const text = getTextContent(result);

    expect(text).toContain("No mapped flood-hazard zone");
    expect(text).toContain("not a guarantee of safety");
  });

  it("rejects a malformed transaction_id via zod, no API call (protects credit)", async () => {
    const result = await client.callTool({ name: "get_transaction_flood", arguments: { transaction_id: "not-a-uuid" } });

    expect(result.isError).toBe(true);
    expect(getTextContent(result)).toContain("UUID");
    expect(mockGetTransactionFlood).not.toHaveBeenCalled();
  });
});

// ── Tests: get_transaction_heritage ────────────────────────────────

describe("get_transaction_heritage", () => {
  const VALID_UUID = "11111111-2222-3333-4444-555555555555";

  it("renders a per-parcel heritage breakdown with credit footer", async () => {
    mockGetTransactionHeritage.mockResolvedValueOnce(withCredits({
      data: [
        // Input mirrors the API's already-scrubbed shape (neutral EN categories, no source-register fingerprint).
        {
          heritage_status: "listed", severity_rank: 1, pct_in_zone: "45.00", site_count: 1,
          sites: [{ category: "building", name: "Townhouse", function: "residential", period: "19th c.", entry_date: "1967-05-12" }],
        },
      ],
      truncated: false,
    }));

    const result = await client.callTool({ name: "get_transaction_heritage", arguments: { transaction_id: VALID_UUID } });
    const text = getTextContent(result);

    expect(mockGetTransactionHeritage).toHaveBeenCalledWith(VALID_UUID, "test-api-key");
    expect(text).toContain("Per-parcel heritage-listing breakdown (1 parcel with");
    expect(text).toContain("status: listed (protected monument on/at the parcel)");
    expect(text).toContain("Townhouse");
    expect(text).toContain("Indicative data");
    expect(text).toMatch(/API tokens.*48/);
  });

  it("two-state empty data → neutral message that never asserts the absence of protection", async () => {
    mockGetTransactionHeritage.mockResolvedValueOnce(withCredits({ data: [], truncated: false }));

    const result = await client.callTool({ name: "get_transaction_heritage", arguments: { transaction_id: VALID_UUID } });
    const text = getTextContent(result);

    expect(text).toContain("No heritage-listing records found");
    expect(text).toContain("not a statement that the property is free of heritage protection");
  });

  it("rejects a malformed transaction_id via zod, no API call (protects credit)", async () => {
    const result = await client.callTool({ name: "get_transaction_heritage", arguments: { transaction_id: "not-a-uuid" } });

    expect(result.isError).toBe(true);
    expect(getTextContent(result)).toContain("UUID");
    expect(mockGetTransactionHeritage).not.toHaveBeenCalled();
  });
});

// ── Tests: get_transaction_landslide ───────────────────────────────

describe("get_transaction_landslide", () => {
  const VALID_UUID = "11111111-2222-3333-4444-555555555555";

  it("renders a per-parcel landslide breakdown with credit footer", async () => {
    mockGetTransactionLandslide.mockResolvedValueOnce(withCredits({
      data: [
        // Input mirrors the API's already-scrubbed shape (neutral EN kinds, no source-register fingerprint).
        {
          landslide_risk: "landslide", severity_rank: 1, pct_in_zone: "45.00",
          zones: [{ kind: "landslide", source_version_date: "2021-03-15" }],
        },
      ],
      truncated: false,
    }));

    const result = await client.callTool({ name: "get_transaction_landslide", arguments: { transaction_id: VALID_UUID } });
    const text = getTextContent(result);

    expect(mockGetTransactionLandslide).toHaveBeenCalledWith(VALID_UUID, "test-api-key");
    expect(text).toContain("Per-parcel landslide-zone breakdown (1 parcel intersecting");
    expect(text).toContain("risk: landslide (a mapped landslide area)");
    expect(text).toContain("record version date: 2021-03-15");
    expect(text).toMatch(/API tokens.*48/);
  });

  it("two-state empty data → neutral message that never asserts safety", async () => {
    mockGetTransactionLandslide.mockResolvedValueOnce(withCredits({ data: [], truncated: false }));

    const result = await client.callTool({ name: "get_transaction_landslide", arguments: { transaction_id: VALID_UUID } });
    const text = getTextContent(result);

    expect(text).toContain("No mapped landslide-hazard zone");
    expect(text).toContain("not a guarantee of safety");
  });

  it("rejects a malformed transaction_id via zod, no API call (protects credit)", async () => {
    const result = await client.callTool({ name: "get_transaction_landslide", arguments: { transaction_id: "not-a-uuid" } });

    expect(result.isError).toBe(true);
    expect(getTextContent(result)).toContain("UUID");
    expect(mockGetTransactionLandslide).not.toHaveBeenCalled();
  });
});

// ── Tests: get_transaction_surroundings ────────────────────────────

describe("get_transaction_surroundings", () => {
  const VALID_UUID = "11111111-2222-3333-4444-555555555555";

  it("renders a per-plot surroundings breakdown with credit footer", async () => {
    mockGetTransactionSurroundings.mockResolvedValueOnce(withCredits({
      data: [
        {
          assessed: true,
          cemetery_distance_m: 240.5,
          landfill_distance_m: null,
          sewage_treatment_distance_m: null,
          industrial_area_distance_m: "890.00",
          industrial_plant_distance_m: "1500.00",
          livestock_farm_distance_m: null,
        },
      ],
      truncated: false,
    }));

    const result = await client.callTool({ name: "get_transaction_surroundings", arguments: { transaction_id: VALID_UUID } });
    const text = getTextContent(result);

    expect(mockGetTransactionSurroundings).toHaveBeenCalledWith(VALID_UUID, "test-api-key");
    expect(text).toContain("Per-parcel surroundings (1 plot;");
    expect(text).toContain("cemetery: ~241 m");
    expect(text).toContain("landfill (waste disposal): none within 3 km");
    expect(text).toContain("industrial/storage area: ~890 m");
    expect(text).toContain("large industrial plant: ~1500 m");
    expect(text).toContain("intensive livestock farm: none within 3 km");
    expect(text).toMatch(/API tokens.*48/);
  });

  it("two-state empty data → neutral message (no linked plots or unknown id)", async () => {
    mockGetTransactionSurroundings.mockResolvedValueOnce(withCredits({ data: [], truncated: false }));

    const result = await client.callTool({ name: "get_transaction_surroundings", arguments: { transaction_id: VALID_UUID } });
    const text = getTextContent(result);

    expect(text).toContain("No surroundings data is available");
  });

  it("rejects a malformed transaction_id via zod, no API call (protects credit)", async () => {
    const result = await client.callTool({ name: "get_transaction_surroundings", arguments: { transaction_id: "not-a-uuid" } });

    expect(result.isError).toBe(true);
    expect(getTextContent(result)).toContain("UUID");
    expect(mockGetTransactionSurroundings).not.toHaveBeenCalled();
  });
});

// ── Tests: get_transaction_transit ──────────────────────────────────

describe("get_transaction_transit", () => {
  const VALID_UUID = "11111111-2222-3333-4444-555555555555";

  it("renders a per-parcel transit breakdown with credit footer", async () => {
    mockGetTransactionTransit.mockResolvedValueOnce(withCredits({
      data: [
        {
          rail_distance_m: 850, rail_stop_name: "Central Station",
          metro_distance_m: null, metro_stop_name: null,
          tram_distance_m: 300, tram_stop_name: "Market Square",
          bus_distance_m: 120, bus_stop_name: "Post Office",
        },
      ],
      truncated: false,
    }));

    const result = await client.callTool({ name: "get_transaction_transit", arguments: { transaction_id: VALID_UUID } });
    const text = getTextContent(result);

    expect(mockGetTransactionTransit).toHaveBeenCalledWith(VALID_UUID, "test-api-key");
    expect(text).toContain("Per-parcel public transport access (1 parcel");
    expect(text).toContain("Rail: 850 m (Central Station)");
    expect(text).toContain("Tram: 300 m (Market Square)");
    expect(text).toContain("Bus: 120 m (Post Office)");
    expect(text).not.toContain("Metro:");
    expect(text).toMatch(/API tokens.*48/);
  });

  it("two-state empty data → neutral message that never asserts 'no transit access'", async () => {
    mockGetTransactionTransit.mockResolvedValueOnce(withCredits({ data: [], truncated: false }));

    const result = await client.callTool({ name: "get_transaction_transit", arguments: { transaction_id: VALID_UUID } });
    const text = getTextContent(result);

    expect(text).toContain("No public transport stop is recorded");
    expect(text).not.toContain("no transit access");
  });

  it("rejects a malformed transaction_id via zod, no API call (protects credit)", async () => {
    const result = await client.callTool({ name: "get_transaction_transit", arguments: { transaction_id: "not-a-uuid" } });

    expect(result.isError).toBe(true);
    expect(getTextContent(result)).toContain("UUID");
    expect(mockGetTransactionTransit).not.toHaveBeenCalled();
  });

  it("never names a feed aggregator, carrier, or transit authority", async () => {
    mockGetTransactionTransit.mockResolvedValueOnce(withCredits({
      data: [{
        rail_distance_m: 500, rail_stop_name: "Central Station",
        metro_distance_m: null, metro_stop_name: null,
        tram_distance_m: null, tram_stop_name: null,
        bus_distance_m: null, bus_stop_name: null,
      }],
      truncated: false,
    }));

    const result = await client.callTool({ name: "get_transaction_transit", arguments: { transaction_id: VALID_UUID } });
    expect(findGuardToken(getTextContent(result))).toBeNull();
  });
});

// ── Tests: get_transaction_farmland ────────────────────────────────

describe("get_transaction_farmland", () => {
  const VALID_UUID = "11111111-2222-3333-4444-555555555555";

  it("renders a per-parcel agricultural land-eligibility breakdown with credit footer", async () => {
    mockGetTransactionFarmland.mockResolvedValueOnce(withCredits({
      data: [{ eligible_area_m2: 3984, pct_of_parcel: 87, feature_count: 2 }],
      truncated: false,
      parcels_total: 1,
      parcels_with_data: 1,
      as_of: "2026-07-01",
    }));

    const result = await client.callTool({ name: "get_transaction_farmland", arguments: { transaction_id: VALID_UUID } });
    const text = getTextContent(result);

    expect(mockGetTransactionFarmland).toHaveBeenCalledWith(VALID_UUID, "test-api-key");
    expect(text).toContain("Per-parcel agricultural land-eligibility (1 of 1 linked parcel with a matched eligible area)");
    expect(text).toContain("eligible agricultural area: 3984 m²");
    expect(text).toContain("87% of the parcel");
    expect(text).toContain("snapshot as of 2026-07-01");
    expect(text).toMatch(/API tokens.*48/);
  });

  it("two-state empty data → neutral message that never asserts the land is non-agricultural", async () => {
    mockGetTransactionFarmland.mockResolvedValueOnce(withCredits({
      data: [], truncated: false, parcels_total: 0, parcels_with_data: 0, as_of: null,
    }));

    const result = await client.callTool({ name: "get_transaction_farmland", arguments: { transaction_id: VALID_UUID } });
    const text = getTextContent(result);

    expect(text).toContain("No eligible agricultural area found for the linked parcels");
    expect(text).toContain("not a statement that the property is non-agricultural");
  });

  it("rejects a malformed transaction_id via zod, no API call (protects credit)", async () => {
    const result = await client.callTool({ name: "get_transaction_farmland", arguments: { transaction_id: "not-a-uuid" } });

    expect(result.isError).toBe(true);
    expect(getTextContent(result)).toContain("UUID");
    expect(mockGetTransactionFarmland).not.toHaveBeenCalled();
  });
});

// ── Tests: search_transactions building id surfacing + CTA ─────────

describe("search_transactions building surfacing", () => {
  const txWithBuildings = {
    ...sampleTransaction,
    id: "11111111-2222-3333-4444-555555555555",
    building_count: 2,
    footprint_area_m2: "300.00",
    est_total_area_m2: "600.00",
  };

  it("surfaces the transaction id + breakdown tip when a row has buildings", async () => {
    mockGetTransactions.mockResolvedValueOnce(withCredits({
      data: [txWithBuildings],
      pagination: { page: 1, limit: 10, total: 1, pages: 1 },
    }));
    mockGetTransactionsSummary.mockResolvedValueOnce(withCredits(sampleSummary));

    const result = await client.callTool({ name: "search_transactions", arguments: {} });
    const text = getTextContent(result);

    expect(text).toContain("id: 11111111-2222-3333-4444-555555555555");
    expect(text).toContain("get_building_breakdown");
  });

  it("surfaces id but NOT the breakdown tip when no row has buildings", async () => {
    // id is unconditional (deep link); the get_building_breakdown tip stays gated.
    mockGetTransactions.mockResolvedValueOnce(withCredits(sampleTransactionsResponse));
    mockGetTransactionsSummary.mockResolvedValueOnce(withCredits(sampleSummary));

    const result = await client.callTool({ name: "search_transactions", arguments: {} });
    const text = getTextContent(result);

    expect(text).toContain("id: tx-1");
    expect(text).not.toContain("get_building_breakdown");
  });
});

// ── Tests: search_by_polygon vertex count validation ──────────────

describe("search_by_polygon validation", () => {
  it("rejects polygon with >500 vertices (zod refinement)", async () => {
    // Build a single ring with 502 vertices (501 unique + closing point)
    const ring: [number, number][] = [];
    for (let i = 0; i < 501; i++) {
      ring.push([21.0 + i * 0.0001, 52.2]);
    }
    ring.push(ring[0]!); // close ring
    const result = await client.callTool({
      name: "search_by_polygon",
      arguments: { polygon: { type: "Polygon", coordinates: [ring] } },
    });
    expect(getTextContent(result)).toContain("500 total vertices");
    expect(mockSearchByPolygon).not.toHaveBeenCalled();
  });
});

// ── Tests: list_locations with TERYT hierarchy ────────────────────

describe("list_locations with TERYT hierarchy", () => {
  const sampleVoivodeships: LocationItem[] = [
    { code: "02", name: "dolnośląskie", typeName: null, level: "voivodeship" },
    { code: "14", name: "mazowieckie", typeName: null, level: "voivodeship" },
  ];

  const sampleCounties: LocationItem[] = [
    { code: "1401", name: "Warszawa", typeName: null, level: "county" },
    { code: "1402", name: "ciechanowski", typeName: null, level: "county" },
  ];

  it("no params → returns voivodeships via getLocations", async () => {
    mockGetLocations.mockResolvedValueOnce(withCredits(sampleVoivodeships));

    const result = await client.callTool({ name: "list_locations", arguments: {} });
    const text = getTextContent(result);

    expect(mockGetLocations).toHaveBeenCalledWith(undefined, "test-api-key");
    expect(mockGetDistricts).not.toHaveBeenCalled();
    expect(text).toContain("voivodeship");
    expect(text).toContain("02 - dolnośląskie");
  });

  it("parent='14' → returns counties", async () => {
    mockGetLocations.mockResolvedValueOnce(withCredits(sampleCounties));

    const result = await client.callTool({ name: "list_locations", arguments: { parent: "14" } });
    const text = getTextContent(result);

    expect(mockGetLocations).toHaveBeenCalledWith("14", "test-api-key");
    expect(text).toContain("county");
    expect(text).toContain("1401 - Warszawa");
  });

  it("empty results with parent → helpful message", async () => {
    mockGetLocations.mockResolvedValueOnce(withCredits([]));

    const result = await client.callTool({ name: "list_locations", arguments: { parent: "321705" } });
    const text = getTextContent(result);

    expect(text).toContain("No sub-locations");
    expect(text).toContain("search_transactions");
  });

  it("invalid parent 'abc' → error without API call", async () => {
    const result = await client.callTool({ name: "list_locations", arguments: { parent: "abc" } });
    const text = getTextContent(result);

    expect(mockGetLocations).not.toHaveBeenCalled();
    expect(text).toContain("Invalid parent code");
    expect(text).toContain("2, 4, or 6 digits");
  });

  it("trims whitespace from parent before validation", async () => {
    const counties: LocationItem[] = [
      { code: "1401", name: "Warszawa", typeName: null, level: "county" },
    ];
    mockGetLocations.mockResolvedValueOnce(withCredits(counties));

    const result = await client.callTool({ name: "list_locations", arguments: { parent: " 14 " } });
    const text = getTextContent(result);

    expect(mockGetLocations).toHaveBeenCalledWith("14", "test-api-key");
    expect(text).toContain("county");
  });

  it("sanitizes HTML from parent in error message", async () => {
    const result = await client.callTool({ name: "list_locations", arguments: { parent: "<script>alert(1)</script>" } });
    const text = getTextContent(result);

    expect(text).toContain("Invalid parent code");
    expect(text).not.toContain("<script>");
  });

  it("8-digit parent → error (rejects non-2/4/6 digit codes)", async () => {
    const result = await client.callTool({ name: "list_locations", arguments: { parent: "12345678" } });
    const text = getTextContent(result);

    expect(mockGetLocations).not.toHaveBeenCalled();
    expect(text).toContain("Invalid parent code");
  });

  it("precinct code as parent → error with search_transactions hint", async () => {
    const result = await client.callTool({ name: "list_locations", arguments: { parent: "321705_2.0054" } });
    const text = getTextContent(result);

    expect(mockGetLocations).not.toHaveBeenCalled();
    expect(text).toContain("Invalid parent code");
    expect(text).toContain("search_transactions(teryt=...)");
  });

  it("6-digit parent returns precincts", async () => {
    const precinctItems = [
      { code: "321705_2.0054", name: "Strączno", typeName: null, level: "precinct" as const },
      { code: "321705_2.0055", name: "Szwecja", typeName: null, level: "precinct" as const },
    ];
    mockGetLocations.mockResolvedValueOnce(withCredits(precinctItems));

    const result = await client.callTool({ name: "list_locations", arguments: { parent: "321705" } });
    const text = getTextContent(result);

    expect(mockGetLocations).toHaveBeenCalledWith("321705", "test-api-key");
    expect(text).toContain("precinct");
    expect(text).toContain("Strączno");
    expect(text).toContain("search_transactions");
  });

  it("parent + search → parent takes precedence", async () => {
    mockGetLocations.mockResolvedValueOnce(withCredits(sampleCounties));

    await client.callTool({ name: "list_locations", arguments: { parent: "14", search: "Krak" } });

    expect(mockGetLocations).toHaveBeenCalledWith("14", "test-api-key");
    expect(mockGetDistricts).not.toHaveBeenCalled();
  });

  it("search without parent → legacy flow via getDistricts", async () => {
    mockGetDistricts.mockResolvedValueOnce(withCredits(["Mokotów", "Kraków-Podgórze"]));

    const result = await client.callTool({ name: "list_locations", arguments: { search: "Krak" } });
    const text = getTextContent(result);

    expect(mockGetDistricts).toHaveBeenCalled();
    expect(mockGetLocations).not.toHaveBeenCalled();
    expect(text).toContain("Kraków-Podgórze");
    expect(text).not.toContain("Mokotów");
  });
});

// ── Tests: search_transactions with teryt ─────────────────────────

describe("search_transactions with teryt", () => {
  it("passes teryt to getTransactions and getTransactionsSummary", async () => {
    mockGetTransactions.mockResolvedValueOnce(withCredits(sampleTransactionsResponse));
    mockGetTransactionsSummary.mockResolvedValueOnce(withCredits(sampleSummary));

    await client.callTool({ name: "search_transactions", arguments: { teryt: "1465" } });

    expect(mockGetTransactions).toHaveBeenCalledWith(
      expect.objectContaining({ teryt: "1465" }),
      "test-api-key",
    );
    expect(mockGetTransactionsSummary).toHaveBeenCalledWith(
      expect.objectContaining({ teryt: "1465" }),
      "test-api-key",
    );
  });

  it("passes multi-teryt string as-is", async () => {
    mockGetTransactions.mockResolvedValueOnce(withCredits(sampleTransactionsResponse));
    mockGetTransactionsSummary.mockResolvedValueOnce(withCredits(sampleSummary));

    await client.callTool({ name: "search_transactions", arguments: { teryt: "1465,3217" } });

    expect(mockGetTransactions).toHaveBeenCalledWith(
      expect.objectContaining({ teryt: "1465,3217" }),
      "test-api-key",
    );
  });

  it("combines teryt with other filters", async () => {
    mockGetTransactions.mockResolvedValueOnce(withCredits(sampleTransactionsResponse));
    mockGetTransactionsSummary.mockResolvedValueOnce(withCredits(sampleSummary));

    await client.callTool({
      name: "search_transactions",
      arguments: { teryt: "1465", propertyType: "unit", minPrice: 500000 },
    });

    expect(mockGetTransactions).toHaveBeenCalledWith(
      expect.objectContaining({ teryt: "1465", propertyType: 4, minPrice: 500000 }),
      "test-api-key",
    );
  });

  it("rejects invalid teryt with error (MCP strict)", async () => {
    const result = await client.callTool({ name: "search_transactions", arguments: { teryt: "garbage" } });
    const text = getTextContent(result);

    expect(text).toContain("Invalid TERYT code");
    expect(text).toContain("'garbage'");
    expect(mockGetTransactions).not.toHaveBeenCalled();
  });

  it("rejects mixed valid+invalid teryt (MCP strict: any invalid = reject)", async () => {
    const result = await client.callTool({ name: "search_transactions", arguments: { teryt: "1465,not_a_code" } });
    const text = getTextContent(result);

    expect(text).toContain("Invalid TERYT code");
    expect(text).toContain("'not_a_code'");
    expect(mockGetTransactions).not.toHaveBeenCalled();
  });

  it("sanitizes HTML in invalid teryt error message", async () => {
    const result = await client.callTool({ name: "search_transactions", arguments: { teryt: "<script>alert(1)</script>" } });
    const text = getTextContent(result);

    expect(text).toContain("Invalid TERYT code");
    expect(text).not.toContain("<script>");
    expect(mockGetTransactions).not.toHaveBeenCalled();
  });

  it("accepts all valid teryt formats", async () => {
    mockGetTransactions.mockResolvedValueOnce(withCredits(sampleTransactionsResponse));
    mockGetTransactionsSummary.mockResolvedValueOnce(withCredits(sampleSummary));

    const result = await client.callTool({
      name: "search_transactions",
      arguments: { teryt: "14,1465,146509,146509_8,146509_8.0501" },
    });
    const text = getTextContent(result);

    expect(text).not.toContain("Invalid TERYT");
    expect(mockGetTransactions).toHaveBeenCalled();
  });

  it("combines teryt with location", async () => {
    mockGetTransactions.mockResolvedValueOnce(withCredits(sampleTransactionsResponse));
    mockGetTransactionsSummary.mockResolvedValueOnce(withCredits(sampleSummary));

    await client.callTool({
      name: "search_transactions",
      arguments: { teryt: "1465", location: "Mokotów" },
    });

    expect(mockGetTransactions).toHaveBeenCalledWith(
      expect.objectContaining({ teryt: "1465", district: "Mokotów" }),
      "test-api-key",
    );
  });
});

// ── Tests: Edge cases ──────────────────────────────────────────────

describe("edge cases", () => {
  it("withErrorHandling catches non-Error throws", async () => {
    mockGetStats.mockRejectedValueOnce("string error");

    const result = await client.callTool({ name: "get_market_overview", arguments: {} });
    const text = getTextContent(result);

    expect(text).toContain("Error: string error");
  });

  it("search_transactions maps marketType string to number", async () => {
    mockGetTransactions.mockResolvedValueOnce(withCredits(sampleTransactionsResponse));
    mockGetTransactionsSummary.mockResolvedValueOnce(withCredits(sampleSummary));

    await client.callTool({
      name: "search_transactions",
      arguments: { marketType: "primary" },
    });

    expect(mockGetTransactions).toHaveBeenCalledWith(
      expect.objectContaining({ marketType: 1 }),
      "test-api-key",
    );
  });

  it("search_transactions passes street, buildingNumber, parcelId", async () => {
    mockGetTransactions.mockResolvedValueOnce(withCredits(sampleTransactionsResponse));
    mockGetTransactionsSummary.mockResolvedValueOnce(withCredits(sampleSummary));

    await client.callTool({
      name: "search_transactions",
      arguments: { street: "Puławska", buildingNumber: "15A", parcelId: "146509_8.0501.12" },
    });

    expect(mockGetTransactions).toHaveBeenCalledWith(
      expect.objectContaining({
        street: "Puławska",
        buildingNumber: "15A",
        parcelId: "146509_8.0501.12",
      }),
      "test-api-key",
    );
    // Summary call must carry the same filters so the "Found N" count matches the rows.
    expect(mockGetTransactionsSummary).toHaveBeenCalledWith(
      expect.objectContaining({
        street: "Puławska",
        buildingNumber: "15A",
        parcelId: "146509_8.0501.12",
      }),
      "test-api-key",
    );
  });

  it("search_transactions forwards floodRisk to both rows and summary count", async () => {
    mockGetTransactions.mockResolvedValueOnce(withCredits(sampleTransactionsResponse));
    mockGetTransactionsSummary.mockResolvedValueOnce(withCredits(sampleSummary));

    await client.callTool({
      name: "search_transactions",
      arguments: { location: "Warszawa", floodRisk: ["high"] },
    });

    expect(mockGetTransactions).toHaveBeenCalledWith(
      expect.objectContaining({ floodRisk: "high" }),
      "test-api-key",
    );
    expect(mockGetTransactionsSummary).toHaveBeenCalledWith(
      expect.objectContaining({ floodRisk: "high" }),
      "test-api-key",
    );
  });

  it("search_transactions forwards heritageStatus to both rows and summary count", async () => {
    mockGetTransactions.mockResolvedValueOnce(withCredits(sampleTransactionsResponse));
    mockGetTransactionsSummary.mockResolvedValueOnce(withCredits(sampleSummary));

    await client.callTool({
      name: "search_transactions",
      arguments: { location: "Warszawa", heritageStatus: ["listed"] },
    });

    expect(mockGetTransactions).toHaveBeenCalledWith(
      expect.objectContaining({ heritageStatus: "listed" }),
      "test-api-key",
    );
    expect(mockGetTransactionsSummary).toHaveBeenCalledWith(
      expect.objectContaining({ heritageStatus: "listed" }),
      "test-api-key",
    );
  });

  it("search_transactions forwards landslideRisk to both rows and summary count", async () => {
    mockGetTransactions.mockResolvedValueOnce(withCredits(sampleTransactionsResponse));
    mockGetTransactionsSummary.mockResolvedValueOnce(withCredits(sampleSummary));

    await client.callTool({
      name: "search_transactions",
      arguments: { location: "Warszawa", landslideRisk: ["landslide", "threatened"] },
    });

    expect(mockGetTransactions).toHaveBeenCalledWith(
      expect.objectContaining({ landslideRisk: "landslide,threatened" }),
      "test-api-key",
    );
    expect(mockGetTransactionsSummary).toHaveBeenCalledWith(
      expect.objectContaining({ landslideRisk: "landslide,threatened" }),
      "test-api-key",
    );
  });

  it("search_transactions defaults: sort=date, order=desc, limit=10", async () => {
    mockGetTransactions.mockResolvedValueOnce(withCredits(sampleTransactionsResponse));
    mockGetTransactionsSummary.mockResolvedValueOnce(withCredits(sampleSummary));

    await client.callTool({ name: "search_transactions", arguments: {} });

    expect(mockGetTransactions).toHaveBeenCalledWith(
      expect.objectContaining({ sort: "date", order: "desc", limit: 10 }),
      "test-api-key",
    );
  });
});

// ── Tests: tool.call identity logging (user_id) + Sentry per-call user ──
// Verifies which user made a call is now observable: OAuth -> UUID in the stderr `tool.call` log AND
// Sentry scope.setUser; api-key -> key_prefix in both. Guards against the old flatten-to-"oauth" bug.
describe("tool.call identity: user_id in stderr log + Sentry setUser", () => {
  const OAUTH_UUID = "3f9a1c22-1b7e-4d0a-9c11-2b3c4d5e6f70";

  // Build a fresh server bound to `apiKey`, run one tool call, return the parsed `tool.call` log line.
  async function runOneCall(apiKey: string, toolName: string): Promise<Record<string, unknown>> {
    const writes: string[] = [];
    const spy = vi.spyOn(process.stderr, "write").mockImplementation((chunk: unknown) => {
      writes.push(String(chunk));
      return true;
    });
    try {
      const { createMcpServer } = await import("../index.js");
      const server = createMcpServer(apiKey);
      const [clientTransport, serverTransport] = InMemoryTransport.createLinkedPair();
      await server.connect(serverTransport);
      const c = new Client({ name: "id-test", version: "1.0.0" });
      await c.connect(clientTransport);
      await c.callTool({ name: toolName, arguments: {} });
      await c.close();
    } finally {
      spy.mockRestore();
    }
    const line = writes.reverse().find((w) => w.includes('"tool.call"'));
    if (!line) throw new Error("no tool.call log line captured");
    return JSON.parse(line) as Record<string, unknown>;
  }

  it("OAuth call: user_id = decoded UUID, key_prefix = 'oauth', Sentry user = UUID", async () => {
    mockGetStats.mockResolvedValueOnce(withCredits(sampleStats));
    const log = await runOneCall(encodeOAuthCtx(OAUTH_UUID, "grant-x"), "get_market_overview");

    expect(log.evt).toBe("tool.call");
    expect(log.user_id).toBe(OAUTH_UUID);
    expect(log.key_prefix).toBe("oauth");
    expect(log.success).toBe(true);
    expect(mockSentrySetUser).toHaveBeenCalledWith({ id: OAUTH_UUID });
  });

  it("OAuth error path: captureException fires and Sentry user is still the UUID", async () => {
    mockGetStats.mockRejectedValueOnce(new Error("upstream 500"));
    const log = await runOneCall(encodeOAuthCtx(OAUTH_UUID, "grant-x"), "get_market_overview");

    expect(log.user_id).toBe(OAUTH_UUID);
    expect(log.success).toBe(false);
    expect(mockSentrySetUser).toHaveBeenCalledWith({ id: OAUTH_UUID });
    expect(mockSentryCaptureException).toHaveBeenCalledTimes(1);
  });

  it("api-key call: user_id = key_prefix (cngrm_xxxx), Sentry user = same prefix", async () => {
    mockGetStats.mockResolvedValueOnce(withCredits(sampleStats));
    const log = await runOneCall("cngrm_test_abcd1234", "get_market_overview");

    expect(log.user_id).toBe("cngrm_test");
    expect(log.key_prefix).toBe("cngrm_test");
    expect(mockSentrySetUser).toHaveBeenCalledWith({ id: "cngrm_test" });
  });

  // End-to-end guard for the plan-CR MAJOR: a malformed OAuth-shaped key (\x01 prefix, no valid ctx)
  // must NOT leak the raw \x01 control byte into the log — it stays the stable "oauth" label.
  it("malformed OAuth key: falls back to 'oauth', no raw \\x01 byte in the log line", async () => {
    mockGetStats.mockResolvedValueOnce(withCredits(sampleStats));
    const writes: string[] = [];
    const spy = vi.spyOn(process.stderr, "write").mockImplementation((chunk: unknown) => {
      writes.push(String(chunk));
      return true;
    });
    try {
      const { createMcpServer } = await import("../index.js");
      const server = createMcpServer("\x01onlyUserIdNoSeparator"); // no second \x01 -> decode returns null
      const [ct, st] = InMemoryTransport.createLinkedPair();
      await server.connect(st);
      const c = new Client({ name: "id-test", version: "1.0.0" });
      await c.connect(ct);
      await c.callTool({ name: "get_market_overview", arguments: {} });
      await c.close();
    } finally {
      spy.mockRestore();
    }
    const rawLine = writes.reverse().find((w) => w.includes('"tool.call"'))!;
    expect(rawLine).not.toContain("\x01");
    const log = JSON.parse(rawLine) as Record<string, unknown>;
    expect(log.key_prefix).toBe("oauth");
    expect(log.user_id).toBe("oauth");
    expect(mockSentrySetUser).toHaveBeenCalledWith({ id: "oauth" });
  });
});

// A tool call without an auth context used to answer "Internal: missing auth context … report
// bug". On stdio that is simply someone who has not got a key yet, and the message sent them to
// an issue tracker instead of to the page that hands keys out.
describe("missing auth context", () => {
  const origTransport = process.env.MCP_TRANSPORT;

  afterEach(() => {
    if (origTransport === undefined) delete process.env.MCP_TRANSPORT;
    else process.env.MCP_TRANSPORT = origTransport;
  });

  async function callWithoutKey(): Promise<string> {
    const { createMcpServer } = await import("../index.js");
    const server = createMcpServer(undefined as unknown as string);
    const [clientTransport, serverTransport] = InMemoryTransport.createLinkedPair();
    await server.connect(serverTransport);
    const c = new Client({ name: "no-key-test", version: "1.0.0" });
    await c.connect(clientTransport);
    const result = await c.callTool({ name: "get_market_overview", arguments: {} });
    await c.close();
    return getTextContent(result);
  }

  it("stdio: points at the signup page and the config key, not at the bug tracker", async () => {
    delete process.env.MCP_TRANSPORT;
    const text = await callWithoutKey();
    expect(text).toContain("https://cenogram.pl/api?src=mcpstdio");
    expect(text).toContain("CENOGRAM_API_KEY");
    expect(text).not.toMatch(/internal/i);
    expect(text).not.toMatch(/report/i);
    expect(text).not.toContain("/ustawienia");
  });

  it("hosted HTTP: still a bug, and says so", async () => {
    process.env.MCP_TRANSPORT = "http";
    const text = await callWithoutKey();
    expect(text).toMatch(/bug on our side/i);
    expect(text).toContain("github.com/cenogram/mcp-server/issues");
    expect(text).not.toContain("CENOGRAM_API_KEY");
  });
});
