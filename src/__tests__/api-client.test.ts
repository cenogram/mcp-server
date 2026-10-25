import { describe, it, expect, vi, beforeEach } from "vitest";

const { mockFetch } = vi.hoisted(() => ({
  mockFetch: vi.fn(),
}));

vi.mock("undici", () => ({ fetch: mockFetch }));

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
    expect(url).toContain("/api/v1/stats");
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

  it("getTransactions passes page, and the summary call does not carry it", async () => {
    const ok = { ok: true, json: () => Promise.resolve({ data: [], pagination: {}, summary: null }) };
    mockFetch.mockResolvedValueOnce(ok).mockResolvedValueOnce(ok);

    const { getTransactions, getTransactionsSummary } = await import("../api-client.js");
    await getTransactions({ bbox: "20,50,21,51", limit: 50, page: 2, sort: "date", order: "desc" });
    await getTransactionsSummary({ bbox: "20,50,21,51", limit: 50, page: 2 });

    const rowsUrl = mockFetch.mock.calls[0]![0] as string;
    expect(rowsUrl).toContain("page=2");
    expect(rowsUrl).toContain("limit=50");
    expect(mockFetch.mock.calls[1]![0] as string).not.toContain("page=");
  });

  it("getTransactions passes street, buildingNumber, parcelId", async () => {
    mockFetch.mockResolvedValueOnce({
      ok: true,
      json: () => Promise.resolve({ data: [], pagination: {}, summary: null }),
    });

    const { getTransactions } = await import("../api-client.js");
    await getTransactions({
      district: "Wawer",
      street: "Aleja Waszyngtona",
      buildingNumber: "30",
      parcelId: "146518_8.0108.27",
    });

    const url = mockFetch.mock.calls[0]![0] as string;
    expect(url).toContain("street=Aleja");
    expect(url).toContain("buildingNumber=30");
    expect(url).toContain("parcelId=146518");
  });

  it("getTransactions passes floodRisk filter", async () => {
    mockFetch.mockResolvedValueOnce({
      ok: true,
      json: () => Promise.resolve({ data: [], pagination: {}, summary: null }),
    });

    const { getTransactions } = await import("../api-client.js");
    await getTransactions({ district: "Wrocław", floodRisk: "medium,high" });

    const url = mockFetch.mock.calls[0]![0] as string;
    // comma may be URL-encoded (%2C) or literal depending on the serializer — match both, anchored to
    // the floodRisk key so a stray "high" elsewhere can't satisfy the assertion.
    expect(url).toMatch(/floodRisk=medium(%2C|,)high/);
  });

  it("getTransactionFlood hits the per-transaction flood endpoint", async () => {
    mockFetch.mockResolvedValueOnce({
      ok: true,
      json: () => Promise.resolve({ data: [], truncated: false }),
    });

    const { getTransactionFlood } = await import("../api-client.js");
    await getTransactionFlood("11111111-2222-3333-4444-555555555555");

    const url = mockFetch.mock.calls[0]![0] as string;
    expect(url).toContain("/api/v1/transactions/11111111-2222-3333-4444-555555555555/flood");
  });

  it("getTransactions passes heritageStatus filter", async () => {
    mockFetch.mockResolvedValueOnce({
      ok: true,
      json: () => Promise.resolve({ data: [], pagination: {}, summary: null }),
    });

    const { getTransactions } = await import("../api-client.js");
    await getTransactions({ district: "Toruń", heritageStatus: "listed,zone" });

    const url = mockFetch.mock.calls[0]![0] as string;
    // comma may be URL-encoded (%2C) or literal depending on the serializer — match both, anchored to
    // the heritageStatus key so a stray "zone" elsewhere can't satisfy the assertion.
    expect(url).toMatch(/heritageStatus=listed(%2C|,)zone/);
  });

  it("getTransactions passes landslideRisk filter", async () => {
    mockFetch.mockResolvedValueOnce({
      ok: true,
      json: () => Promise.resolve({ data: [], pagination: {}, summary: null }),
    });

    const { getTransactions } = await import("../api-client.js");
    await getTransactions({ district: "Gdańsk", landslideRisk: "landslide,threatened" });

    const url = mockFetch.mock.calls[0]![0] as string;
    // comma may be URL-encoded (%2C) or literal depending on the serializer — match both, anchored to
    // the landslideRisk key so a stray "threatened" elsewhere can't satisfy the assertion.
    expect(url).toMatch(/landslideRisk=landslide(%2C|,)threatened/);
  });

  it("getTransactions passes ownershipType filter", async () => {
    mockFetch.mockResolvedValueOnce({
      ok: true,
      json: () => Promise.resolve({ data: [], pagination: {}, summary: null }),
    });

    const { getTransactions } = await import("../api-client.js");
    // CSV as produced by mapOwnershipTypes(["land_ownership","perpetual_usufruct"]) → "1,2,8".
    await getTransactions({ district: "Poznań", ownershipType: "1,2,8" });

    const url = mockFetch.mock.calls[0]![0] as string;
    // comma may be URL-encoded (%2C) or literal — anchor to the ownershipType key.
    expect(url).toMatch(/ownershipType=1(%2C|,)2(%2C|,)8/);
  });

  it("getTransactions passes landUse and buildingStoreys filters", async () => {
    mockFetch.mockResolvedValueOnce({
      ok: true,
      json: () => Promise.resolve({ data: [], pagination: {}, summary: null }),
    });

    const { getTransactions } = await import("../api-client.js");
    await getTransactions({ district: "Gdańsk", landUse: "gruntyRolne,unknown", buildingStoreys: "1,3plus" });

    const url = mockFetch.mock.calls[0]![0] as string;
    // comma may be URL-encoded (%2C) or literal — anchor to each key.
    expect(url).toMatch(/landUse=gruntyRolne(%2C|,)unknown/);
    expect(url).toMatch(/buildingStoreys=1(%2C|,)3plus/);
  });

  it("getTransactions passes minFootprintArea and maxFootprintArea filters", async () => {
    mockFetch.mockResolvedValueOnce({
      ok: true,
      json: () => Promise.resolve({ data: [], pagination: {}, summary: null }),
    });

    const { getTransactions } = await import("../api-client.js");
    await getTransactions({ district: "Gdańsk", minFootprintArea: 100, maxFootprintArea: 200 });

    const url = mockFetch.mock.calls[0]![0] as string;
    expect(url).toContain("minFootprintArea=100");
    expect(url).toContain("maxFootprintArea=200");
  });

  it("getTransactionHeritage hits the per-transaction heritage endpoint", async () => {
    mockFetch.mockResolvedValueOnce({
      ok: true,
      json: () => Promise.resolve({ data: [], truncated: false }),
    });

    const { getTransactionHeritage } = await import("../api-client.js");
    await getTransactionHeritage("11111111-2222-3333-4444-555555555555");

    const url = mockFetch.mock.calls[0]![0] as string;
    expect(url).toContain("/api/v1/transactions/11111111-2222-3333-4444-555555555555/heritage");
  });

  it("getTransactionLandslide hits the per-transaction landslide endpoint and passes the body through", async () => {
    const body = {
      data: [{
        landslide_risk: "landslide", severity_rank: 1, pct_in_zone: "80.00",
        zones: [{ kind: "landslide", source_version_date: "2021-03-15" }],
      }],
      truncated: false,
    };
    mockFetch.mockResolvedValueOnce({
      ok: true,
      json: () => Promise.resolve(body),
    });

    const { getTransactionLandslide } = await import("../api-client.js");
    const { data } = await getTransactionLandslide("11111111-2222-3333-4444-555555555555");

    const url = mockFetch.mock.calls[0]![0] as string;
    expect(url).toContain("/api/v1/transactions/11111111-2222-3333-4444-555555555555/landslide");
    expect(data).toEqual(body);
  });

  it("getTransactionLandslide passes an empty two-state body through untouched", async () => {
    mockFetch.mockResolvedValueOnce({
      ok: true,
      json: () => Promise.resolve({ data: [], truncated: false }),
    });

    const { getTransactionLandslide } = await import("../api-client.js");
    const { data } = await getTransactionLandslide("11111111-2222-3333-4444-555555555555");

    expect(data).toEqual({ data: [], truncated: false });
  });

  it("getTransactionSurroundings hits the per-transaction surroundings endpoint", async () => {
    mockFetch.mockResolvedValueOnce({
      ok: true,
      json: () => Promise.resolve({ data: [], truncated: false }),
    });

    const { getTransactionSurroundings } = await import("../api-client.js");
    await getTransactionSurroundings("11111111-2222-3333-4444-555555555555");

    const url = mockFetch.mock.calls[0]![0] as string;
    expect(url).toContain("/api/v1/transactions/11111111-2222-3333-4444-555555555555/surroundings");
  });

  it("getTransactionPermits hits the per-transaction permits endpoint", async () => {
    mockFetch.mockResolvedValueOnce({
      ok: true,
      json: () => Promise.resolve({ data: [], truncated: false, note: "…" }),
    });

    const { getTransactionPermits } = await import("../api-client.js");
    await getTransactionPermits("11111111-2222-3333-4444-555555555555");

    const url = mockFetch.mock.calls[0]![0] as string;
    expect(url).toContain("/api/v1/transactions/11111111-2222-3333-4444-555555555555/permits");
  });

  it("getPermitsInArea hits the area endpoint with only the params that were given", async () => {
    mockFetch.mockResolvedValueOnce({
      ok: true,
      json: () => Promise.resolve({ locked: false, data: [], truncated: false }),
    });

    const { getPermitsInArea } = await import("../api-client.js");
    await getPermitsInArea({ lat: 52.0928, lng: 21.0225, radiusKm: 1.5, intent: "multi_family", limit: 20 });

    const url = new URL(mockFetch.mock.calls[0]![0] as string);
    expect(url.pathname).toBe("/api/v1/permits/area");
    expect(Object.fromEntries(url.searchParams)).toEqual({
      lat: "52.0928", lng: "21.0225", radiusKm: "1.5", intent: "multi_family", limit: "20",
    });
  });

  it("getPermitsInArea sends category arrays as CSV and passes cursor, dateTo and aggregateOnly", async () => {
    mockFetch.mockResolvedValueOnce({
      ok: true,
      json: () => Promise.resolve({ locked: false, data: [], truncated: false }),
    });

    const { getPermitsInArea } = await import("../api-client.js");
    await getPermitsInArea({
      lat: 52.0928, lng: 21.0225, dateFrom: "2020-01-01", dateTo: "2024-12-31",
      categories: ["XIII", "I"], excludeCategories: ["XXVI"], cursor: "abc_DEF-123", aggregateOnly: true,
    });

    const url = new URL(mockFetch.mock.calls[0]![0] as string);
    expect(Object.fromEntries(url.searchParams)).toEqual({
      lat: "52.0928", lng: "21.0225", dateFrom: "2020-01-01", dateTo: "2024-12-31",
      category: "XIII,I", excludeCategory: "XXVI", cursor: "abc_DEF-123", aggregateOnly: "true",
    });
  });

  it("getPermitsInArea omits aggregateOnly=false and empty category arrays", async () => {
    mockFetch.mockResolvedValueOnce({
      ok: true,
      json: () => Promise.resolve({ locked: false, data: [], truncated: false }),
    });

    const { getPermitsInArea } = await import("../api-client.js");
    await getPermitsInArea({ lat: 52.0928, lng: 21.0225, categories: [], excludeCategories: [], aggregateOnly: false });

    const url = new URL(mockFetch.mock.calls[0]![0] as string);
    expect(Object.fromEntries(url.searchParams)).toEqual({ lat: "52.0928", lng: "21.0225" });
  });

  it("getPermitsInArea: a 503 body keeps its feature-off mode on the error", async () => {
    mockFetch.mockResolvedValueOnce({
      ok: false,
      status: 503,
      json: () => Promise.resolve({ error: "Service Unavailable", message: "off", mode: "feature-disabled" }),
    });

    const { getPermitsInArea, ApiHttpError } = await import("../api-client.js");
    const err = await getPermitsInArea({ lat: 52.1, lng: 21.0 }, `cngrm_${"a".repeat(32)}`).catch((e: Error) => e);
    expect(err).toBeInstanceOf(ApiHttpError);
    expect((err as InstanceType<typeof ApiHttpError>).mode).toBe("feature-disabled");
  });

  it("getTransactionPlanning hits the per-transaction planning endpoint and passes the three-state body through", async () => {
    const body = {
      data: [{
        kind: "zone", zone_symbol: "SW", zone_name: "multi-family residential zone",
        pct_of_parcel: 80, max_building_height_m: 12, max_development_intensity: 1.2,
        max_built_up_coverage_pct: 40, min_bio_active_area_pct: 30,
        params_mixed: false, effective_from: "2025-12-03",
      }],
      truncated: false, coverage: "covered", parcels_total: 1, parcels_covered: 1, note: null,
    };
    mockFetch.mockResolvedValueOnce({
      ok: true,
      json: () => Promise.resolve(body),
    });

    const { getTransactionPlanning } = await import("../api-client.js");
    const { data } = await getTransactionPlanning("11111111-2222-3333-4444-555555555555");

    const url = mockFetch.mock.calls[0]![0] as string;
    expect(url).toContain("/api/v1/transactions/11111111-2222-3333-4444-555555555555/planning");
    expect(data).toEqual(body);
  });

  it("getTransactionPlanning passes an empty not_covered body through untouched", async () => {
    const body = { data: [], truncated: false, coverage: "not_covered", parcels_total: 1, parcels_covered: 0, note: null };
    mockFetch.mockResolvedValueOnce({
      ok: true,
      json: () => Promise.resolve(body),
    });

    const { getTransactionPlanning } = await import("../api-client.js");
    const { data } = await getTransactionPlanning("11111111-2222-3333-4444-555555555555");

    expect(data).toEqual(body);
  });

  it("getTransactionFarmland hits the per-transaction farmland endpoint and passes the envelope through", async () => {
    const body = {
      data: [{ eligible_area_m2: 3984, pct_of_parcel: 87, feature_count: 2 }],
      truncated: false,
      parcels_total: 1,
      parcels_with_data: 1,
      as_of: "2026-07-01",
    };
    mockFetch.mockResolvedValueOnce({
      ok: true,
      json: () => Promise.resolve(body),
    });

    const { getTransactionFarmland } = await import("../api-client.js");
    const { data } = await getTransactionFarmland("11111111-2222-3333-4444-555555555555");

    const url = mockFetch.mock.calls[0]![0] as string;
    expect(url).toContain("/api/v1/transactions/11111111-2222-3333-4444-555555555555/farmland");
    expect(data).toEqual(body);
  });

  it("getTransactionFarmland passes an empty two-state envelope through untouched", async () => {
    const body = { data: [], truncated: false, parcels_total: 0, parcels_with_data: 0, as_of: null };
    mockFetch.mockResolvedValueOnce({
      ok: true,
      json: () => Promise.resolve(body),
    });

    const { getTransactionFarmland } = await import("../api-client.js");
    const { data } = await getTransactionFarmland("11111111-2222-3333-4444-555555555555");

    expect(data).toEqual(body);
  });

  it("throws readable message on non-200 status (500)", async () => {
    mockFetch.mockResolvedValueOnce({
      ok: false,
      status: 500,
      json: () => Promise.resolve({}),
    });

    const { fetchApi } = await import("../api-client.js");
    await expect(fetchApi("/api/stats")).rejects.toThrow("HTTP 500");
  });

  it("throws readable message on 402 (insufficient credits)", async () => {
    mockFetch.mockResolvedValueOnce({
      ok: false,
      status: 402,
      json: () => Promise.resolve({ currentBalance: 0, creditsRequired: 2 }),
    });

    const { fetchApi } = await import("../api-client.js");
    await expect(fetchApi("/api/stats")).rejects.toThrow("Insufficient API tokens");
  });

  it("402 error includes balance and required credits", async () => {
    mockFetch.mockResolvedValueOnce({
      ok: false,
      status: 402,
      json: () => Promise.resolve({ currentBalance: 0, creditsRequired: 5 }),
    });

    const { fetchApi } = await import("../api-client.js");
    const error = await fetchApi("/api/stats").catch((e: Error) => e);
    expect((error as Error).message).toContain("balance: 0");
    expect((error as Error).message).toContain("this call costs: 5");
  });

  it("402 error carries the free-tier body through to the message: cost, balance, free tools, renewal time", async () => {
    mockFetch.mockResolvedValueOnce({
      ok: false,
      status: 402,
      json: () => Promise.resolve({
        error: "insufficient_credits",
        creditsRequired: 45,
        currentBalance: 12,
        tokensReturnAt: "2026-10-30T14:05:33.000Z",
        message: "The current balance is used up; it goes back to 50 from 2026-10-30.",
        upgrade: "https://cenogram.pl/api#cennik",
      }),
    });

    const { fetchApi } = await import("../api-client.js");
    const error = await fetchApi("/api/stats").catch((e: Error) => e);
    const message = (error as Error).message;
    expect(message).toContain("balance: 12, this call costs: 45");
    expect(message).toContain("Free tools that still work: list_locations");
    expect(message).toContain("Balance restores from 2026-10-30 14:05 UTC");
    expect(message).toContain("The current balance is used up; it goes back to 50 from 2026-10-30.");
  });

  it("402 error handles missing json body gracefully", async () => {
    mockFetch.mockResolvedValueOnce({
      ok: false,
      status: 402,
      json: () => Promise.reject(new Error("not json")),
    });

    const { fetchApi } = await import("../api-client.js");
    const error = await fetchApi("/api/stats").catch((e: Error) => e);
    expect((error as Error).message).toContain("Insufficient API tokens");
    expect((error as Error).message).toContain("balance: unknown");
  });

  it("throws on 429 (IP rate limit)", async () => {
    mockFetch.mockResolvedValueOnce({
      ok: false,
      status: 429,
      headers: { get: () => null },
    });

    const { fetchApi } = await import("../api-client.js");
    await expect(fetchApi("/api/stats")).rejects.toThrow("Too many requests");
  });

  // A 429 from this API means "wait a few seconds", so the message has to say seconds.
  // It used to divide Retry-After by 86400 and report every bounce as "Resets in 1 day(s)",
  // which read to a calling agent as "the allowance is gone, come back tomorrow".
  describe("429 Retry-After", () => {
    const bounce = async (retryAfter: string | null) => {
      mockFetch.mockResolvedValueOnce({
        ok: false,
        status: 429,
        headers: { get: (h: string) => (h === "Retry-After" ? retryAfter : null) },
      });
      const { fetchApi } = await import("../api-client.js");
      return fetchApi("/api/stats").then(
        () => { throw new Error("expected a rejection"); },
        (err: Error) => err.message,
      );
    };

    it.each([
      ["5", "Retry in 5 seconds."],
      ["1", "Retry in 1 second."],
      ["60", "Retry in 1 minute."],
      ["90", "Retry in 2 minutes."],
      ["3600", "Retry in 1 hour."],
      ["259200", "Retry in 3 days."],
      ["0", "Retry in 1 second."],
    ])("Retry-After: %s -> %s", async (header, expected) => {
      expect(await bounce(header)).toContain(expected);
    });

    it("says it is a rate limit, not an exhausted allowance", async () => {
      expect(await bounce("5")).toContain("rate limit, not an exhausted allowance");
    });

    it.each([[null], ["", ], ["soon"], ["-5"]])(
      "stays silent about timing for an unusable header (%s)",
      async (header) => {
        const message = await bounce(header as string | null);
        expect(message).toContain("Retry shortly.");
        expect(message).not.toContain("NaN");
        expect(message).not.toMatch(/day/);
      },
    );

    it("reads the RFC 7231 HTTP-date form a proxy may send", async () => {
      const in90s = new Date(Date.now() + 90_000).toUTCString();
      expect(await bounce(in90s)).toMatch(/Retry in (1|2) minutes?\./);
    });
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
    expect(url).toContain("/api/v1/price-per-m2");
  });

  it("getPricePerM2 forwards dateFrom/dateTo and sends none by default", async () => {
    mockFetch.mockResolvedValue({ ok: true, json: () => Promise.resolve([]) });

    const { getPricePerM2 } = await import("../api-client.js");
    await getPricePerM2();
    await getPricePerM2(undefined, { dateFrom: "2024-10-23", dateTo: "2026-10-23" });
    await getPricePerM2(undefined, { dateTo: "2026-10-23" });

    const urls = mockFetch.mock.calls.map((c) => new URL(c[0] as string));
    expect(urls[0]!.search).toBe("");
    expect(urls[1]!.searchParams.get("dateFrom")).toBe("2024-10-23");
    expect(urls[1]!.searchParams.get("dateTo")).toBe("2026-10-23");
    expect(urls[2]!.searchParams.has("dateFrom")).toBe(false);
    expect(urls[2]!.searchParams.get("dateTo")).toBe("2026-10-23");
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
    expect(url).toContain("/api/v1/districts");
  });

  it("getDistrictCoverage sends the names as one comma-separated query param", async () => {
    mockFetch.mockResolvedValueOnce({
      ok: true,
      json: () => Promise.resolve({ data: [{ name: "Testville", transactions: 2 }], meta: { total: 1 } }),
    });

    const { getDistrictCoverage } = await import("../api-client.js");
    const result = await getDistrictCoverage(["Testville", "Wola"]);

    const url = new URL(mockFetch.mock.calls[0]![0] as string);
    expect(url.pathname).toBe("/api/v1/districts/coverage");
    expect(url.searchParams.get("names")).toBe("Testville,Wola");
    expect(result.data.data[0]!.transactions).toBe(2);
  });

  it("getRentalYield passes location to the rental-yield endpoint", async () => {
    mockFetch.mockResolvedValueOnce({
      ok: true,
      json: () => Promise.resolve({ location: "Warszawa", gross_yield_pct: 5.5 }),
    });

    const { getRentalYield } = await import("../api-client.js");
    await getRentalYield({ location: "Warszawa" });

    const url = mockFetch.mock.calls[0]![0] as string;
    expect(url).toContain("/api/v1/rental-yield");
    expect(url).toContain("location=Warszawa");
  });

  it("getRentalYield passes teryt (and omits empty location)", async () => {
    mockFetch.mockResolvedValueOnce({
      ok: true,
      json: () => Promise.resolve({ location: "Kraków", gross_yield_pct: 4.9 }),
    });

    const { getRentalYield } = await import("../api-client.js");
    await getRentalYield({ teryt: "1261" });

    const url = mockFetch.mock.calls[0]![0] as string;
    expect(url).toContain("/api/v1/rental-yield");
    expect(url).toContain("teryt=1261");
    expect(url).not.toContain("location=");
  });

  it("getFloodRisk passes location to the flood-risk endpoint", async () => {
    mockFetch.mockResolvedValueOnce({
      ok: true,
      json: () => Promise.resolve({ location: { name: "Warszawa" }, metric: "flood_exposure_share" }),
    });

    const { getFloodRisk } = await import("../api-client.js");
    await getFloodRisk({ location: "Warszawa" });

    const url = mockFetch.mock.calls[0]![0] as string;
    expect(url).toContain("/api/v1/flood-risk");
    expect(url).toContain("location=Warszawa");
  });

  it("getFloodRisk passes teryt (and omits empty location)", async () => {
    mockFetch.mockResolvedValueOnce({
      ok: true,
      json: () => Promise.resolve({ location: { name: "Kraków" }, metric: "flood_exposure_share" }),
    });

    const { getFloodRisk } = await import("../api-client.js");
    await getFloodRisk({ teryt: "1261" });

    const url = mockFetch.mock.calls[0]![0] as string;
    expect(url).toContain("/api/v1/flood-risk");
    expect(url).toContain("teryt=1261");
    expect(url).not.toContain("location=");
  });

  it("getFloodRiskLocations hits the flood-risk locations catalog with search", async () => {
    mockFetch.mockResolvedValueOnce({
      ok: true,
      json: () => Promise.resolve({ data: [], meta: { total: 0, snapshot_date: null } }),
    });

    const { getFloodRiskLocations } = await import("../api-client.js");
    await getFloodRiskLocations({ search: "gda" });

    const url = mockFetch.mock.calls[0]![0] as string;
    expect(url).toContain("/api/v1/flood-risk/locations");
    expect(url).toContain("search=gda");
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
    expect(url).toContain("/api/v1/transactions/summary");
    expect(url).toContain("district=Mokot");
    expect(url).toContain("propertyType=4");
    expect(url).toContain("dateFrom=2024-01-01");
  });

  it("getTransactionsSummary forwards floodRisk, heritageStatus, buildingNumber, parcelId (count must match filtered rows)", async () => {
    mockFetch.mockResolvedValueOnce({
      ok: true,
      json: () => Promise.resolve({ median_price_m2: 15000, avg_area: 55, total: 100 }),
    });

    const { getTransactionsSummary } = await import("../api-client.js");
    await getTransactionsSummary({
      district: "Warszawa",
      street: "Aleja Waszyngtona",
      buildingNumber: "30",
      parcelId: "146518_8.0108.27",
      floodRisk: "high",
      heritageStatus: "listed",
    });

    const url = mockFetch.mock.calls[0]![0] as string;
    // Drift guard: summary must carry the same row-filtering params as getTransactions,
    // otherwise "Found N" reports an unfiltered total.
    expect(url).toContain("buildingNumber=30");
    expect(url).toContain("parcelId=146518_8.0108.27");
    expect(url).toContain("floodRisk=high");
    expect(url).toContain("heritageStatus=listed");
  });

  it("getTransactionsSummary forwards landslideRisk (count must match filtered rows)", async () => {
    mockFetch.mockResolvedValueOnce({
      ok: true,
      json: () => Promise.resolve({ median_price_m2: 15000, avg_area: 55, total: 100 }),
    });

    const { getTransactionsSummary } = await import("../api-client.js");
    await getTransactionsSummary({
      district: "Gdynia",
      landslideRisk: "landslide",
    });

    const url = mockFetch.mock.calls[0]![0] as string;
    // Same drift guard as floodRisk: a summary that drops the filter reports an unfiltered total.
    expect(url).toContain("landslideRisk=landslide");
  });

  it("getTransactionsSummary forwards ownershipType (count must match filtered rows)", async () => {
    mockFetch.mockResolvedValueOnce({
      ok: true,
      json: () => Promise.resolve({ median_price_m2: 15000, avg_area: 55, total: 100 }),
    });

    const { getTransactionsSummary } = await import("../api-client.js");
    await getTransactionsSummary({
      district: "Kraków",
      ownershipType: "2,8",
    });

    const url = mockFetch.mock.calls[0]![0] as string;
    // Same drift guard: a summary that drops the filter reports an unfiltered total.
    expect(url).toMatch(/ownershipType=2(%2C|,)8/);
  });

  it("getTransactionsSummary forwards landUse/buildingStoreys/footprint (count must match filtered rows)", async () => {
    mockFetch.mockResolvedValueOnce({
      ok: true,
      json: () => Promise.resolve({ median_price_m2: 15000, avg_area: 55, total: 100 }),
    });

    const { getTransactionsSummary } = await import("../api-client.js");
    await getTransactionsSummary({
      district: "Kraków",
      landUse: "gruntyRolne",
      buildingStoreys: "1",
      minFootprintArea: 100,
      maxFootprintArea: 200,
    });

    const url = mockFetch.mock.calls[0]![0] as string;
    // Same drift guard as floodRisk: a summary that drops any of these reports an unfiltered total.
    expect(url).toContain("landUse=gruntyRolne");
    expect(url).toContain("buildingStoreys=1");
    expect(url).toContain("minFootprintArea=100");
    expect(url).toContain("maxFootprintArea=200");
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
    await expect(fetchApiPost("/api/test", {})).rejects.toThrow("Insufficient API tokens");
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
    expect(url).toContain("/api/v1/parcels/search");
    expect(url).toContain("q=146518");
    expect(url).toContain("limit=5");
  });

  it("resolveParcel builds correct URL and omits empty params", async () => {
    mockFetch.mockResolvedValueOnce({
      ok: true,
      json: () => Promise.resolve({ query: { mode: "q", q: "Wawer 27" }, coverage: "covered", as_of: null, matches: [], truncated: false }),
    });

    const { resolveParcel } = await import("../api-client.js");
    await resolveParcel({ q: "Wawer 27" });

    const url = mockFetch.mock.calls[0]![0] as string;
    expect(url).toContain("/api/v1/parcels/resolve");
    expect(url).toContain("q=Wawer+27");
    expect(url).not.toContain("parcelId=");
    expect(url).not.toContain("lat=");
  });

  it("resolveParcel serializes numeric lat/lng", async () => {
    mockFetch.mockResolvedValueOnce({
      ok: true,
      json: () => Promise.resolve({ query: { mode: "latlng", lat: 52.12, lng: 21.05 }, coverage: "covered", as_of: null, matches: [], truncated: false }),
    });

    const { resolveParcel } = await import("../api-client.js");
    await resolveParcel({ lat: 52.12, lng: 21.05 });

    const url = mockFetch.mock.calls[0]![0] as string;
    expect(url).toContain("lat=52.12");
    expect(url).toContain("lng=21.05");
    expect(url).not.toContain("q=");
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
    expect(url).toContain("/api/v1/transactions/spatial");
    const opts = mockFetch.mock.calls[0]![1] as RequestInit;
    expect(opts.method).toBe("POST");
    const body = JSON.parse(opts.body as string) as Record<string, unknown>;
    expect(body.propertyType).toBe(4);
    expect(body.minPrice).toBe(300000);
  });

  it("searchByPolygon forwards ownershipType in the POST body", async () => {
    mockFetch.mockResolvedValueOnce({
      ok: true,
      json: () => Promise.resolve({ type: "FeatureCollection", features: [], total: 0, truncated: false }),
    });

    const { searchByPolygon } = await import("../api-client.js");
    await searchByPolygon({
      polygon: { type: "Polygon", coordinates: [[[21, 52], [21.01, 52], [21.01, 52.01], [21, 52.01], [21, 52]]] },
      ownershipType: "2,8",
    });

    const opts = mockFetch.mock.calls[0]![1] as RequestInit;
    const body = JSON.parse(opts.body as string) as Record<string, unknown>;
    expect(body.ownershipType).toBe("2,8");
  });

  it("searchByPolygon forwards landUse/buildingStoreys/footprint in the POST body", async () => {
    mockFetch.mockResolvedValueOnce({
      ok: true,
      json: () => Promise.resolve({ type: "FeatureCollection", features: [], total: 0, truncated: false }),
    });

    const { searchByPolygon } = await import("../api-client.js");
    await searchByPolygon({
      polygon: { type: "Polygon", coordinates: [[[21, 52], [21.01, 52], [21.01, 52.01], [21, 52.01], [21, 52]]] },
      landUse: "gruntyRolne,unknown",
      buildingStoreys: "1,3plus",
      minFootprintArea: 100,
      maxFootprintArea: 200,
    });

    const opts = mockFetch.mock.calls[0]![1] as RequestInit;
    const body = JSON.parse(opts.body as string) as Record<string, unknown>;
    expect(body.landUse).toBe("gruntyRolne,unknown");
    expect(body.buildingStoreys).toBe("1,3plus");
    // Footprint bounds go over the wire as numbers; the /spatial handler accepts number|string.
    expect(body.minFootprintArea).toBe(100);
    expect(body.maxFootprintArea).toBe(200);
  });

  it("402 + OAuth ctx: wording does not mention an API key", async () => {
    mockFetch.mockResolvedValueOnce({
      ok: false,
      status: 402,
      json: () => Promise.resolve({ currentBalance: 3, creditsRequired: 5 }),
    });
    const { getStats, encodeOAuthCtx } = await import("../api-client.js");
    const oauthKey = encodeOAuthCtx("u1", "g1");
    const err = await getStats(oauthKey).catch((e: Error) => e);
    expect((err as Error).message).toContain("Insufficient API tokens");
    expect((err as Error).message).toContain("balance: 3");
    expect((err as Error).message).not.toContain("key's account");
  });

  it("401 + OAuth ctx: prompts disconnect/reconnect", async () => {
    mockFetch.mockResolvedValueOnce({ ok: false, status: 401, json: () => Promise.resolve({}) });
    const { getStats, encodeOAuthCtx } = await import("../api-client.js");
    const oauthKey = encodeOAuthCtx("u1", "g1");
    const err = await getStats(oauthKey).catch((e: Error) => e);
    expect((err as Error).message).toContain("Connection to Cenogram expired");
    expect((err as Error).message).toContain("disconnect and reconnect");
  });

  it("401 + API key: prompts to check the API key in account settings", async () => {
    mockFetch.mockResolvedValueOnce({ ok: false, status: 401, json: () => Promise.resolve({}) });
    const { getStats } = await import("../api-client.js");
    const err = await getStats(`cngrm_${"a".repeat(32)}`).catch((e: Error) => e);
    expect((err as Error).message).toContain("API key rejected");
    expect((err as Error).message).toContain("https://cenogram.pl/ustawienia#api-keys");
  });

  it("403 email_not_verified: prompts inbox check", async () => {
    mockFetch.mockResolvedValueOnce({
      ok: false,
      status: 403,
      json: () => Promise.resolve({ error: "email_not_verified" }),
    });
    const { getStats } = await import("../api-client.js");
    const err = await getStats(`cngrm_${"a".repeat(32)}`).catch((e: Error) => e);
    expect((err as Error).message).toContain("not verified");
  });

  // No longer asserts "maintenance": 503 also covers a disabled feature, a read-only failover
  // and an unavailable dataset, so the message relays the API's reason rather than guessing one.
  it("503: temporary unavailability with retry hint", async () => {
    mockFetch.mockResolvedValueOnce({ ok: false, status: 503, json: () => Promise.resolve({}) });
    const { getStats } = await import("../api-client.js");
    const err = await getStats(`cngrm_${"a".repeat(32)}`).catch((e: Error) => e);
    expect((err as Error).message).toContain("unavailable");
    expect((err as Error).message).toContain("Try again");
  });

  // 503 body ({error, message, mode}): `mode` is carried on the error so a handler can tell a
  // switched-off feature apart from other 503s (additive field).
  it("503: carries body.mode on the ApiHttpError", async () => {
    mockFetch.mockResolvedValueOnce({
      ok: false,
      status: 503,
      json: () => Promise.resolve({ error: "service_unavailable", message: "feature disabled", mode: "feature-disabled" }),
    });
    const { getStats, ApiHttpError } = await import("../api-client.js");
    const err = await getStats(`cngrm_${"a".repeat(32)}`).catch((e: Error) => e);
    expect(err).toBeInstanceOf(ApiHttpError);
    expect((err as InstanceType<typeof ApiHttpError>).status).toBe(503);
    expect((err as InstanceType<typeof ApiHttpError>).mode).toBe("feature-disabled");
  });

  it("503: carries Retry-After seconds on the ApiHttpError", async () => {
    mockFetch.mockResolvedValueOnce({
      ok: false,
      status: 503,
      headers: { get: (h: string) => (h === "Retry-After" ? "30" : null) },
      json: () => Promise.resolve({}),
    });
    const { getStats } = await import("../api-client.js");
    const err = await getStats(`cngrm_${"a".repeat(32)}`).catch((e: Error) => e);
    expect((err as { retryAfterSeconds?: number }).retryAfterSeconds).toBe(30);
  });

  it("503 without mode leaves mode undefined", async () => {
    mockFetch.mockResolvedValueOnce({ ok: false, status: 503, json: () => Promise.resolve({}) });
    const { getStats, ApiHttpError } = await import("../api-client.js");
    const err = await getStats(`cngrm_${"a".repeat(32)}`).catch((e: Error) => e);
    expect(err).toBeInstanceOf(ApiHttpError);
    expect((err as InstanceType<typeof ApiHttpError>).mode).toBeUndefined();
  });

  it("400 surfaces specific body.error from custom reply.send", async () => {
    mockFetch.mockResolvedValueOnce({
      ok: false,
      status: 400,
      json: () => Promise.resolve({ error: "Maximum 5 districts allowed" }),
    });
    const { getStats } = await import("../api-client.js");
    const err = await getStats(`cngrm_${"a".repeat(32)}`).catch((e: Error) => e);
    expect((err as Error).message).toBe("Invalid request: Maximum 5 districts allowed");
  });

  it("400 surfaces body.message from a validation error (error is a class name)", async () => {
    mockFetch.mockResolvedValueOnce({
      ok: false,
      status: 400,
      json: () => Promise.resolve({
        statusCode: 400,
        error: "ValidationError",
        message: "body/districts must NOT have fewer than 1 characters",
      }),
    });
    const { getStats } = await import("../api-client.js");
    const err = await getStats(`cngrm_${"a".repeat(32)}`).catch((e: Error) => e);
    expect((err as Error).message).toContain("Invalid request:");
    expect((err as Error).message).toContain("body/districts");
    expect((err as Error).message).not.toContain("ValidationError");
  });

  it("400 surfaces body.message from thrown plain obj (no error field, polygon shape)", async () => {
    mockFetch.mockResolvedValueOnce({
      ok: false,
      status: 400,
      json: () => Promise.resolve({
        statusCode: 400,
        message: "polygon ring must be closed (first coordinate must equal last)",
      }),
    });
    const { getStats } = await import("../api-client.js");
    const err = await getStats(`cngrm_${"a".repeat(32)}`).catch((e: Error) => e);
    expect((err as Error).message).toContain("Invalid request:");
    expect((err as Error).message).toContain("ring must be closed");
  });

  it("400 with empty body falls back to generic message", async () => {
    mockFetch.mockResolvedValueOnce({
      ok: false,
      status: 400,
      json: () => Promise.resolve({}),
    });
    const { getStats } = await import("../api-client.js");
    const err = await getStats(`cngrm_${"a".repeat(32)}`).catch((e: Error) => e);
    expect((err as Error).message).toBe("Invalid request (HTTP 400). Check parameters.");
  });

  it("422 surfaces body.message from the server (generic body.error)", async () => {
    mockFetch.mockResolvedValueOnce({
      ok: false,
      status: 422,
      json: () => Promise.resolve({
        statusCode: 422,
        error: "Unprocessable Entity",
        message: "polygon must be a closed ring",
      }),
    });
    const { getStats } = await import("../api-client.js");
    const err = await getStats(`cngrm_${"a".repeat(32)}`).catch((e: Error) => e);
    expect((err as Error).message).toContain("Invalid request:");
    expect((err as Error).message).toContain("closed ring");
    expect((err as Error).message).not.toContain("Unprocessable Entity");
  });

  it("400 preserves Polish UTF-8 in surfaced message", async () => {
    mockFetch.mockResolvedValueOnce({
      ok: false,
      status: 400,
      json: () => Promise.resolve({ error: "Nieznana dzielnica: Mokotów" }),
    });
    const { getStats } = await import("../api-client.js");
    const err = await getStats(`cngrm_${"a".repeat(32)}`).catch((e: Error) => e);
    expect((err as Error).message).toBe("Invalid request: Nieznana dzielnica: Mokotów");
  });

  it("compareLocations builds correct URL with districts and filters", async () => {
    mockFetch.mockResolvedValueOnce({
      ok: true,
      json: () => Promise.resolve({ "Mokotów": { median_price_m2: 15000, total: 100 } }),
    });

    const { compareLocations } = await import("../api-client.js");
    await compareLocations({ districts: "Mokotów,Wola", propertyType: 4, dateFrom: "2024-01-01" });

    const url = mockFetch.mock.calls[0]![0] as string;
    expect(url).toContain("/api/v1/transactions/summary/compare");
    expect(url).toContain("districts=Mokot");
    expect(url).toContain("propertyType=4");
    expect(url).toContain("dateFrom=2024-01-01");
  });

  it("compareLocations forwards ownershipType", async () => {
    mockFetch.mockResolvedValueOnce({
      ok: true,
      json: () => Promise.resolve({ "Mokotów": { median_price_m2: 15000, total: 100 } }),
    });

    const { compareLocations } = await import("../api-client.js");
    await compareLocations({ districts: "Mokotów,Wola", ownershipType: "2,8" });

    const url = mockFetch.mock.calls[0]![0] as string;
    expect(url).toMatch(/ownershipType=2(%2C|,)8/);
  });
  describe("location error body", () => {
    const body404 = {
      error: "Unknown location: Krowodrza. Look up the code with /api/locations?search=<fragment> (free, returns a TERYT code to pass as teryt=), or pass a 4-digit county TERYT directly.",
      candidates: [
        { code: "126101", name: "Kraków-Krowodrza", typeName: "delegatura", level: "municipality", parent_name: "Kraków" },
        { code: "126101_9.0001", name: "Krowodrza", typeName: null, level: "precinct", parent_name: "Kraków-Krowodrza" },
      ],
      hint: "Pass the code of the unit you mean as teryt= (for a precinct, the first 6 digits of its code).",
    };

    it("carries hint, parsed candidates (typeName included) and the API's own sentence on the error", async () => {
      mockFetch.mockResolvedValueOnce({ ok: false, status: 404, json: () => Promise.resolve(body404) });

      const { getDemographics, ApiHttpError } = await import("../api-client.js");
      const err = await getDemographics({ location: "Krowodrza" }, `cngrm_${"a".repeat(32)}`).catch((e: Error) => e);
      expect(err).toBeInstanceOf(ApiHttpError);
      const e = err as InstanceType<typeof ApiHttpError>;
      expect(e.message).toBe(body404.error);
      expect(e.detail).toBe(body404.error);
      expect(e.hint).toBe(body404.hint);
      expect(e.candidates?.[0]).toEqual({ code: "126101", name: "Kraków-Krowodrza", typeName: "delegatura", level: "municipality", parent_name: "Kraków" });
      expect(e.candidates?.[1]?.typeName).toBeNull();
    });

    it("flows from the response body through ApiHttpError into formatLocationError", async () => {
      mockFetch.mockResolvedValueOnce({ ok: false, status: 404, json: () => Promise.resolve(body404) });

      const { getDemographics } = await import("../api-client.js");
      const { formatLocationError } = await import("../location-errors.js");
      const err = await getDemographics({ location: "Krowodrza" }, `cngrm_${"a".repeat(32)}`).catch((e: Error) => e);
      const text = formatLocationError("get_demographics", { location: "Krowodrza" }, err as never)!;
      expect(text).toContain("126101 - Kraków-Krowodrza (delegatura), Kraków");
      expect(text).toContain('get_demographics(teryt="126101")');
      expect(text).not.toContain("/api/");
    });

    it("keeps an older body without the new fields working", async () => {
      mockFetch.mockResolvedValueOnce({ ok: false, status: 404, json: () => Promise.resolve({ error: body404.error }) });

      const { getDemographics } = await import("../api-client.js");
      const { formatLocationError } = await import("../location-errors.js");
      const err = (await getDemographics({ location: "Krowodrza" }, `cngrm_${"a".repeat(32)}`).catch((e: Error) => e)) as InstanceType<typeof import("../api-client.js").ApiHttpError>;
      expect(err.candidates).toBeUndefined();
      expect(err.hint).toBeUndefined();
      const text = formatLocationError("get_demographics", { location: "Krowodrza" }, err)!;
      expect(text).toContain('list_locations(search="Krowodrza")');
      expect(text).not.toContain("/api/");
    });

    it("relays a 400 hint on the error for the tool layer to reword", async () => {
      mockFetch.mockResolvedValueOnce({
        ok: false,
        status: 400,
        json: () => Promise.resolve({ error: "Provide a parcel number", hint: "look it up with GET /api/parcels?location=<locality>&street=<street>" }),
      });

      const { resolveParcel } = await import("../api-client.js");
      const err = await resolveParcel({ q: "Armii Krajowej 10 Ełk" }, `cngrm_${"a".repeat(32)}`).catch((e: Error) => e) as Error & { hint?: string; detail?: string };
      expect(err.detail).toBe("Provide a parcel number");
      expect(err.hint).toContain("GET /api/parcels?location=");
      expect(err.message).toContain("Invalid request: Provide a parcel number");
    });
  });
});
