import { describe, it, expect, vi, beforeAll, afterAll, beforeEach } from "vitest";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { InMemoryTransport } from "@modelcontextprotocol/sdk/inMemory.js";
import type {
  TransactionsResponse,
  TransactionsSummary,
  StatsResponse,
  PricePerM2Row,
  HistogramBin,
  ParcelSearchResponse,
  SpatialSearchResponse,
  CompareResponse,
  CreditInfo,
  ApiResponse,
} from "../api-client.js";

// ── Mock api-client (replaces entire module, including module-level API_KEY) ──

const mockGetTransactions = vi.fn();
const mockGetTransactionsSummary = vi.fn();
const mockGetStats = vi.fn();
const mockGetPricePerM2 = vi.fn();
const mockGetDistricts = vi.fn();
const mockGetPriceHistogram = vi.fn();
const mockSearchParcels = vi.fn();
const mockSearchByPolygon = vi.fn();
const mockCompareLocations = vi.fn();

vi.mock("../api-client.js", () => ({
  getTransactions: (...args: unknown[]) => mockGetTransactions(...args),
  getTransactionsSummary: (...args: unknown[]) => mockGetTransactionsSummary(...args),
  getStats: (...args: unknown[]) => mockGetStats(...args),
  getPricePerM2: (...args: unknown[]) => mockGetPricePerM2(...args),
  getDistricts: (...args: unknown[]) => mockGetDistricts(...args),
  getPriceHistogram: (...args: unknown[]) => mockGetPriceHistogram(...args),
  searchParcels: (...args: unknown[]) => mockSearchParcels(...args),
  searchByPolygon: (...args: unknown[]) => mockSearchByPolygon(...args),
  compareLocations: (...args: unknown[]) => mockCompareLocations(...args),
}));

vi.mock("../client-id.js", () => ({
  getClientId: () => "test-client-uuid",
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
  counts: { transactions: 7352087, parcels: 681000, buildings: 50000, units: 30000, addresses: 20000 },
  prices: { total: 7352087, avg_price: 456789, median_price: 280000, min_price: 1, max_price: 999999999 },
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

function getTextContent(result: { content: { type: string; text?: string }[] }): string {
  const textBlock = result.content.find((c) => c.type === "text");
  return textBlock?.text ?? "";
}

// ── Tests: Tool discovery ──────────────────────────────────────────

describe("tool discovery", () => {
  it("lists exactly 9 tools", async () => {
    const { tools } = await client.listTools();
    expect(tools).toHaveLength(9);
  });

  it("all tools have readOnlyHint annotation", async () => {
    const { tools } = await client.listTools();
    for (const tool of tools) {
      expect(tool.annotations?.readOnlyHint, `${tool.name} missing readOnlyHint`).toBe(true);
    }
  });

  it("has all expected tool names", async () => {
    const { tools } = await client.listTools();
    const names = tools.map((t) => t.name).sort();
    expect(names).toEqual([
      "compare_locations",
      "get_market_overview",
      "get_price_distribution",
      "get_price_statistics",
      "list_locations",
      "search_by_area",
      "search_by_polygon",
      "search_parcels",
      "search_transactions",
    ]);
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
    expect(text).toMatch(/Tokeny API.*48/);
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

    const result = await client.callTool({ name: "get_price_statistics", arguments: { location: "krak" } });
    const text = getTextContent(result);

    expect(text).toContain("Kraków-Podgórze");
    expect(text).not.toContain("Mokotów");
    expect(text).not.toContain("Wola");
  });

  it("shows helpful message when no results", async () => {
    mockGetPricePerM2.mockResolvedValueOnce(withCredits([]));

    const result = await client.callTool({ name: "get_price_statistics", arguments: { location: "Atlantyda" } });
    const text = getTextContent(result);

    expect(text).toContain("No price statistics");
    expect(text).toContain("list_locations");
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

  it("returns Error with isError flag on API failure", async () => {
    mockGetTransactions.mockRejectedValueOnce(new Error("Zbyt wiele zapytań."));
    mockGetTransactionsSummary.mockRejectedValueOnce(new Error("Zbyt wiele zapytań."));

    const result = await client.callTool({
      name: "search_by_area",
      arguments: { latitude: 52.23, longitude: 21.01, radiusKm: 2 },
    });
    const text = getTextContent(result);

    expect(text).toContain("Error:");
    expect(result.isError).toBe(true);
  });
});

// ── Tests: get_market_overview ─────────────────────────────────────

describe("get_market_overview", () => {
  it("returns formatted overview with Cenogram branding", async () => {
    mockGetStats.mockResolvedValueOnce(withCredits(sampleStats));

    const result = await client.callTool({ name: "get_market_overview", arguments: {} });
    const text = getTextContent(result);

    expect(text).toContain("Cenogram");
    expect(text).toMatch(/7.?352.?087/); // total count with possible separators
    expect(text).toContain("2003");
  });

  it("includes credit footer", async () => {
    mockGetStats.mockResolvedValueOnce(withCredits(sampleStats));

    const result = await client.callTool({ name: "get_market_overview", arguments: {} });
    const text = getTextContent(result);

    expect(text).toMatch(/Tokeny API.*48/);
    expect(text).toContain("koszt zapytania: 2");
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
  const allDistricts = [
    "Mokotów", "Śródmieście", "Wola", "Ursynów", "Praga-Południe",
    ...Array.from({ length: 55 }, (_, i) => `District-${i}`),
  ];

  it("lists up to 50 locations without search", async () => {
    mockGetDistricts.mockResolvedValueOnce(withCredits(allDistricts));

    const result = await client.callTool({ name: "list_locations", arguments: {} });
    const text = getTextContent(result);

    expect(text).toContain(`Found ${allDistricts.length} locations`);
    expect(text).toContain("Mokotów");
    expect(text).toContain("more");
  });

  it("filters by search term", async () => {
    mockGetDistricts.mockResolvedValueOnce(withCredits(["Mokotów", "Śródmieście", "Wola", "Kraków-Podgórze", "Kraków-Śródmieście"]));

    const result = await client.callTool({ name: "list_locations", arguments: { search: "Kraków" } });
    const text = getTextContent(result);

    expect(text).toContain("Kraków-Podgórze");
    expect(text).toContain("Kraków-Śródmieście");
    expect(text).not.toContain("Mokotów");
  });

  it("returns 'no locations' message for no match", async () => {
    mockGetDistricts.mockResolvedValueOnce(withCredits(["Mokotów", "Wola"]));

    const result = await client.callTool({ name: "list_locations", arguments: { search: "Atlantyda" } });
    const text = getTextContent(result);

    expect(text).toContain("No locations found");
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

// ── Tests: compare_locations ───────────────────────────────────────

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

  it("renders comparison table", async () => {
    mockCompareLocations.mockResolvedValueOnce(withCredits(sampleCompareResponse));

    const result = await client.callTool({
      name: "compare_locations",
      arguments: { districts: "Mokotów,Wola" },
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
      arguments: { districts: "Mokotow" },
    });
    const text = getTextContent(result);

    expect(text).toContain("Did you mean: Mokotów");
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
