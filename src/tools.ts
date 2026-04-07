import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";
import {
  getStats,
  getTransactions,
  getPricePerM2,
  getDistricts,
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
} from "./formatters.js";
import {
  mapPropertyType,
  mapMarketType,
  radiusKmToBbox,
  filterByLocation,
} from "./mappings.js";

// ── Helpers ─────────────────────────────────────────────────────────

function textResponse(text: string) {
  return { content: [{ type: "text" as const, text }] };
}

function formatCreditFooter(creditInfo: CreditInfo | null): string {
  if (!creditInfo) return "";
  return `\n---\nTokeny API: ${creditInfo.balance} pozostało (koszt zapytania: ${creditInfo.cost})`;
}

function requireApiKey(apiKey: string | undefined): asserts apiKey is string {
  if (!apiKey) {
    throw new Error(
      "Authorization: Bearer <api-key> required. Get your free API key at https://cenogram.pl/api",
    );
  }
}

async function withErrorHandling(
  fn: () => Promise<{ content: { type: "text"; text: string }[] }>,
) {
  try {
    return await fn();
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    return { content: [{ type: "text" as const, text: `Error: ${message}` }], isError: true };
  }
}

// ── Tool registration ──────────────────────────────────────────────

export function registerTools(server: McpServer, apiKey?: string): void {

// ── Tool 1: search_transactions ─────────────────────────────────────

server.tool(
  "search_transactions",
  `Search Polish real estate transactions from the national RCN registry (7M+ records).
Returns transaction details: address, date, price, area, price/m², property type.
Use list_locations first to find valid location names.
Example: search for apartments in Mokotów sold in 2024 above 500,000 PLN.`,
  {
    location: z.string().optional().describe(
      "Location name - city (e.g. 'Kraków', 'Gdańsk') or district (e.g. 'Mokotów', 'Śródmieście'). For Warsaw, use district names (Mokotów, Wola, etc.) - 'Warszawa' won't match. Use list_locations to find valid names.",
    ),
    propertyType: z.enum(["land", "building", "developed_land", "unit"]).optional()
      .describe("Property type filter"),
    marketType: z.enum(["primary", "secondary"]).optional()
      .describe("Market type: primary (developer) or secondary (resale)"),
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
    withErrorHandling(async () => {
      requireApiKey(apiKey);
      const txParams = {
        district: params.location,
        propertyType: mapPropertyType(params.propertyType),
        marketType: mapMarketType(params.marketType),
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
For Warsaw: use district names (Mokotów, Wola) - 'Warszawa' won't match any results.`,
  {
    location: z.string().optional().describe(
      "Filter by location name (case-insensitive partial match). E.g. 'Kraków' matches 'Kraków-Podgórze', 'Kraków-Śródmieście', etc. Omit for all Poland.",
    ),
  },
  { readOnlyHint: true },
  async (params) =>
    withErrorHandling(async () => {
      requireApiKey(apiKey);
      const { data: allRows, creditInfo } = await getPricePerM2(apiKey);
      let rows = allRows;
      if (params.location) {
        rows = rows.filter((r) =>
          filterByLocation(params.location!, [r.district]).length > 0,
        );
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
    withErrorHandling(async () => {
      requireApiKey(apiKey);
      const { data: bins, creditInfo } = await getPriceHistogram(params.bins, params.maxPrice, apiKey);
      return textResponse(formatHistogram(bins) + formatCreditFooter(creditInfo));
    }),
);

// ── Tool 4: search_by_area ──────────────────────────────────────────

server.tool(
  "search_by_area",
  `Search real estate transactions within a geographic radius.
Provide latitude/longitude coordinates and a radius in km.
Example: find apartment sales within 2km of Warsaw's Palace of Culture (lat 52.2317, lng 21.0060).`,
  {
    latitude: z.number().min(49).max(55)
      .describe("Latitude (Poland range: 49-55)"),
    longitude: z.number().min(14).max(25)
      .describe("Longitude (Poland range: 14-25)"),
    radiusKm: z.number().min(0.1).max(50).default(2)
      .describe("Search radius in kilometers (0.1-50, default 2)"),
    propertyType: z.enum(["land", "building", "developed_land", "unit"]).optional()
      .describe("Property type filter"),
    marketType: z.enum(["primary", "secondary"]).optional()
      .describe("Market type filter"),
    minPrice: z.number().optional().describe("Minimum price in PLN"),
    maxPrice: z.number().optional().describe("Maximum price in PLN"),
    dateFrom: z.string().optional().describe("Start date (YYYY-MM-DD)"),
    dateTo: z.string().optional().describe("End date (YYYY-MM-DD)"),
    limit: z.number().min(1).max(50).default(20)
      .describe("Number of results (1-50, default 20)"),
  },
  { readOnlyHint: true },
  async (params) =>
    withErrorHandling(async () => {
      requireApiKey(apiKey);
      const bbox = radiusKmToBbox(params.latitude, params.longitude, params.radiusKm);
      const txParams = {
        bbox: bbox.join(","),
        propertyType: mapPropertyType(params.propertyType),
        marketType: mapMarketType(params.marketType),
        minPrice: params.minPrice,
        maxPrice: params.maxPrice,
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
Returns: total transaction count, date range, breakdown by property type and market type, top locations, price statistics.`,
  {},
  { readOnlyHint: true },
  async () =>
    withErrorHandling(async () => {
      requireApiKey(apiKey);
      const { data: stats, creditInfo } = await getStats(apiKey);
      return textResponse(formatMarketOverview(stats) + formatCreditFooter(creditInfo));
    }),
);

// ── Tool 6: list_locations ──────────────────────────────────────────

server.tool(
  "list_locations",
  `List available locations (cities and districts) in the database.
Returns administrative districts - for most cities, the district name equals the city name.
For Warsaw: returns district names (Mokotów, Śródmieście, Wola, etc.), not 'Warszawa'.
For Kraków: returns sub-districts (Kraków-Podgórze, Kraków-Śródmieście, etc.).
Use the search parameter to filter by name.`,
  {
    search: z.string().optional().describe(
      "Filter locations by name (case-insensitive partial match, e.g. 'Krak' for Kraków districts)",
    ),
  },
  { readOnlyHint: true },
  async (params) =>
    withErrorHandling(async () => {
      requireApiKey(apiKey);
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
      // Show all if filtered, otherwise top 50
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
    withErrorHandling(async () => {
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
Use for precise area searches (neighborhoods, streets, custom regions).
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
    withErrorHandling(async () => {
      requireApiKey(apiKey);
      const { data, creditInfo } = await searchByPolygon({
        polygon: params.polygon as { type: "Polygon"; coordinates: number[][][] },
        propertyType: mapPropertyType(params.propertyType),
        marketType: mapMarketType(params.marketType),
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
    withErrorHandling(async () => {
      requireApiKey(apiKey);
      const { data, creditInfo } = await compareLocations({
        districts: params.districts,
        propertyType: mapPropertyType(params.propertyType),
        marketType: mapMarketType(params.marketType),
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
