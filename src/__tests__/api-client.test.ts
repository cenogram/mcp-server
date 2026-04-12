import { describe, it, expect, vi, beforeEach } from "vitest";

// Must mock fetch before importing api-client
const mockFetch = vi.fn();
vi.stubGlobal("fetch", mockFetch);

vi.mock("../client-id.js", () => ({
  getClientId: () => "test-client-uuid-1234",
}));

describe("api-client", () => {
  beforeEach(() => {
    vi.resetAllMocks();
  });

  it("getStats builds correct URL", async () => {
    mockFetch.mockResolvedValueOnce({
      ok: true,
      json: () => Promise.resolve({ counts: { transactions: 100 } }),
    });

    const { getStats } = await import("../api-client.js");
    await getStats();

    expect(mockFetch).toHaveBeenCalledTimes(1);
    const url = mockFetch.mock.calls[0]![0] as string;
    expect(url).toContain("/api/stats");
  });

  it("getTransactions passes query params", async () => {
    mockFetch.mockResolvedValueOnce({
      ok: true,
      json: () => Promise.resolve({ data: [], pagination: {}, summary: null }),
    });

    const { getTransactions } = await import("../api-client.js");
    await getTransactions({
      district: "Mokotów",
      propertyType: 4,
      limit: 10,
      sort: "date",
      order: "desc",
    });

    const url = mockFetch.mock.calls[0]![0] as string;
    expect(url).toContain("district=Mokot");
    expect(url).toContain("propertyType=4");
    expect(url).toContain("limit=10");
    expect(url).toContain("sort=date");
  });

  it("getTransactions passes street, buildingNumber, parcelId", async () => {
    mockFetch.mockResolvedValueOnce({
      ok: true,
      json: () => Promise.resolve({ data: [], pagination: {}, summary: null }),
    });

    const { getTransactions } = await import("../api-client.js");
    await getTransactions({
      district: "Wawer",
      street: "Trakt Lubelski",
      buildingNumber: "251C",
      parcelId: "146518_8.0108.27",
    });

    const url = mockFetch.mock.calls[0]![0] as string;
    expect(url).toContain("street=Trakt");
    expect(url).toContain("buildingNumber=251C");
    expect(url).toContain("parcelId=146518");
  });

  it("throws on non-200 status", async () => {
    mockFetch.mockResolvedValueOnce({ ok: false, status: 500 });

    const { fetchApi } = await import("../api-client.js");
    await expect(fetchApi("/api/stats")).rejects.toThrow("API error: HTTP 500");
  });

  it("throws readable message on 402 (insufficient credits)", async () => {
    mockFetch.mockResolvedValueOnce({
      ok: false,
      status: 402,
      json: () => Promise.resolve({ currentBalance: 0, creditsRequired: 2 }),
    });

    const { fetchApi } = await import("../api-client.js");
    await expect(fetchApi("/api/stats")).rejects.toThrow("Niewystarczające tokeny API");
  });

  it("402 error includes balance and required credits", async () => {
    mockFetch.mockResolvedValueOnce({
      ok: false,
      status: 402,
      json: () => Promise.resolve({ currentBalance: 0, creditsRequired: 5 }),
    });

    const { fetchApi } = await import("../api-client.js");
    const error = await fetchApi("/api/stats").catch((e: Error) => e);
    expect((error as Error).message).toContain("Saldo: 0");
    expect((error as Error).message).toContain("wymagane: 5");
  });

  it("402 error handles missing json body gracefully", async () => {
    mockFetch.mockResolvedValueOnce({
      ok: false,
      status: 402,
      json: () => Promise.reject(new Error("not json")),
    });

    const { fetchApi } = await import("../api-client.js");
    await expect(fetchApi("/api/stats")).rejects.toThrow("Niewystarczające tokeny API");
  });

  it("throws on 429 (IP rate limit)", async () => {
    mockFetch.mockResolvedValueOnce({
      ok: false,
      status: 429,
      headers: { get: () => null },
    });

    const { fetchApi } = await import("../api-client.js");
    await expect(fetchApi("/api/stats")).rejects.toThrow("Zbyt wiele zapytań");
  });

  it("429 error includes days from Retry-After", async () => {
    mockFetch.mockResolvedValueOnce({
      ok: false,
      status: 429,
      headers: { get: (h: string) => h === "Retry-After" ? "259200" : null },
    });

    const { fetchApi } = await import("../api-client.js");
    await expect(fetchApi("/api/stats")).rejects.toThrow("Reset za 3 dni");
  });

  it("throws on timeout", async () => {
    mockFetch.mockImplementationOnce(
      () => new Promise((_, reject) => setTimeout(() => reject(new DOMException("aborted", "AbortError")), 50)),
    );

    const { fetchApi } = await import("../api-client.js");
    await expect(fetchApi("/api/stats")).rejects.toThrow();
  }, 15_000);

  it("getPriceHistogram passes bins and max", async () => {
    mockFetch.mockResolvedValueOnce({
      ok: true,
      json: () => Promise.resolve([]),
    });

    const { getPriceHistogram } = await import("../api-client.js");
    await getPriceHistogram(30, 5_000_000);

    const url = mockFetch.mock.calls[0]![0] as string;
    expect(url).toContain("bins=30");
    expect(url).toContain("max=5000000");
  });

  it("getPricePerM2 calls correct endpoint", async () => {
    mockFetch.mockResolvedValueOnce({
      ok: true,
      json: () => Promise.resolve([{ district: "Mokotów", avg_price_m2: 16000, median_price_m2: 15200, count: 5000 }]),
    });

    const { getPricePerM2 } = await import("../api-client.js");
    const result = await getPricePerM2();

    expect(result.data).toHaveLength(1);
    const url = mockFetch.mock.calls[0]![0] as string;
    expect(url).toContain("/api/price-per-m2");
  });

  it("getDistricts calls correct endpoint", async () => {
    mockFetch.mockResolvedValueOnce({
      ok: true,
      json: () => Promise.resolve(["Mokotów", "Śródmieście"]),
    });

    const { getDistricts } = await import("../api-client.js");
    const result = await getDistricts();

    expect(result.data).toEqual(["Mokotów", "Śródmieście"]);
    const url = mockFetch.mock.calls[0]![0] as string;
    expect(url).toContain("/api/districts");
  });

  it("returns creditInfo when response headers present", async () => {
    mockFetch.mockResolvedValueOnce({
      ok: true,
      json: () => Promise.resolve({ counts: { transactions: 100 } }),
      headers: { get: (h: string) => h === "X-Credits-Balance" ? "48" : h === "X-Credits-Cost" ? "2" : null },
    });

    const { getStats } = await import("../api-client.js");
    const result = await getStats();

    expect(result.creditInfo).toEqual({ balance: 48, cost: 2 });
  });

  it("returns null creditInfo when headers missing", async () => {
    mockFetch.mockResolvedValueOnce({
      ok: true,
      json: () => Promise.resolve({ counts: { transactions: 100 } }),
    });

    const { getStats } = await import("../api-client.js");
    const result = await getStats();

    expect(result.creditInfo).toBeNull();
  });

  it("sends X-Source header", async () => {
    mockFetch.mockResolvedValueOnce({
      ok: true,
      json: () => Promise.resolve({}),
    });

    const { fetchApi } = await import("../api-client.js");
    await fetchApi("/api/stats");

    const opts = mockFetch.mock.calls[0]![1] as RequestInit;
    expect((opts.headers as Record<string, string>)["X-Source"]).toBe("mcp-server");
  });

  it("sends X-Cenogram-Client-Id header", async () => {
    mockFetch.mockResolvedValueOnce({
      ok: true,
      json: () => Promise.resolve({}),
    });

    const { fetchApi } = await import("../api-client.js");
    await fetchApi("/api/stats");

    const opts = mockFetch.mock.calls[0]![1] as RequestInit;
    expect((opts.headers as Record<string, string>)["X-Cenogram-Client-Id"]).toBe("test-client-uuid-1234");
  });

  it("getTransactionsSummary builds correct URL with filters", async () => {
    mockFetch.mockResolvedValueOnce({
      ok: true,
      json: () => Promise.resolve({ median_price_m2: 15000, avg_area: 55, total: 100 }),
    });

    const { getTransactionsSummary } = await import("../api-client.js");
    await getTransactionsSummary({ district: "Mokotów", propertyType: 4, dateFrom: "2024-01-01" });

    const url = mockFetch.mock.calls[0]![0] as string;
    expect(url).toContain("/api/transactions/summary");
    expect(url).toContain("district=Mokot");
    expect(url).toContain("propertyType=4");
    expect(url).toContain("dateFrom=2024-01-01");
  });

  it("fetchApiPost sends POST with JSON body", async () => {
    mockFetch.mockResolvedValueOnce({
      ok: true,
      json: () => Promise.resolve({ type: "FeatureCollection", features: [], total: 0, truncated: false }),
    });

    const { fetchApiPost } = await import("../api-client.js");
    await fetchApiPost("/api/transactions/spatial", { polygon: { type: "Polygon", coordinates: [[[21, 52], [21.01, 52], [21.01, 52.01], [21, 52.01], [21, 52]]] } });

    const opts = mockFetch.mock.calls[0]![1] as RequestInit;
    expect(opts.method).toBe("POST");
    expect((opts.headers as Record<string, string>)["Content-Type"]).toBe("application/json");
    expect(opts.body).toContain("Polygon");
  });

  it("fetchApiPost sends X-Source and X-Cenogram-Client-Id headers", async () => {
    mockFetch.mockResolvedValueOnce({
      ok: true,
      json: () => Promise.resolve({}),
    });

    const { fetchApiPost } = await import("../api-client.js");
    await fetchApiPost("/api/test", { data: 1 });

    const opts = mockFetch.mock.calls[0]![1] as RequestInit;
    expect((opts.headers as Record<string, string>)["X-Source"]).toBe("mcp-server");
    expect((opts.headers as Record<string, string>)["X-Cenogram-Client-Id"]).toBe("test-client-uuid-1234");
  });

  it("fetchApiPost handles 402 error", async () => {
    mockFetch.mockResolvedValueOnce({
      ok: false,
      status: 402,
      json: () => Promise.resolve({ currentBalance: 0, creditsRequired: 5 }),
    });

    const { fetchApiPost } = await import("../api-client.js");
    await expect(fetchApiPost("/api/test", {})).rejects.toThrow("Niewystarczające tokeny API");
  });

  it("fetchApiPost returns creditInfo from headers", async () => {
    mockFetch.mockResolvedValueOnce({
      ok: true,
      json: () => Promise.resolve({}),
      headers: { get: (h: string) => h === "X-Credits-Balance" ? "100" : h === "X-Credits-Cost" ? "3" : null },
    });

    const { fetchApiPost } = await import("../api-client.js");
    const result = await fetchApiPost("/api/test", {});
    expect(result.creditInfo).toEqual({ balance: 100, cost: 3 });
  });

  it("searchParcels builds correct URL with q and limit", async () => {
    mockFetch.mockResolvedValueOnce({
      ok: true,
      json: () => Promise.resolve({ results: [{ parcel_id: "146518_8.0108.27", district: "Wawer", area_m2: 1200, lat: 52.1, lng: 21.1 }] }),
    });

    const { searchParcels } = await import("../api-client.js");
    await searchParcels("146518", 5);

    const url = mockFetch.mock.calls[0]![0] as string;
    expect(url).toContain("/api/parcels/search");
    expect(url).toContain("q=146518");
    expect(url).toContain("limit=5");
  });

  it("searchByPolygon sends POST to spatial endpoint", async () => {
    mockFetch.mockResolvedValueOnce({
      ok: true,
      json: () => Promise.resolve({ type: "FeatureCollection", features: [], total: 0, truncated: false }),
    });

    const { searchByPolygon } = await import("../api-client.js");
    await searchByPolygon({
      polygon: { type: "Polygon", coordinates: [[[21, 52], [21.01, 52], [21.01, 52.01], [21, 52.01], [21, 52]]] },
      propertyType: 4,
      minPrice: 300000,
    });

    const url = mockFetch.mock.calls[0]![0] as string;
    expect(url).toContain("/api/transactions/spatial");
    const opts = mockFetch.mock.calls[0]![1] as RequestInit;
    expect(opts.method).toBe("POST");
    const body = JSON.parse(opts.body as string) as Record<string, unknown>;
    expect(body.propertyType).toBe(4);
    expect(body.minPrice).toBe(300000);
  });

  it("compareLocations builds correct URL with districts and filters", async () => {
    mockFetch.mockResolvedValueOnce({
      ok: true,
      json: () => Promise.resolve({ "Mokotów": { median_price_m2: 15000, total: 100 } }),
    });

    const { compareLocations } = await import("../api-client.js");
    await compareLocations({ districts: "Mokotów,Wola", propertyType: 4, dateFrom: "2024-01-01" });

    const url = mockFetch.mock.calls[0]![0] as string;
    expect(url).toContain("/api/transactions/summary/compare");
    expect(url).toContain("districts=Mokot");
    expect(url).toContain("propertyType=4");
    expect(url).toContain("dateFrom=2024-01-01");
  });
});
