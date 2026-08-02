import { Sentry } from "./sentry.js";
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
  resolveParcel,
  getParcelReport,
  searchByPolygon,
  compareLocations,
  getRentalYield,
  getRentalYieldLocations,
  getPriceSpread,
  getPriceSpreadLocations,
  getValuation,
  getBuildingBreakdown,
  getTransactionFlood,
  getTransactionHeritage,
  getTransactionLandslide,
  getTransactionSurroundings,
  getTransactionTransit,
  getTransactionPermits,
  getTransactionPlanning,
  getTransactionFarmland,
  getDemographics,
  getInfrastructureSignals,
  decodeOAuthCtx,
  OAUTH_CTX_PREFIX,
} from "./api-client.js";
import type { CreditInfo } from "./api-client.js";
import { signupUrl } from "./error-messages.js";
import { channelSrc, isHttpMode } from "./transport-mode.js";
import { sanitizeForLog } from "./auth-dispatch.js";
import {
  formatTransactionList,
  formatMarketOverview,
  formatPriceStats,
  formatHistogram,
  formatParcelResults,
  formatParcelResolve,
  formatParcelReport,
  formatSpatialResults,
  formatCompareResults,
  formatLocationHierarchy,
  formatRentalYield,
  formatRentalYieldLocations,
  formatPriceSpread,
  formatPriceSpreadLocations,
  formatValuation,
  formatBuildingBreakdown,
  formatFloodBreakdown,
  formatHeritageBreakdown,
  formatLandslideBreakdown,
  formatSurroundings,
  formatTransitBreakdown,
  formatPermitsBreakdown,
  formatPlanningBreakdown,
  formatFarmland,
  formatDemographics,
  formatInfrastructureSignals,
  MARKET_CAVEAT,
} from "./formatters.js";
import {
  mapPropertyType,
  mapMarketType,
  mapUnitFunction,
  mapBuildingType,
  mapOwnershipTypes,
  mapTransactionTypes,
  radiusKmToBbox,
  filterByLocation,
  resolveDistrict,
  tryResolveCityKey,
} from "./mappings.js";

// ── Helpers ─────────────────────────────────────────────────────────

function sanitizeInput(s: string, maxLen = 50): string {
  return s.replace(/[<>]/g, "").slice(0, maxLen);
}

// Mirror of the server-side guard. Validating here means a malformed id is
// rejected before the API call — the REST endpoint bills 1 credit per call even for a garbage id that
// resolves to empty, so zod-validating up front protects the caller's credit.
const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

function textResponse(text: string) {
  return { content: [{ type: "text" as const, text }] };
}

function formatCreditFooter(creditInfo: CreditInfo | null): string {
  if (!creditInfo) return "";
  return `\n---\nAPI tokens: ${creditInfo.balance} remaining (query cost: ${creditInfo.cost})`;
}

// Two very different situations produce a missing key, and the old wording described both as
// a defect. On stdio it is the ordinary state of someone who has not got a key yet - telling
// them to file a bug sends them nowhere. Over HTTP the auth context is established before any
// tool runs, so its absence really is a defect on our side.
function requireApiKey(apiKey: string | undefined): asserts apiKey is string {
  if (!apiKey) {
    if (isHttpMode()) {
      throw new Error(
        "Missing auth context on the hosted server - this is a bug on our side, not something " +
        "you can fix. Please report it: https://github.com/cenogram/mcp-server/issues",
      );
    }
    throw new Error(
      `No Cenogram API key configured. Get a free key at ${signupUrl()}, then add it to your ` +
      'MCP config: "env": { "CENOGRAM_API_KEY": "cngrm_..." }',
    );
  }
}

// Decode the caller identity from the auth context, for logging + Sentry only.
// user_id carries two shapes: a UUID for OAuth callers, the key prefix otherwise. key_prefix stays a
// separate field so a log consumer can tell the channel apart; the two shapes are visually distinct too.
function decodeAuthIdentity(apiKey: string | undefined): { userId: string | null; keyPrefix: string | null } {
  if (!apiKey) return { userId: null, keyPrefix: null };
  // Gate on the \x01 prefix BEFORE the slice fallback: a malformed OAuth ctx (decode = null) must not fall
  // through to apiKey.slice(0,4), which would leak the raw \x01 control byte into the logs/Sentry. Keep the
  // stable "oauth" label (the previous extractKeyPrefix returned "oauth" for any \x01-prefixed key).
  if (apiKey.startsWith(OAUTH_CTX_PREFIX)) {
    const oauth = decodeOAuthCtx(apiKey);
    return { userId: oauth ? sanitizeForLog(oauth.userId) : null, keyPrefix: "oauth" };
  }
  if (apiKey.startsWith("cngrm_")) return { userId: null, keyPrefix: apiKey.slice(0, 10) };
  return { userId: null, keyPrefix: apiKey.slice(0, 4) };
}

async function withErrorHandling(
  toolName: string,
  apiKey: string | undefined,
  fn: () => Promise<{ content: { type: "text"; text: string }[] }>,
) {
  const start = Date.now();
  let success = true;
  const { userId, keyPrefix } = decodeAuthIdentity(apiKey);
  // Per-call scope (NOT global Sentry.setUser): the process is shared across concurrent HTTP requests.
  // withScope forks the current scope, kept per-call via the OTel async-context strategy, so
  // captureException inside binds the right user even across awaits; withScope returns the callback's
  // return value (incl. the Promise).
  return await Sentry.withScope(async (scope) => {
    const identity = userId ?? keyPrefix;
    if (identity) scope.setUser({ id: identity });
    try {
      return await fn();
    } catch (error) {
      success = false;
      Sentry.captureException(error, { tags: { tool: toolName, error_layer: "tool_execution" } });
      const message = error instanceof Error ? error.message : String(error);
      return { content: [{ type: "text" as const, text: `Error: ${message}` }], isError: true };
    } finally {
      process.stderr.write(
        JSON.stringify({
          level: "info",
          evt: "tool.call",
          tool: toolName,
          key_prefix: keyPrefix,
          user_id: userId ?? keyPrefix,
          duration_ms: Date.now() - start,
          success,
        }) + "\n",
      );
    }
  });
}

// ── Optional tools flag ────────────────────────────────────────────

/** Whether tools outside the default set are registered. Read once, at registration time. */
export function experimentalToolsEnabled(): boolean {
  return process.env.CENOGRAM_EXPERIMENTAL_TOOLS === "1";
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
Permalink: every result is shareable on the map. From a result's "id:" line and its "Location: <A>°N, <B>°E" line, build https://cenogram.pl/ceny-transakcyjne?src=${channelSrc()}#v=1&lat=<A>&lng=<B>&z=16&tx=<id> (drop the °N/°E; lat = the °N number, lng = the °E number) — opens that exact transaction on the map. Omit &tx=<id> for the area only.
Field provenance: values are from the notarial deed (RCN) by default; computed values (parcel area summed across plots or converted from hectares, an inferred/reclassified property type) and approximated streets are flagged inline with a neutral [...] note.
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
    unitFunction: z.enum(["residential", "commercial", "office", "production", "garage", "other", "unknown"]).optional()
      .describe("Unit/apartment function filter. 'unknown' = no function recorded (NULL); without it such rows are excluded. Garages appear only when 'garage' is selected, not via 'unknown'."),
    buildingType: z.enum(["residential", "commercial", "industrial", "transport", "office", "warehouse", "education_sports", "farm_utility", "hospital", "other_nonresidential", "unknown"]).optional()
      .describe("Building type filter (PKOB classification). 'unknown' = no type recorded (NULL); without it such rows are excluded (~39% of buildings have no type)."),
    ownershipType: z.array(z.enum(["land_ownership", "perpetual_usufruct", "cooperative_ownership", "unit_sale", "ownership", "unit_ownership_with_appurtenant_right", "building_ownership_with_appurtenant_right", "unknown"])).optional()
      .describe("Ownership / legal-right type filter (rodzaj prawa do nieruchomości). land_ownership; perpetual_usufruct (użytkowanie wieczyste — covers both registry codes for this right); cooperative_ownership; unit_sale; ownership; unit_ownership_with_appurtenant_right; building_ownership_with_appurtenant_right. 'unknown' = no right recorded (NULL). Multi-select; e.g. ['land_ownership','perpetual_usufruct'] to compare ownership vs perpetual usufruct on undeveloped land."),
    mpzpDesignation: z.string().optional()
      .describe("MPZP zoning designation filter (exact match, e.g. 'budownictwoMieszkanioweWielorodzinne', 'terenObiektowProdukcyjnychSkladowIMagazynow'). Use 'unknown' for rows with no designation recorded (NULL); distinct from the registry code 'brakMPZPLubWZ' (= 'no plan/WZ' recorded as data)."),
    transactionType: z.array(z.enum(["free_market", "auction", "non_auction", "subsidized", "public_purpose", "foreclosure", "unknown"])).optional()
      .describe("Transaction type filter. For market analysis, ALWAYS specify transactionType to exclude non-market transactions (subsidized, foreclosure, public purpose). ~2% of transactions have unknown type (NULL) and are excluded when this filter is used unless 'unknown' is included."),
    rooms: z.array(z.enum(["1", "2", "3", "4", "5", "6", "7", "8plus", "unknown"])).optional()
      .describe("Number of rooms (izby) filter, residential units only. Multi-select; '8plus' means 8 or more, 'unknown' = no room count recorded (NULL). E.g. ['2','3'] for 2-3 izby flats. Without 'unknown', rows with no room count are excluded."),
    floor: z.array(z.string().regex(/^(-?\d+|\d+plus|unknown)$/i, "Invalid floor token - use an integer (e.g. '2','0','-1'), 'Nplus' (e.g. '10plus'), or 'unknown'.")).optional()
      .describe("Floor of the unit (piętro lokalu, residential). Multi-select buckets: exact integers incl. '0' (parter) and negatives e.g. '-1' (basement), 'Nplus' e.g. '10plus' = 10 or more, '0plus' = ground and above, 'unknown' = no floor recorded (NULL). E.g. ['0','1','2'] for ground-to-2nd floor. Building storeys are a different attribute. Without 'unknown', rows with no floor are excluded."),
    floodRisk: z.array(z.enum(["low", "medium", "high"])).optional()
      .describe("Flood-hazard filter. high = most frequent flooding (~1-in-10-year), medium (~1-in-100-year), low = rarest (~1-in-500-year). Selects ONLY transactions whose land sits in a mapped flood zone; absence of a zone is never asserted as 'safe'. Multi-select; e.g. ['medium','high'] = at least medium risk."),
    heritageStatus: z.array(z.enum(["listed", "zone"])).optional()
      .describe("Heritage-listing filter. listed = a protected monument on/at the property's land; zone = the land lies within a protected urban layout or the designated surroundings of a monument. Selects ONLY transactions where a listing was detected; absence of a detection is never asserted as 'not listed'. Multi-select; e.g. ['listed'] = individually listed properties only."),
    landslideRisk: z.array(z.enum(["landslide", "threatened"])).optional()
      .describe("Landslide-hazard filter, from official landslide-hazard maps (1:10,000 scale). 'landslide' = the land intersects a mapped landslide area; 'threatened' = an area threatened by mass movements. Selects ONLY transactions whose land intersects a mapped hazard area — an intersection means overlap with a mapped area, not that the parcel itself is a landslide; absence of a zone is never asserted as 'safe'. Multi-select; e.g. ['landslide','threatened'] = any mapped hazard."),
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
  { readOnlyHint: true, destructiveHint: false, title: "Search Real Estate Transactions" },
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
        ownershipType: mapOwnershipTypes(params.ownershipType),
        buildingType: mapBuildingType(params.buildingType),
        mpzpDesignation: params.mpzpDesignation,
        transactionType: mapTransactionTypes(params.transactionType),
        rooms: params.rooms?.join(","),
        floor: params.floor?.join(","),
        floodRisk: params.floodRisk?.join(","),
        heritageStatus: params.heritageStatus?.join(","),
        landslideRisk: params.landslideRisk?.join(","),
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
Data quality: based on transaction prices from notarial deeds, not asking/listing prices. Coverage varies by county (some have data gaps of 5+ years).
${MARKET_CAVEAT}`,
  {
    location: z.string().optional().describe(
      "Filter by location name. 'Warszawa'/'Kraków'/'Łódź' auto-expand to all sub-districts. Other names use case-insensitive partial match (e.g. 'Wrocł' matches 'Wrocław'). Omit for all Poland.",
    ),
  },
  { readOnlyHint: true, destructiveHint: false, title: "Price per m² Statistics" },
  async (params) =>
    withErrorHandling("get_price_statistics", apiKey, async () => {
      requireApiKey(apiKey);
      const { data: allRows, creditInfo } = await getPricePerM2(apiKey);
      let rows = allRows;
      if (params.location) {
        // City keys (Warszawa/Kraków/Łódź) resolve from the static
        // sub-district map — skip the /api/districts fetch. getPricePerM2 still runs.
        const city = tryResolveCityKey(params.location);
        if (city) {
          const allowed = new Set(city);
          rows = rows.filter((r) => allowed.has(r.district));
        } else {
          const { data: allDistricts } = await getDistricts(apiKey);
          const resolved = resolveDistrict(params.location, allDistricts);
          const isCityExpansion = resolved.length > 1;
          if (isCityExpansion) {
            const allowed = new Set(resolved);
            rows = rows.filter((r) => allowed.has(r.district));
          } else {
            rows = rows.filter((r) =>
              filterByLocation(params.location!, [r.district]).length > 0,
            );
          }
        }
      }
      return textResponse(formatPriceStats(rows, params.location) + formatCreditFooter(creditInfo));
    }),
);

// ── Tool 3: get_price_distribution ──────────────────────────────────

server.tool(
  "get_price_distribution",
  `Get price distribution histogram showing how many transactions fall into each price range.
Useful for understanding the overall market price structure in Poland.
${MARKET_CAVEAT}`,
  {
    bins: z.number().min(5).max(50).default(20)
      .describe("Number of price bins (5-50, default 20)"),
    maxPrice: z.number().default(3_000_000)
      .describe("Maximum price to include (default 3,000,000 PLN)"),
  },
  { readOnlyHint: true, destructiveHint: false, title: "Price Distribution Histogram" },
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
Area filters (minArea/maxArea) work for all propertyType values.
Permalink: every result is shareable on the map. From a result's "id:" line and its "Location: <A>°N, <B>°E" line, build https://cenogram.pl/ceny-transakcyjne?src=${channelSrc()}#v=1&lat=<A>&lng=<B>&z=16&tx=<id> (drop the °N/°E; lat = the °N number, lng = the °E number) — opens that exact transaction on the map. Omit &tx=<id> for the area only.
Field provenance: values are from the notarial deed (RCN) by default; computed values (parcel area summed across plots or converted from hectares, an inferred/reclassified property type) and approximated streets are flagged inline with a neutral [...] note.`,
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
    unitFunction: z.enum(["residential", "commercial", "office", "production", "garage", "other", "unknown"]).optional()
      .describe("Unit/apartment function filter. 'unknown' = no function recorded (NULL); without it such rows are excluded. Garages appear only when 'garage' is selected, not via 'unknown'."),
    buildingType: z.enum(["residential", "commercial", "industrial", "transport", "office", "warehouse", "education_sports", "farm_utility", "hospital", "other_nonresidential", "unknown"]).optional()
      .describe("Building type filter (PKOB classification). 'unknown' = no type recorded (NULL); without it such rows are excluded (~39% of buildings have no type)."),
    ownershipType: z.array(z.enum(["land_ownership", "perpetual_usufruct", "cooperative_ownership", "unit_sale", "ownership", "unit_ownership_with_appurtenant_right", "building_ownership_with_appurtenant_right", "unknown"])).optional()
      .describe("Ownership / legal-right type filter (rodzaj prawa do nieruchomości). land_ownership; perpetual_usufruct (użytkowanie wieczyste — covers both registry codes for this right); cooperative_ownership; unit_sale; ownership; unit_ownership_with_appurtenant_right; building_ownership_with_appurtenant_right. 'unknown' = no right recorded (NULL). Multi-select; e.g. ['land_ownership','perpetual_usufruct'] to compare ownership vs perpetual usufruct on undeveloped land."),
    minPrice: z.number().optional().describe("Minimum price in PLN"),
    maxPrice: z.number().optional().describe("Maximum price in PLN"),
    minArea: z.number().optional()
      .describe("Minimum area in m² (usable_area_m2 for units, parcel_area for land)"),
    maxArea: z.number().optional()
      .describe("Maximum area in m²"),
    dateFrom: z.string().optional().describe("Start date (YYYY-MM-DD)"),
    dateTo: z.string().optional().describe("End date (YYYY-MM-DD)"),
    transactionType: z.array(z.enum(["free_market", "auction", "non_auction", "subsidized", "public_purpose", "foreclosure", "unknown"])).optional()
      .describe("Transaction type filter. For market analysis, ALWAYS specify to exclude non-market transactions."),
    rooms: z.array(z.enum(["1", "2", "3", "4", "5", "6", "7", "8plus", "unknown"])).optional()
      .describe("Number of rooms (izby) filter, residential units only. Multi-select; '8plus' means 8 or more, 'unknown' = no room count recorded (NULL). E.g. ['2','3'] for 2-3 izby flats. Without 'unknown', rows with no room count are excluded."),
    floor: z.array(z.string().regex(/^(-?\d+|\d+plus|unknown)$/i, "Invalid floor token - use an integer (e.g. '2','0','-1'), 'Nplus' (e.g. '10plus'), or 'unknown'.")).optional()
      .describe("Floor of the unit (piętro lokalu, residential). Multi-select buckets: exact integers incl. '0' (parter) and negatives e.g. '-1' (basement), 'Nplus' e.g. '10plus' = 10 or more, '0plus' = ground and above, 'unknown' = no floor recorded (NULL). E.g. ['0','1','2'] for ground-to-2nd floor. Building storeys are a different attribute. Without 'unknown', rows with no floor are excluded."),
    floodRisk: z.array(z.enum(["low", "medium", "high"])).optional()
      .describe("Flood-hazard filter. high = most frequent flooding (~1-in-10-year), medium (~1-in-100-year), low = rarest (~1-in-500-year). Selects ONLY transactions whose land sits in a mapped flood zone; absence of a zone is never asserted as 'safe'. Multi-select; e.g. ['medium','high'] = at least medium risk."),
    heritageStatus: z.array(z.enum(["listed", "zone"])).optional()
      .describe("Heritage-listing filter. listed = a protected monument on/at the property's land; zone = the land lies within a protected urban layout or the designated surroundings of a monument. Selects ONLY transactions where a listing was detected; absence of a detection is never asserted as 'not listed'. Multi-select; e.g. ['listed'] = individually listed properties only."),
    landslideRisk: z.array(z.enum(["landslide", "threatened"])).optional()
      .describe("Landslide-hazard filter, from official landslide-hazard maps (1:10,000 scale). 'landslide' = the land intersects a mapped landslide area; 'threatened' = an area threatened by mass movements. Selects ONLY transactions whose land intersects a mapped hazard area — an intersection means overlap with a mapped area, not that the parcel itself is a landslide; absence of a zone is never asserted as 'safe'. Multi-select; e.g. ['landslide','threatened'] = any mapped hazard."),
    limit: z.number().min(1).max(50).default(20)
      .describe("Number of results (1-50, default 20)"),
  },
  { readOnlyHint: true, destructiveHint: false, title: "Search Transactions by Radius" },
  async (params) =>
    withErrorHandling("search_by_area", apiKey, async () => {
      requireApiKey(apiKey);
      const bbox = radiusKmToBbox(params.latitude, params.longitude, params.radiusKm);
      const txParams = {
        bbox: bbox.join(","),
        propertyType: mapPropertyType(params.propertyType),
        marketType: mapMarketType(params.marketType),
        unitFunction: mapUnitFunction(params.unitFunction),
        ownershipType: mapOwnershipTypes(params.ownershipType),
        buildingType: mapBuildingType(params.buildingType),
        transactionType: mapTransactionTypes(params.transactionType),
        rooms: params.rooms?.join(","),
        floor: params.floor?.join(","),
        floodRisk: params.floodRisk?.join(","),
        heritageStatus: params.heritageStatus?.join(","),
        landslideRisk: params.landslideRisk?.join(","),
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
Note: data quality varies by field - marketType is unknown for ~55% of records, transaction_date missing for ~1.7%.
${MARKET_CAVEAT}`,
  {},
  { readOnlyHint: true, destructiveHint: false, title: "Market Overview" },
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
  { readOnlyHint: true, destructiveHint: false, title: "List Locations & TERYT Codes" },
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

      // For known city keys (Warszawa/Kraków/Łódź) skip /api/districts
      // entirely — sub-districts come from the static map, zero API call (and zero credit).
      // params.search is a defined non-empty string here (undefined handled by the early
      // return above; zod enforces .min(1)).
      let districts: string[];
      let creditInfo: CreditInfo | null;
      const city = tryResolveCityKey(params.search);
      if (city) {
        districts = city;
        creditInfo = null;
      } else {
        const res = await getDistricts(apiKey);
        creditInfo = res.creditInfo;
        districts = filterByLocation(params.search, res.data);
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
  { readOnlyHint: true, destructiveHint: false, title: "Search Land Parcels" },
  async (params) =>
    withErrorHandling("search_parcels", apiKey, async () => {
      requireApiKey(apiKey);
      const { data, creditInfo } = await searchParcels(params.q, params.limit, apiKey);
      return textResponse(formatParcelResults(data, params.q) + formatCreditFooter(creditInfo));
    }),
);

// ── Tool: resolve_parcel ────────────────────────────────────────────

server.tool(
  "resolve_parcel",
  `Resolve a land parcel to its cadastral identity using exactly ONE of:
- parcelId: a full cadastral id, either raw '/' form ('142907_2.0014.342/5') or URL-safe '-' form ('142907_2.0014.342-5'), or the internal UUID from search results.
- q: a full cadastral id, a UUID, OR free-text 'locality name + parcel number' (e.g. 'Sabnie 342/5'). Name matching is exact on the locality (case-insensitive) — an unusual spelling may miss.
- lat & lng: a WGS84 point inside the parcel (returns the parcel(s) containing that point).
Returns a list of matching parcels with district, area, and coordinates; 'truncated' when the name+number match was capped. When nothing matches, coverage is not_covered and the credit is refunded.
Use this to turn an address point, a coordinate, or a locality+number into a concrete parcel id — then feed that id to search_transactions (parcelId) to see its sale history.
Costs 1 API token (refunded when nothing matches).`,
  {
    q: z.string().max(200).optional().describe(
      "Full cadastral id, a UUID, or 'locality name + parcel number' (e.g. 'Sabnie 342/5'). Mutually exclusive with parcelId and lat/lng.",
    ),
    parcelId: z.string().max(200).optional().describe(
      "Full cadastral id (slash or dash form) or internal UUID. Mutually exclusive with q and lat/lng.",
    ),
    lat: z.number().min(-90).max(90).optional().describe(
      "Latitude WGS84. Must be paired with lng. Mutually exclusive with q and parcelId.",
    ),
    lng: z.number().min(-180).max(180).optional().describe(
      "Longitude WGS84. Must be paired with lat. Mutually exclusive with q and parcelId.",
    ),
  },
  { readOnlyHint: true, destructiveHint: false, title: "Resolve Land Parcel" },
  async (params) =>
    withErrorHandling("resolve_parcel", apiKey, async () => {
      requireApiKey(apiKey);
      // Exactly-one-mode guard (mirrors the server's 400). The MCP SDK's tool() takes a raw Zod shape
      // (each field validated independently) and offers no object-level .refine for cross-field rules —
      // same limitation search_by_polygon works around with a field-level refine — so the exclusivity is
      // enforced here, pre-flight, to give a clear message without spending a call/credit.
      const hasQ = params.q != null && params.q !== "";
      const hasParcelId = params.parcelId != null && params.parcelId !== "";
      const hasLat = params.lat != null;
      const hasLng = params.lng != null;
      const modeCount = (hasQ ? 1 : 0) + (hasParcelId ? 1 : 0) + (hasLat || hasLng ? 1 : 0);
      if (modeCount !== 1) {
        return textResponse(
          "Provide exactly one lookup mode: q=, parcelId=, or lat= and lng=.",
        );
      }
      if ((hasLat || hasLng) && !(hasLat && hasLng)) {
        return textResponse("lat and lng must be provided together.");
      }
      const { data, creditInfo } = await resolveParcel(
        { q: params.q, parcelId: params.parcelId, lat: params.lat, lng: params.lng },
        apiKey,
      );
      return textResponse(formatParcelResolve(data) + formatCreditFooter(creditInfo));
    }),
);

// ── Tool: get_parcel_report ─────────────────────────────────────────

server.tool(
  "get_parcel_report",
  `The whole dossier for one land parcel in a single call: the parcel core (location, area, land use, plan designation), all nine enrichment layers (flood risk, heritage listing, landslide risk, nuisance surroundings, public-transport access, general-plan zoning, buildings on the parcel, recent building activity, agricultural-land eligibility), the parcel's transaction history (newest first, up to 20), a local price context (median zł/m² for the county and the locality over the last 12 months) and a municipal context (a headline demographic/economic subset plus upcoming-infrastructure signals for the gmina).
Address it by a full cadastral id in the natural '/' form ('142907_2.0014.342/5'), the URL-safe '-' form, or the internal UUID from a search or resolve result.
Each section carries its own state, shown explicitly: covered = a definitive result; covered_no_data = the parcel was checked and nothing was found (still billed); not_covered = outside our data (refunded); not_computed = a live computation could not finish in time (refunded — the rest of the report still returns, so a report can be partial). The two context sections instead use full / low_sample / suppressed / no_data.
Prefer this over calling the per-layer parcel tools one by one — it is one call at a flat price and never costs more than the sum of its parts. Use resolve_parcel first when you only have an address, a coordinate, or a 'locality + number'.
Costs 35 API tokens. Billing is by outcome (see the billing line on the response): a parcel that cannot be resolved is fully refunded; a resolved parcel where no layer had data is billed only the core floor (1 token) with the rest refunded; a resolved parcel with at least one covered layer is billed in full.`,
  {
    parcelId: z.string().min(3).max(200).describe(
      "Full cadastral id ('142907_2.0014.342/5' or the '-' form) or the internal UUID from a search/resolve result.",
    ),
  },
  { readOnlyHint: true, destructiveHint: false, title: "Get Parcel Report" },
  async (params) =>
    withErrorHandling("get_parcel_report", apiKey, async () => {
      requireApiKey(apiKey);
      const { data, creditInfo } = await getParcelReport(params.parcelId, apiKey);
      return textResponse(formatParcelReport(data) + formatCreditFooter(creditInfo));
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
Permalink: every result is shareable on the map. From a result's "id:" line and its "Location: <A>°N, <B>°E" line, build https://cenogram.pl/ceny-transakcyjne?src=${channelSrc()}#v=1&lat=<A>&lng=<B>&z=16&tx=<id> (drop the °N/°E; lat = the °N number, lng = the °E number) — opens that exact transaction on the map. Omit &tx=<id> for the area only.
Field provenance: values are from the notarial deed (RCN) by default; computed values (parcel area summed across plots or converted from hectares, an inferred/reclassified property type) and approximated streets are flagged inline with a neutral [...] note.
Example: {"type":"Polygon","coordinates":[[[21.0,52.2],[21.01,52.2],[21.01,52.21],[21.0,52.21],[21.0,52.2]]]}`,
  {
    polygon: z.object({
      type: z.literal("Polygon"),
      coordinates: z.array(z.array(z.array(z.number()))).min(1),
    }).refine(
      // Mirror of the server-side guard - keep in sync
      (poly) => poly.coordinates.reduce((sum, ring) => sum + ring.length, 0) <= 500,
      { message: "polygon exceeds 500 total vertices (sum across all rings)" },
    ).describe("GeoJSON Polygon geometry. Coordinates: [longitude, latitude] pairs. First and last point must be identical. Max 500 vertices total."),
    propertyType: z.enum(["land", "building", "developed_land", "unit"]).optional()
      .describe("Property type filter"),
    marketType: z.enum(["primary", "secondary"]).optional()
      .describe("Market type filter"),
    unitFunction: z.enum(["residential", "commercial", "office", "production", "garage", "other", "unknown"]).optional()
      .describe("Unit/apartment function filter. 'unknown' = no function recorded (NULL); without it such rows are excluded. Garages appear only when 'garage' is selected, not via 'unknown'."),
    buildingType: z.enum(["residential", "commercial", "industrial", "transport", "office", "warehouse", "education_sports", "farm_utility", "hospital", "other_nonresidential", "unknown"]).optional()
      .describe("Building type filter (PKOB classification). 'unknown' = no type recorded (NULL); without it such rows are excluded (~39% of buildings have no type)."),
    ownershipType: z.array(z.enum(["land_ownership", "perpetual_usufruct", "cooperative_ownership", "unit_sale", "ownership", "unit_ownership_with_appurtenant_right", "building_ownership_with_appurtenant_right", "unknown"])).optional()
      .describe("Ownership / legal-right type filter (rodzaj prawa do nieruchomości). land_ownership; perpetual_usufruct (użytkowanie wieczyste — covers both registry codes for this right); cooperative_ownership; unit_sale; ownership; unit_ownership_with_appurtenant_right; building_ownership_with_appurtenant_right. 'unknown' = no right recorded (NULL). Multi-select; e.g. ['land_ownership','perpetual_usufruct'] to compare ownership vs perpetual usufruct on undeveloped land."),
    mpzpDesignation: z.string().optional()
      .describe("MPZP zoning designation filter (exact match). Use 'unknown' for rows with no designation recorded (NULL); distinct from the registry code 'brakMPZPLubWZ'."),
    transactionType: z.array(z.enum(["free_market", "auction", "non_auction", "subsidized", "public_purpose", "foreclosure", "unknown"])).optional()
      .describe("Transaction type filter. For market analysis, ALWAYS specify to exclude non-market transactions."),
    rooms: z.array(z.enum(["1", "2", "3", "4", "5", "6", "7", "8plus", "unknown"])).optional()
      .describe("Number of rooms (izby) filter, residential units only. Multi-select; '8plus' means 8 or more, 'unknown' = no room count recorded (NULL). E.g. ['2','3'] for 2-3 izby flats. Without 'unknown', rows with no room count are excluded."),
    floor: z.array(z.string().regex(/^(-?\d+|\d+plus|unknown)$/i, "Invalid floor token - use an integer (e.g. '2','0','-1'), 'Nplus' (e.g. '10plus'), or 'unknown'.")).optional()
      .describe("Floor of the unit (piętro lokalu, residential). Multi-select buckets: exact integers incl. '0' (parter) and negatives e.g. '-1' (basement), 'Nplus' e.g. '10plus' = 10 or more, '0plus' = ground and above, 'unknown' = no floor recorded (NULL). E.g. ['0','1','2'] for ground-to-2nd floor. Building storeys are a different attribute. Without 'unknown', rows with no floor are excluded."),
    minPrice: z.number().optional().describe("Minimum price in PLN"),
    maxPrice: z.number().optional().describe("Maximum price in PLN"),
    dateFrom: z.string().optional().describe("Start date (YYYY-MM-DD)"),
    dateTo: z.string().optional().describe("End date (YYYY-MM-DD)"),
    minArea: z.number().optional().describe("Minimum area in m²"),
    maxArea: z.number().optional().describe("Maximum area in m²"),
    district: z.string().optional().describe("District name filter"),
    street: z.string().optional().describe("Street name filter (partial match)"),
    limit: z.number().min(1).max(3000).default(100).optional()
      .describe("Max results (1-3000, default 100). MCP displays up to 50 transactions."),
  },
  { readOnlyHint: true, destructiveHint: false, title: "Search Transactions by Polygon" },
  async (params) =>
    withErrorHandling("search_by_polygon", apiKey, async () => {
      requireApiKey(apiKey);
      const { data, creditInfo } = await searchByPolygon({
        polygon: params.polygon as { type: "Polygon"; coordinates: number[][][] },
        propertyType: mapPropertyType(params.propertyType),
        marketType: mapMarketType(params.marketType),
        unitFunction: mapUnitFunction(params.unitFunction),
        ownershipType: mapOwnershipTypes(params.ownershipType),
        buildingType: mapBuildingType(params.buildingType),
        mpzpDesignation: params.mpzpDesignation,
        transactionType: mapTransactionTypes(params.transactionType),
        rooms: params.rooms?.join(","),
        floor: params.floor?.join(","),
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
Example: compare Mokotów, Wola, Ursynów for apartments.
${MARKET_CAVEAT}`,
  {
    districts: z.string()
      // Mirror of the server-side guard - server dedupes then enforces 1..5; MCP requires 2..5 for compare semantics
      .refine(
        (s) => {
          const list = [...new Set(s.split(",").map((d) => d.trim()).filter(Boolean))];
          return list.length >= 2 && list.length <= 5;
        },
        { message: "districts must be 2-5 unique comma-separated names (e.g. 'Mokotów,Wola,Ursynów')" },
      )
      .describe("Comma-separated district names to compare (2-5, must be unique). E.g. 'Mokotów,Wola,Ursynów'"),
    propertyType: z.enum(["land", "building", "developed_land", "unit"]).optional()
      .describe("Property type filter (recommended - API requires at least one filter)"),
    marketType: z.enum(["primary", "secondary"]).optional()
      .describe("Market type filter"),
    unitFunction: z.enum(["residential", "commercial", "office", "production", "garage", "other", "unknown"]).optional()
      .describe("Unit/apartment function filter. 'unknown' = no function recorded (NULL); without it such rows are excluded. Garages appear only when 'garage' is selected, not via 'unknown'."),
    buildingType: z.enum(["residential", "commercial", "industrial", "transport", "office", "warehouse", "education_sports", "farm_utility", "hospital", "other_nonresidential", "unknown"]).optional()
      .describe("Building type filter (PKOB classification). 'unknown' = no type recorded (NULL); without it such rows are excluded (~39% of buildings have no type)."),
    ownershipType: z.array(z.enum(["land_ownership", "perpetual_usufruct", "cooperative_ownership", "unit_sale", "ownership", "unit_ownership_with_appurtenant_right", "building_ownership_with_appurtenant_right", "unknown"])).optional()
      .describe("Ownership / legal-right type filter (rodzaj prawa do nieruchomości). land_ownership; perpetual_usufruct (użytkowanie wieczyste — covers both registry codes for this right); cooperative_ownership; unit_sale; ownership; unit_ownership_with_appurtenant_right; building_ownership_with_appurtenant_right. 'unknown' = no right recorded (NULL). Multi-select; e.g. ['land_ownership','perpetual_usufruct'] to compare ownership vs perpetual usufruct on undeveloped land."),
    mpzpDesignation: z.string().optional()
      .describe("MPZP zoning designation prefix filter (e.g. 'terenRolniczy', 'budownictwoMieszkanioweJednorodzinne', 'budownictwoMieszkanioweWielorodzinne'). Use 'unknown' for rows with no designation recorded (NULL); distinct from the registry code 'brakMPZPLubWZ'."),
    transactionType: z.array(z.enum(["free_market", "auction", "non_auction", "subsidized", "public_purpose", "foreclosure", "unknown"])).optional()
      .describe("Transaction type filter. For market analysis, ALWAYS specify to exclude non-market transactions."),
    minPrice: z.number().optional().describe("Minimum price in PLN"),
    maxPrice: z.number().optional().describe("Maximum price in PLN"),
    dateFrom: z.string().optional().describe("Start date (YYYY-MM-DD)"),
    dateTo: z.string().optional().describe("End date (YYYY-MM-DD)"),
    minArea: z.number().optional().describe("Minimum area in m²"),
    maxArea: z.number().optional().describe("Maximum area in m²"),
    street: z.string().optional().describe("Street name filter"),
    rooms: z.array(z.enum(["1", "2", "3", "4", "5", "6", "7", "8plus", "unknown"])).optional()
      .describe("Number of rooms (izby) filter, residential units only. Multi-select; '8plus' means 8 or more, 'unknown' = no room count recorded (NULL). E.g. ['2','3'] for 2-3 izby flats. Without 'unknown', rows with no room count are excluded."),
    floor: z.array(z.string().regex(/^(-?\d+|\d+plus|unknown)$/i, "Invalid floor token - use an integer (e.g. '2','0','-1'), 'Nplus' (e.g. '10plus'), or 'unknown'.")).optional()
      .describe("Floor of the unit (piętro lokalu, residential). Multi-select buckets: exact integers incl. '0' (parter) and negatives e.g. '-1' (basement), 'Nplus' e.g. '10plus' = 10 or more, '0plus' = ground and above, 'unknown' = no floor recorded (NULL). E.g. ['0','1','2'] for ground-to-2nd floor. Building storeys are a different attribute. Without 'unknown', rows with no floor are excluded."),
    includeDemographics: z.boolean().optional()
      .describe("Add a GUS BDL demographics block per district (county-level: population density, wages, unemployment, median age, plus a few cross-source ratios like price-to-income). Districts that don't resolve to a county are omitted from the demographics section."),
  },
  { readOnlyHint: true, destructiveHint: false, title: "Compare Locations" },
  async (params) =>
    withErrorHandling("compare_locations", apiKey, async () => {
      requireApiKey(apiKey);
      // Mirror of the server-side guard - at least one filter required besides districts.
      // Free-text strings use .trim() (server's safeString treats "" and whitespace-only as missing).
      // Enums are validated by zod first, so "" / "   " never reach here.
      const hasFilter =
        !!params.propertyType ||
        !!params.marketType ||
        !!params.unitFunction ||
        !!params.buildingType ||
        !!params.mpzpDesignation?.trim() ||
        (params.transactionType != null && params.transactionType.length > 0) ||
        (params.rooms != null && params.rooms.length > 0) ||
        (params.floor != null && params.floor.length > 0) ||
        (params.ownershipType != null && params.ownershipType.length > 0) ||
        params.minPrice != null ||
        params.maxPrice != null ||
        !!params.dateFrom?.trim() ||
        !!params.dateTo?.trim() ||
        params.minArea != null ||
        params.maxArea != null ||
        !!params.street?.trim();
      if (!hasFilter) {
        return textResponse(
          "compare_locations requires at least one filter besides districts (e.g. propertyType=unit, marketType=secondary, or a date range).",
        );
      }
      const { data, creditInfo } = await compareLocations({
        districts: params.districts,
        propertyType: mapPropertyType(params.propertyType),
        marketType: mapMarketType(params.marketType),
        unitFunction: mapUnitFunction(params.unitFunction),
        ownershipType: mapOwnershipTypes(params.ownershipType),
        buildingType: mapBuildingType(params.buildingType),
        mpzpDesignation: params.mpzpDesignation,
        transactionType: mapTransactionTypes(params.transactionType),
        rooms: params.rooms?.join(","),
        floor: params.floor?.join(","),
        minPrice: params.minPrice,
        maxPrice: params.maxPrice,
        dateFrom: params.dateFrom,
        dateTo: params.dateTo,
        minArea: params.minArea,
        maxArea: params.maxArea,
        street: params.street,
        // Comma-separated on the wire, per the API's list-param convention — but a boolean is clearer
        // for an LLM; forward-compat: a future
        // includeAsking would join with a comma. Demo mode (REST) silently drops enrichment.
        include: params.includeDemographics ? "demographics" : undefined,
      }, apiKey);
      return textResponse(formatCompareResults(data) + formatCreditFooter(creditInfo));
    }),
);

// ── Tool: get_demographics (PUBLIC) ─────────────────────────────────

// Format guard only (NOT resolution — that lives in REST): 2/4/6/7-digit TERYT.
const DEMOGRAPHICS_TERYT_RE = /^(\d{2}|\d{4}|\d{6,7})$/;
// Mirror of the server-side category enum. Kept inline to avoid a cross-package dependency; if the
// server list changes, an unknown category simply 400s server-side.
const DEMOGRAPHICS_CATEGORIES = [
  "demographics", "economy", "economy_macro", "housing", "planning",
  "infrastructure", "environment", "safety", "re_market", "education", "prices",
] as const;

server.tool(
  "get_demographics",
  `Demographic, economic, housing and other local statistics for a Polish location, from GUS BDL (Bank Danych Lokalnych) — Poland's public Central Statistical Office open-data bank. ~50 indicators across 11 categories (population, economy, housing, spatial planning, infrastructure, environment, safety, education, prices) plus a few derived metrics.
Address by location (city/county name) OR teryt. A name resolves to county/powiat (4-digit) level; for richer gmina/district-level data (L6) pass a 6 or 7-digit teryt. teryt wins when both are given. Use list_locations to find TERYT codes — neighborhoods/osiedla are NOT addressable here.
A query returns the requested level PLUS all parent levels (a gmina query also yields powiat, NUTS3 region and voivodeship indicators). Optional year, or yearFrom+yearTo for a time series, and category to filter. Cost: 1 token.`,
  {
    location: z.string().optional().describe(
      "City/county name, resolves to county/powiat level (e.g. 'Warszawa', 'Kraków'). Use this OR teryt. For gmina-level data pass a 6/7-digit teryt instead.",
    ),
    teryt: z.string().optional().describe(
      "TERYT code: 2-digit (voivodeship, e.g. 14), 4-digit (county, e.g. 1465), 6 or 7-digit (gmina, e.g. 1465011). Wins over location. Use list_locations to find codes.",
    ),
    year: z.number().int().optional().describe(
      "Single year (2003-present). Mutually exclusive with yearFrom/yearTo. Omit for the latest available year per indicator.",
    ),
    yearFrom: z.number().int().optional().describe("Start year for a time series (min 2003)."),
    yearTo: z.number().int().optional().describe("End year for a time series (max current year + 1)."),
    category: z.array(z.enum(DEMOGRAPHICS_CATEGORIES)).optional().describe(
      "Filter to these categories. Omit to return all available.",
    ),
  },
  { readOnlyHint: true, destructiveHint: false, title: "Demographics & Local Statistics" },
  async (params) =>
    withErrorHandling("get_demographics", apiKey, async () => {
      requireApiKey(apiKey);
      const location = params.location?.trim();
      const teryt = params.teryt?.trim();
      if (!location && !teryt) {
        return textResponse(
          'Provide a location (city/county name) or teryt (administrative code). Example: get_demographics(location="Warszawa").',
        );
      }
      // Obvious format error → reject before the API call (saves the 1-credit charge). A name that
      // doesn't resolve (e.g. a neighborhood) is left to REST → 404 → auto-refunded by the global hook.
      if (teryt && !DEMOGRAPHICS_TERYT_RE.test(teryt)) {
        return textResponse(
          `Invalid teryt '${sanitizeInput(teryt)}'. Use 2 digits (voivodeship), 4 (county), or 6-7 (gmina). Use list_locations to find codes.`,
        );
      }
      const { data, creditInfo } = await getDemographics(
        {
          location,
          teryt,
          year: params.year,
          yearFrom: params.yearFrom,
          yearTo: params.yearTo,
          category: params.category?.join(","),
        },
        apiKey,
      );
      return textResponse(formatDemographics(data) + formatCreditFooter(creditInfo));
    }),
);

// ── Tool: get_infrastructure_signals (PUBLIC) ───────────────────────

// Format guard only (resolution lives in REST): 4-digit county or 6/7-digit municipality.
const INFRA_TERYT_RE = /^(\d{4}|\d{6,7})$/;

server.tool(
  "get_infrastructure_signals",
  `Signals that a Polish municipality is about to build infrastructure — sewerage, water supply, roads, street lighting, gas network or cycling infrastructure. Three independent public sources: tenders published in the national public procurement bulletin (rolling 12-month window), membership in an agglomeration of the national urban waste-water treatment programme (where collective sewerage exists or is planned), and the municipality's own planned capital expenditure from its multi-year financial forecast.
Address by location (city/county name → aggregates every municipality in that county) OR teryt (6-7 digits = one municipality, 4 digits = a county aggregate). teryt wins when both are given. Use list_locations to find codes.
Known limits, state them when you report results: the bulletin carries only contracts BELOW the EU procurement thresholds (from 2021), so the largest investments are not visible here. A tender is attributed to the SEAT of the contracting authority, not to the works location — county and national authorities tender works in other municipalities. The category counters therefore include municipal authorities only, while the recent-notice list shows every authority with a flag. Absence of tenders is NOT evidence that a municipality is not investing.
Cost: 1 token.`,
  {
    location: z.string().optional().describe(
      "City or county name (e.g. 'Warszawa', 'Krotoszyn'). Aggregates every municipality in the county. Use this OR teryt.",
    ),
    teryt: z.string().optional().describe(
      "TERYT code: 6 or 7 digits = one municipality (e.g. 146501), 4 digits = a county aggregate (e.g. 1465). Wins over location.",
    ),
  },
  { readOnlyHint: true, destructiveHint: false, title: "Infrastructure Signals" },
  async (params) =>
    withErrorHandling("get_infrastructure_signals", apiKey, async () => {
      requireApiKey(apiKey);
      const location = params.location?.trim();
      const teryt = params.teryt?.trim();
      if (!location && !teryt) {
        return textResponse(
          'Provide a location (city/county name) or teryt (administrative code). Example: get_infrastructure_signals(location="Krotoszyn").',
        );
      }
      // Obvious format error → reject before the API call (saves the 1-credit charge). A code that
      // is well-formed but nonexistent is left to REST → 404 → auto-refunded by the global hook.
      if (teryt && !INFRA_TERYT_RE.test(teryt)) {
        return textResponse(
          `Invalid teryt '${sanitizeInput(teryt)}'. Use 4 digits (county) or 6-7 digits (municipality). Use list_locations to find codes.`,
        );
      }
      const { data, creditInfo } = await getInfrastructureSignals({ location, teryt }, apiKey);
      return textResponse(formatInfrastructureSignals(data) + formatCreditFooter(creditInfo));
    }),
);

// ── Tool: estimate_value ────────────────────────────────────────────
// Part of the default tool set, flagged "[Beta]" in the description.

server.tool(
  "estimate_value",
  `[Beta] Estimate the market value of an apartment from comparable registered transaction prices near a point. An orientation estimate, NOT a certified appraisal (operat szacunkowy) — it does not account for the unit's condition, finish standard or floor, and does not replace a surveyor's valuation.
Address by lat + lng (a point on the map) OR parcelId (a full cadastral id or internal UUID; the parcel centroid is used) — exactly one. area (usable area in m², 10–250) is REQUIRED: there is no per-address floor-area source in Poland, so the caller supplies it.
Optional: rooms (1–10) and market (primary/secondary) narrow the comparables; includeComps (default true) echoes the nearest comparables it weighed.
Returns the point estimate, a likely and a wide value range, a confidence band, the comparable count, and an as_of date. as_of reflects transaction-data freshness, which lags by county — estimates are NOT directly comparable across cities with different as_of.
Apartments only (v1), 10–250 m². Too few comparables near the point → no estimate (the credit is refunded). Costs 5 API tokens, refunded when no estimate is produced. ${MARKET_CAVEAT}`,
  {
    // Bounds are the Poland bbox, same as search_by_area — the data is Polish, and a point far outside it
    // only buys a slow round-trip that ends in "no estimate".
    lat: z.number().min(49).max(55).optional().describe(
      "Latitude of the apartment (WGS84, Poland). Must be paired with lng. Use this OR parcelId.",
    ),
    lng: z.number().min(14).max(25).optional().describe(
      "Longitude of the apartment (WGS84, Poland). Must be paired with lat. Use this OR parcelId.",
    ),
    parcelId: z.string().max(200).optional().describe(
      "Full cadastral id (slash or dash form) or internal UUID; the parcel centroid is used. Use instead of lat/lng.",
    ),
    area: z.number().min(10).max(250).describe(
      "Apartment usable area in m² (REQUIRED, 10–250). Estimates for 300+ m² are unreliable and rejected.",
    ),
    rooms: z.number().int().min(1).max(10).optional().describe(
      "Room count (1–10, optional) — narrows the comparables to ±1 room.",
    ),
    market: z.enum(["primary", "secondary"]).optional().describe(
      "Restrict comparables to the primary (new-build) or secondary market (optional).",
    ),
    includeComps: z.boolean().optional().describe(
      "Echo the nearest comparables the estimate weighed (default true). Set false for the estimate only.",
    ),
  },
  { readOnlyHint: true, destructiveHint: false, title: "[Beta] Apartment Value Estimate" },
  async (params) =>
    withErrorHandling("estimate_value", apiKey, async () => {
      requireApiKey(apiKey);
      // Exactly-one-mode guard (mirrors resolve_parcel + the server's 400). The MCP SDK's tool() takes a
      // raw Zod shape with no object-level .refine, so enforce lat/lng-XOR-parcelId here, pre-flight, to
      // return a clear message without spending a call/credit.
      const hasLat = params.lat != null;
      const hasLng = params.lng != null;
      const hasParcel = params.parcelId != null && params.parcelId !== "";
      const latLngMode = hasLat || hasLng;
      const modeCount = (latLngMode ? 1 : 0) + (hasParcel ? 1 : 0);
      if (modeCount !== 1) {
        return textResponse("Provide exactly one location: lat= and lng=, OR parcelId=.");
      }
      if (latLngMode && !(hasLat && hasLng)) {
        return textResponse("lat and lng must be provided together.");
      }
      const { data, creditInfo } = await getValuation(
        {
          lat: params.lat,
          lng: params.lng,
          parcelId: params.parcelId,
          area: params.area,
          rooms: params.rooms,
          market: params.market,
          includeComps: params.includeComps ?? true,
        },
        apiKey,
      );
      return textResponse(formatValuation(data) + formatCreditFooter(creditInfo));
    }),
);

// Tools outside the default set (off unless enabled).
if (experimentalToolsEnabled()) {

// ── Tool: get_rental_yield ──────────────────────────────────────────

server.tool(
  "get_rental_yield",
  `EXPERIMENTAL (beta): this tool may change or be withdrawn without notice; do not build critical workflows on it.
Estimate the gross rental yield for a Polish city or county: annualized median asking rent (PLN/m²/month × 12) divided by the median apartment transaction price per m² (secondary market) from the RCN registry.
Gross and top-line only — excludes vacancy, management, tax and maintenance. Indicative, not investment advice.
Address by location (city name → resolves to a county) OR teryt (4-digit county code; 6-digit = dzielnica where available, today Warszawa's 18 districts, otherwise truncated to the county; teryt wins when both are given). Both sides need at least 5 samples or the result is suppressed.
Not comparable across cities with different as_of dates (RCN publication lag varies by county). Rent and transaction prices come from different sources, so the yield is an approximation.
Coverage is county-level only (miasta na prawach powiatu) plus Warszawa's 18 districts, and further limited to cities with asking-rent data. A town inside a larger powiat (e.g. Sandomierz, Pruszków), a non-Warszawa city district, or an osiedle does NOT resolve and returns a 404 — do not pass such names. Unless the location is a major city you already know is covered, call list_rental_yield_locations FIRST to get valid names, or pass a 4-digit county TERYT.
Optional areaBucket restricts both sides to an apartment area range in m2 (e.g. '40-50'). Area ranges are NOT additive — a bucket does not sum back to 'all'.
The transaction-price denominator uses the market median. ${MARKET_CAVEAT}`,
  {
    location: z.string().optional().describe(
      "County-level city name — must be a miasto na prawach powiatu or a catalog entry from list_rental_yield_locations (e.g. 'Warszawa', 'Kraków', 'Gdańsk'). A town within a larger powiat, a non-Warszawa district, or an osiedle will 404 — check the catalog or use teryt first. Use this OR teryt.",
    ),
    teryt: z.string().optional().describe(
      "TERYT code. 4 digits = county (e.g. 1465 = Warszawa). 6 digits = dzielnica where available (today: Warszawa's 18 districts, e.g. 146510 = Śródmieście) → yield for that district. Other longer codes (gmina/precinct) are truncated to the county. Wins over location when both are provided.",
    ),
    areaBucket: z.enum(["all", "0-30", "30-40", "40-50", "50-60", "60-80", "80+"]).optional().describe(
      "Apartment area range in m2: all (default, whole stock), 0-30, 30-40, 40-50, 50-60, 60-80, 80+. Bucket values are not additive.",
    ),
  },
  { readOnlyHint: true, destructiveHint: false, title: "[Beta] Rental Yield Estimate" },
  async (params) =>
    withErrorHandling("get_rental_yield", apiKey, async () => {
      requireApiKey(apiKey);
      if (!params.location?.trim() && !params.teryt?.trim()) {
        return textResponse(
          'Provide a location (city name) or teryt (county code). Example: get_rental_yield(location="Warszawa").',
        );
      }
      const { data, creditInfo } = await getRentalYield(
        { location: params.location, teryt: params.teryt, areaBucket: params.areaBucket },
        apiKey,
      );
      return textResponse(formatRentalYield(data) + formatCreditFooter(creditInfo));
    }),
);

// ── Tool: list_rental_yield_locations ───────────────────────────────

server.tool(
  "list_rental_yield_locations",
  `EXPERIMENTAL (beta): this tool may change or be withdrawn without notice; do not build critical workflows on it.
List the cities/counties for which get_rental_yield can return data (asking-rent coverage). Use this to discover valid location/teryt values for get_rental_yield instead of guessing names.
Each entry is coverage signal only (offer sample size + confidence) — it does not compute the yield; call get_rental_yield(location|teryt) for the actual yield.
Optional search filters by city name (diacritic-insensitive substring, min 2 chars). Results are sorted by rent_sample_n descending. Free (0 credits).`,
  {
    search: z.string().min(2, "search must be at least 2 characters").optional().describe(
      "Filter by city name (diacritic-insensitive substring, min 2 chars). E.g. 'gda' → Gdańsk. Omit to list the full catalog.",
    ),
  },
  { readOnlyHint: true, destructiveHint: false, title: "[Beta] List Rental Yield Locations" },
  async (params) =>
    withErrorHandling("list_rental_yield_locations", apiKey, async () => {
      requireApiKey(apiKey);
      const { data, creditInfo } = await getRentalYieldLocations(
        { search: params.search },
        apiKey,
      );
      return textResponse(formatRentalYieldLocations(data) + formatCreditFooter(creditInfo));
    }),
);

// ── Tool: get_price_spread ──────────────────────────────────────────

server.tool(
  "get_price_spread",
  `EXPERIMENTAL (beta): this tool may change or be withdrawn without notice; do not build critical workflows on it.
Measure the asking-vs-transaction price spread for a Polish city or county: how far the median asking price per m² of apartments for sale sits above (or below) the median apartment transaction price per m² from the RCN registry. spread_pct = (asking − transaction) / transaction × 100.
The spread can be NEGATIVE (asking below transaction) in premium-secondary cities — that is a valid answer, not an error.
Address by location (city name → resolves to a county) OR teryt (4-digit county code; 6-digit = dzielnica where available, today Warszawa's 18 districts, otherwise truncated to the county; teryt wins when both are given). Both sides need at least 5 samples or the result is suppressed.
For marketType='all' (the default), sale offers are a mix of primary and secondary market, so the transaction denominator covers the whole market. With marketType='secondary' or 'primary', both the asking and transaction sides are narrowed to that single market segment.
Not comparable across cities with different as_of dates (RCN publication lag varies by county). Asking and transaction prices come from different sources, so the spread is an approximation.
Coverage is county-level only (miasta na prawach powiatu) plus Warszawa's 18 districts, and further limited to cities with asking-sale data. A town inside a larger powiat (e.g. Sandomierz, Pruszków), a non-Warszawa city district, or an osiedle does NOT resolve and returns a 404 — do not pass such names. Unless the location is a major city you already know is covered, call list_price_spread_locations FIRST to get valid names, or pass a 4-digit county TERYT.
Optional areaBucket restricts both sides to an apartment area range in m2 (e.g. '40-50'). Area ranges are NOT additive — a bucket does not sum back to 'all'.
The transaction-price denominator uses the market median. ${MARKET_CAVEAT}`,
  {
    location: z.string().optional().describe(
      "County-level city name — must be a miasto na prawach powiatu or a catalog entry from list_price_spread_locations (e.g. 'Warszawa', 'Kraków', 'Gdańsk'). A town within a larger powiat, a non-Warszawa district, or an osiedle will 404 — check the catalog or use teryt first. Use this OR teryt.",
    ),
    teryt: z.string().optional().describe(
      "TERYT code. 4 digits = county (e.g. 1465 = Warszawa). 6 digits = dzielnica where available (today: Warszawa's 18 districts, e.g. 146510 = Śródmieście) → spread for that district. Other longer codes (gmina/precinct) are truncated to the county. Wins over location when both are provided.",
    ),
    marketType: z.enum(["primary", "secondary", "all"]).optional().describe(
      "Transaction denominator segment: 'all' (default, composition-matched to mixed sale offers), 'secondary', or 'primary'.",
    ),
    areaBucket: z.enum(["all", "0-30", "30-40", "40-50", "50-60", "60-80", "80+"]).optional().describe(
      "Apartment area range in m2: all (default, whole stock), 0-30, 30-40, 40-50, 50-60, 60-80, 80+. Bucket values are not additive.",
    ),
  },
  { readOnlyHint: true, destructiveHint: false, title: "[Beta] Asking vs Transaction Price Spread" },
  async (params) =>
    withErrorHandling("get_price_spread", apiKey, async () => {
      requireApiKey(apiKey);
      if (!params.location?.trim() && !params.teryt?.trim()) {
        return textResponse(
          'Provide a location (city name) or teryt (county code). Example: get_price_spread(location="Warszawa").',
        );
      }
      const { data, creditInfo } = await getPriceSpread(
        { location: params.location, teryt: params.teryt, marketType: params.marketType, areaBucket: params.areaBucket },
        apiKey,
      );
      return textResponse(formatPriceSpread(data) + formatCreditFooter(creditInfo));
    }),
);

// ── Tool: list_price_spread_locations ───────────────────────────────

server.tool(
  "list_price_spread_locations",
  `EXPERIMENTAL (beta): this tool may change or be withdrawn without notice; do not build critical workflows on it.
List the cities/counties for which get_price_spread can return data (asking-sale coverage). Use this to discover valid location/teryt values for get_price_spread instead of guessing names.
Each entry is coverage signal only (sale offer sample size + confidence) — it does not compute the spread; call get_price_spread(location|teryt) for the actual spread.
Optional search filters by city name (diacritic-insensitive substring, min 2 chars). Results are sorted by asking_sample_n descending. Free (0 credits).`,
  {
    search: z.string().min(2, "search must be at least 2 characters").optional().describe(
      "Filter by city name (diacritic-insensitive substring, min 2 chars). E.g. 'gda' → Gdańsk. Omit to list the full catalog.",
    ),
  },
  { readOnlyHint: true, destructiveHint: false, title: "[Beta] List Price Spread Locations" },
  async (params) =>
    withErrorHandling("list_price_spread_locations", apiKey, async () => {
      requireApiKey(apiKey);
      const { data, creditInfo } = await getPriceSpreadLocations(
        { search: params.search },
        apiKey,
      );
      return textResponse(formatPriceSpreadLocations(data) + formatCreditFooter(creditInfo));
    }),
);

} // end optional tools

// ── Tool 10: get_building_breakdown ─────────────────────────────────

server.tool(
  "get_building_breakdown",
  `Get the building-by-building breakdown for one transaction: footprint area, number of storeys, and estimated total floor area (footprint × storeys) for each building on the property.
search_transactions / search_by_area / search_by_polygon return per-transaction building SUMS inline; this tool splits them into individual buildings. Use it after a search when a result has building data and you need the detail (e.g. a developed-land deed covering several buildings).
The transaction_id is the id shown on a search result that has building data. Cost: 4 tokens. Returns nothing for a transaction with no buildings.`,
  {
    transaction_id: z.string().regex(UUID_RE, "transaction_id must be a UUID — copy the id from a search_transactions result that has building data").describe(
      "Transaction id (UUID) from a search_transactions / search_by_area / search_by_polygon result that carries building data.",
    ),
  },
  { readOnlyHint: true, destructiveHint: false, title: "Building-by-Building Breakdown" },
  async (params) =>
    withErrorHandling("get_building_breakdown", apiKey, async () => {
      requireApiKey(apiKey);
      // `res` is the whole response body ({ data, truncated }); `res.data` is the building array.
      // Destructure as `res` (not `data`) to keep that distinction explicit.
      const { data: res, creditInfo } = await getBuildingBreakdown(params.transaction_id, apiKey);
      return textResponse(formatBuildingBreakdown(res) + formatCreditFooter(creditInfo));
    }),
);

// ── Tool 11: get_transaction_flood ──────────────────────────────────

server.tool(
  "get_transaction_flood",
  `Get the parcel-by-parcel flood-hazard breakdown for one transaction: for each linked plot that sits in a mapped flood zone — the worst hazard category (high/medium/low, i.e. ~1-in-10-year to ~1-in-500-year), the hazard type (river/coastal/infrastructure), the share of the plot inside the zone, and the full per-scenario list (each with its return period).
search_transactions (and search_by_area) surface a per-transaction worst-case flood_risk inline; this tool splits that into the individual parcels and scenarios behind it. Use it after a search when a result shows flood_risk. (search_by_polygon does not include flood inline.)
TWO-STATE: a transaction whose land is in no mapped zone returns nothing — absence of a zone is never asserted as "safe". Cost: 4 tokens (refunded when there is no flood data).`,
  {
    transaction_id: z.string().regex(UUID_RE, "transaction_id must be a UUID — copy the id from a search_transactions result").describe(
      "Transaction id (UUID) from a search_transactions / search_by_area / search_by_polygon result.",
    ),
  },
  { readOnlyHint: true, destructiveHint: false, title: "Transaction Flood-Hazard Breakdown" },
  async (params) =>
    withErrorHandling("get_transaction_flood", apiKey, async () => {
      requireApiKey(apiKey);
      // `res` is the whole response body ({ data, truncated }); `res.data` is the parcel array.
      const { data: res, creditInfo } = await getTransactionFlood(params.transaction_id, apiKey);
      return textResponse(formatFloodBreakdown(res) + formatCreditFooter(creditInfo));
    }),
);

// ── Tool 12: get_transaction_heritage ───────────────────────────────

server.tool(
  "get_transaction_heritage",
  `Get the parcel-by-parcel heritage-listing breakdown for one transaction: for each linked plot with a detected heritage listing — the status (listed = a protected monument on/at the plot; zone = the plot lies within a protected urban layout or the designated surroundings of a monument), the share of the plot inside the protected area (when measurable), and the individual entries (category, name, function, period, entry date).
search_transactions (and search_by_area) surface a per-transaction heritage_status inline; this tool splits that into the individual parcels and entries behind it. Use it after a search when a result shows a heritage listing. (search_by_polygon does not include heritage inline.)
TWO-STATE: a transaction with no detected listing returns nothing — absence of a detection is never asserted as "not listed". Indicative data — the regional heritage conservator makes the final, binding determination. Cost: 4 tokens (refunded when there is no heritage data).`,
  {
    transaction_id: z.string().regex(UUID_RE, "transaction_id must be a UUID — copy the id from a search_transactions result").describe(
      "Transaction id (UUID) from a search_transactions / search_by_area / search_by_polygon result.",
    ),
  },
  { readOnlyHint: true, destructiveHint: false, title: "Transaction Heritage-Listing Breakdown" },
  async (params) =>
    withErrorHandling("get_transaction_heritage", apiKey, async () => {
      requireApiKey(apiKey);
      // `res` is the whole response body ({ data, truncated }); `res.data` is the parcel array.
      const { data: res, creditInfo } = await getTransactionHeritage(params.transaction_id, apiKey);
      return textResponse(formatHeritageBreakdown(res) + formatCreditFooter(creditInfo));
    }),
);

// ── Tool 13: get_transaction_landslide ──────────────────────────────

server.tool(
  "get_transaction_landslide",
  `Get the parcel-by-parcel landslide-hazard breakdown for one transaction, based on official landslide-hazard maps (1:10,000 scale): for each linked plot that intersects a mapped hazard area — the worst category ('landslide' = a mapped landslide area, 'threatened' = an area threatened by mass movements), the share of the plot inside the mapped zones, and the per-zone list (each with its source_version_date — the source-record version date, not a survey/observation date).
An intersection at this scale means the parcel overlaps a mapped hazard area, not that the parcel itself is a landslide.
search_transactions (and search_by_area) surface a per-transaction worst-case landslide_risk inline; this tool splits that into the individual parcels and zones behind it. Use it after a search when a result shows a landslide risk. (search_by_polygon does not include landslide inline.)
TWO-STATE: a transaction whose land is in no mapped zone returns nothing — absence of data is never an assertion of safety. Cost: 4 tokens (refunded when there is no landslide data).`,
  {
    transaction_id: z.string().regex(UUID_RE, "transaction_id must be a UUID — copy the id from a search_transactions result").describe(
      "Transaction id (UUID) from a search_transactions / search_by_area / search_by_polygon result.",
    ),
  },
  { readOnlyHint: true, destructiveHint: false, title: "Transaction Landslide-Hazard Breakdown" },
  async (params) =>
    withErrorHandling("get_transaction_landslide", apiKey, async () => {
      requireApiKey(apiKey);
      // `res` is the whole response body ({ data, truncated }); `res.data` is the parcel array.
      const { data: res, creditInfo } = await getTransactionLandslide(params.transaction_id, apiKey);
      return textResponse(formatLandslideBreakdown(res) + formatCreditFooter(creditInfo));
    }),
);

// ── Tool 14: get_transaction_surroundings ───────────────────────────

server.tool(
  "get_transaction_surroundings",
  `Get the plot-by-plot surroundings profile for one transaction: for each linked plot, the distance in meters to the nearest cemetery, landfill (waste disposal site), sewage treatment plant, industrial/storage area, large industrial plant, and intensive livestock farm, from reference land-use and environmental-registry data. Useful for due-diligence on nearby nuisances.
Distances are approximate and measured from the plot boundary; 0 means the plot touches or overlaps such an area. Each category is searched within a fixed radius only: cemetery 1 km, landfill 3 km, sewage treatment 2 km, industrial/storage 1 km, large industrial plant 3 km, intensive livestock farm 3 km.
TWO-STATE: a null/absent distance means no such object within the search radius in the reference data — it is NEVER a guarantee that none exists. assessed=false means the plot has not been evaluated yet (no statement either way). Cost: 4 tokens (refunded when there is no informative data — no linked plots, or none evaluated yet).`,
  {
    transaction_id: z.string().regex(UUID_RE, "transaction_id must be a UUID — copy the id from a search_transactions result").describe(
      "Transaction id (UUID) from a search_transactions / search_by_area / search_by_polygon result.",
    ),
  },
  { readOnlyHint: true, destructiveHint: false, title: "Transaction Surroundings Breakdown" },
  async (params) =>
    withErrorHandling("get_transaction_surroundings", apiKey, async () => {
      requireApiKey(apiKey);
      // `res` is the whole response body ({ data, truncated }); `res.data` is the plot array.
      const { data: res, creditInfo } = await getTransactionSurroundings(params.transaction_id, apiKey);
      return textResponse(formatSurroundings(res) + formatCreditFooter(creditInfo));
    }),
);

// ── Tool 15: get_transaction_transit ────────────────────────────────

server.tool(
  "get_transaction_transit",
  `Get the parcel-by-parcel public transport access breakdown for one transaction: for each linked plot, the nearest public transport stop distances per transaction parcel, by mode (rail/metro/tram/bus), from open GTFS data — plus the nearest stop's name for each mode present.
A mode is present only when a stop of that mode is within its cap (rail/metro 3000 m, tram 1500 m, bus 1000 m).
TWO-STATE: a transaction whose land has no stop within cap in any mode returns nothing — absence of a row is never asserted as "no transit access" (open feeds cover cities and national rail, not every rural area). Cost: 4 tokens (refunded when there is no transit data).`,
  {
    transaction_id: z.string().regex(UUID_RE, "transaction_id must be a UUID — copy the id from a search_transactions result").describe(
      "Transaction id (UUID) from a search_transactions / search_by_area / search_by_polygon result.",
    ),
  },
  { readOnlyHint: true, destructiveHint: false, title: "Transaction Public Transport Access Breakdown" },
  async (params) =>
    withErrorHandling("get_transaction_transit", apiKey, async () => {
      requireApiKey(apiKey);
      // `res` is the whole response body ({ data, truncated }); `res.data` is the parcel array.
      const { data: res, creditInfo } = await getTransactionTransit(params.transaction_id, apiKey);
      return textResponse(formatTransitBreakdown(res) + formatCreditFooter(creditInfo));
    }),
);

// ── Tool 16: get_transaction_permits ────────────────────────────────

server.tool(
  "get_transaction_permits",
  `Get the building-permit history for one transaction's parcels, from the official national registry of positively resolved building permits and works notifications (records since 2016): for each case — its kind (permit / notification), the building intent and works type, the statutory object category, the deciding authority, the decision or intake date, the investment address, and the volume.
Use it after a search to screen what has been built or approved on the transaction's land — a leading indicator of development activity. Match is by the parcel's current identifier, so splits/merges break the link, and only positively resolved cases are held (no pending or refused applications).
TWO-STATE: a transaction whose parcels have no registered case returns nothing — an empty result is never a confirmation that nothing was ever planned. Cost: 4 tokens (refunded when there is no record).`,
  {
    transaction_id: z.string().regex(UUID_RE, "transaction_id must be a UUID — copy the id from a search_transactions result").describe(
      "Transaction id (UUID) from a search_transactions / search_by_area / search_by_polygon result.",
    ),
  },
  { readOnlyHint: true, destructiveHint: false, title: "Transaction Building-Permit History" },
  async (params) =>
    withErrorHandling("get_transaction_permits", apiKey, async () => {
      requireApiKey(apiKey);
      // `res` is the whole response body ({ data, truncated, note }); `res.data` is the record array.
      const { data: res, creditInfo } = await getTransactionPermits(params.transaction_id, apiKey);
      return textResponse(formatPermitsBreakdown(res) + formatCreditFooter(creditInfo));
    }),
);

// ── Tool 17: get_transaction_planning ───────────────────────────────

server.tool(
  "get_transaction_planning",
  `Get the general-plan (plan ogólny, POG) zoning for one transaction's land: for each linked plot, the planning zones that cover it — zone symbol and name, the share of the plot each zone covers, and the building parameters the plan sets (max building height, max development intensity, max built-up coverage, min biologically active area) — plus any overlay areas (infill development area / obszar uzupełnienia zabudowy, central development area) that sit on top.
Coverage is honest and THREE-STATE: 'covered' returns zone data; 'covered_no_data' means the municipality has an adopted general plan but no zone data covers these plots in the data yet; 'not_covered' means no published general-plan data for this municipality yet — this is NEVER a claim that the municipality has no plan. General plans are still being adopted across Poland, so coverage grows over time.
Use it for feasibility and permitted-use questions on a plot. Cost: 4 tokens (refunded when there is no zone data for the transaction — 'covered_no_data' or 'not_covered').`,
  {
    transaction_id: z.string().regex(UUID_RE, "transaction_id must be a UUID — copy the id from a search_transactions result").describe(
      "Transaction id (UUID) from a search_transactions / search_by_area / search_by_polygon result.",
    ),
  },
  { readOnlyHint: true, destructiveHint: false, title: "Transaction General-Plan Zoning" },
  async (params) =>
    withErrorHandling("get_transaction_planning", apiKey, async () => {
      requireApiKey(apiKey);
      // `res` is the whole response body ({ data, truncated, coverage, ... }); `res.data` is the zone/overlay array.
      const { data: res, creditInfo } = await getTransactionPlanning(params.transaction_id, apiKey);
      return textResponse(formatPlanningBreakdown(res) + formatCreditFooter(creditInfo));
    }),
);

// ── Tool 18: get_transaction_farmland ───────────────────────────────

server.tool(
  "get_transaction_farmland",
  `Get the parcel-by-parcel agricultural land-eligibility breakdown for one transaction, from official nationwide agricultural land-eligibility data (updated weekly): for each linked parcel with a matched eligible agricultural area — the eligible area in square metres, its share of the parcel (when the parcel's measured area is known), and how many source features compose it. The response also reports how many of the transaction's linked parcels carry a match and the source snapshot date. Useful for due-diligence on land that is actually eligible/maintained as agricultural (beyond what a registry classification says on paper).
TWO-STATE: a parcel with no matched eligible area returns nothing — absence of a match is NEVER a statement that the property is non-agricultural (small plots that are not actively farmed are simply absent, the reference layer has its own update cadence, and older transactions can reference renumbered parcels). Cost: 4 tokens (refunded when there is no eligible agricultural area for the linked parcels).`,
  {
    transaction_id: z.string().regex(UUID_RE, "transaction_id must be a UUID — copy the id from a search_transactions result").describe(
      "Transaction id (UUID) from a search_transactions / search_by_area / search_by_polygon result.",
    ),
  },
  { readOnlyHint: true, destructiveHint: false, title: "Transaction Agricultural Land-Eligibility Breakdown" },
  async (params) =>
    withErrorHandling("get_transaction_farmland", apiKey, async () => {
      requireApiKey(apiKey);
      // `res` is the whole response body ({ data, truncated, parcels_total, parcels_with_data, as_of }).
      const { data: res, creditInfo } = await getTransactionFarmland(params.transaction_id, apiKey);
      return textResponse(formatFarmland(res) + formatCreditFooter(creditInfo));
    }),
);

} // end registerTools
