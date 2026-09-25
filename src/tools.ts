import { Sentry } from "./sentry.js";
import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";
import {
  getStats,
  getTransactions,
  getPricePerM2,
  getDistricts,
  getLocations,
  searchLocations,
  getPriceHistogram,
  getTransactionsSummary,
  searchParcels,
  resolveParcel,
  listParcels,
  getParcelsMap,
  searchParcelsByPolygon,
  getParcelReport,
  getParcelLandClass,
  searchByPolygon,
  compareLocations,
  getRentalYield,
  getRentalYieldLocations,
  getPriceSpread,
  getPriceSpreadLocations,
  getFloodRisk,
  getFloodRiskLocations,
  getValuation,
  getBuildingBreakdown,
  getTransactionFlood,
  getTransactionHeritage,
  getTransactionLandslide,
  getTransactionNature,
  getTransactionSubsurface,
  getTransactionSurroundings,
  getTransactionRoads,
  getTransactionTransit,
  getTransactionPermits,
  getTransactionPlanning,
  getTransactionFarmland,
  getDemographics,
  getInfrastructureSignals,
  decodeOAuthCtx,
  isExpectedApiError,
  OAUTH_CTX_PREFIX,
} from "./api-client.js";
import type { CreditInfo, LocationSearchItem } from "./api-client.js";
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
  formatParcelList,
  formatParcelFeatures,
  formatParcelReport,
  formatParcelLandClass,
  formatSpatialResults,
  formatCompareResults,
  formatLocationHierarchy,
  formatLocationSearch,
  formatRentalYield,
  formatRentalYieldLocations,
  formatPriceSpread,
  formatPriceSpreadLocations,
  formatFloodRisk,
  formatFloodRiskLocations,
  formatValuation,
  formatBuildingBreakdown,
  formatFloodBreakdown,
  formatHeritageBreakdown,
  formatLandslideBreakdown,
  formatNatureBreakdown,
  formatSubsurfaceBreakdown,
  formatSurroundings,
  formatRoads,
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
  stripDiacritics,
} from "./mappings.js";

// ── Helpers ─────────────────────────────────────────────────────────

function sanitizeInput(s: string, maxLen = 50): string {
  return s.replace(/[<>]/g, "").slice(0, maxLen);
}

// Mirror of the server-side guard, used by the per-transaction layer tools. Validating here means a
// malformed id is rejected before the API call — those endpoints bill their full weight even for a
// garbage id that resolves to empty, so validating up front protects the caller's tokens. The
// per-call price is deliberately not repeated here; it is published in the API docs.
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

// `fn` may set isError itself. That is not a protocol failure: the JSON-RPC call succeeded and the
// text says what went wrong. A handler uses it to answer a condition it recognises — a source it
// depends on being temporarily unavailable, say — in words the caller can act on, instead of
// throwing and being reported as a fault of ours.
async function withErrorHandling(
  toolName: string,
  apiKey: string | undefined,
  fn: () => Promise<{ content: { type: "text"; text: string }[]; isError?: boolean }>,
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
      // An unknown location, a spent allowance or a rate limit is an answer, not an incident, and
      // reporting them made the genuine failures impossible to spot. The stderr line below still
      // records every one of them with success=false.
      if (!isExpectedApiError(error)) {
        Sentry.captureException(error, { tags: { tool: toolName, error_layer: "tool_execution" } });
      }
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

// ── Shared land / building filters ─────────────────────────────────
//
// The same four filters are exposed on search_transactions, search_by_area and search_by_polygon.
// Declared once and reused so the three tools cannot drift. Each description carries the
// "absence of a value ≠ absence of the phenomenon" caveat — that is the line the model reads to
// decide whether to trust a missing value, so it must never be dropped.

const landUseParam = z.array(z.enum([
  "gruntyZabudowaneIZurbanizowane",
  "gruntyRolne",
  "gruntyLesne",
  "terenyKomunikacyjne",
  "inne",
  "unknown",
])).optional().describe(
  "Recorded land-use category of the transaction's land. Multi-select from: gruntyZabudowaneIZurbanizowane (built-up and urbanised), gruntyRolne (agricultural), gruntyLesne (forest), terenyKomunikacyjne (transport), inne (other). 'unknown' = no category recorded for the land (NULL) — a legitimate bucket, never a claim that the land has no use. Values are case-sensitive. E.g. ['gruntyRolne'] for farmland, or ['gruntyZabudowaneIZurbanizowane','gruntyRolne'] to compare developed vs farmland.",
);

const buildingStoreysParam = z.array(
  z.string().regex(/^(\d+|\d+plus|unknown)$/i, "Invalid buildingStoreys token - use a non-negative integer (e.g. '1','2'), 'Nplus' (e.g. '3plus'), or 'unknown'."),
).optional().describe(
  "Number of above-ground storeys of the building. Multi-select buckets: exact non-negative integers (e.g. '1','2'), 'Nplus' e.g. '3plus' = 3 or more, 'unknown' = no storey count recorded (NULL). Recorded ONLY for single-building transactions, so 'unknown' covers BOTH a deed with several buildings (no single storey count exists) and a single building with missing data — never read it as 'a building with no storeys'. This is NOT the floor of a unit (see floor). Without 'unknown', rows with no storey count are excluded.",
);

const minFootprintAreaParam = z.number().optional().describe(
  "Minimum building footprint (ground-plan) area in m², summed over all buildings of the transaction. Distinct from minArea, which measures usable floor area (units) or land/parcel area. Set only where every linked building has footprint data, so this bound selects only measured rows — absence means 'not measured', not 'no building'.",
);

const maxFootprintAreaParam = z.number().optional().describe(
  "Maximum building footprint (ground-plan) area in m², summed over all buildings of the transaction. Distinct from maxArea, which measures usable floor area (units) or land/parcel area. Set only where every linked building has footprint data, so this bound selects only measured rows — absence means 'not measured', not 'no building'.",
);

// ── Tool registration ──────────────────────────────────────────────

export function registerTools(server: McpServer, apiKey?: string): void {

// ── Tool 1: search_transactions ─────────────────────────────────────

server.tool(
  "search_transactions",
  `Search Polish real estate transactions from the national RCN registry (8M+ records).
Returns transaction details: address, date, price, area, price/m², property type.
Call list_locations(search=...) first to resolve a place: prefer the returned TERYT code as teryt= (exact administrative match). Pass a name to location= only when the result flags it as an RCN district (rcn_district) — most TERYT names are not valid location= values and silently return zero rows.
Example: search for apartments in Mokotów sold in 2024 above 500,000 PLN.
Data notes: marketType is NULL for ~55% of records (notary didn't classify) - filtering by marketType excludes them. ~1.7% of records have no transaction_date.
Permalink: every result is shareable on the map. From a result's "id:" line and its "Location: <A>°N, <B>°E" line, build https://cenogram.pl/ceny-transakcyjne?src=${channelSrc()}#v=1&lat=<A>&lng=<B>&z=16&tx=<id> (drop the °N/°E; lat = the °N number, lng = the °E number) — opens that exact transaction on the map. Omit &tx=<id> for the area only.
Field provenance: values are from the notarial deed (RCN) by default; computed values (parcel area summed across plots or converted from hectares, an inferred/reclassified property type) and approximated streets are flagged inline with a neutral [...] note.
Location matches TERYT districts only - for neighborhoods (osiedla), use search_by_area instead.`,
  {
    location: z.string().optional().describe(
      "Location name - city (e.g. 'Warszawa', 'Kraków', 'Gdańsk') or district (e.g. 'Mokotów', 'Kraków-Podgórze'). 'Warszawa', 'Kraków', 'Łódź' auto-expand to all sub-districts. Prefer teryt= for exact matches; call list_locations(search=...) to confirm a name is valid here — it flags valid ones as rcn_district.",
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
    street: z.string().optional().describe("Street name filter, matched anywhere inside the name (e.g. 'Puławska', 'Aleja Waszyngtona'). Give it in the NOMINATIVE and with its Polish diacritics — matching is literal, so 'Karmelickiej' does not find 'Karmelicka' and 'Marszalkowska' does not find 'Marszałkowska'. Either mistake answers with nothing, which reads exactly like 'no such transactions'."),
    buildingNumber: z.string().optional().describe("Building/house number (e.g. '30', '12A'). Requires location or street to be set."),
    parcelId: z.string().optional().describe("Exact parcel ID as returned in search results (e.g. '146518_8.0108.27'). Must match exactly - copy from a previous search result's parcel_id field."),
    minArea: z.number().optional().describe("Minimum area in m²"),
    maxArea: z.number().optional().describe("Maximum area in m²"),
    landUse: landUseParam,
    buildingStoreys: buildingStoreysParam,
    minFootprintArea: minFootprintAreaParam,
    maxFootprintArea: maxFootprintAreaParam,
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
        landUse: params.landUse?.join(","),
        buildingStoreys: params.buildingStoreys?.join(","),
        minFootprintArea: params.minFootprintArea,
        maxFootprintArea: params.maxFootprintArea,
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
Returns TRANSACTIONS — deeds and prices — despite the name. For the land plots themselves in an area, use list_parcels_in_area.
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
    landUse: landUseParam,
    buildingStoreys: buildingStoreysParam,
    minFootprintArea: minFootprintAreaParam,
    maxFootprintArea: maxFootprintAreaParam,
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
        landUse: params.landUse?.join(","),
        buildingStoreys: params.buildingStoreys?.join(","),
        minFootprintArea: params.minFootprintArea,
        maxFootprintArea: params.maxFootprintArea,
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
2. Name search (search param): Look up a place by name across all levels (voivodeship, county, municipality, precinct). Each match comes with its TERYT code, its parent unit, and the exact follow-up calls to make — use teryt= for precise administrative filtering. Rows also flagged as RCN districts additionally accept the name in search_transactions(location=)/compare_locations. RCN district names that have no TERYT code are listed separately.
If both provided, parent takes precedence.
Returns administrative units — never streets. A street is not a level of this hierarchy and has no code of its own; to search for parcels on one, pass the name straight to list_parcels_in_area as street=.
Use 'location' for quick city searches, 'teryt' for precise administrative filtering (avoids name ambiguity, e.g. 'Wałcz' is both a county and a municipality).`,
  {
    parent: z.string().min(1).optional().describe(
      "TERYT parent code to browse children. 2-digit (voivodeship → counties), 4-digit (county → municipalities), 6-digit (municipality → precincts). Omit for all voivodeships.",
    ),
    search: z.string().min(1).optional().describe(
      "Look up a place by name (case-insensitive, diacritics-insensitive partial match, e.g. 'wejher' for Wejherowo). Returns TERYT codes plus, where applicable, RCN district names. Ignored when parent is set.",
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

      // Two sources are merged on every search — nothing is dropped.
      //
      // 1. RCN districts (unchanged): for known city keys (Warszawa/Kraków/Łódź) the sub-districts
      //    come from the static map with zero API call; otherwise /api/districts is filtered. This
      //    is the only source that returns Warsaw's 18 districts in one call (their names do not
      //    contain "Warszawa", so a TERYT infix search never finds them).
      // 2. TERYT units (new): searchLocations returns administrative units with codes and, per row,
      //    rcn_district — whether the name is a valid search_transactions(location=) value.
      //
      // params.search is a defined non-empty string here (undefined handled by the early return
      // above; zod enforces .min(1)).
      const query = params.search;

      let rcnDistricts: string[];
      let rcnCreditInfo: CreditInfo | null;
      const city = tryResolveCityKey(query);
      if (city) {
        rcnDistricts = city;
        rcnCreditInfo = null;
      } else {
        const res = await getDistricts(apiKey);
        rcnCreditInfo = res.creditInfo;
        rcnDistricts = filterByLocation(query, res.data);
      }

      // The API requires >=2 letters/digits (punctuation yields none, mirroring the server's own
      // reading); for a shorter query skip the TERYT branch entirely and behave exactly as before
      // (RCN only), so no new 400 surfaces on this published tool. Counting raw characters would let
      // e.g. "!a" through the guard and turn the server's 400 into a lost result.
      let terytItems: LocationSearchItem[] = [];
      let terytCreditInfo: CreditInfo | null = null;
      if (wordCharCount(query) >= TERYT_SEARCH_MIN_WORD_CHARS) {
        try {
          const res = await searchLocations(query, apiKey);
          terytItems = res.data;
          terytCreditInfo = res.creditInfo;
        } catch {
          // A future tightening of the server's validation must not sink the whole result: fall
          // through to the RCN-only section rather than propagate the TERYT-branch failure.
          terytItems = [];
          terytCreditInfo = null;
        }
      }

      // A city key matches only its parent county by TERYT infix — the districts' names carry no
      // city prefix, so they would fall to the "no code" section. For city keys only, pull the
      // county's children once (free route) and lift the matching districts into the coded section.
      if (city && terytItems.length > 0) {
        const cityNorm = stripDiacritics(query.trim().toLowerCase());
        const countyRow = terytItems.find(
          (it) => it.level === "county" && stripDiacritics(it.name.toLowerCase()) === cityNorm,
        );
        if (countyRow) {
          try {
            const { data: children } = await getLocations(countyRow.code, apiKey);
            const rcnNorms = new Set(rcnDistricts.map((d) => stripDiacritics(d.toLowerCase())));
            const present = new Set(terytItems.map((it) => stripDiacritics(it.name.toLowerCase())));
            for (const child of children) {
              const childNorm = stripDiacritics(child.name.toLowerCase());
              // Join by normalized name: a district known to the RCN dictionary is a valid location=
              // value, so flag it and print it with its code. A name that does not join stays below.
              if (rcnNorms.has(childNorm) && !present.has(childNorm)) {
                terytItems.push({ ...child, rcn_district: true });
                present.add(childNorm);
              }
            }
          } catch {
            // Degrade to today's shape: unmatched districts stay in the "no code" section.
          }
        }
      }

      // A name present on the TERYT side is printed there (with rcn_district); drop it from the
      // RCN-only section so it is shown once.
      const terytNames = new Set(terytItems.map((it) => stripDiacritics(it.name.toLowerCase())));
      const rcnOnly = rcnDistricts.filter(
        (d) => !terytNames.has(stripDiacritics(d.toLowerCase())),
      );

      const creditInfo = terytCreditInfo ?? rcnCreditInfo;
      if (terytItems.length === 0 && rcnOnly.length === 0) {
        return textResponse(`No locations found matching "${query}".` + formatCreditFooter(creditInfo));
      }
      return textResponse(formatLocationSearch(terytItems, rcnOnly, query) + formatCreditFooter(creditInfo));
    }),
);

// ── Tool 7: search_parcels ──────────────────────────────────────────

server.tool(
  "search_parcels",
  `Search for land parcels by parcel ID prefix (autocomplete).
Matches on the ID PREFIX only, never on an area: to list the parcels in a place or a shape use list_parcels_in_area, and to turn an address, a coordinate or 'locality + number' into one parcel use resolve_parcel.
Returns matching parcels with their district, area, and GPS coordinates.
Useful for finding exact parcel IDs, then searching transactions nearby.
Example: search for parcels starting with '146518_8.01'.
Coverage: this searches the cadastral register we hold — near-complete national coverage, though not the whole of it and not live — so an empty result more likely means a recent change or a mistyped prefix than that no such parcel exists. Do not report a missing match as "this parcel does not exist". The answer carries a corpus_coverage block with the measured figures for the county the prefix names, and resolve_parcel with the FULL id can still confirm and add a parcel we do not yet hold.
Free: searching for parcels costs no API tokens.`,
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
- q: a full cadastral id, a UUID, OR free-text 'locality name + parcel number' (e.g. 'Sabnie 342/5'). The name may be a gmina name or a cadastral precinct (obręb) name; matching is exact and case-insensitive, so an unusual spelling may miss. A precinct name is not unique nationwide, so an ambiguous name comes back as several candidates rather than a guess. This is NOT a street address: it is a locality name plus a PARCEL number, never a street name plus a building number. For a city address (street + building number) use list_parcels_in_area(street=, buildingNumber=) instead — resolve_parcel will not turn 'Marszałkowska 12' into a parcel.
- lat & lng: a WGS84 point inside the parcel (returns the parcel(s) containing that point).
Returns a list of matching parcels with district, area, and coordinates; 'truncated' when the name+number match was capped. When nothing matches, coverage is not_covered — and what that means depends on the mode. With a FULL cadastral id we confirm the parcel live and add it if it exists, so not_covered there really does mean we could not confirm one. With the DISCOVERY modes (locality name + number, or a coordinate) we only look at the register we hold — near-complete national coverage, though not the whole of it and not live — so not_covered means "not among the parcels we hold", which is a weaker statement, and a fresh change or an unusual spelling is a likelier cause than the parcel not existing. Never report it as "no such parcel". The corpus_coverage block in each answer says how much of the register was actually searched. When the lookup could not be completed at all — a live confirmation that failed, or a name carried by more precincts than one search covers and nothing found among them — coverage is not_computed instead: that is not a statement that the parcel does not exist. Matches found before such a search ran out are returned normally, with 'truncated'.
Use this to turn an address point, a coordinate, or a locality+number into a concrete parcel id — then feed that id to search_transactions (parcelId) to see its sale history.
Free: resolving a parcel costs no API tokens.`,
  {
    q: z.string().max(200).optional().describe(
      "Full cadastral id, a UUID, or 'locality name + parcel number' (e.g. 'Sabnie 342/5') — the name may be a gmina or a cadastral precinct (obręb). NOT a street address: for a street + building number use list_parcels_in_area instead. Mutually exclusive with parcelId and lat/lng.",
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
  `The whole dossier for one land parcel in a single call: the parcel core (location, area, land use, plan designation), all thirteen enrichment layers (flood risk, heritage listing, landslide risk, subsurface: mining terrains and major groundwater reservoirs, nuisance surroundings, public-transport access, general-plan zoning, buildings on the parcel, recent building activity, agricultural-land eligibility, official land-use & soil-quality classification with its re-designation consequences where the county publishes it, nature: nearby forest and protected areas, roads: geometric road-access evidence measured from carriageway centrelines, which is not a determination of legal access), the parcel's transaction history (newest first, up to 20), a local price context (median zł/m² for the county and the locality over the last 12 months) and a municipal context (a headline demographic/economic subset plus upcoming-infrastructure signals for the gmina).
Address it by a full cadastral id in the natural '/' form ('142907_2.0014.342/5'), the URL-safe '-' form, or the internal UUID from a search or resolve result.
Each section carries its own state, shown explicitly: covered = a definitive result; covered_no_data = the parcel was checked and nothing was found (still billed); not_covered = outside our data (refunded); not_computed = a live computation could not finish in time (refunded — the rest of the report still returns, so a report can be partial). The two context sections instead use full / low_sample / suppressed / no_data.
The buildings section additionally reports how many of the buildings could be given a construction-age estimate from building-permit records. That is an ESTIMATE with an interval, never a registry construction date, and the records only start in 2016, so for most buildings the answer is that the year could not be established — which is stated rather than omitted.
Prefer this over calling the per-layer parcel tools one by one — it is one call at a flat price and never costs more than the sum of its parts. Use resolve_parcel first when you only have an address, a coordinate, or a 'locality + number'.
Costs 45 API tokens. Billing is by outcome (see the billing line on the response): a parcel that cannot be resolved is fully refunded; a resolved parcel where no layer had data is billed only the core floor (1 token) with the rest refunded; a resolved parcel with at least one covered layer is billed in full.`,
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

// ── Tool: get_parcel_land_class ─────────────────────────────────────
//
// The first per-layer parcel tool. The family's rule is composite-first (get_parcel_report), and it
// stands: this is a NAMED exception for a layer that answers a question people ask on its own — "can
// this land be taken out of agricultural use" is often the only question before buying a plot, and it
// needs neither flood nor heritage nor transit to mean something. The description therefore spends its
// first job on sending everything else to get_parcel_report: an assistant picks wrong exactly when two
// tool names look alike.
//
// It takes the RAW id with a slash — URL encoding is the HTTP layer's problem, not the caller's; the
// client normalises to the dash form. Not gated by CENOGRAM_EXPERIMENTAL_TOOLS: that flag is for beta
// derivatives whose shape may still move, and this one rides the stable four-state contract.

server.tool(
  "get_parcel_land_class",
  `The official land-use and soil-quality classification recorded for one land parcel, and what it implies for taking the land out of agricultural use. Returns the land-use categories and the soil-quality grades entered for the parcel, whether any of those grades is in the protected I-III range, whether the parcel lies inside a city's administrative boundary (which changes the rule that applies), and a note on the re-designation consequences with the date the legal state behind it was verified.
Use it when the question is specifically about the classification or about re-designating farmland. For anything else about the parcel — price history, flood risk, zoning, buildings, permits, surroundings, transport — call get_parcel_report instead: it is one call at a flat price and includes this same classification as one of its sections.
Address it by a full cadastral id in the natural '/' form ('142907_2.0014.342/5'), the URL-safe '-' form, or the internal UUID from a search or resolve result.
The categories and grades come back as SETS. The source records no area for any of them, so the answer can never say which category prevails on the parcel or give a share — a parcel listing two categories has both, in unknown proportion.
This layer answers only where the county publishes the classification; many counties, including several large cities, do not. Four states, told apart explicitly: covered = the county publishes it and the parcel has an entry; covered_no_data = the county publishes it and this parcel has none (a checked negative — still billed); not_covered = the county does not publish it, or we do not hold the parcel (refunded); not_computed = the lookup could not finish in time (refunded — retry).
Costs 4 API tokens, refunded on not_covered and not_computed. Not legal advice, and never a statement that a parcel can or cannot be built on.`,
  {
    parcelId: z.string().min(3).max(200).describe(
      "Full cadastral id ('142907_2.0014.342/5' or the '-' form) or the internal UUID from a search/resolve result.",
    ),
  },
  { readOnlyHint: true, destructiveHint: false, title: "Get Parcel Land Classification" },
  async (params) =>
    withErrorHandling("get_parcel_land_class", apiKey, async () => {
      requireApiKey(apiKey);
      const { data, creditInfo } = await getParcelLandClass(params.parcelId, apiKey);
      return textResponse(formatParcelLandClass(data) + formatCreditFooter(creditInfo));
    }),
);

// ── Tool: list_parcels_in_area ──────────────────────────────────────
//
// ONE tool over the three collection endpoints, not one tool per entrance. An area can be named five
// ways (administrative code, name, bbox, circle, polygon) and the answer comes in two shapes (a light
// list, or outlines); three tools for that would make the assistant pick between near-identical
// names, and the pick would be wrong exactly when the caller's area does not fit the tool they chose.
//
// The pre-flight guards below mirror the server's own 400s. They exist to protect the caller's
// tokens: an impossible combination is rejected here, before the call is made and billed.

// Ceiling on the area a spatial query may cover, and the radius of a circle covering the same ground.
// Mirrors of server-side limits — keep in sync. Quoted in the description so a caller can size a
// request before spending anything, and a request over either is refused rather than scanned.
const PARCEL_AREA_MAX_KM2 = 500;
const PARCEL_RADIUS_MAX_KM = 12.6;

// Scope and shape limits for the address filters, mirroring the server's. A TERYT of at least this
// many digits is a county; anything coarser turns a street name into a national search.
const ADDRESS_FILTER_MIN_TERYT_DIGITS = 4;
// Counted in letters and digits, not characters, and mirrors the server. Four, not three: a
// three-letter fragment matches too broadly for a fast lookup; four stays fast. Refusing here rather
// than letting the server refuse saves the caller a round trip.
const STREET_MIN_WORD_CHARS = 4;
// The TERYT name index answers only queries of at least this many letters/digits; a shorter one is
// served from RCN alone rather than provoking the server's 400.
const TERYT_SEARCH_MIN_WORD_CHARS = 2;
const ADDRESS_FILTER_MAX_CHARS = 200;

/** How much of `s` an index over names can actually be searched by: letters and digits. */
function wordCharCount(s: string): number {
  return (s.match(/[\p{L}\p{N}]/gu) ?? []).length;
}

/** Does this TERYT argument reach county precision? Mirrors the server's own reading of it. */
function terytReachesCounty(teryt: string): boolean {
  // Several codes may be comma-separated, and the scope is only as narrow as its widest member —
  // the same reading the server takes.
  const parts = teryt.split(",").map((p) => p.trim()).filter((p) => p !== "");
  if (parts.length === 0) return false;
  return parts.every((p) => p.replace(/\D/g, "").length >= ADDRESS_FILTER_MIN_TERYT_DIGITS);
}

server.tool(
  "list_parcels_in_area",
  `List cadastral parcels in an area — the land plots themselves, NOT transactions.
For deeds and prices in an area use search_by_area or search_by_polygon instead. To look up a parcel by an id prefix use search_parcels; to turn one address, coordinate or 'locality + number' into a parcel use resolve_parcel; for everything known about a single parcel use get_parcel_report.

Name the area in one of five ways — at least one is required:
- teryt: administrative code prefix at any level (2 digits = voivodeship, 4 = county, 6 = municipality, finer allowed); comma-separate several. Browse codes with list_locations.
- location: a county or city NAME, resolved to its code. A name shared by two counties comes back as an error listing both, never as a guess.
- bbox: "minLng,minLat,maxLng,maxLat" in WGS84.
- lat + lng + radiusKm: a circle (all three together).
- polygon: a GeoJSON Polygon, for a drawn shape. Pass it on its own.
A bbox and a circle cannot be combined — together they would mean the overlap of a rectangle and a circle, which is rarely the question.

Two shapes of answer, priced differently:
- Default: the LIGHT list — parcel id, district and centre point per row, with no outline and no surface. 2 API tokens. Pages by cursor: when more parcels match, the answer hands you an opaque cursor to pass back as cursor=.
- includeGeometry=true (needs a bbox), or a polygon: OUTLINES — the full GeoJSON polygon of each parcel. 5 API tokens, at most 100 parcels per call (50 by default), no paging.

Truncation is the normal case on outlines, not an edge case. An area the size of a city holds far more parcels than one call returns, so an outline answer is usually marked TRUNCATED and the parcels in it are an arbitrary subset — not the first, nearest or largest. Never report a truncated answer as the parcel list of an area; ask for a smaller area instead.

minArea / maxArea (m²) filter on the registered parcel surface without returning it. They need a narrow scope — a bbox, a circle, a location name, or a teryt of at least 4 digits (county level) — and are refused elsewhere with a message saying what to add. They are not available on the outline calls.

Every row of the light list carries the street address held for that parcel, whether or not you asked about one, and says where it came from: a street on record, one we worked out for a parcel the record left without a street (shown with a note saying so), or — only when a buildingNumber search on the record came back empty — one read off an official address point that falls inside the parcel (also noted). A building number is only ever on record or from that address point, so a worked-out street never carries one. When a page comes back with a requested buildingNumber, it also carries a note on which of the two the number came from. If the street exists in the area but not with that number, the answer says so instead of the generic "no such street". Most rural parcels have no street at all — for those the way in is resolve_parcel with the precinct name and the parcel number, not a street.
- street: matches whole words of the name, case- and accent-insensitively — ${STREET_MIN_WORD_CHARS} letters or digits minimum, ${ADDRESS_FILTER_MAX_CHARS} characters maximum. It is a NAME, not a pattern: % and _ match themselves. 'Górna' finds 'ulica Górna' and 'Górna 15' but not 'Podgórna', and a fragment like 'Marsza' finds nothing. Both sources are searched at once and a parcel found in both appears once, attributed to the record. Matching folds accents, so 'karmelicka' finds 'Karmelicka' — but it does NOT inflect: pass the name in the NOMINATIVE, because an inflected form like 'Karmelickiej' answers with an empty list. That empty page costs nothing (the tokens are refunded) and carries a suggestions block with close names to retry, so read the suggestions before you conclude anything about the data.
- buildingNumber: needs street alongside it. Against the record the match is EXACT ('12A' does not find '12a'); RCN often records a compound or split number ('84/92'), so an exact '84' will not find '84/92'. When that comes back empty, the same street+number is tried against official address points instead — that match ignores case ('12a' finds '12A') but is still exact on the number, no compound splitting, and it matches the street by the same whole-word rule as above, not a fragment ('Waszyngtona' finds 'Aleja Waszyngtona', 'szyng' does not). Only when BOTH miss does the page come back empty (the tokens are refunded), listing the numbers held on the street as suggestions to retry.
Both need a narrow scope for the same reason minArea does — a bbox, a circle, a teryt of at least 4 digits, or a location name — and neither counts as naming the area: a common street name across the country is a national search, not a question. Neither is available on the outline calls.

Parcel identity is gated: parcel_id comes back for API-token / OAuth callers and for paid or active-trial accounts, and is withheld for everyone else while the location and the outline still come back.

Coverage, so you can allow for it — TWO SEPARATE GAPS:
1. We hold near-complete coverage of the cadastral register, though not the whole of it and not live: what we hold was measured county by county on a fixed date, so a freshly split, merged or renumbered parcel may not be in yet. This applies to EVERY entrance here, teryt and location included. A short list, and the absence of a truncation marker, mean only that nothing further matched what we hold as of that measurement — never that you have every parcel in the area. Each answer carries a corpus_coverage block: for teryt and location it gives the measured parcels-held and parcels-in-register figures for the counties you asked about; for bbox, circle and polygon those figures are null, because sizing an arbitrary shape needs county boundaries we do not have — the measurement still applies, we just cannot put a number on it for that shape.
2. Separately, the spatial entrances (bbox, circle, polygon) work off the stored outline, and a small share of the parcels we DO hold keep theirs in a coordinate system those queries cannot read — those are missing from spatial answers specifically. The teryt and location entrances never touch geometry and are unaffected BY THAT SECOND GAP; a parcel whose outline we do not hold shows up there with no location.
Neither gap is a reason to distrust what comes back: a returned parcel is a real parcel. They are a reason never to read an empty or short answer as evidence that the land is not there.

Limits: an area over ${PARCEL_AREA_MAX_KM2} km², a radius over ${PARCEL_RADIUS_MAX_KM} km (the same ground) or a polygon over 500 vertices is refused rather than scanned, and a query that outruns its time limit answers with an error asking you to narrow it.`,
  {
    teryt: z.string().max(200).optional().describe(
      "TERYT administrative code prefix (2/4/6 digits or finer), comma-separated for several. Wins over location when both are given.",
    ),
    location: z.string().max(200).optional().describe(
      "County, city, or district name, resolved to its TERYT code. A Warszawa district name (e.g. 'Mokotów') narrows to that district; another city's delegatura (e.g. 'Kraków-Podgórze') resolves to its parent county. An ambiguous name is an error listing the candidates.",
    ),
    bbox: z.string().max(200).optional().describe(
      `Bounding box in WGS84 as "minLng,minLat,maxLng,maxLat", covering at most ${PARCEL_AREA_MAX_KM2} km². Required for includeGeometry=true.`,
    ),
    lat: z.number().min(-90).max(90).optional().describe(
      "Latitude of the circle centre (WGS84). Requires lng and radiusKm.",
    ),
    lng: z.number().min(-180).max(180).optional().describe(
      "Longitude of the circle centre (WGS84). Requires lat and radiusKm.",
    ),
    radiusKm: z.number().positive().max(PARCEL_RADIUS_MAX_KM).optional().describe(
      `Circle radius in km (max ${PARCEL_RADIUS_MAX_KM} — the radius covering the ${PARCEL_AREA_MAX_KM2} km² ceiling). Requires lat and lng.`,
    ),
    polygon: z.object({
      type: z.literal("Polygon"),
      coordinates: z.array(z.array(z.array(z.number()))).min(1),
    }).refine(
      // Mirror of the server-side guard - keep in sync
      (poly) => poly.coordinates.reduce((sum, ring) => sum + ring.length, 0) <= 500,
      { message: "polygon exceeds 500 total vertices (sum across all rings)" },
    ).optional().describe(
      "GeoJSON Polygon geometry. Coordinates: [longitude, latitude] pairs, first and last point identical, at most 500 vertices. Always returns outlines. Pass it instead of the other area parameters, not alongside them.",
    ),
    minArea: z.number().positive().optional().describe(
      "Minimum parcel surface in m². Needs a bbox, a circle, a location name, or a teryt of at least 4 digits. Not available with includeGeometry or a polygon.",
    ),
    maxArea: z.number().positive().optional().describe(
      "Maximum parcel surface in m². Same scope requirement as minArea.",
    ),
    street: z.string().max(ADDRESS_FILTER_MAX_CHARS).optional().describe(
      `Street name, matched by whole words within the name, case- and accent-insensitively (min ${STREET_MIN_WORD_CHARS} letters or digits): 'Górna' finds 'ulica Górna' and 'Górna 15' but not 'Podgórna', and a fragment like 'Marsza' finds nothing. NOMINATIVE: 'Karmelickiej' does not fold to 'Karmelicka' and answers empty. Needs a bbox, a circle, a location name, or a teryt of at least ${ADDRESS_FILTER_MIN_TERYT_DIGITS} digits. Not available with includeGeometry or a polygon.`,
    ),
    buildingNumber: z.string().max(ADDRESS_FILTER_MAX_CHARS).optional().describe(
      "Building number. Against the record the match is exact ('12A' does not find '12a') and RCN numbering is often compound ('84/92'), so an exact '84' misses '84/92'. When that comes back empty, the same number is tried against official address points instead, case-insensitively ('12a' finds '12A') but still exact, matching the street by the same whole-word rule as street, not a fragment — if that also misses, drop the number and read the numbers off the street's rows. Requires street. Same scope requirement as street.",
    ),
    includeGeometry: z.boolean().optional().describe(
      "Return each parcel's full outline instead of the light row (5 tokens instead of 2, at most 100 parcels, no paging). Requires a bbox; with a polygon the outlines come back anyway.",
    ),
    limit: z.number().min(1).max(1000).optional().describe(
      "Max parcels returned. Light list: up to 1000, default 250. Outlines: up to 100, default 50 — a larger value is clamped there.",
    ),
    cursor: z.string().max(500).optional().describe(
      "Opaque cursor from the previous light-list answer, to get the next page. Pass it back unchanged; it is not available on outline calls.",
    ),
  },
  { readOnlyHint: true, destructiveHint: false, title: "List Parcels in an Area" },
  async (params) =>
    withErrorHandling("list_parcels_in_area", apiKey, async () => {
      requireApiKey(apiKey);

      const hasTeryt = params.teryt != null && params.teryt !== "";
      const hasLocation = params.location != null && params.location !== "";
      const hasBbox = params.bbox != null && params.bbox !== "";
      const circleParts = [params.lat, params.lng, params.radiusKm].filter((v) => v != null).length;
      const hasPolygon = params.polygon != null;
      const hasAreaFilter = params.minArea != null || params.maxArea != null;
      const hasCursor = params.cursor != null && params.cursor !== "";
      const street = params.street != null && params.street !== "" ? params.street : undefined;
      const buildingNumber = params.buildingNumber != null && params.buildingNumber !== "" ? params.buildingNumber : undefined;
      const hasAddressFilter = street !== undefined || buildingNumber !== undefined;

      // Every branch below returns a message instead of calling the API. These are the combinations
      // the server also refuses; catching them here costs the caller nothing, and the alternative is
      // an error they paid a token to read.
      if (!hasTeryt && !hasLocation && !hasBbox && circleParts === 0 && !hasPolygon) {
        return textResponse(
          "Name the area first: pass teryt, location, bbox, lat+lng+radiusKm, or polygon. Listing every parcel in the country is not something this tool does.",
        );
      }
      if (hasPolygon && (hasTeryt || hasLocation || hasBbox || circleParts > 0)) {
        return textResponse(
          "A polygon already describes the area. Pass it on its own, or drop it and use teryt / location / bbox / lat+lng+radiusKm instead.",
        );
      }
      if (hasBbox && circleParts > 0) {
        return textResponse(
          "Pick one shape for the area: a bbox or a lat+lng+radiusKm circle. Passing both asks for the overlap of a rectangle and a circle.",
        );
      }
      if (circleParts > 0 && circleParts < 3) {
        return textResponse("lat, lng and radiusKm must be given together — a circle needs a centre and a radius.");
      }
      if (params.includeGeometry === false && hasPolygon) {
        return textResponse(
          "A polygon search always returns outlines. Drop includeGeometry=false, or use a bbox if you want the light list instead.",
        );
      }

      const wantsOutlines = hasPolygon || params.includeGeometry === true;
      if (params.includeGeometry === true && !hasBbox && !hasPolygon) {
        return textResponse(
          "Outlines are returned for a bbox or a polygon. With teryt, location or a circle, drop includeGeometry to get the light list, then ask for outlines with a bbox around the part you care about.",
        );
      }
      if (wantsOutlines && hasAreaFilter) {
        return textResponse(
          "minArea/maxArea are not available on an outline call. Use them on the light list (no includeGeometry, no polygon) to find the parcels, then ask for outlines by bbox.",
        );
      }
      if (wantsOutlines && hasCursor) {
        return textResponse(
          "An outline call has no paging, so there is no cursor to pass. Narrow the area instead — the cursor belongs to the light list.",
        );
      }

      // ── Address filters ───────────────────────────────────────────────────────────────────────
      // Refused here rather than dropped silently. An outline call goes to a different endpoint,
      // which knows nothing of a street — sending the request anyway would answer with every parcel
      // in the shape and look like a street with a great many parcels on it.
      if (wantsOutlines && hasAddressFilter) {
        return textResponse(
          "street/buildingNumber are not available on an outline call. Use them on the light list (no includeGeometry, no polygon) to find the parcels, then ask for outlines by bbox.",
        );
      }
      if (buildingNumber !== undefined && street === undefined) {
        return textResponse(
          "buildingNumber needs street alongside it, e.g. street=\"Karmelicka\", buildingNumber=\"10\". A number on its own would have to be looked up parcel by parcel across the whole area.",
        );
      }
      if (hasAddressFilter) {
        // teryt WINS over location on the server, so when both are given the scope is the one teryt
        // describes — judging by location here would pass a request the server then refuses.
        const scopeIsNarrow = hasBbox
          || circleParts === 3
          || (hasTeryt ? terytReachesCounty(params.teryt!) : hasLocation);
        if (!scopeIsNarrow) {
          return textResponse(
            `A street name needs a narrower area alongside it: a bbox, a lat+lng+radiusKm circle, a location name, or a teryt of at least ${ADDRESS_FILTER_MIN_TERYT_DIGITS} digits (county level). The same street name occurs in hundreds of towns, so on its own it asks for a search of the whole country.`,
          );
        }
      }
      if (street !== undefined && wordCharCount(street) < STREET_MIN_WORD_CHARS) {
        return textResponse(
          `street needs at least ${STREET_MIN_WORD_CHARS} letters or digits — punctuation alone cannot be looked up, and a shorter fragment would have to read every street name we hold. Pass more of the name.`,
        );
      }

      if (hasPolygon) {
        const { data, creditInfo } = await searchParcelsByPolygon(
          params.polygon as { type: "Polygon"; coordinates: number[][][] },
          params.limit,
          apiKey,
        );
        return textResponse(formatParcelFeatures(data, "the polygon") + formatCreditFooter(creditInfo));
      }

      if (wantsOutlines) {
        // hasBbox is true here: the guard above rejects includeGeometry without a bbox or a polygon.
        const { data, creditInfo } = await getParcelsMap(params.bbox!, params.limit, apiKey);
        return textResponse(formatParcelFeatures(data, "the bounding box") + formatCreditFooter(creditInfo));
      }

      const { data, creditInfo } = await listParcels(
        {
          teryt: params.teryt,
          location: params.location,
          bbox: params.bbox,
          lat: params.lat,
          lng: params.lng,
          radiusKm: params.radiusKm,
          minArea: params.minArea,
          maxArea: params.maxArea,
          street,
          buildingNumber,
          limit: params.limit,
          cursor: params.cursor,
        },
        apiKey,
      );
      // teryt wins over location on the server, so the label has to follow the same order — naming
      // the parameter the answer did not come from would misreport what was searched.
      const area = hasTeryt ? `teryt ${sanitizeInput(params.teryt!)}`
        : hasLocation ? `"${sanitizeInput(params.location!)}"`
        : hasBbox ? "the bounding box"
        : `a ${params.radiusKm} km circle`;
      // The address filters go into the label too. "No parcels found for teryt 1261" reads as a
      // statement about the county when the question was really about one street in it.
      const address = street === undefined ? ""
        : buildingNumber === undefined
          ? `, street "${sanitizeInput(street, ADDRESS_FILTER_MAX_CHARS)}"`
          : `, street "${sanitizeInput(street, ADDRESS_FILTER_MAX_CHARS)}" no. ${sanitizeInput(buildingNumber, ADDRESS_FILTER_MAX_CHARS)}`;
      return textResponse(formatParcelList(data, area + address, (creditInfo?.refunded ?? 0) > 0) + formatCreditFooter(creditInfo));
    }),
);

// ── Street catalogue: answered over REST, not exposed as a tool here ──
//
// A caller on this side already knows the name of the street it wants — it is not typing one letter
// at a time waiting for suggestions. Completing a partial name is an affordance of a text box with
// a keyboard, and there is no keyboard on this side. The parcels on a named street are one call to
// list_parcels_in_area with street=, and a catalogue lookup placed in front of that call costs a
// turn to hand back a name the caller already had.
//
// getStreets() in api-client.ts and formatStreetList() in formatters.ts stay typed and tested: the
// REST route they speak to answers a different audience (a browser typeahead), not this one.

// ── Tool 8: search_by_polygon ──────────────────────────────────────

server.tool(
  "search_by_polygon",
  `Search real estate transactions within a geographic polygon.
Returns TRANSACTIONS — deeds and prices — despite the name. For the land plots themselves inside a drawn shape, pass the same polygon to list_parcels_in_area.
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
    landUse: landUseParam,
    buildingStoreys: buildingStoreysParam,
    minFootprintArea: minFootprintAreaParam,
    maxFootprintArea: maxFootprintAreaParam,
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
        landUse: params.landUse?.join(","),
        buildingStoreys: params.buildingStoreys?.join(","),
        minFootprintArea: params.minFootprintArea,
        maxFootprintArea: params.maxFootprintArea,
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
This tool matches on name only. Call list_locations(search=...) first: use names it flags as RCN districts (rcn_district) — other names (most TERYT unit names) silently return no data here.
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
      "City, county, or district name (e.g. 'Warszawa', 'Kraków'). A city/county name resolves to county/powiat level; a Warszawa district name (e.g. 'Mokotów') resolves to that district, another city's delegatura (e.g. 'Kraków-Podgórze') to its parent county. Use this OR teryt. For gmina-level data on other units pass a 6/7-digit teryt instead.",
    ),
    teryt: z.string().optional().describe(
      "TERYT code: 2-digit (voivodeship, e.g. 14), 4-digit (county, e.g. 1465), 6 or 7-digit (gmina, e.g. 1465011). The 7th digit selects the unit type: 3 = urban-rural gmina overall, 4/5 = urban/rural part only, 8 = Warszawa district (1465011 = all of Warszawa, 1465108 = Śródmieście). Wins over location. Use list_locations to find codes.",
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
      "City, county, or district name (e.g. 'Warszawa', 'Krotoszyn'). A city/county name aggregates every municipality in the county; a Warszawa district name (e.g. 'Mokotów') narrows to that gmina, another city's delegatura (e.g. 'Kraków-Podgórze') resolves to its parent county. Use this OR teryt.",
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
      "County-level city name — a miasto na prawach powiatu or a catalog entry from list_rental_yield_locations (e.g. 'Warszawa', 'Kraków', 'Gdańsk'). A Warszawa district name (e.g. 'Mokotów') narrows to that district; another city's delegatura (e.g. 'Kraków-Podgórze') resolves to its parent county. A town within a larger powiat or an osiedle will 404 — check the catalog or use teryt first. Use this OR teryt.",
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
      "County-level city name — a miasto na prawach powiatu or a catalog entry from list_price_spread_locations (e.g. 'Warszawa', 'Kraków', 'Gdańsk'). A Warszawa district name (e.g. 'Mokotów') narrows to that district; another city's delegatura (e.g. 'Kraków-Podgórze') resolves to its parent county. A town within a larger powiat or an osiedle will 404 — check the catalog or use teryt first. Use this OR teryt.",
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

// ── Tool: get_flood_risk ────────────────────────────────────────────

server.tool(
  "get_flood_risk",
  `EXPERIMENTAL (beta): this tool may change or be withdrawn without notice; do not build critical workflows on it.
Report what share of a Polish county's real-estate transactions sit on land in a mapped flood-hazard zone, broken down by severity, from the RCN registry.
Severity bands are return periods: high = most frequent flooding (~1-in-10-year), medium (~1-in-100-year), low = rarest (~1-in-500-year). Counts land in a mapped hazard zone only; absence of a zone is never asserted as 'safe' (an area may be unmapped).
Address by location (city/county name → resolves to a county) OR teryt (4-digit county code; longer codes truncate to the county; a district code resolves to its county — exposure is reported at county level; teryt wins when both are given).
Aggregated over the whole transaction history (all-time, no date window). Suppressed below 5 assessed transactions. Coverage is county-level. Unless the location is a major city you already know is covered, call list_flood_risk_locations FIRST to get valid names, or pass a 4-digit county TERYT.`,
  {
    location: z.string().optional().describe(
      "County-level city/county name (e.g. 'Warszawa', 'Kraków', 'Gdańsk'). District names are accepted (a Warszawa district or another city's delegatura, e.g. 'Kraków-Podgórze'), but coverage is county-level, so the answer is the parent county with a note. A town within a larger powiat or an osiedle may 404 — check the catalog or use teryt first. Use this OR teryt.",
    ),
    teryt: z.string().optional().describe(
      "TERYT code. 4 digits = county (e.g. 1465 = Warszawa). Longer codes (gmina/precinct/district) are truncated/resolved to the county. Wins over location when both are provided.",
    ),
  },
  { readOnlyHint: true, destructiveHint: false, title: "[Beta] Flood-Hazard Exposure Share" },
  async (params) =>
    withErrorHandling("get_flood_risk", apiKey, async () => {
      requireApiKey(apiKey);
      if (!params.location?.trim() && !params.teryt?.trim()) {
        return textResponse(
          'Provide a location (city/county name) or teryt (county code). Example: get_flood_risk(location="Warszawa").',
        );
      }
      const { data, creditInfo } = await getFloodRisk(
        { location: params.location, teryt: params.teryt },
        apiKey,
      );
      return textResponse(formatFloodRisk(data) + formatCreditFooter(creditInfo));
    }),
);

// ── Tool: list_flood_risk_locations ─────────────────────────────────

server.tool(
  "list_flood_risk_locations",
  `EXPERIMENTAL (beta): this tool may change or be withdrawn without notice; do not build critical workflows on it.
List the counties for which get_flood_risk can return data (i.e. where transactions have a completed flood assessment). Use this to discover valid location/teryt values for get_flood_risk instead of guessing names.
Each entry is coverage signal only (assessed sample size + confidence) — it does not compute the share; call get_flood_risk(location|teryt) for the actual exposure.
Optional search filters by county name (diacritic-insensitive substring, min 2 chars). Results are sorted by assessed_sample_n descending. Free (0 credits).`,
  {
    search: z.string().min(2, "search must be at least 2 characters").optional().describe(
      "Filter by county name (diacritic-insensitive substring, min 2 chars). E.g. 'gda' → Gdańsk. Omit to list the full catalog.",
    ),
  },
  { readOnlyHint: true, destructiveHint: false, title: "[Beta] List Flood-Risk Locations" },
  async (params) =>
    withErrorHandling("list_flood_risk_locations", apiKey, async () => {
      requireApiKey(apiKey);
      const { data, creditInfo } = await getFloodRiskLocations(
        { search: params.search },
        apiKey,
      );
      return textResponse(formatFloodRiskLocations(data) + formatCreditFooter(creditInfo));
    }),
);

} // end optional tools

// ── Tool 10: get_building_breakdown ─────────────────────────────────

server.tool(
  "get_building_breakdown",
  `Get the building-by-building breakdown for one transaction: footprint area, number of storeys, and estimated total floor area (footprint × storeys) for each building on the property.
search_transactions / search_by_area / search_by_polygon return per-transaction building SUMS inline; this tool splits them into individual buildings. Use it after a search when a result has building data and you need the detail (e.g. a developed-land deed covering several buildings).
Each building also carries a construction-age estimate derived from building-permit records. It is an ESTIMATE with an interval, never a registry construction date, and the records only start in 2016 — so for most buildings the honest answer is "construction year not established", which is stated explicitly rather than left out.
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

// ── Tool 13b: get_transaction_subsurface ────────────────────────────

server.tool(
  "get_transaction_subsurface",
  `Get the parcel-by-parcel subsurface breakdown for one transaction across two dimensions: mining terrains and major groundwater reservoirs. For each linked plot that overlaps either — the mining-terrain status ('active' | 'former') with its mineral class ('subsidence' = extraction with surface deformation, the actual mining-damage risk; 'surface' = open-pit working, mostly local impact; 'fluid' = borehole extraction; 'other'), the groundwater-reservoir status ('documented' | 'undocumented'), the share of the plot inside each, and the per-object lists (mining terrain: name, oversight authority, validity dates; reservoir: number, name, documentation).
A mining terrain is a legally defined zone of anticipated mining influence; its mapped location is approximate — an intersection is an advisory signal to verify with the competent mining-supervision authority, not a legal determination. A groundwater reservoir's extent alone imposes NO restriction; a restriction would come only from an established protection zone, which is not published here.
Use it for a specific transaction to see whether its land overlaps a mining terrain or a major groundwater reservoir, and the per-object detail. get_parcel_report includes a one-line subsurface summary per parcel.
TWO-STATE: a transaction whose land overlaps neither layer returns nothing — absence of data is never an assertion of safety. Cost: 4 tokens (refunded when there is no subsurface data).`,
  {
    transaction_id: z.string().regex(UUID_RE, "transaction_id must be a UUID — copy the id from a search_transactions result").describe(
      "Transaction id (UUID) from a search_transactions / search_by_area / search_by_polygon result.",
    ),
  },
  { readOnlyHint: true, destructiveHint: false, title: "Transaction Subsurface Breakdown" },
  async (params) =>
    withErrorHandling("get_transaction_subsurface", apiKey, async () => {
      requireApiKey(apiKey);
      // `res` is the whole response body ({ data, truncated }); `res.data` is the parcel array.
      const { data: res, creditInfo } = await getTransactionSubsurface(params.transaction_id, apiKey);
      return textResponse(formatSubsurfaceBreakdown(res) + formatCreditFooter(creditInfo));
    }),
);

// ── Tool 13c: get_transaction_roads ─────────────────────────────────

server.tool(
  "get_transaction_roads",
  `Get the plot-by-plot road-access evidence for one transaction: for each linked plot, the distance in meters to the nearest public road, to the nearest road of any kind, and to the nearest motorway/expressway/dual-carriageway — plus, for the nearest public road, the estimated distance to the EDGE of its carriageway, its management category ('national' | 'voivodeship' | 'county' | 'municipal'), its functional class ('motorway' | 'expressway' | 'main_accelerated' | 'main' | 'collector' | 'local' | 'access' | 'other') and whether it runs at ground level (false = it crosses on a viaduct or in a tunnel, so it passes the plot over or under it). Each plot also carries access_indicator ('likely' | 'uncertain' | 'unlikely') and the version of the rule that produced it.
access_indicator is GEOMETRIC EVIDENCE measured from carriageway centrelines in reference road-network data. It does NOT determine legal access and says nothing about easements or rights of way, which are recorded in the land register and are not published here — treat it as a lead to verify, never as a conclusion. That is why it has three states and is never a yes/no.
Each measurement has a fixed radius: public road 500 m, road of any kind 500 m, motorway/expressway/dual-carriageway 3 km (that last one is a traffic-nuisance proxy, not an access signal). public_road_edge_distance_m is null when the source carries no carriageway width — no median is substituted.
Use it for a specific transaction to judge how its land sits relative to the road network. get_parcel_report includes a one-line road-access summary per parcel.
TWO-STATE: a null/absent distance means no such road within the search radius in the reference data — it is NEVER a guarantee that none exists. assessed=false means the plot has not been evaluated yet (no statement either way). Cost: 4 tokens (refunded when there is no informative data — no linked plots, or none evaluated yet).`,
  {
    transaction_id: z.string().regex(UUID_RE, "transaction_id must be a UUID — copy the id from a search_transactions result").describe(
      "Transaction id (UUID) from a search_transactions / search_by_area / search_by_polygon result.",
    ),
  },
  { readOnlyHint: true, destructiveHint: false, title: "Transaction Road Access" },
  async (params) =>
    withErrorHandling("get_transaction_roads", apiKey, async () => {
      requireApiKey(apiKey);
      // `res` is the whole response body ({ data, truncated }); `res.data` is the plot array.
      const { data: res, creditInfo } = await getTransactionRoads(params.transaction_id, apiKey);
      return textResponse(formatRoads(res) + formatCreditFooter(creditInfo));
    }),
);

// ── Tool 14: get_transaction_surroundings ───────────────────────────

server.tool(
  "get_transaction_surroundings",
  `Get the plot-by-plot surroundings profile for one transaction: for each linked plot, the distance in meters to the nearest cemetery, landfill (waste disposal site), sewage treatment plant, industrial/storage area, large industrial plant, intensive livestock farm, high-voltage overhead power line and extra-high-voltage overhead power line, from reference land-use and environmental-registry data. Useful for due-diligence on nearby nuisances.
Distances are approximate and measured from the plot boundary; 0 means the plot touches or overlaps such an area. Each category is searched within a fixed radius only: cemetery 1 km, landfill 3 km, sewage treatment 2 km, industrial/storage 1 km, large industrial plant 3 km, intensive livestock farm 3 km, high-voltage overhead power line 1 km, extra-high-voltage overhead power line 1 km. Only overhead high- and extra-high-voltage lines are covered — medium- and low-voltage lines are ubiquitous and carry no signal, and no easement corridor width or substation is published here.
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
  `Get the building-permit history for one transaction's parcels, from the official national registry of building permits and works notifications (records since 2016): for each case — its kind (permit / notification), the building intent and works type, the statutory object category, the deciding authority, the decision or intake date, the investment address, and the volume.
Use it after a search to screen what has been built or approved on the transaction's land — a leading indicator of development activity. Match is by the parcel's current identifier, so splits/merges break the link. Permits are held once a decision has been issued; the outcome of that decision, granted or refused, is not part of the data held here. Notifications are held only where they were accepted without objection. Cases still pending are not held at all.
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

// ── Tool 19: get_transaction_nature ─────────────────────────────────

server.tool(
  "get_transaction_nature",
  `Get the parcel-by-parcel nature breakdown for one transaction: for each linked plot with a nature signal — the nearest forest within 2 km (forest_distance_m in metres, 0 = the plot overlaps forest, with its overlap share) and any overlapping protected natural areas: the sharpest form (protection_rank 1 = national park, 2 = nature reserve, 3 = Natura 2000, 4 = landscape park, 5 = protected landscape, 6 = other), building_restriction ('statutory_ban' = a build ban that follows directly from the Nature Protection Act for national parks and reserves, 'conditional' = restrictions depend on the act that established the area), the share of the plot under protection, and the named areas.
This describes the SOURCE of a restriction (statute vs the establishing act), never the outcome of a specific permitting case, and is not legal advice. Forest is an amenity signal (proximity), protected areas a due-diligence one (build limits).
Search results do not carry a nature signal, so call this tool directly on a transaction id whenever forest proximity or protected-area build limits matter. Use it after a search on land plots.
An empty result is NEVER a statement that building is allowed — this layer does not cover local zoning plans, planning-permission decisions or areas under designation. A buffer zone around a park or reserve IS reported, as form 'buffer_zone' at rank 6, and never as a statutory ban. An empty result also says which kind of empty it is: either the plots were checked and carry no signal, or no nature reference data is held for them yet and nothing was checked — the second is never a finding that there is no forest or protected area. Cost: 4 tokens (refunded on any empty result).`,
  {
    transaction_id: z.string().regex(UUID_RE, "transaction_id must be a UUID — copy the id from a search_transactions result").describe(
      "Transaction id (UUID) from a search_transactions / search_by_area / search_by_polygon result.",
    ),
  },
  { readOnlyHint: true, destructiveHint: false, title: "Transaction Nature (Forest & Protected Areas) Breakdown" },
  async (params) =>
    withErrorHandling("get_transaction_nature", apiKey, async () => {
      requireApiKey(apiKey);
      // `res` is the whole response body ({ data, truncated, coverage }); `res.data` is the parcel array.
      // The formatter needs the envelope, not just the rows: `coverage` is what an empty result means.
      const { data: res, creditInfo } = await getTransactionNature(params.transaction_id, apiKey);
      return textResponse(formatNatureBreakdown(res) + formatCreditFooter(creditInfo));
    }),
);

} // end registerTools
