import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";
import {
  getStats,
  getTransactions,
  getPricePerM2,
  getDistricts,
  getLocations,
  getPriceHistogram,
  getTransactionsSummary,
  searchParcels,
  searchByPolygon,
  compareLocations,
} from "./api-client.js";
import type { CreditInfo } from "./api-client.js";
import {
  formatTransactionList,
  formatMarketOverview,
  formatPriceStats,
  formatHistogram,
  formatParcelResults,
  formatSpatialResults,
  formatCompareResults,
  formatLocationHierarchy,
} from "./formatters.js";
import {
  mapPropertyType,
  mapMarketType,
  mapUnitFunction,
  mapBuildingType,
  radiusKmToBbox,
  filterByLocation,
  expandDistrict,
  CITY_SUBDISTRICTS,
} from "./mappings.js";

// ── Helpers ─────────────────────────────────────────────────────────

function sanitizeInput(s: string, maxLen = 50): string {
  return s.replace(/[<>]/g, "").slice(0, maxLen);
}

function textResponse(text: string) {
  return { content: [{ type: "text" as const, text }] };
}

function formatCreditFooter(creditInfo: CreditInfo | null): string {
  if (!creditInfo) return "";
  return `\n---\nAPI tokens: ${creditInfo.balance} remaining (query cost: ${creditInfo.cost})`;
}

function requireApiKey(apiKey: string | undefined): asserts apiKey is string {
  if (!apiKey) {
    throw new Error(
      "Internal: missing auth context. " +
      "stdio: set CENOGRAM_API_KEY env var (key from https://cenogram.pl/api/keys). " +
      "HTTP MCP: report bug - https://github.com/cenogram/mcp-server/issues",
    );
  }
}

function extractKeyPrefix(apiKey: string | undefined): string | null {
  if (!apiKey) return null;
  if (apiKey.startsWith("\x01")) return "oauth";
  if (apiKey.startsWith("cngrm_")) return apiKey.slice(0, 10);
  return apiKey.slice(0, 4);
}

async function withErrorHandling(
  toolName: string,
  apiKey: string | undefined,
  fn: () => Promise<{ content: { type: "text"; text: string }[] }>,
) {
  const start = Date.now();
  let success = true;
  try {
    return await fn();
  } catch (error) {
    success = false;
    const message = error instanceof Error ? error.message : String(error);
    return { content: [{ type: "text" as const, text: `Error: ${message}` }], isError: true };
  } finally {
    process.stderr.write(
      JSON.stringify({
        level: "info",
        evt: "tool.call",
        tool: toolName,
        key_prefix: extractKeyPrefix(apiKey),
        duration_ms: Date.now() - start,
        success,
      }) + "\n",
    );
  }
}

// ── Tool registration ──────────────────────────────────────────────

export function registerTools(server: McpServer, apiKey?: string): void {

// ── Tool 1: search_transactions ─────────────────────────────────────

server.tool(
  "search_transactions",
  `Search Polish real estate transactions from the national RCN registry (8M+ records).
Returns transaction details: address, date, price, area, price/m², property type.
Use list_locations first to find valid location names.
Example: search for apartments in Mokotów sold in 2024 above 500,000 PLN.
Data notes: marketType is NULL for ~55% of records (notary didn't classify) - filtering by marketType excludes them. ~1.7% of records have no transaction_date.
Location matches TERYT districts only - for neighborhoods (osiedla), use search_by_area instead.`,
  {
    location: z.string().optional().describe(
      "Location name - city (e.g. 'Warszawa', 'Kraków', 'Gdańsk') or district (e.g. 'Mokotów', 'Kraków-Podgórze'). 'Warszawa', 'Kraków', 'Łódź' auto-expand to all sub-districts. Use list_locations to find valid names.",
    ),
    teryt: z.string().min(1).optional().describe(
      "TERYT administrative code(s) for precise area filtering. Comma-separated, max 10. 2-digit (voivodeship), 4-digit (county), 6-digit (municipality), or full precinct code (e.g. '321705_2.0054'). Use list_locations to find codes. More precise than 'location' - avoids name ambiguity.",
    ),
    propertyType: z.enum(["land", "building", "developed_land", "unit"]).optional()
      .describe("Property type filter"),
    marketType: z.enum(["primary", "secondary"]).optional()
      .describe("Market type: primary (developer) or secondary (resale). ~55% of records have unknown market type and will be excluded when this filter is used."),
    unitFunction: z.enum(["residential", "commercial", "office", "production", "garage", "other"]).optional()
      .describe("Unit/apartment function filter"),
    buildingType: z.enum(["residential", "commercial", "industrial", "transport", "office", "warehouse", "education_sports", "farm_utility", "hospital", "other_nonresidential"]).optional()
      .describe("Building type filter (PKOB classification)"),
    mpzpDesignation: z.string().optional()
      .describe("MPZP zoning designation filter (exact match, e.g. 'budownictwoMieszkanioweWielorodzinne', 'terenObiektowProdukcyjnychSkladowIMagazynow')"),
    minPrice: z.number().optional().describe("Minimum price in PLN"),
    maxPrice: z.number().optional().describe("Maximum price in PLN"),
    dateFrom: z.string().optional().describe("Start date (YYYY-MM-DD)"),
    dateTo: z.string().optional().describe("End date (YYYY-MM-DD)"),
    street: z.string().optional().describe("Street name filter (partial match, e.g. 'Puławska', 'Trakt Lubelski')"),
    buildingNumber: z.string().optional().describe("Building/house number (e.g. '251C', '12A'). Requires location or street to be set."),
    parcelId: z.string().optional().describe("Exact parcel ID as returned in search results (e.g. '146518_8.0108.27'). Must match exactly - copy from a previous search result's parcel_id field."),
    minArea: z.number().optional().describe("Minimum area in m²"),
    maxArea: z.number().optional().describe("Maximum area in m²"),
    limit: z.number().min(1).max(50).default(10)
      .describe("Number of results (1-50, default 10)"),
    sort: z.enum(["price", "date", "area", "pricePerM2", "district", "rooms", "floor"]).default("date")
      .describe("Sort by field (default: date)"),
    order: z.enum(["asc", "desc"]).default("desc").optional()
      .describe("Sort order (default: desc)"),
    page: z.number().min(1).default(1).optional()
      .describe("Page number for pagination (default: 1)"),
  },
  { readOnlyHint: true },
  async (params) =>
    withErrorHandling("search_transactions", apiKey, async () => {
      requireApiKey(apiKey);

      if (params.teryt) {
        const TERYT_RE = /^(\d{2}|\d{4}|\d{6}|\d{6}_\d|\d{6}_\d\.\d{4})$/;
        const codes = params.teryt.split(",").map((c) => c.trim());
        if (codes.length > 10) {
          return textResponse("Too many TERYT codes (max 10). Narrow your selection.");
        }
        const invalid = codes.filter((c) => !TERYT_RE.test(c));
        if (invalid.length > 0) {
          return textResponse(
            `Invalid TERYT code(s): ${invalid.map((c) => `'${sanitizeInput(c)}'`).join(", ")}. ` +
            "Valid formats: 2-digit (voivodeship), 4-digit (county), 6-digit (municipality), " +
            "or precinct (e.g. '321705_2.0054'). Use list_locations to find codes.",
          );
        }
      }

      const txParams = {
        district: params.location,
        teryt: params.teryt,
        propertyType: mapPropertyType(params.propertyType),
        marketType: mapMarketType(params.marketType),
        unitFunction: mapUnitFunction(params.unitFunction),
        buildingType: mapBuildingType(params.buildingType),
        mpzpDesignation: params.mpzpDesignation,
        minPrice: params.minPrice,
        maxPrice: params.maxPrice,
        dateFrom: params.dateFrom,
        dateTo: params.dateTo,
        street: params.street,
        buildingNumber: params.buildingNumber,
        parcelId: params.parcelId,
        minArea: params.minArea,
        maxArea: params.maxArea,
        limit: params.limit,
        sort: params.sort,
        order: params.order ?? "desc",
        page: params.page,
      };
      const [txResult, summaryResult] = await Promise.all([
        getTransactions(txParams, apiKey),
        getTransactionsSummary(txParams, apiKey).catch(() => null),
      ]);
      return textResponse(formatTransactionList(txResult.data, summaryResult?.data ?? null) + formatCreditFooter(txResult.creditInfo));
    }),
);

// ── Tool 2: get_price_statistics ────────────────────────────────────

server.tool(
  "get_price_statistics",
  `Get price per m² statistics by location for residential apartments in Poland.
Note: only covers residential units (lokale mieszkalne). For other property types, use search_transactions.
'Warszawa'/'Kraków'/'Łódź' auto-expand to all sub-districts (Warszawa=19, Kraków=5, Łódź=6). Other names use partial match.
Data quality: based on transaction prices from notarial deeds, not asking/listing prices. Coverage varies by county (some have data gaps of 5+ years).`,
  {
    location: z.string().optional().describe(
      "Filter by location name. 'Warszawa'/'Kraków'/'Łódź' auto-expand to all sub-districts. Other names use case-insensitive partial match (e.g. 'Wrocł' matches 'Wrocław'). Omit for all Poland.",
    ),
  },
  { readOnlyHint: true },
  async (params) =>
    withErrorHandling("get_price_statistics", apiKey, async () => {
      requireApiKey(apiKey);
      const { data: allRows, creditInfo } = await getPricePerM2(apiKey);
      let rows = allRows;
      if (params.location) {
        if (CITY_SUBDISTRICTS.has(params.location)) {
          const allowed = new Set(expandDistrict(params.location));
          rows = rows.filter((r) => allowed.has(r.district));
        } else {
          rows = rows.filter((r) =>
            filterByLocation(params.location!, [r.district]).length > 0,
          );
        }
      }
      return textResponse(formatPriceStats(rows, params.location) + formatCreditFooter(creditInfo));
    }),
);

// ── Tool 3: get_price_distribution ──────────────────────────────────

server.tool(
  "get_price_distribution",
  `Get price distribution histogram showing how many transactions fall into each price range.
Useful for understanding the overall market price structure in Poland.`,
  {
    bins: z.number().min(5).max(50).default(20)
      .describe("Number of price bins (5-50, default 20)"),
    maxPrice: z.number().default(3_000_000)
      .describe("Maximum price to include (default 3,000,000 PLN)"),
  },
  { readOnlyHint: true },
  async (params) =>
    withErrorHandling("get_price_distribution", apiKey, async () => {
      requireApiKey(apiKey);
      const { data: bins, creditInfo } = await getPriceHistogram(params.bins, params.maxPrice, apiKey);
      return textResponse(formatHistogram(bins) + formatCreditFooter(creditInfo));
    }),
);

// ── Tool 4: search_by_area ──────────────────────────────────────────

server.tool(
  "search_by_area",
  `Search real estate transactions within a geographic radius.
Best tool for neighborhood/osiedle searches (neighborhoods are not TERYT districts).
Radius guide: 0.3-0.5 km for a street, 0.5-1 km for a neighborhood, 2-5 km for a city area.
Example: apartments in Wrocław's Nowy Dwór (lat 51.143, lng 16.993, radiusKm=0.7).
Area filters (minArea/maxArea) work for all propertyType values.`,
  {
    latitude: z.number().min(49).max(55)
      .describe("Latitude (Poland range: 49-55)"),
    longitude: z.number().min(14).max(25)
      .describe("Longitude (Poland range: 14-25)"),
    radiusKm: z.number().min(0.1).max(50).default(2)
      .describe("Search radius in km (0.1-50, default 2). Use 0.5-1 for neighborhoods, 0.3-0.5 for streets."),
    propertyType: z.enum(["land", "building", "developed_land", "unit"]).optional()
      .describe("Property type filter"),
    marketType: z.enum(["primary", "secondary"]).optional()
      .describe("Market type: primary (developer) or secondary (resale). ~55% of records have unknown market type and will be excluded when this filter is used."),
    unitFunction: z.enum(["residential", "commercial", "office", "production", "garage", "other"]).optional()
      .describe("Unit/apartment function filter"),
    buildingType: z.enum(["residential", "commercial", "industrial", "transport", "office", "warehouse", "education_sports", "farm_utility", "hospital", "other_nonresidential"]).optional()
      .describe("Building type filter (PKOB classification)"),
    minPrice: z.number().optional().describe("Minimum price in PLN"),
    maxPrice: z.number().optional().describe("Maximum price in PLN"),
    minArea: z.number().optional()
      .describe("Minimum area in m² (usable_area_m2 for units, parcel_area for land)"),
    maxArea: z.number().optional()
      .describe("Maximum area in m²"),
    dateFrom: z.string().optional().describe("Start date (YYYY-MM-DD)"),
    dateTo: z.string().optional().describe("End date (YYYY-MM-DD)"),
    limit: z.number().min(1).max(50).default(20)
      .describe("Number of results (1-50, default 20)"),
  },
  { readOnlyHint: true },
  async (params) =>
    withErrorHandling("search_by_area", apiKey, async () => {
      requireApiKey(apiKey);
      const bbox = radiusKmToBbox(params.latitude, params.longitude, params.radiusKm);
      const txParams = {
        bbox: bbox.join(","),
        propertyType: mapPropertyType(params.propertyType),
        marketType: mapMarketType(params.marketType),
        unitFunction: mapUnitFunction(params.unitFunction),
        buildingType: mapBuildingType(params.buildingType),
        minPrice: params.minPrice,
        maxPrice: params.maxPrice,
        minArea: params.minArea,
        maxArea: params.maxArea,
        dateFrom: params.dateFrom,
        dateTo: params.dateTo,
        limit: params.limit,
        sort: "date",
        order: "desc" as const,
      };
      const [txResult, summaryResult] = await Promise.all([
        getTransactions(txParams, apiKey),
        getTransactionsSummary(txParams, apiKey).catch(() => null),
      ]);
      return textResponse(formatTransactionList(txResult.data, summaryResult?.data ?? null) + formatCreditFooter(txResult.creditInfo));
    }),
);

// ── Tool 5: get_market_overview ─────────────────────────────────────

server.tool(
  "get_market_overview",
  `Get a comprehensive overview of the Polish real estate transaction database.
Returns: total transaction count, date range, breakdown by property type and market type, top locations, price statistics.
Note: data quality varies by field - marketType is unknown for ~55% of records, transaction_date missing for ~1.7%.`,
  {},
  { readOnlyHint: true },
  async () =>
    withErrorHandling("get_market_overview", apiKey, async () => {
      requireApiKey(apiKey);
      const { data: stats, creditInfo } = await getStats(apiKey);
      return textResponse(formatMarketOverview(stats) + formatCreditFooter(creditInfo));
    }),
);

// ── Tool 6: list_locations ──────────────────────────────────────────

server.tool(
  "list_locations",
  `Browse locations in two modes:
1. TERYT hierarchy (parent param): Navigate voivodeship → county → municipality → precinct. Returns TERYT codes for use in search_transactions(teryt=...).
   - No parent: 16 voivodeships (2-digit codes)
   - 2-digit: counties (4-digit), 4-digit: municipalities (6-digit), 6-digit: precincts
2. Name search (search param): Find districts by name (flat list, legacy).
If both provided, parent takes precedence.
Use 'location' for quick city searches, 'teryt' for precise administrative filtering (avoids name ambiguity, e.g. 'Wałcz' is both a county and a municipality).`,
  {
    parent: z.string().min(1).optional().describe(
      "TERYT parent code to browse children. 2-digit (voivodeship → counties), 4-digit (county → municipalities), 6-digit (municipality → precincts). Omit for all voivodeships.",
    ),
    search: z.string().min(1).optional().describe(
      "Filter locations by name (case-insensitive partial match, e.g. 'Krak' for Kraków districts). Ignored when parent is set.",
    ),
  },
  { readOnlyHint: true },
  async (params) =>
    withErrorHandling("list_locations", apiKey, async () => {
      requireApiKey(apiKey);

      if (params.parent !== undefined) {
        const parent = params.parent.trim();
        if (!/^(\d{2}|\d{4}|\d{6})$/.test(parent)) {
          return textResponse(
            `Invalid parent code '${sanitizeInput(parent)}'. Parent must be 2, 4, or 6 digits (e.g. '14' for Mazowieckie voivodeship). ` +
            "For precinct-level codes (e.g. '321705_2.0054'), use search_transactions(teryt=...) directly.",
          );
        }
        const { data: locations, creditInfo } = await getLocations(parent, apiKey);
        return textResponse(formatLocationHierarchy(locations, parent) + formatCreditFooter(creditInfo));
      }

      if (params.search === undefined) {
        const { data: locations, creditInfo } = await getLocations(undefined, apiKey);
        return textResponse(formatLocationHierarchy(locations) + formatCreditFooter(creditInfo));
      }

      const { data: allDistricts, creditInfo } = await getDistricts(apiKey);
      let districts = allDistricts;
      if (params.search) {
        districts = filterByLocation(params.search, districts);
      }
      if (districts.length === 0) {
        const msg = params.search
          ? `No locations found matching "${params.search}".`
          : "No locations available.";
        return textResponse(msg + formatCreditFooter(creditInfo));
      }
      const lines = [`Found ${districts.length} locations:\n`];
      const shown = params.search ? districts : districts.slice(0, 50);
      for (const d of shown) {
        lines.push(`  - ${d}`);
      }
      if (!params.search && districts.length > 50) {
        lines.push(`\n...and ${districts.length - 50} more. Use search parameter to filter.`);
      }
      return textResponse(lines.join("\n") + formatCreditFooter(creditInfo));
    }),
);

// ── Tool 7: search_parcels ──────────────────────────────────────────

server.tool(
  "search_parcels",
  `Search for land parcels by parcel ID prefix (autocomplete).
Returns matching parcels with their district, area, and GPS coordinates.
Useful for finding exact parcel IDs, then searching transactions nearby.
Example: search for parcels starting with '146518_8.01'.`,
  {
    q: z.string().min(3).describe(
      "Parcel ID prefix to search for (min 3 chars). E.g. '146518_8.01'",
    ),
    limit: z.number().min(1).max(10).default(10).optional()
      .describe("Max results (1-10, default 10)"),
  },
  { readOnlyHint: true },
  async (params) =>
    withErrorHandling("search_parcels", apiKey, async () => {
      requireApiKey(apiKey);
      const { data, creditInfo } = await searchParcels(params.q, params.limit, apiKey);
      return textResponse(formatParcelResults(data, params.q) + formatCreditFooter(creditInfo));
    }),
);

// ── Tool 8: search_by_polygon ──────────────────────────────────────

server.tool(
  "search_by_polygon",
  `Search real estate transactions within a geographic polygon.
Provide a GeoJSON Polygon geometry to search within a custom area.
Returns transactions found inside the polygon with coordinates.
Use for precise neighborhood/osiedle boundaries. Can estimate coordinates from search_by_area results. For quick searches, start with search_by_area instead.
Coordinates are [longitude, latitude]. First and last point must be identical.
Example: {"type":"Polygon","coordinates":[[[21.0,52.2],[21.01,52.2],[21.01,52.21],[21.0,52.21],[21.0,52.2]]]}`,
  {
    polygon: z.object({
      type: z.literal("Polygon"),
      coordinates: z.array(z.array(z.array(z.number()))),
    }).describe("GeoJSON Polygon geometry. Coordinates: [longitude, latitude] pairs. Max 500 vertices."),
    propertyType: z.enum(["land", "building", "developed_land", "unit"]).optional()
      .describe("Property type filter"),
    marketType: z.enum(["primary", "secondary"]).optional()
      .describe("Market type filter"),
    unitFunction: z.enum(["residential", "commercial", "office", "production", "garage", "other"]).optional()
      .describe("Unit/apartment function filter"),
    buildingType: z.enum(["residential", "commercial", "industrial", "transport", "office", "warehouse", "education_sports", "farm_utility", "hospital", "other_nonresidential"]).optional()
      .describe("Building type filter (PKOB classification)"),
    mpzpDesignation: z.string().optional()
      .describe("MPZP zoning designation filter (exact match)"),
    minPrice: z.number().optional().describe("Minimum price in PLN"),
    maxPrice: z.number().optional().describe("Maximum price in PLN"),
    dateFrom: z.string().optional().describe("Start date (YYYY-MM-DD)"),
    dateTo: z.string().optional().describe("End date (YYYY-MM-DD)"),
    minArea: z.number().optional().describe("Minimum area in m²"),
    maxArea: z.number().optional().describe("Maximum area in m²"),
    district: z.string().optional().describe("District name filter"),
    street: z.string().optional().describe("Street name filter (partial match)"),
    limit: z.number().min(1).max(5000).default(100).optional()
      .describe("Max results (1-5000, default 100). MCP displays up to 50 transactions."),
  },
  { readOnlyHint: true },
  async (params) =>
    withErrorHandling("search_by_polygon", apiKey, async () => {
      requireApiKey(apiKey);
      const { data, creditInfo } = await searchByPolygon({
        polygon: params.polygon as { type: "Polygon"; coordinates: number[][][] },
        propertyType: mapPropertyType(params.propertyType),
        marketType: mapMarketType(params.marketType),
        unitFunction: mapUnitFunction(params.unitFunction),
        buildingType: mapBuildingType(params.buildingType),
        mpzpDesignation: params.mpzpDesignation,
        minPrice: params.minPrice,
        maxPrice: params.maxPrice,
        dateFrom: params.dateFrom,
        dateTo: params.dateTo,
        minArea: params.minArea,
        maxArea: params.maxArea,
        district: params.district,
        street: params.street,
        limit: params.limit,
      }, apiKey);
      return textResponse(formatSpatialResults(data) + formatCreditFooter(creditInfo));
    }),
);

// ── Tool 9: compare_locations ──────────────────────────────────────

server.tool(
  "compare_locations",
  `Compare real estate statistics across multiple locations side-by-side.
Provide 2-5 district names to compare median price/m², average area, and transaction counts.
Use list_locations first to find valid location names.
Requires at least one filter besides districts (e.g., propertyType).
Example: compare Mokotów, Wola, Ursynów for apartments.`,
  {
    districts: z.string().min(1).describe(
      "Comma-separated district names to compare (2-5). E.g. 'Mokotów,Wola,Ursynów'",
    ),
    propertyType: z.enum(["land", "building", "developed_land", "unit"]).optional()
      .describe("Property type filter (recommended - API requires at least one filter)"),
    marketType: z.enum(["primary", "secondary"]).optional()
      .describe("Market type filter"),
    unitFunction: z.enum(["residential", "commercial", "office", "production", "garage", "other"]).optional()
      .describe("Unit/apartment function filter"),
    buildingType: z.enum(["residential", "commercial", "industrial", "transport", "office", "warehouse", "education_sports", "farm_utility", "hospital", "other_nonresidential"]).optional()
      .describe("Building type filter (PKOB classification)"),
    mpzpDesignation: z.string().optional()
      .describe("MPZP zoning designation prefix filter (e.g. 'terenRolniczy', 'budownictwoMieszkanioweJednorodzinne', 'budownictwoMieszkanioweWielorodzinne')"),
    minPrice: z.number().optional().describe("Minimum price in PLN"),
    maxPrice: z.number().optional().describe("Maximum price in PLN"),
    dateFrom: z.string().optional().describe("Start date (YYYY-MM-DD)"),
    dateTo: z.string().optional().describe("End date (YYYY-MM-DD)"),
    minArea: z.number().optional().describe("Minimum area in m²"),
    maxArea: z.number().optional().describe("Maximum area in m²"),
    street: z.string().optional().describe("Street name filter"),
  },
  { readOnlyHint: true },
  async (params) =>
    withErrorHandling("compare_locations", apiKey, async () => {
      requireApiKey(apiKey);
      const { data, creditInfo } = await compareLocations({
        districts: params.districts,
        propertyType: mapPropertyType(params.propertyType),
        marketType: mapMarketType(params.marketType),
        unitFunction: mapUnitFunction(params.unitFunction),
        buildingType: mapBuildingType(params.buildingType),
        mpzpDesignation: params.mpzpDesignation,
        minPrice: params.minPrice,
        maxPrice: params.maxPrice,
        dateFrom: params.dateFrom,
        dateTo: params.dateTo,
        minArea: params.minArea,
        maxArea: params.maxArea,
        street: params.street,
      }, apiKey);
      return textResponse(formatCompareResults(data) + formatCreditFooter(creditInfo));
    }),
);

} // end registerTools
