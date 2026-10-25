import { Sentry } from "./sentry.js";
import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";
import {
  getStats,
  getTransactions,
  getPricePerM2,
  getDistricts,
  getDistrictCoverage,
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
  getLandValuation,
  ApiHttpError,
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
  getPermitsInArea,
  getTransactionPlanning,
  getTransactionFarmland,
  getDemographics,
  getInfrastructureSignals,
  decodeOAuthCtx,
  isExpectedApiError,
  OAUTH_CTX_PREFIX,
} from "./api-client.js";
import type { ApiResponse, CreditInfo, LocationSearchItem, TransactionParams, TransactionsSummary } from "./api-client.js";
import { formatCreditFooter } from "./credit-footer.js";
import { experimentalToolsEnabled } from "./free-tools.js";
import { signupUrl } from "./error-messages.js";
import { withLocationErrors } from "./location-errors.js";
import { channelSrc, isHttpMode } from "./transport-mode.js";
import { sanitizeForLog } from "./auth-dispatch.js";
import {
  formatTransactionList,
  formatTransactionSummaryOnly,
  formatMarketOverview,
  formatPriceStats,
  type PriceStatsPeriod,
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
  buildCoverageMap,
  type LocationCoverage,
  formatNeighbourhoodNote,
  formatRentalYield,
  formatRentalYieldLocations,
  formatPriceSpread,
  formatPriceSpreadLocations,
  formatFloodRisk,
  formatFloodRiskLocations,
  formatValuation,
  formatLandValuation,
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
  formatPermitsInArea,
  formatPlanningBreakdown,
  formatFarmland,
  formatDemographics,
  formatInfrastructureSignals,
  landUseHint,
} from "./formatters.js";
import {
  mapPropertyType,
  mapMarketType,
  mapUnitFunction,
  mapBuildingType,
  mapOwnershipTypes,
  mapTransactionTypes,
  invalidMpzpTokens,
  MPZP_DESIGNATIONS,
  radiusKmToBbox,
  filterByLocation,
  rankByLocation,
  capRcnSection,
  resolveDistrict,
  tryResolveCityKey,
  stripDiacritics,
} from "./mappings.js";

// ── Helpers ─────────────────────────────────────────────────────────

function sanitizeInput(s: string, maxLen = 50): string {
  return s.replace(/[<>]/g, "").slice(0, maxLen);
}

// Soft check: the filter is still sent as given, so a code missing from the bundled list (data can
// outgrow an old package version) is flagged, never refused.
function mpzpWarning(raw: string | undefined): string {
  const bad = invalidMpzpTokens(raw);
  if (bad.length === 0) return "";
  return (
    `\n\nWarning: unrecognised mpzpDesignation value(s): ${bad.map((t) => `'${sanitizeInput(t)}'`).join(", ")}. ` +
    "The filter was sent as given and matches tokens exactly, so it likely returned nothing. " +
    `Known codes: ${MPZP_DESIGNATIONS.join(", ")}.`
  );
}

const MPZP_DESIGNATION_DESCRIPTION =
  "MPZP zoning designation, exact token match; comma-separated = OR (e.g. 'MN,MW'). " +
  "'unknown' = none recorded (NULL), distinct from the code 'brakMPZPLubWZ' (no plan/WZ). " +
  `Known codes: ${MPZP_DESIGNATIONS.join(", ")}. An unrecognised value is still sent, with a warning.`;
// The code list is long: spelled out once (search_transactions); the other tools point at it.
const MPZP_DESIGNATION_REF_DESCRIPTION =
  "MPZP zoning designation, exact token match; comma-separated = OR; 'unknown' = none recorded. Same codes as search_transactions mpzpDesignation.";

// Short stand-in for the registry-wide price caveat inside tool descriptions.
const MARKET_NOTE = "Aggregates exclude fractional shares and non-market deeds.";

// Mirror of the server-side guard, used by the per-transaction layer tools: a malformed id is
// rejected before the API call.
const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

function textResponse(text: string) {
  return { content: [{ type: "text" as const, text }] };
}

// Today (UTC) minus N calendar months as YYYY-MM-DD, day clamped to the target month's length
// (2028-02-29 - 24 months = 2026-02-28), matching the server-side search_transactions median window.
function utcMonthsBack(now: Date, months: number): string {
  const total = now.getUTCFullYear() * 12 + now.getUTCMonth() - months;
  const year = Math.floor(total / 12);
  const month = total % 12;
  const day = Math.min(now.getUTCDate(), new Date(Date.UTC(year, month + 1, 0)).getUTCDate());
  return new Date(Date.UTC(year, month, day)).toISOString().slice(0, 10);
}

// Explicit dates win over `period`; default is the last 24 months (the search_transactions median window).
// dateTo is always sent (today when absent) so the API reports the actual span and drops future-dated deeds.
function resolvePriceStatsPeriod(
  p: { period?: "24m" | "all"; dateFrom?: string; dateTo?: string },
  now: Date = new Date(),
): PriceStatsPeriod {
  const today = now.toISOString().slice(0, 10);
  if (p.dateFrom || p.dateTo) {
    return { kind: "custom", dateFrom: p.dateFrom, dateTo: p.dateTo ?? today };
  }
  if (p.period === "all") return { kind: "full_history", dateTo: today };
  return { kind: "last_24_months", dateFrom: utcMonthsBack(now, 24), dateTo: today };
}

function errorResponse(text: string) {
  return { content: [{ type: "text" as const, text }], isError: true };
}

// Both spellings are declared because a key missing from the shape is stripped silently, so a
// camelCase call would otherwise fail as "required". `carries` narrows the source in the building tool.
function txIdShape(carries = "") {
  const idField = (name: string) =>
    z.string().regex(UUID_RE, `${name} must be a UUID — copy the id from a search_transactions result${carries}`).optional();
  return {
    transaction_id: idField("transaction_id").describe(
      `Transaction id (UUID) from a search result${carries}. This or transactionId is required.`,
    ),
    transactionId: idField("transactionId"),
  };
}

// transaction_id wins when both are sent; a call with neither is answered, not left to a schema error.
function resolveTxId(params: { transaction_id?: string; transactionId?: string }) {
  return params.transaction_id ?? params.transactionId
    ?? errorResponse("transaction_id is required - copy the id from a search_transactions result");
}

type SummaryOutcome =
  | { failed: false; summary: TransactionsSummary; creditInfo: CreditInfo | null }
  | { failed: true; error: unknown };

// The summary only enriches the list, so its failure degrades the reply instead of failing it. The
// error is reported after the rows arrive, so one outage that fails both calls is not reported twice.
function settleSummary(call: Promise<ApiResponse<TransactionsSummary>>): Promise<SummaryOutcome> {
  return call.then(
    (res): SummaryOutcome => ({ failed: false, summary: res.data, creditInfo: res.creditInfo }),
    (error: unknown): SummaryOutcome => ({ failed: true, error }),
  );
}

function summaryNote(outcome: SummaryOutcome, toolName: string, follows: string): string {
  if (!outcome.failed) return "";
  if (!isExpectedApiError(outcome.error)) {
    Sentry.captureException(outcome.error, { tags: { tool: toolName, error_layer: "summary" } });
  }
  return `Summary statistics unavailable for this query (temporary error); transaction results below follow the requested ${follows}.\n\n`;
}

// Only successful responses carry credit metadata; a failed summary's charge is unknown, so only the list's cost is shown.
function listAndSummaryFooter(list: CreditInfo | null, summary: SummaryOutcome): string {
  return formatCreditFooter(list, summary.failed ? null : summary.creditInfo);
}

const SUMMARY_ONLY_DESCRIPTION =
  "Return only aggregate stats (total, median price/m² with its sample size, period) and no rows. Costs only the summary call; limit/sort/page are ignored.";
const DEFAULT_WINDOW_MONTHS = 24;
const MAX_WINDOW_MONTHS = 120;

function parseIsoDate(s: string): { y: number; m: number; d: number } | null {
  const mt = /^(\d{4})-(\d{2})-(\d{2})$/.exec(s);
  if (!mt) return null;
  const y = Number(mt[1]), m = Number(mt[2]), d = Number(mt[3]);
  const dt = new Date(Date.UTC(y, m - 1, d));
  return dt.getUTCFullYear() === y && dt.getUTCMonth() === m - 1 && dt.getUTCDate() === d ? { y, m, d } : null;
}

// summaryOnly asks for a median window because only it carries a sample size; the API anchors it at min(today, dateTo).
// Months run from dateFrom to that anchor, rounded up so the window starts on or before dateFrom; undefined = bad date or over 10 years.
export function summaryWindowMonths(
  dateFrom: string | undefined,
  now: Date = new Date(),
  dateTo?: string,
): number | undefined {
  const today = { y: now.getUTCFullYear(), m: now.getUTCMonth() + 1, d: now.getUTCDate() };
  const to = dateTo ? parseIsoDate(dateTo) : null;
  const dateKey = (p: { y: number; m: number; d: number }): number => p.y * 10000 + p.m * 100 + p.d;
  const anchor = to && dateKey(to) < dateKey(today) ? to : today;
  const startKey = (months: number): number => {
    const idx = anchor.y * 12 + (anchor.m - 1) - months;
    const y = Math.floor(idx / 12), m = idx - y * 12 + 1;
    const daysInMonth = new Date(Date.UTC(y, m, 0)).getUTCDate();
    return y * 10000 + m * 100 + Math.min(anchor.d, daysInMonth);
  };
  if (!dateFrom) return DEFAULT_WINDOW_MONTHS;
  const from = parseIsoDate(dateFrom);
  if (!from) return undefined;
  const fromKey = dateKey(from);
  if (fromKey >= dateKey(anchor)) return 1;
  let months = Math.max(1, (anchor.y - from.y) * 12 + (anchor.m - from.m));
  while (startKey(months) > fromKey) months++;
  return months <= MAX_WINDOW_MONTHS ? months : undefined;
}

// summaryOnly branch shared by search_transactions and search_by_area: one summary call, no rows, no
// error swallowing (an API error should reach the caller rather than read as an empty result).
async function summaryOnlyResponse(
  txParams: TransactionParams,
  hints: { propertyType?: string; landUse?: string[]; mpzpDesignation?: string },
  apiKey: string,
  location?: string,
) {
  const summary = await getTransactionsSummary(
    { ...txParams, medianWindowMonths: summaryWindowMonths(txParams.dateFrom, new Date(), txParams.dateTo) },
    apiKey,
  );
  const dateFrom = txParams.dateFrom && parseIsoDate(txParams.dateFrom) ? txParams.dateFrom : undefined;
  const dateTo = txParams.dateTo && parseIsoDate(txParams.dateTo) ? txParams.dateTo : undefined;
  return textResponse(
    formatTransactionSummaryOnly(summary.data, location, dateFrom, dateTo) +
    landUseHint(hints.propertyType, hints.landUse?.join(",")) +
    mpzpWarning(hints.mpzpDesignation) +
    formatCreditFooter(summary.creditInfo),
  );
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

// Re-exported: the flag moved to free-tools.ts so error messages can read it without importing the registry.
export { experimentalToolsEnabled };

// ── Shared filters ─────────────────────────────────────────────────
//
// Declared once and reused so the transaction-search tools cannot drift. Hazard/listing filters keep
// the "absence of a value ≠ absence of the phenomenon" caveat: the model reads it to judge a missing value.

const unitFunctionParam = z.enum(["residential", "commercial", "office", "production", "garage", "other", "unknown"]).optional()
  .describe("Unit function; 'unknown' = none recorded (NULL), any other value excludes such rows. Garages only via 'garage'.");

const buildingTypeParam = z.enum(["residential", "commercial", "industrial", "transport", "office", "warehouse", "education_sports", "farm_utility", "hospital", "other_nonresidential", "unknown"]).optional()
  .describe("Building type (PKOB); 'unknown' = none recorded (NULL, ~39% of buildings), any other value excludes such rows.");

const marketTypeParam = z.enum(["primary", "secondary"]).optional()
  .describe("primary (developer) or secondary (resale); the ~55% of records with no market type drop out when this is set.");

const ownershipTypeParam = z.array(z.enum(["land_ownership", "perpetual_usufruct", "cooperative_ownership", "unit_sale", "ownership", "unit_ownership_with_appurtenant_right", "building_ownership_with_appurtenant_right", "unknown"])).optional()
  .describe("Legal-right type (rodzaj prawa), multi-select; perpetual_usufruct = użytkowanie wieczyste; 'unknown' = none recorded.");

const transactionTypeParam = z.array(z.enum(["free_market", "auction", "non_auction", "subsidized", "public_purpose", "foreclosure", "unknown"])).optional()
  .describe("Multi-select. For market analysis ALWAYS set it to exclude non-market deeds (subsidized, foreclosure, public_purpose); no-type rows (~2%) drop out unless 'unknown' is listed.");

const roomsParam = z.array(z.enum(["1", "2", "3", "4", "5", "6", "7", "8plus", "unknown"])).optional()
  .describe("Rooms (izby), residential units only; multi-select ('8plus' = 8 or more). Rows with no count drop out unless 'unknown' is listed.");

const floorParam = z.array(z.string().regex(/^(-?\d+|\d+plus|unknown)$/i, "Invalid floor token - use an integer (e.g. '2','0','-1'), 'Nplus' (e.g. '10plus'), or 'unknown'.")).optional()
  .describe("Unit floor, multi-select: integers ('0' = parter, negatives = basement), 'Nplus' ('0plus' = ground and above), 'unknown' (none recorded). Not building storeys; rows with no floor drop out unless 'unknown' is listed.");

const floodRiskParam = z.array(z.enum(["low", "medium", "high"])).optional()
  .describe("Flood-hazard zone, multi-select: high ~1-in-10-year, medium ~1-in-100, low ~1-in-500. Mapped zones only; absence of a zone is never 'safe'.");

const heritageStatusParam = z.array(z.enum(["listed", "zone"])).optional()
  .describe("Heritage listing, multi-select: listed = protected monument on the land; zone = protected urban layout or monument surroundings. Detected listings only; absence of a detection is never 'not listed'.");

const landslideRiskParam = z.array(z.enum(["landslide", "threatened"])).optional()
  .describe("Landslide hazard, multi-select: landslide = mapped landslide area; threatened = area threatened by mass movements. Mapped areas only; absence of a zone is never 'safe'.");

const mpzpDesignationParam = z.string().optional().describe(MPZP_DESIGNATION_DESCRIPTION);
const mpzpDesignationRefParam = z.string().optional().describe(MPZP_DESIGNATION_REF_DESCRIPTION);

const landUseParam = z.array(z.enum([
  "gruntyZabudowaneIZurbanizowane",
  "gruntyRolne",
  "gruntyLesne",
  "terenyKomunikacyjne",
  "inne",
  "unknown",
])).optional().describe(
  "Land-use category, multi-select, case-sensitive (gruntyZabudowaneIZurbanizowane = built-up, gruntyRolne = agricultural, gruntyLesne = forest, terenyKomunikacyjne = transport); 'unknown' = none recorded (NULL), not 'no use'.",
);

const buildingStoreysParam = z.array(
  z.string().regex(/^(\d+|\d+plus|unknown)$/i, "Invalid buildingStoreys token - use a non-negative integer (e.g. '1','2'), 'Nplus' (e.g. '3plus'), or 'unknown'."),
).optional().describe(
  "Above-ground storeys, multi-select: integers, 'Nplus' ('3plus' = 3+), 'unknown' (no count). Single-building deeds only, so 'unknown' also covers multi-building deeds. Not the unit floor; rows with no count drop out unless 'unknown' is listed.",
);

const minFootprintAreaParam = z.number().optional().describe(
  "Minimum building footprint in m², summed over the transaction's buildings; measured rows only (absence = 'not measured', not 'no building'). Not usable area.",
);

const maxFootprintAreaParam = z.number().optional().describe(
  "Maximum building footprint in m², summed over the transaction's buildings; measured rows only (absence = 'not measured', not 'no building'). Not usable area.",
);

// Opt-in: default false keeps every existing caller's results unchanged.
const excludeFractionalSharesParam = z.boolean().optional().default(false).describe(
  "true = clean land prices: drops fractional ownership shares, whose price reflects the whole deed. Default false.",
);

// ── Tool registration ──────────────────────────────────────────────

export function registerTools(server: McpServer, apiKey?: string): void {

// ── Tool 1: search_transactions ─────────────────────────────────────

server.tool(
  "search_transactions",
  `Find individual Polish real-estate transactions from the national RCN registry (8M+ notarial deeds, not asking prices) by place, property type, price, area, date or street. Returns address, date, price, area, price/m² and property type.
Resolve the place first: list_locations(search=...), then pass its TERYT code as teryt= (exact match). Use location= only for a name that result flags as an RCN district (rcn_district) - other names silently return zero rows. Neighborhoods (osiedla) are not TERYT districts: use search_by_area.
Data notes: marketType is NULL for ~55% of records (filtering by it drops them); ~1.7% have no transaction_date.
Permalink to a result: https://cenogram.pl/ceny-transakcyjne?src=${channelSrc()}#v=1&lat=<A>&lng=<B>&z=16&tx=<id> (<id> from the "id:" line, <A>/<B> from "Location: <A>°N, <B>°E"; omit &tx=<id> for the area only).
Inline [...] notes flag computed values (summed or converted parcel area, inferred property type) and approximated streets; all else is as recorded in the deed.`,
  {
    location: z.string().optional().describe(
      "City (e.g. 'Warszawa') or RCN district (e.g. 'Mokotów', 'Kraków-Podgórze'); 'Warszawa', 'Kraków', 'Łódź' expand to all sub-districts. Prefer teryt=; confirm a name with list_locations(search=...) (valid ones are flagged rcn_district).",
    ),
    teryt: z.string().min(1).optional().describe(
      "TERYT code(s), comma-separated, max 10: 2-digit (voivodeship), 4 (county), 6 (municipality) or a precinct code (e.g. '321705_2.0054'). Find codes with list_locations. Exact - avoids name ambiguity.",
    ),
    propertyType: z.enum(["land", "building", "developed_land", "unit"]).optional()
      .describe("Property type filter"),
    marketType: marketTypeParam,
    unitFunction: unitFunctionParam,
    buildingType: buildingTypeParam,
    ownershipType: ownershipTypeParam,
    mpzpDesignation: mpzpDesignationParam,
    transactionType: transactionTypeParam,
    rooms: roomsParam,
    floor: floorParam,
    floodRisk: floodRiskParam,
    heritageStatus: heritageStatusParam,
    landslideRisk: landslideRiskParam,
    minPrice: z.number().optional().describe("Minimum price in PLN"),
    maxPrice: z.number().optional().describe("Maximum price in PLN"),
    dateFrom: z.string().optional().describe("Start date (YYYY-MM-DD)"),
    dateTo: z.string().optional().describe("End date (YYYY-MM-DD)"),
    street: z.string().optional().describe("Street name, matched anywhere inside the name. Give the NOMINATIVE with Polish diacritics - matching is literal ('Karmelickiej' does not find 'Karmelicka'); a miss looks exactly like 'no such transactions'."),
    buildingNumber: z.string().optional().describe("Building/house number (e.g. '30', '12A'). Requires location or street."),
    parcelId: z.string().optional().describe("Exact parcel ID, copied from a search result's parcel_id field (e.g. '146518_8.0108.27')."),
    minArea: z.number().optional().describe("Minimum area in m²"),
    maxArea: z.number().optional().describe("Maximum area in m²"),
    landUse: landUseParam,
    buildingStoreys: buildingStoreysParam,
    minFootprintArea: minFootprintAreaParam,
    maxFootprintArea: maxFootprintAreaParam,
    excludeFractionalShares: excludeFractionalSharesParam,
    limit: z.number().min(1).max(50).default(10)
      .describe("Number of results (1-50, default 10)"),
    sort: z.enum(["price", "date", "area", "pricePerM2", "district", "rooms", "floor"]).default("date")
      .describe("Sort by field (default: date)"),
    order: z.enum(["asc", "desc"]).default("desc").optional()
      .describe("Sort order (default: desc)"),
    page: z.number().min(1).default(1).optional()
      .describe("Page number for pagination (default: 1)"),
    summaryOnly: z.boolean().optional().describe(SUMMARY_ONLY_DESCRIPTION),
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
        excludeFractionalShares: params.excludeFractionalShares,
        // Default the summary median to a 24-month window UNLESS the caller set their own dateFrom
        // (then their window governs). The rows endpoint ignores this param.
        medianWindowMonths: params.dateFrom ? undefined : 24,
        limit: params.limit,
        sort: params.sort,
        order: params.order ?? "desc",
        page: params.page,
      };
      if (params.summaryOnly) return summaryOnlyResponse(txParams, params, apiKey, params.location);
      const [txResult, summaryOutcome] = await Promise.all([
        getTransactions(txParams, apiKey),
        settleSummary(getTransactionsSummary(txParams, apiKey)),
      ]);
      const note = summaryNote(summaryOutcome, "search_transactions", "limit and pagination");
      return textResponse(note + formatTransactionList(txResult.data, summaryOutcome.failed ? null : summaryOutcome.summary, params.location) + landUseHint(params.propertyType, params.landUse?.join(",")) + mpzpWarning(params.mpzpDesignation) + listAndSummaryFooter(txResult.creditInfo, summaryOutcome));
    }),
);

// ── Tool 2: get_price_statistics ────────────────────────────────────

server.tool(
  "get_price_statistics",
  `Price per m² statistics for residential apartments (lokale mieszkalne) by location; for other property types use search_transactions.
Default window: last 24 months (same as the search_transactions median); period="all" for full history. The response states the period used.
'Warszawa'/'Kraków'/'Łódź' auto-expand to all sub-districts; other names use partial match. Based on notarial-deed prices, not asking prices; coverage varies by county (some have data gaps of 5+ years).`,
  {
    location: z.string().optional().describe(
      "Location name; 'Warszawa'/'Kraków'/'Łódź' expand to all sub-districts, other names use case-insensitive partial match (e.g. 'Wrocł' matches 'Wrocław'). Omit for all Poland.",
    ),
    period: z.enum(["24m", "all"]).optional().describe(
      'Window: "24m" (default) = last 24 months, "all" = full history. Ignored when dateFrom or dateTo is set.',
    ),
    dateFrom: z.string().regex(/^\d{4}-\d{2}-\d{2}$/, "dateFrom must be YYYY-MM-DD").optional().describe(
      "Custom window start, YYYY-MM-DD. Overrides period.",
    ),
    dateTo: z.string().regex(/^\d{4}-\d{2}-\d{2}$/, "dateTo must be YYYY-MM-DD").optional().describe(
      "Custom window end, YYYY-MM-DD, inclusive (default today). Overrides period.",
    ),
  },
  { readOnlyHint: true, destructiveHint: false, title: "Price per m² Statistics" },
  async (params) =>
    withErrorHandling("get_price_statistics", apiKey, async () => {
      requireApiKey(apiKey);
      const period = resolvePriceStatsPeriod(params);
      let priceRows;
      try {
        priceRows = await getPricePerM2(apiKey, { dateFrom: period.dateFrom, dateTo: period.dateTo });
      } catch (error) {
        // 503 + Retry-After: a retry will succeed.
        if (error instanceof ApiHttpError && error.status === 503 && error.retryAfterSeconds !== undefined) {
          return textResponse(
            `Figures for this period are being prepared right now. Repeat the same call in about ${error.retryAfterSeconds} s.`,
          );
        }
        throw error;
      }
      const { data: allRows, creditInfo } = priceRows;
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
      return textResponse(formatPriceStats(rows, params.location, period) + formatCreditFooter(creditInfo));
    }),
);

// ── Tool 3: get_price_distribution ──────────────────────────────────

server.tool(
  "get_price_distribution",
  `National histogram (all Poland) of transactions per price range - use it for the overall price structure of the market. No location filter (location/teryt are ignored); for one place use get_price_statistics or search_transactions.`,
  {
    bins: z.number().min(5).max(50).default(20)
      .describe("Number of price bins (5-50, default 20)"),
    maxPrice: z.number().default(3_000_000)
      .describe("Maximum price to include (default 3,000,000 PLN)"),
    // Declared only so they survive validation: an undeclared key is stripped silently and the caller
    // would never learn the histogram is national.
    location: z.string().optional().describe("Ignored: histogram is national."),
    teryt: z.string().optional().describe("Ignored: histogram is national."),
  },
  { readOnlyHint: true, destructiveHint: false, title: "Price Distribution Histogram" },
  async (params) =>
    withErrorHandling("get_price_distribution", apiKey, async () => {
      requireApiKey(apiKey);
      const { data: bins, creditInfo } = await getPriceHistogram(params.bins, params.maxPrice, apiKey);
      const location = params.location?.trim();
      const teryt = params.teryt?.trim();
      const ignored = [
        location ? `location '${sanitizeInput(location)}'` : "",
        teryt ? `teryt '${sanitizeInput(teryt)}'` : "",
      ].filter(Boolean);
      const note = ignored.length > 0
        ? `Note: this histogram is national (all Poland); ${ignored.join(" and ")} ${ignored.length > 1 ? "were" : "was"} not applied.\n\n`
        : "";
      return textResponse(note + formatHistogram(bins) + formatCreditFooter(creditInfo));
    }),
);

// ── Tool 4: search_by_area ──────────────────────────────────────────

// The radius is turned into a bounding box, not a circle - say so, or corner results look like bugs.
const BBOX_NOTE = "\n\nArea approximated by a bounding box around the radius (corners extend beyond radiusKm).";

// Fixed page size; the caps bound how deep a caller can page.
const PAGE_SIZE = 50;
const AREA_MAX_PAGE = 10;
const POLYGON_MAX_PAGE = 20;
const AREA_PAGE_COST_NOTE = "Each page is a separate call billed like the first (2 + 1 API tokens).";
const POLYGON_PAGE_COST_NOTE = "Each page is a separate call billed like the first (5 API tokens).";

function pageParam(maxPage: number) {
  return z.number().int().min(1).max(maxPage).optional()
    .describe(`Page 1-${maxPage} (${PAGE_SIZE} rows).`);
}

server.tool(
  "search_by_area",
  `Find transactions within a radius of a point - the tool for neighborhoods/osiedla (not TERYT districts) and street-level searches. Returns TRANSACTIONS (deeds and prices), despite the name; for the land plots themselves in an area use list_parcels_in_area.
Radius: 0.3-0.5 km for a street, 0.5-1 km for a neighborhood, 2-5 km for a city area; the area is a bounding box around the radius, so corners extend beyond radiusKm. Take coordinates from the user, never invent them. minArea/maxArea work for every propertyType. Costs 3 API tokens (1 with summaryOnly).
Permalink to a result: https://cenogram.pl/ceny-transakcyjne?src=${channelSrc()}#v=1&lat=<A>&lng=<B>&z=16&tx=<id> (<id> from the "id:" line, <A>/<B> from "Location: <A>°N, <B>°E"; omit &tx=<id> for the area only).`,
  {
    latitude: z.number().min(49).max(55)
      .describe("Latitude (Poland range: 49-55)"),
    longitude: z.number().min(14).max(25)
      .describe("Longitude (Poland range: 14-25)"),
    radiusKm: z.number().min(0.1).max(50).default(2)
      .describe("Search radius in km (0.1-50, default 2)."),
    propertyType: z.enum(["land", "building", "developed_land", "unit"]).optional()
      .describe("Property type filter"),
    marketType: marketTypeParam,
    unitFunction: unitFunctionParam,
    buildingType: buildingTypeParam,
    ownershipType: ownershipTypeParam,
    mpzpDesignation: mpzpDesignationRefParam,
    minPrice: z.number().optional().describe("Minimum price in PLN"),
    maxPrice: z.number().optional().describe("Maximum price in PLN"),
    minArea: z.number().optional()
      .describe("Minimum area in m² (usable area for units, parcel area for land)"),
    maxArea: z.number().optional()
      .describe("Maximum area in m²"),
    dateFrom: z.string().optional().describe("Start date (YYYY-MM-DD)"),
    dateTo: z.string().optional().describe("End date (YYYY-MM-DD)"),
    transactionType: transactionTypeParam,
    rooms: roomsParam,
    floor: floorParam,
    floodRisk: floodRiskParam,
    heritageStatus: heritageStatusParam,
    landslideRisk: landslideRiskParam,
    landUse: landUseParam,
    buildingStoreys: buildingStoreysParam,
    minFootprintArea: minFootprintAreaParam,
    maxFootprintArea: maxFootprintAreaParam,
    excludeFractionalShares: excludeFractionalSharesParam,
    limit: z.number().min(1).max(50).default(20)
      .describe("Number of results (1-50, default 20)"),
    page: pageParam(AREA_MAX_PAGE),
    summaryOnly: z.boolean().optional().describe(SUMMARY_ONLY_DESCRIPTION),
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
        mpzpDesignation: params.mpzpDesignation,
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
        excludeFractionalShares: params.excludeFractionalShares,
        // Default the summary median to a 24-month window UNLESS the caller set their own dateFrom.
        medianWindowMonths: params.dateFrom ? undefined : 24,
        limit: params.limit,
        sort: "date",
        order: "desc" as const,
      };
      if (params.summaryOnly) return summaryOnlyResponse(txParams, params, apiKey);
      const rowParams = params.page ? { ...txParams, limit: PAGE_SIZE, page: params.page } : txParams;
      const [txResult, summaryOutcome] = await Promise.all([
        getTransactions(rowParams, apiKey),
        settleSummary(getTransactionsSummary(txParams, apiKey)),
      ]);
      const note = summaryNote(summaryOutcome, "search_by_area", params.page ? "page" : "limit");
      // Exact total comes from the summary count; without it the rows' own (possibly estimated) total stands in.
      const pagination = txResult.data.pagination;
      const paging = params.page
        ? {
            page: params.page,
            pageSize: PAGE_SIZE,
            maxPage: AREA_MAX_PAGE,
            total: summaryOutcome.failed ? pagination.total : summaryOutcome.summary.total,
            estimated: summaryOutcome.failed && pagination.estimated === true,
            costNote: AREA_PAGE_COST_NOTE,
          }
        : undefined;
      return textResponse(note + formatTransactionList(txResult.data, summaryOutcome.failed ? null : summaryOutcome.summary, undefined, paging) + landUseHint(params.propertyType, params.landUse?.join(",")) + mpzpWarning(params.mpzpDesignation) + BBOX_NOTE + listAndSummaryFooter(txResult.creditInfo, summaryOutcome));
    }),
);

// ── Tool 5: get_market_overview ─────────────────────────────────────

server.tool(
  "get_market_overview",
  `Start here for the shape of the whole Polish transaction database (not one place; for a place use get_price_statistics or search_transactions): total count, date range, breakdown by property and market type, top locations, price statistics. marketType is unknown for ~55% of records, transaction_date missing for ~1.7%.`,
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
  `Resolve a place name to TERYT codes, or browse the TERYT hierarchy - the first step before search_transactions (pass the returned code as teryt=).
- search (a name): looks it up across all levels (voivodeship, county, municipality, precinct); each match carries its TERYT code, parent unit and the exact follow-up calls; exact and prefix matches come first under 'Best matches'. Rows flagged rcn_district also accept the name in search_transactions(location=) and compare_locations; RCN district names with no TERYT code are listed separately. RCN district matches also show their transaction count and date range, with a warning when the label covers only part of a gmina.
- parent (a code): browse children - no parent = 16 voivodeships, 2-digit = counties, 4-digit = municipalities, 6-digit = precincts. parent wins when both are given.
Returns administrative units, never streets: for parcels on a street pass the name to list_parcels_in_area as street=. Prefer teryt where a name is ambiguous ('Wałcz' is both a county and a municipality).`,
  {
    parent: z.string().min(1).optional().describe(
      "TERYT parent code to browse children: 2-digit (voivodeship → counties), 4-digit (county → municipalities), 6-digit (municipality → precincts). Omit for all voivodeships.",
    ),
    search: z.string().min(1).optional().describe(
      "Place name, case- and diacritics-insensitive partial match (e.g. 'wejher' for Wejherowo). Returns TERYT codes plus, where applicable, RCN district names. Ignored when parent is set.",
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
      let rcnHasExact = false;
      const city = tryResolveCityKey(query);
      if (city) {
        rcnDistricts = city;
        rcnCreditInfo = null;
      } else {
        const res = await getDistricts(apiKey);
        rcnCreditInfo = res.creditInfo;
        const ranked = rankByLocation(query, res.data);
        rcnDistricts = ranked.names;
        rcnHasExact = ranked.hasExact;
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
      const rcnUnique = rcnDistricts.filter(
        (d) => !terytNames.has(stripDiacritics(d.toLowerCase())),
      );
      // A city key lists its sub-districts in full; only the fragment-matched names get capped.
      const exactPresent = rcnHasExact || terytItems.some((it) => it.match === "exact");
      const { shown: rcnOnly, hidden: rcnHidden } = city
        ? { shown: rcnUnique, hidden: 0 }
        : capRcnSection(rcnUnique, exactPresent);

      const creditInfo = terytCreditInfo ?? rcnCreditInfo;
      if (terytItems.length === 0 && rcnOnly.length === 0) {
        return textResponse(
          `No locations found matching "${query}".\n\n${formatNeighbourhoodNote(query)}` + formatCreditFooter(creditInfo),
        );
      }
      // One batched lookup for every RCN label printed; any failure (older API: 404) prints the plain list.
      const labelNames = [...new Set([
        ...terytItems.filter((it) => it.rcn_district).map((it) => it.name),
        ...rcnOnly,
      ])].filter((n) => n.length <= COVERAGE_NAME_MAX_CHARS && !n.includes(",")).slice(0, COVERAGE_MAX_NAMES);
      let coverage: LocationCoverage | undefined;
      if (labelNames.length > 0) {
        try {
          coverage = buildCoverageMap((await getDistrictCoverage(labelNames, apiKey)).data.data);
        } catch {
          coverage = undefined;
        }
      }
      return textResponse(formatLocationSearch(terytItems, rcnOnly, query, rcnHidden, coverage) + formatCreditFooter(creditInfo));
    }),
);

// ── Tool 7: search_parcels ──────────────────────────────────────────

server.tool(
  "search_parcels",
  `Autocomplete land parcels by cadastral ID PREFIX only, never by area: for the parcels in a place or shape use list_parcels_in_area; to turn a coordinate or 'locality + number' into one parcel use resolve_parcel (a street address: list_parcels_in_area). Returns matching parcels with district, area and GPS coordinates (e.g. prefix '146518_8.01').
Coverage: the cadastral register we hold is near-complete but not live, so an empty result more likely means a recent change or a mistyped prefix than that no such parcel exists - never report it as "this parcel does not exist" (resolve_parcel with the FULL id can still confirm and add one).
Free: costs no API tokens.`,
  {
    q: z.string().min(3).describe(
      "Parcel ID prefix (min 3 chars), e.g. '146518_8.01'",
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
- parcelId: a full cadastral id ('142907_2.0014.342/5' or the '-' form) or internal UUID.
- q: a full id, a UUID, or 'locality name + parcel number' (e.g. 'Sabnie 342/5'): the name is a gmina or cadastral precinct (obręb), matched exactly, case-insensitively; a gmina name plus a number also works for a gmina made of several precincts (e.g. 'Ełk 461/3'). An ambiguous name returns several candidates, not a guess. NOT a street address: for a city address use list_parcels_in_area(street=, buildingNumber=).
- lat & lng: a WGS84 point inside the parcel (a road parcel is flagged: the point probably fell on the street).
Returns matching parcels with district, area and coordinates; 'truncated' when capped.
not_covered: for a FULL id it means we could not confirm the parcel live; in the DISCOVERY modes (name + number, coordinate) only "not among the parcels we hold" (near-complete, not live) - a fresh change or an unusual spelling is likelier than a missing parcel, so never report "no such parcel". not_computed = the lookup could not finish, also not a finding. corpus_coverage says how much of the register was searched.
Then feed the id to search_transactions(parcelId) for its sale history. Free.`,
  {
    q: z.string().max(200).optional().describe(
      "Full cadastral id, UUID, or 'locality name + parcel number' (e.g. 'Sabnie 342/5'); not a street address. Exclusive with parcelId and lat/lng.",
    ),
    parcelId: z.string().max(200).optional().describe(
      "Full cadastral id (slash or dash form) or internal UUID. Exclusive with q and lat/lng.",
    ),
    lat: z.number().min(-90).max(90).optional().describe(
      "Latitude WGS84; pair with lng. Exclusive with q and parcelId.",
    ),
    lng: z.number().min(-180).max(180).optional().describe(
      "Longitude WGS84; pair with lat. Exclusive with q and parcelId.",
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
      const { data, creditInfo } = await withLocationErrors("resolve_parcel", {}, () => resolveParcel(
        { q: params.q, parcelId: params.parcelId, lat: params.lat, lng: params.lng },
        apiKey,
      ));
      return textResponse(formatParcelResolve(data) + formatCreditFooter(creditInfo));
    }),
);

// ── Tool: get_parcel_report ─────────────────────────────────────────

server.tool(
  "get_parcel_report",
  `The whole dossier for one land parcel in one call - prefer it over the per-layer parcel tools. Contains the parcel core (location, area, land use, plan designation); thirteen layers (flood, heritage, landslide, subsurface, nuisance surroundings, transit, general-plan zoning, buildings, building activity, agricultural eligibility, land-use and soil classification, nature, road access); the parcel's transactions (newest first, up to 20); local price context (county and gmina median zł/m², last 12 months); municipal context (demographics, infrastructure signals); and a parcel-shape section (outline geometry only).
For a coordinate or 'locality + number' use resolve_parcel first; for a street address use list_parcels_in_area.
Every section has its own state: covered; covered_no_data (checked, nothing found; billed); not_covered (outside our data; refunded); not_computed (did not finish in time; refunded - the report can be partial). Context sections use full / low_sample / suppressed / no_data (shape: full / no_data). Long lists are capped with a count of the rest.
Reading it: the nearby designation signal comes from RCN deeds of neighbouring land, not from the planning register - it describes the neighbourhood, not this parcel; confirm with the local plan (MPZP) or a zoning decision. Neither it nor the shape section (geometry only) says whether a parcel can be built on or divided. Construction age is an ESTIMATE with an interval (permit records start in 2016), often "not established".
Costs 45 API tokens, billed by outcome: an unresolvable parcel is refunded in full; a resolved parcel with no layer data pays only the 1-token core floor; with at least one covered layer, in full.
Requests are rate-limited per API key per minute, so parallel agents sharing one key share the same limit. On a "Too many requests" response, wait the given seconds and retry sequentially.`,
  {
    parcelId: z.string().min(3).max(200).describe(
      "Full cadastral id ('142907_2.0014.342/5' or the '-' form) or internal UUID.",
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
  `The official land-use and soil-quality classification of one land parcel and what it implies for taking the land out of agricultural use. Use it only for that question; for anything else about the parcel (prices, flood, zoning, buildings, permits, surroundings, transport) call get_parcel_report (one flat-price call, includes this classification).
Returns the land-use categories and soil grades entered for the parcel, whether any grade is in the protected I-III range, whether the parcel is inside a city boundary (changes the rule), and a re-designation note with the date the legal state was verified. They come back as SETS: the source records no area for any of them, so the answer can never say which category prevails or give a share.
Answers only where the county publishes the classification; many counties, including several large cities, do not. States: covered; covered_no_data (published, this parcel has none; billed); not_covered (county does not publish it, or we do not hold the parcel; refunded); not_computed (did not finish in time; refunded, retry).
Costs 4 API tokens, refunded on not_covered and not_computed. Not legal advice, and never a statement that a parcel can or cannot be built on.`,
  {
    parcelId: z.string().min(3).max(200).describe(
      "Full cadastral id ('142907_2.0014.342/5' or the '-' form) or internal UUID.",
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
// The coverage route refuses more names, or a longer one, with a 400 for the WHOLE request; trim here instead.
const COVERAGE_MAX_NAMES = 200;
const COVERAGE_NAME_MAX_CHARS = 100;
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
  `List cadastral parcels in an area - the land plots themselves, NOT transactions (for deeds and prices use search_by_area or search_by_polygon). For an id prefix use search_parcels; for a coordinate or 'locality + number' use resolve_parcel (a street address goes here, via street= and buildingNumber=); for everything about one parcel use get_parcel_report.

Name the area (at least one): teryt (codes from list_locations); location (county, city or gmina NAME; a name shared by several units is an error listing the candidates, never a guess); bbox; lat + lng + radiusKm (a circle; not together with a bbox); polygon (on its own).

Two answer shapes, priced differently: the default LIGHT list (parcel id, district, centre point, held street address; 2 API tokens; cursor paging) and OUTLINES, with includeGeometry=true (needs a bbox) or a polygon (GeoJSON polygon per parcel; 5 API tokens; max 100 parcels, 50 by default; no paging). An outline answer marked TRUNCATED is an arbitrary subset (not the first, nearest or largest): never report it as the area's parcel list, ask for a smaller area.

Light-list filters (not on outline calls) need a narrow scope - a bbox, a circle, a location name, or a teryt of at least 4 digits (county) - and do not count as naming the area. minArea / maxArea (m²) = the registered parcel surface.
- street: whole-word, case- and accent-insensitive ('Górna' does not find 'Podgórna'; a fragment finds nothing). Not inflected: pass the NOMINATIVE ('Karmelickiej' answers empty). An empty page is free and carries close-name suggestions - read them before concluding anything.
- buildingNumber (needs street): exact ('12A' does not find '12a'); RCN often records compound numbers ('84/92'), so '84' will not find '84/92'. If empty, official address points are tried (still exact); if both miss, the page is empty (free) and lists the numbers held on the street.
Most rural parcels have no street: outside towns use resolve_parcel with the precinct name and parcel number; an empty street search in the countryside says nothing about the parcel. parcel_id is returned only to API-token / OAuth callers and paid or trial accounts.

Coverage has two gaps. (1) The cadastral data we hold is near-complete but not live (measured per county; fresh splits, merges or renumbering may be missing), for EVERY entrance: a short list or no truncation marker never means you have every parcel. Each answer has a corpus_coverage block (figures for teryt/location, null for bbox/circle/polygon). (2) bbox, circle and polygon miss the few held parcels whose outline is in an unreadable coordinate system; teryt/location list those with no location. A returned parcel is real; never read an empty or short answer as proof the land is not there.
Limits: an area over ${PARCEL_AREA_MAX_KM2} km², a radius over ${PARCEL_RADIUS_MAX_KM} km or a polygon over 500 vertices is refused.`,
  {
    teryt: z.string().max(200).optional().describe(
      "TERYT code prefix (2/4/6 digits or finer), comma-separated for several. Wins over location.",
    ),
    location: z.string().max(200).optional().describe(
      "County, city, gmina or district name, resolved to its TERYT code ('Mokotów' = that Warszawa district; 'Kraków-Podgórze' = its parent county; a gmina name answers at municipality level).",
    ),
    bbox: z.string().max(200).optional().describe(
      `Bounding box "minLng,minLat,maxLng,maxLat" (WGS84), at most ${PARCEL_AREA_MAX_KM2} km². Required for includeGeometry=true.`,
    ),
    lat: z.number().min(-90).max(90).optional().describe(
      "Circle centre latitude (WGS84). Needs lng and radiusKm.",
    ),
    lng: z.number().min(-180).max(180).optional().describe(
      "Circle centre longitude (WGS84). Needs lat and radiusKm.",
    ),
    radiusKm: z.number().positive().max(PARCEL_RADIUS_MAX_KM).optional().describe(
      `Circle radius in km (max ${PARCEL_RADIUS_MAX_KM}, the radius covering ${PARCEL_AREA_MAX_KM2} km²). Needs lat and lng.`,
    ),
    polygon: z.object({
      type: z.literal("Polygon"),
      coordinates: z.array(z.array(z.array(z.number()))).min(1),
    }).refine(
      // Mirror of the server-side guard - keep in sync
      (poly) => poly.coordinates.reduce((sum, ring) => sum + ring.length, 0) <= 500,
      { message: "polygon exceeds 500 total vertices (sum across all rings)" },
    ).optional().describe(
      "GeoJSON Polygon: [longitude, latitude] pairs, first and last point identical, max 500 vertices. Always returns outlines. Pass it instead of the other area parameters.",
    ),
    minArea: z.number().positive().optional().describe(
      "Minimum parcel surface in m². Needs a narrow scope; not with includeGeometry or a polygon.",
    ),
    maxArea: z.number().positive().optional().describe(
      "Maximum parcel surface in m². Same scope requirement as minArea.",
    ),
    street: z.string().max(ADDRESS_FILTER_MAX_CHARS).optional().describe(
      `Street name in the NOMINATIVE (min ${STREET_MIN_WORD_CHARS} letters or digits). Needs a bbox, a circle, a location name, or a teryt of at least ${ADDRESS_FILTER_MIN_TERYT_DIGITS} digits; not with includeGeometry or a polygon.`,
    ),
    buildingNumber: z.string().max(ADDRESS_FILTER_MAX_CHARS).optional().describe(
      "Building number, exact; needs street, same scope requirement. If nothing is found, drop the number and read the numbers off the street's rows.",
    ),
    includeGeometry: z.boolean().optional().describe(
      "Return full outlines instead of the light row (5 tokens instead of 2). Requires a bbox; with a polygon outlines come back anyway.",
    ),
    limit: z.number().min(1).max(1000).optional().describe(
      "Max parcels. Light list: up to 1000, default 250. Outlines: up to 100, default 50.",
    ),
    cursor: z.string().max(500).optional().describe(
      "Opaque cursor from the previous light-list answer, for the next page; pass it back unchanged. Not available on outline calls.",
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

      const { data, creditInfo } = await withLocationErrors("list_parcels_in_area", { location: params.location }, () => listParcels(
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
      ));
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

// ── Street catalogue: not exposed as a tool ──
// list_parcels_in_area(street=) takes a street name directly. getStreets() in api-client.ts and
// formatStreetList() in formatters.ts stay typed and tested.

// ── Tool 8: search_by_polygon ──────────────────────────────────────

server.tool(
  "search_by_polygon",
  `Find transactions inside a GeoJSON Polygon - for precise neighborhood/osiedla boundaries; for a quick look start with search_by_area (its results can help estimate coordinates). Returns TRANSACTIONS (deeds and prices) with coordinates, despite the name; for the land plots inside a drawn shape pass the same polygon to list_parcels_in_area. Costs 5 API tokens.
Permalink to a result: https://cenogram.pl/ceny-transakcyjne?src=${channelSrc()}#v=1&lat=<A>&lng=<B>&z=16&tx=<id> (<id> from the "id:" line, <A>/<B> from "Location: <A>°N, <B>°E"; omit &tx=<id> for the area only).`,
  {
    polygon: z.object({
      type: z.literal("Polygon"),
      coordinates: z.array(z.array(z.array(z.number()))).min(1),
    }).refine(
      // Mirror of the server-side guard - keep in sync
      (poly) => poly.coordinates.reduce((sum, ring) => sum + ring.length, 0) <= 500,
      { message: "polygon exceeds 500 total vertices (sum across all rings)" },
    ).describe("GeoJSON Polygon: [longitude, latitude] pairs, first and last point identical, max 500 vertices total."),
    propertyType: z.enum(["land", "building", "developed_land", "unit"]).optional()
      .describe("Property type filter"),
    marketType: marketTypeParam,
    unitFunction: unitFunctionParam,
    buildingType: buildingTypeParam,
    ownershipType: ownershipTypeParam,
    mpzpDesignation: mpzpDesignationRefParam,
    transactionType: transactionTypeParam,
    rooms: roomsParam,
    floor: floorParam,
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
    excludeFractionalShares: excludeFractionalSharesParam,
    limit: z.number().min(1).max(3000).default(100).optional()
      .describe("Max results (1-3000); 50 shown."),
    page: pageParam(POLYGON_MAX_PAGE),
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
        excludeFractionalShares: params.excludeFractionalShares,
        // The endpoint has no offset: ask for rows 1..page*PAGE_SIZE and let the formatter slice the page.
        limit: params.page ? Math.min(3000, params.page * PAGE_SIZE) : params.limit,
      }, apiKey);
      const paging = params.page
        ? { page: params.page, pageSize: PAGE_SIZE, maxPage: POLYGON_MAX_PAGE, total: data.total, costNote: POLYGON_PAGE_COST_NOTE }
        : undefined;
      return textResponse(formatSpatialResults(data, paging) + mpzpWarning(params.mpzpDesignation) + formatCreditFooter(creditInfo));
    }),
);

// ── Tool 9: compare_locations ──────────────────────────────────────

server.tool(
  "compare_locations",
  `Compare 2-5 districts side-by-side: median price/m², average area and transaction counts.
Matches names only: call list_locations(search=...) first and use names it flags as RCN districts (rcn_district) - other names (most TERYT unit names) silently return no data. Needs at least one filter besides districts (e.g. propertyType).`,
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
      .describe("Comma-separated district names (2-5, unique), e.g. 'Mokotów,Wola,Ursynów'"),
    propertyType: z.enum(["land", "building", "developed_land", "unit"]).optional()
      .describe("Property type filter (recommended - API requires at least one filter)"),
    marketType: marketTypeParam,
    unitFunction: unitFunctionParam,
    buildingType: buildingTypeParam,
    ownershipType: ownershipTypeParam,
    mpzpDesignation: mpzpDesignationRefParam,
    transactionType: transactionTypeParam,
    minPrice: z.number().optional().describe("Minimum price in PLN"),
    maxPrice: z.number().optional().describe("Maximum price in PLN"),
    dateFrom: z.string().optional().describe("Start date (YYYY-MM-DD)"),
    dateTo: z.string().optional().describe("End date (YYYY-MM-DD)"),
    minArea: z.number().optional().describe("Minimum area in m²"),
    maxArea: z.number().optional().describe("Maximum area in m²"),
    street: z.string().optional().describe("Street name filter"),
    rooms: roomsParam,
    floor: floorParam,
    includeDemographics: z.boolean().optional()
      .describe("Add a GUS BDL demographics block per district (county-level: density, wages, unemployment, median age, price-to-income). Districts that do not resolve to a county are omitted from it."),
  },
  { readOnlyHint: true, destructiveHint: false, title: "Compare Locations" },
  async (params) =>
    withErrorHandling("compare_locations", apiKey, async () => {
      requireApiKey(apiKey);
      // Mirror of the server-side guard - at least one filter required besides districts.
      // Free-text strings use .trim() (the server treats "" and whitespace-only as missing).
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
        // Comma-separated on the wire, per the API's list-param convention; the tool exposes a boolean
        // because it is clearer for an LLM.
        include: params.includeDemographics ? "demographics" : undefined,
      }, apiKey);
      return textResponse(formatCompareResults(data) + mpzpWarning(params.mpzpDesignation) + formatCreditFooter(creditInfo));
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
  `Local statistics for a Polish location from GUS BDL (Poland's Central Statistical Office): ~50 indicators across 11 categories (population, economy, housing, planning, infrastructure, environment, safety, education, prices) plus a few derived metrics.
Address by location (city, county or gmina name; a city or county resolves to county level) OR teryt (codes from list_locations). Neighborhoods/osiedla are NOT addressable.
Returns the requested level PLUS all parent levels. Optional year, or yearFrom+yearTo for a time series, and category. Cost: 1 token.`,
  {
    location: z.string().optional().describe(
      "City, county, gmina or district name (e.g. 'Warszawa', 'Wieliczka'): city/county → county level, gmina → that gmina, a Warszawa district ('Mokotów') → that district, another city's delegatura ('Kraków-Podgórze') → its parent county. Shared name → candidates; pass one as teryt. Use this OR teryt.",
    ),
    teryt: z.string().optional().describe(
      "TERYT: 2-digit voivodeship (14), 4 county (1465), 6 or 7 gmina (1465011). 7th digit: 3 = urban-rural gmina overall, 4/5 = urban/rural part only, 8 = Warszawa district (1465108 = Śródmieście). Wins over location.",
    ),
    year: z.number().int().optional().describe(
      "Single year (2003-present); exclusive with yearFrom/yearTo. Omit for the latest year per indicator.",
    ),
    yearFrom: z.number().int().optional().describe("Start year for a time series (min 2003)."),
    yearTo: z.number().int().optional().describe("End year for a time series (max current year + 1)."),
    category: z.array(z.enum(DEMOGRAPHICS_CATEGORIES)).optional().describe(
      "Categories to return; omit for all.",
    ),
  },
  { readOnlyHint: true, destructiveHint: false, title: "Demographics & Local Statistics" },
  async (params) =>
    withErrorHandling("get_demographics", apiKey, async () => {
      requireApiKey(apiKey);
      const location = params.location?.trim();
      const teryt = params.teryt?.trim();
      if (!location && !teryt) {
        return errorResponse(
          'Provide a location (city/county name) or teryt (administrative code). Example: get_demographics(location="Warszawa"). Use list_locations(search=...) to find codes.',
        );
      }
      // Obvious format error → reject before the API call. A name that doesn't resolve (e.g. a
      // neighborhood) is left to REST → 404.
      if (teryt && !DEMOGRAPHICS_TERYT_RE.test(teryt)) {
        return errorResponse(
          `Invalid teryt '${sanitizeInput(teryt)}'. Use 2 digits (voivodeship), 4 (county), or 6-7 (gmina). Use list_locations(search=...) to find codes.`,
        );
      }
      const { data, creditInfo } = await withLocationErrors("get_demographics", { location }, () => getDemographics(
        {
          location,
          teryt,
          year: params.year,
          yearFrom: params.yearFrom,
          yearTo: params.yearTo,
          category: params.category?.join(","),
        },
        apiKey,
      ));
      return textResponse(formatDemographics(data) + formatCreditFooter(creditInfo));
    }),
);

// ── Tool: get_infrastructure_signals (PUBLIC) ───────────────────────

// Format guard only (resolution lives in REST): 4-digit county or 6/7-digit municipality.
const INFRA_TERYT_RE = /^(\d{4}|\d{6,7})$/;

server.tool(
  "get_infrastructure_signals",
  `Signals that a Polish municipality is about to build infrastructure, from three public sources: tenders in the national procurement bulletin (rolling 12 months), membership in an agglomeration of the national urban waste-water programme, and the municipality's planned capital expenditure from its multi-year forecast.
Address by location (city/county name → every municipality in the county) OR teryt (codes from list_locations; wins when both are given).
State these limits when reporting: the bulletin has only contracts BELOW EU thresholds (from 2021), so the largest investments are invisible; a tender is attributed to the contracting authority's SEAT, not the works location, so the counters include municipal authorities only while the notice list shows every authority with a flag. Absence of tenders is NOT evidence that a municipality is not investing. Cost: 1 token.`,
  {
    location: z.string().optional().describe(
      "City, county, gmina or district name (e.g. 'Warszawa', 'Krotoszyn'): city/county → every municipality in the county, gmina → that gmina alone, a Warszawa district ('Mokotów') → that gmina, another city's delegatura ('Kraków-Podgórze') → its parent county. Shared name → candidates; pass one as teryt. Use this OR teryt.",
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
        return errorResponse(
          'Provide a location (city/county name) or teryt (administrative code). Example: get_infrastructure_signals(location="Krotoszyn"). Use list_locations(search=...) to find codes.',
        );
      }
      // Obvious format error → reject before the API call. A code that is well-formed but
      // nonexistent is left to REST → 404.
      if (teryt && !INFRA_TERYT_RE.test(teryt)) {
        return errorResponse(
          `Invalid teryt '${sanitizeInput(teryt)}'. Use 4 digits (county) or 6-7 digits (municipality). Use list_locations(search=...) to find codes.`,
        );
      }
      const { data, creditInfo } = await withLocationErrors("get_infrastructure_signals", { location }, () => getInfrastructureSignals({ location, teryt }, apiKey));
      return textResponse(formatInfrastructureSignals(data) + formatCreditFooter(creditInfo));
    }),
);

// ── Tool: estimate_value ────────────────────────────────────────────
// Part of the default tool set, flagged "[Beta]" in the description.

server.tool(
  "estimate_value",
  `[Beta] Estimate an apartment's market value from comparable registered transaction prices near a point. An orientation estimate, NOT a certified appraisal (operat szacunkowy): it ignores condition, finish standard and floor.
Address by lat + lng OR parcelId (the parcel centroid is used) - exactly one. area (usable m², 10–250) is REQUIRED. Optional: rooms (1–10) and market (primary/secondary) narrow the comparables; includeComps (default true) echoes them.
Returns the point estimate, a likely and a wide range, a confidence band, the comparable count and an as_of date; as_of lags by county, so estimates are NOT comparable across cities with different as_of.
Apartments only; for a building plot or farmland use estimate_land_value. Too few comparables → no estimate. Costs 5 API tokens, refunded when no estimate is produced. ${MARKET_NOTE}`,
  {
    // Bounds are the Poland bbox, same as search_by_area — the data is Polish, and a point far outside it
    // only buys a slow round-trip that ends in "no estimate".
    lat: z.number().min(49).max(55).optional().describe(
      "Latitude of the apartment (WGS84, Poland); pair with lng. Use this OR parcelId.",
    ),
    lng: z.number().min(14).max(25).optional().describe(
      "Longitude of the apartment (WGS84, Poland); pair with lat. Use this OR parcelId.",
    ),
    parcelId: z.string().max(200).optional().describe(
      "Full cadastral id (slash or dash form) or internal UUID; the parcel centroid is used. Instead of lat/lng.",
    ),
    area: z.number().min(10).max(250).describe(
      "Apartment usable area in m² (REQUIRED, 10–250).",
    ),
    rooms: z.number().int().min(1).max(10).optional().describe(
      "Room count (1–10); narrows comparables to ±1 room.",
    ),
    market: z.enum(["primary", "secondary"]).optional().describe(
      "Restrict comparables to the primary (new-build) or secondary market.",
    ),
    includeComps: z.boolean().optional().describe(
      "Echo the comparables weighed (default true); false = estimate only.",
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

// ── Tool: estimate_land_value ───────────────────────────────────────
// Part of the default tool set, flagged "[Beta]" in the description. Sibling of estimate_value for
// undeveloped land. The feature can be unavailable, so the description says so and the handler
// degrades a 503 carrying a feature-off mode into a plain message.

// The handler composes this message itself instead of echoing the 503 body.
const LAND_VALUATION_DISABLED_MESSAGE =
  "The land value estimate is temporarily unavailable — this feature is briefly switched off. No credit was charged; please try again later.";

server.tool(
  "estimate_land_value",
  `[Beta] Estimate an undeveloped plot's market value from comparable registered transaction prices near a point. An orientation estimate, NOT a certified appraisal (operat szacunkowy).
Address by lat + lng OR parcelId (the parcel centroid is used) - exactly one. area (m², 100–1000000) is REQUIRED with lat/lng; with parcelId it defaults to the cadastre area. landType: plot (building plot, default) or agricultural (farmland) - the caller chooses. Optional mpzpDesignation narrows the comparables; includeComps (default true) echoes them.
Returns the estimate per m² and per hectare, a likely and a wide range, a confidence band, the comparable count and an as_of date (as_of lags by county: estimates are NOT comparable across areas with different as_of).
Comparables are chosen by the designation recorded in the transaction register (not a local zoning plan), so this does not assert the plot is buildable. Undeveloped land only. Too few comparables, or an area that cannot be determined → no estimate. Costs 5 API tokens, refunded when no estimate is produced. It can be switched off for maintenance (a plain "temporarily unavailable" reply). ${MARKET_NOTE}`,
  {
    // Bounds are the Poland bbox, same as estimate_value — the data is Polish.
    lat: z.number().min(49).max(55).optional().describe(
      "Latitude of the plot (WGS84, Poland); pair with lng. Use this OR parcelId (area is then required).",
    ),
    lng: z.number().min(14).max(25).optional().describe(
      "Longitude of the plot (WGS84, Poland); pair with lat. Use this OR parcelId (area is then required).",
    ),
    parcelId: z.string().max(200).optional().describe(
      "Full cadastral id or internal UUID; the parcel centroid is used. Instead of lat/lng.",
    ),
    area: z.number().min(100).max(1_000_000).optional().describe(
      "Plot area in m² (100–1000000). REQUIRED with lat/lng; with parcelId read from the cadastre when omitted.",
    ),
    landType: z.enum(["plot", "agricultural"]).optional().describe(
      "Comparable segment: plot (building plot, default) or agricultural (farmland); the caller chooses.",
    ),
    mpzpDesignation: z.string().max(100).optional().describe(
      "Narrow comparables to a recorded land-designation token (e.g. 'budownictwoMieszkanioweJednorodzinne'); 'unknown' = none recorded.",
    ),
    includeComps: z.boolean().optional().describe(
      "Echo the comparables weighed (default true); false = estimate only.",
    ),
  },
  { readOnlyHint: true, destructiveHint: false, title: "[Beta] Land Value Estimate" },
  async (params) =>
    withErrorHandling("estimate_land_value", apiKey, async () => {
      requireApiKey(apiKey);
      // Exactly-one-mode guard (mirrors estimate_value + the server's 400): enforce lat/lng-XOR-parcelId
      // pre-flight so a malformed request returns a clear message without spending a call/credit.
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
      // area is required on the lat/lng path (no cadastre to fall back to) — reject before the HTTP call.
      if (latLngMode && params.area == null) {
        return textResponse("area (the plot size in m², 100–1000000) is required when addressing by lat/lng.");
      }
      try {
        const { data, creditInfo } = await getLandValuation(
          {
            lat: params.lat,
            lng: params.lng,
            parcelId: params.parcelId,
            area: params.area,
            landType: params.landType,
            mpzpDesignation: params.mpzpDesignation,
            includeComps: params.includeComps ?? true,
          },
          apiKey,
        );
        return textResponse(formatLandValuation(data) + formatCreditFooter(creditInfo));
      } catch (error) {
        // A 503 with the feature-off mode degrades into a plain message and is not reported to
        // error tracking.
        // Other 503s stay on the normal path (rethrown → withErrorHandling).
        if (error instanceof ApiHttpError && error.status === 503 && error.mode === "avm-disabled") {
          return { content: [{ type: "text" as const, text: LAND_VALUATION_DISABLED_MESSAGE }], isError: true };
        }
        throw error;
      }
    }),
);

// Tools outside the default set (off unless enabled).
if (experimentalToolsEnabled()) {

// ── Tool: get_rental_yield ──────────────────────────────────────────

server.tool(
  "get_rental_yield",
  `EXPERIMENTAL (beta): may change or be withdrawn; no critical workflows on it.
Gross rental yield for a Polish city or county: annualized median asking rent (PLN/m²/month × 12) divided by the median secondary-market apartment transaction price per m² (RCN). Top-line only (excludes vacancy, management, tax, maintenance), indicative, not investment advice. Different sources, so an approximation; not comparable across cities with different as_of dates.
Address by location (city name → a county) OR teryt (teryt wins). Both sides need at least 5 samples or the result is suppressed.
Coverage: counties (miasta na prawach powiatu) plus Warszawa's 18 districts, only cities with asking-rent data. A gmina name resolves to its county (shown in the answer); a name shared by gminas in several counties returns candidates.
Optional areaBucket restricts both sides to an apartment area range. ${MARKET_NOTE}`,
  {
    location: z.string().optional().describe(
      "County-level city name (a miasto na prawach powiatu or a catalog entry, e.g. 'Warszawa', 'Gdańsk'); a Warszawa district ('Mokotów') narrows to it, 'Kraków-Podgórze' resolves to its parent county. A gmina name resolves to its county (candidates if shared by gminas in several counties); an osiedle 404s - use teryt. This OR teryt.",
    ),
    teryt: z.string().optional().describe(
      "TERYT: 4 digits = county (1465 = Warszawa); 6 digits = a Warszawa district (146510 = Śródmieście); other longer codes truncate to the county. Wins over location.",
    ),
    areaBucket: z.enum(["all", "0-30", "30-40", "40-50", "50-60", "60-80", "80+"]).optional().describe(
      "Apartment area range in m² (all = whole stock, default). Buckets are not additive.",
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
      const { data, creditInfo } = await withLocationErrors("get_rental_yield", { location: params.location }, () => getRentalYield(
        { location: params.location, teryt: params.teryt, areaBucket: params.areaBucket },
        apiKey,
      ));
      return textResponse(formatRentalYield(data) + formatCreditFooter(creditInfo));
    }),
);

// ── Tool: list_rental_yield_locations ───────────────────────────────

server.tool(
  "list_rental_yield_locations",
  `EXPERIMENTAL (beta): may change or be withdrawn; no critical workflows on it.
List the cities/counties get_rental_yield can answer for (asking-rent coverage), to find valid location/teryt values instead of guessing names. Each entry is a coverage signal only (offer sample size + confidence); call get_rental_yield for the yield. Optional search: city-name substring (diacritic-insensitive, min 2 chars); sorted by rent_sample_n descending. Free.`,
  {
    search: z.string().min(2, "search must be at least 2 characters").optional().describe(
      "City name filter (diacritic-insensitive substring, min 2 chars), e.g. 'gda' → Gdańsk. Omit for the full catalog.",
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
  `EXPERIMENTAL (beta): may change or be withdrawn; no critical workflows on it.
Asking-vs-transaction price spread for a Polish city or county: how far the median asking price per m² of apartments for sale sits above (or below) the median apartment transaction price per m² (RCN). spread_pct = (asking − transaction) / transaction × 100; it can be NEGATIVE in premium-secondary cities (a valid answer). Different sources, so an approximation; not comparable across cities with different as_of dates.
Address by location (city name → a county) OR teryt (teryt wins). Both sides need at least 5 samples or the result is suppressed.
marketType 'all' (default) = whole market; 'secondary' or 'primary' narrows both sides to that segment.
Coverage: counties (miasta na prawach powiatu) plus Warszawa's 18 districts, only cities with asking-sale data. A gmina name resolves to its county (shown in the answer); a name shared by gminas in several counties returns candidates.
Optional areaBucket restricts both sides to an apartment area range. ${MARKET_NOTE}`,
  {
    location: z.string().optional().describe(
      "County-level city name (a miasto na prawach powiatu or a catalog entry, e.g. 'Warszawa', 'Gdańsk'); a Warszawa district ('Mokotów') narrows to it, 'Kraków-Podgórze' resolves to its parent county. A gmina name resolves to its county (candidates if shared by gminas in several counties); an osiedle 404s - use teryt. This OR teryt.",
    ),
    teryt: z.string().optional().describe(
      "TERYT: 4 digits = county (1465 = Warszawa); 6 digits = a Warszawa district (146510 = Śródmieście); other longer codes truncate to the county. Wins over location.",
    ),
    marketType: z.enum(["primary", "secondary", "all"]).optional().describe(
      "Transaction-side segment: 'all' (default, matched to mixed sale offers), 'secondary' or 'primary'.",
    ),
    areaBucket: z.enum(["all", "0-30", "30-40", "40-50", "50-60", "60-80", "80+"]).optional().describe(
      "Apartment area range in m² (all = whole stock, default). Buckets are not additive.",
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
      const { data, creditInfo } = await withLocationErrors("get_price_spread", { location: params.location }, () => getPriceSpread(
        { location: params.location, teryt: params.teryt, marketType: params.marketType, areaBucket: params.areaBucket },
        apiKey,
      ));
      return textResponse(formatPriceSpread(data) + formatCreditFooter(creditInfo));
    }),
);

// ── Tool: list_price_spread_locations ───────────────────────────────

server.tool(
  "list_price_spread_locations",
  `EXPERIMENTAL (beta): may change or be withdrawn; no critical workflows on it.
List the cities/counties get_price_spread can answer for (asking-sale coverage), to find valid location/teryt values instead of guessing names. Each entry is a coverage signal only (sale offer sample size + confidence); call get_price_spread for the spread. Optional search: city-name substring (diacritic-insensitive, min 2 chars); sorted by asking_sample_n descending. Free.`,
  {
    search: z.string().min(2, "search must be at least 2 characters").optional().describe(
      "City name filter (diacritic-insensitive substring, min 2 chars), e.g. 'gda' → Gdańsk. Omit for the full catalog.",
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
  `EXPERIMENTAL (beta): may change or be withdrawn; no critical workflows on it.
What share of a Polish county's real-estate transactions sit on land in a mapped flood-hazard zone, by severity, from the RCN registry. Bands are return periods: high = most frequent (~1-in-10-year), medium ~1-in-100, low = rarest (~1-in-500). Counts land in a mapped zone only; absence of a zone is never asserted as 'safe' (an area may be unmapped).
Address by location (city/county name → its county; a gmina name is answered at county level, with a note) OR teryt (4-digit county; longer codes truncate to the county; wins when both are given). All-time, no date window; suppressed below 5 assessed transactions.
Coverage is county-level. Unless the location is a major city you know is covered, call list_flood_risk_locations FIRST or pass a 4-digit county TERYT.`,
  {
    location: z.string().optional().describe(
      "City or county name (e.g. 'Warszawa', 'Gdańsk'). District and gmina names are accepted ('Kraków-Podgórze', 'Wieliczka') but coverage is county-level, so the answer is the parent county with a note. A gmina name shared by counties returns candidates. A town within a larger powiat or an osiedle may 404 - check the catalog or use teryt. This OR teryt.",
    ),
    teryt: z.string().optional().describe(
      "TERYT code. 4 digits = county (e.g. 1465 = Warszawa). Longer codes (gmina/precinct/district) resolve to the county. Wins over location.",
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
      const { data, creditInfo } = await withLocationErrors("get_flood_risk", { location: params.location }, () => getFloodRisk(
        { location: params.location, teryt: params.teryt },
        apiKey,
      ));
      return textResponse(formatFloodRisk(data) + formatCreditFooter(creditInfo));
    }),
);

// ── Tool: list_flood_risk_locations ─────────────────────────────────

server.tool(
  "list_flood_risk_locations",
  `EXPERIMENTAL (beta): may change or be withdrawn; no critical workflows on it.
List the counties get_flood_risk can answer for (transactions with a completed flood assessment), to find valid location/teryt values instead of guessing names. Each entry is a coverage signal only (assessed sample size + confidence); call get_flood_risk for the exposure. Optional search: county-name substring (diacritic-insensitive, min 2 chars); sorted by assessed_sample_n descending. Free.`,
  {
    search: z.string().min(2, "search must be at least 2 characters").optional().describe(
      "County name filter (diacritic-insensitive substring, min 2 chars), e.g. 'gda' → Gdańsk. Omit for the full catalog.",
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
  `Building-by-building breakdown for one transaction: footprint area, storeys and estimated total floor area (footprint × storeys) of each building on the property. Use it after a search whose result has building data (searches return per-transaction building SUMS inline) - e.g. a developed-land deed covering several buildings.
Each building carries a construction-age ESTIMATE with an interval, derived from building-permit records: never a registry construction date, and the records only start in 2016, so "construction year not established" is the usual honest answer.
Cost: 4 tokens. Returns nothing for a transaction with no buildings.`,
  txIdShape(" that carries building data"),
  { readOnlyHint: true, destructiveHint: false, title: "Building-by-Building Breakdown" },
  async (params) =>
    withErrorHandling("get_building_breakdown", apiKey, async () => {
      requireApiKey(apiKey);
      const txId = resolveTxId(params);
      if (typeof txId !== "string") return txId;
      // `res` is the whole response body ({ data, truncated }); `res.data` is the building array.
      // Destructure as `res` (not `data`) to keep that distinction explicit.
      const { data: res, creditInfo } = await getBuildingBreakdown(txId, apiKey);
      return textResponse(formatBuildingBreakdown(res) + formatCreditFooter(creditInfo));
    }),
);

// ── Tool 11: get_transaction_flood ──────────────────────────────────

server.tool(
  "get_transaction_flood",
  `Parcel-by-parcel flood-hazard breakdown for one transaction: per linked plot in a mapped flood zone - the worst hazard category (high/medium/low, ~1-in-10-year to ~1-in-500-year), hazard type (river/coastal/infrastructure), the share of the plot inside the zone and the per-scenario list with return periods.
Use it after a search whose result shows flood_risk (search_transactions and search_by_area surface it inline; search_by_polygon does not). For a parcel with no transaction, get_parcel_report lists the same scenarios.
Land in no mapped zone returns nothing - absence of a zone is never asserted as "safe". Cost: 4 tokens (refunded when there is no flood data).`,
  txIdShape(),
  { readOnlyHint: true, destructiveHint: false, title: "Transaction Flood-Hazard Breakdown" },
  async (params) =>
    withErrorHandling("get_transaction_flood", apiKey, async () => {
      requireApiKey(apiKey);
      const txId = resolveTxId(params);
      if (typeof txId !== "string") return txId;
      // `res` is the whole response body ({ data, truncated }); `res.data` is the parcel array.
      const { data: res, creditInfo } = await getTransactionFlood(txId, apiKey);
      return textResponse(formatFloodBreakdown(res) + formatCreditFooter(creditInfo));
    }),
);

// ── Tool 12: get_transaction_heritage ───────────────────────────────

server.tool(
  "get_transaction_heritage",
  `Parcel-by-parcel heritage-listing breakdown for one transaction: per linked plot with a detected listing - the status (listed = a protected monument on/at the plot; zone = within a protected urban layout or the designated surroundings of a monument), the share of the plot inside the protected area (when measurable) and the entries (category, name, function, period, entry date).
Use it after a search whose result shows a heritage listing (search_transactions and search_by_area surface heritage_status inline; search_by_polygon does not). For a parcel with no transaction, get_parcel_report lists the same entries.
No detected listing returns nothing - absence of a detection is never "not listed". Indicative data: the regional heritage conservator makes the binding determination. Cost: 4 tokens (refunded when there is no heritage data).`,
  txIdShape(),
  { readOnlyHint: true, destructiveHint: false, title: "Transaction Heritage-Listing Breakdown" },
  async (params) =>
    withErrorHandling("get_transaction_heritage", apiKey, async () => {
      requireApiKey(apiKey);
      const txId = resolveTxId(params);
      if (typeof txId !== "string") return txId;
      // `res` is the whole response body ({ data, truncated }); `res.data` is the parcel array.
      const { data: res, creditInfo } = await getTransactionHeritage(txId, apiKey);
      return textResponse(formatHeritageBreakdown(res) + formatCreditFooter(creditInfo));
    }),
);

// ── Tool 13: get_transaction_landslide ──────────────────────────────

server.tool(
  "get_transaction_landslide",
  `Parcel-by-parcel landslide-hazard breakdown for one transaction, from official landslide-hazard maps (1:10,000): per linked plot intersecting a mapped hazard area - the worst category ('landslide' = a mapped landslide area, 'threatened' = an area threatened by mass movements), the share of the plot inside the zones, and the per-zone list (with source_version_date, the source-record version date, not an observation date). At this scale an intersection means overlap with a mapped area, not that the parcel itself is a landslide.
Use it after a search whose result shows landslide_risk (inline in search_transactions and search_by_area, not search_by_polygon). For a parcel with no transaction, get_parcel_report gives the share and zone kinds.
Land in no mapped zone returns nothing - absence of data is never an assertion of safety. Cost: 4 tokens (refunded when there is no landslide data).`,
  txIdShape(),
  { readOnlyHint: true, destructiveHint: false, title: "Transaction Landslide-Hazard Breakdown" },
  async (params) =>
    withErrorHandling("get_transaction_landslide", apiKey, async () => {
      requireApiKey(apiKey);
      const txId = resolveTxId(params);
      if (typeof txId !== "string") return txId;
      // `res` is the whole response body ({ data, truncated }); `res.data` is the parcel array.
      const { data: res, creditInfo } = await getTransactionLandslide(txId, apiKey);
      return textResponse(formatLandslideBreakdown(res) + formatCreditFooter(creditInfo));
    }),
);

// ── Tool 13b: get_transaction_subsurface ────────────────────────────

server.tool(
  "get_transaction_subsurface",
  `Use it to see whether one transaction's land overlaps a mining terrain or a major groundwater reservoir: per linked plot overlapping either - the mining-terrain status ('active' | 'former') with mineral class ('subsidence' = extraction with surface deformation, the actual mining-damage risk; 'surface' = open-pit, mostly local impact; 'fluid' = borehole extraction; 'other'), the reservoir status ('documented' | 'undocumented'), the share of the plot inside each, and per-object details.
A mining terrain is a legally defined zone of anticipated mining influence with an approximate mapped location: an intersection is an advisory signal to verify with the competent mining-supervision authority, not a legal determination. A reservoir's extent alone imposes NO restriction; one would come only from a protection zone, which is not published here.
For a parcel with no transaction, get_parcel_report lists the same objects. Land overlapping neither layer returns nothing - absence of data is never an assertion of safety. Cost: 4 tokens (refunded when there is no subsurface data).`,
  txIdShape(),
  { readOnlyHint: true, destructiveHint: false, title: "Transaction Subsurface Breakdown" },
  async (params) =>
    withErrorHandling("get_transaction_subsurface", apiKey, async () => {
      requireApiKey(apiKey);
      const txId = resolveTxId(params);
      if (typeof txId !== "string") return txId;
      // `res` is the whole response body ({ data, truncated }); `res.data` is the parcel array.
      const { data: res, creditInfo } = await getTransactionSubsurface(txId, apiKey);
      return textResponse(formatSubsurfaceBreakdown(res) + formatCreditFooter(creditInfo));
    }),
);

// ── Tool 13c: get_transaction_roads ─────────────────────────────────

server.tool(
  "get_transaction_roads",
  `Plot-by-plot road-access evidence for one transaction, to judge how its land sits relative to the road network: per linked plot, the distance in meters to the nearest public road (500 m), the nearest road of any kind (500 m) and the nearest motorway/expressway/dual-carriageway (3 km; a traffic-nuisance proxy, not access) - plus, for the nearest public road, the estimated distance to its carriageway EDGE (null when the source has no width), its management category and functional class, and whether it runs at ground level (false = viaduct or tunnel). Each plot carries access_indicator (likely / uncertain / unlikely) and its rule version.
access_indicator is GEOMETRIC EVIDENCE from carriageway centrelines in reference road data. It does NOT determine legal access or say anything about easements and rights of way (land register, not published here) - a lead to verify, never a conclusion.
A null distance means no such road within the radius in the reference data - NEVER a guarantee none exists; assessed=false = not evaluated yet. For a parcel with no transaction, get_parcel_report has a one-line road-access summary. Cost: 4 tokens (refunded when there is no informative data).`,
  txIdShape(),
  { readOnlyHint: true, destructiveHint: false, title: "Transaction Road Access" },
  async (params) =>
    withErrorHandling("get_transaction_roads", apiKey, async () => {
      requireApiKey(apiKey);
      const txId = resolveTxId(params);
      if (typeof txId !== "string") return txId;
      // `res` is the whole response body ({ data, truncated }); `res.data` is the plot array.
      const { data: res, creditInfo } = await getTransactionRoads(txId, apiKey);
      return textResponse(formatRoads(res) + formatCreditFooter(creditInfo));
    }),
);

// ── Tool 14: get_transaction_surroundings ───────────────────────────

server.tool(
  "get_transaction_surroundings",
  `Plot-by-plot surroundings profile for one transaction, for due diligence on nearby nuisances: per linked plot, the distance in meters to the nearest cemetery (1 km radius), landfill (3 km), sewage treatment plant (2 km), industrial/storage area (1 km), large industrial plant (3 km), intensive livestock farm (3 km), high-voltage overhead power line (1 km) and extra-high-voltage overhead power line (1 km).
Distances are approximate, from the plot boundary; 0 = the plot touches or overlaps. Only overhead high- and extra-high-voltage lines are covered (medium and low voltage are ubiquitous). For a parcel with no transaction, get_parcel_report lists the same distances.
A null distance means no such object within the radius in the reference data - NEVER a guarantee none exists; assessed=false = not evaluated yet. Cost: 4 tokens (refunded when there is no informative data).`,
  txIdShape(),
  { readOnlyHint: true, destructiveHint: false, title: "Transaction Surroundings Breakdown" },
  async (params) =>
    withErrorHandling("get_transaction_surroundings", apiKey, async () => {
      requireApiKey(apiKey);
      const txId = resolveTxId(params);
      if (typeof txId !== "string") return txId;
      // `res` is the whole response body ({ data, truncated }); `res.data` is the plot array.
      const { data: res, creditInfo } = await getTransactionSurroundings(txId, apiKey);
      return textResponse(formatSurroundings(res) + formatCreditFooter(creditInfo));
    }),
);

// ── Tool 15: get_transaction_transit ────────────────────────────────

server.tool(
  "get_transaction_transit",
  `Use it to check public-transport access to one transaction's land: for each linked plot, the nearest stop distance by mode (rail/metro within 3000 m, tram 1500 m, bus 1000 m) from open GTFS data, plus the nearest stop's name per mode present.
No stop within its cap in any mode returns nothing - absence of a row is never "no transit access" (open feeds cover cities and national rail, not every rural area). Cost: 4 tokens (refunded when there is no transit data).`,
  txIdShape(),
  { readOnlyHint: true, destructiveHint: false, title: "Transaction Public Transport Access Breakdown" },
  async (params) =>
    withErrorHandling("get_transaction_transit", apiKey, async () => {
      requireApiKey(apiKey);
      const txId = resolveTxId(params);
      if (typeof txId !== "string") return txId;
      // `res` is the whole response body ({ data, truncated }); `res.data` is the parcel array.
      const { data: res, creditInfo } = await getTransactionTransit(txId, apiKey);
      return textResponse(formatTransitBreakdown(res) + formatCreditFooter(creditInfo));
    }),
);

// ── Tool 16: get_transaction_permits ────────────────────────────────

server.tool(
  "get_transaction_permits",
  `Building-permit history for one transaction's parcels, from the national registry of building permits and works notifications (records since 2016): per case - kind (permit / notification), works type, object category, authority, date, address, volume. Use it after a search to screen what was built or approved on the land.
Match is by the parcel's current identifier, so splits/merges break the link. Permits are held once a decision is issued (its outcome, granted or refused, is not held); notifications only where accepted without objection; pending cases not at all.
For a parcel with no transaction, get_parcel_report lists the cases in its building-activity section. For what is being built around a point, use get_permits_in_area.
Three coverage states: covered (at least one registered case), covered_no_data (the transaction exists, its parcels have no case), not_covered (no transaction with this id). An empty result never confirms that nothing was planned. Cost: 4 tokens (refunded when there is no record or no such transaction).`,
  txIdShape(),
  { readOnlyHint: true, destructiveHint: false, title: "Transaction Building-Permit History" },
  async (params) =>
    withErrorHandling("get_transaction_permits", apiKey, async () => {
      requireApiKey(apiKey);
      const txId = resolveTxId(params);
      if (typeof txId !== "string") return txId;
      // `res` is the whole response body ({ data, truncated, note }); `res.data` is the record array.
      const { data: res, creditInfo } = await getTransactionPermits(txId, apiKey);
      return textResponse(formatPermitsBreakdown(res) + formatCreditFooter(creditInfo));
    }),
);

// ── Tool: get_permits_in_area ───────────────────────────────────────
// Collection over a circle. The route can be unavailable, so the description says so and the
// handler degrades a 503 carrying a feature-off mode into a plain message (as estimate_land_value does).

// Composed here instead of echoing the 503 body.
const AREA_PERMITS_DISABLED_MESSAGE =
  "Building permits within a radius are temporarily unavailable — this feature is briefly switched off. No credit was charged; please try again later.";

const PERMITS_RADIUS_MESSAGE =
  "radiusKm must be between 0.1 and 2 km. For a wider area, make several calls with neighbouring centre points; for what is closest to the point, use a smaller radius.";

// Statutory object categories (annex to the Construction Law), the closed set the service accepts.
const PERMIT_OBJECT_CATEGORIES = [
  "I", "II", "III", "IV", "V", "VI", "VII", "VIII", "IX", "X", "XI", "XII", "XIII", "XIV", "XV",
  "XVI", "XVII", "XVIII", "XIX", "XX", "XXI", "XXII", "XXIII", "XXIV", "XXV", "XXVI", "XXVII", "XXVIII", "XXIX", "XXX",
] as const;

server.tool(
  "get_permits_in_area",
  `List the building permits and works notifications registered since 2016 within a radius of a point - issued decisions only, matched through the parcel geometry we hold, which is near-complete but not the whole cadastre - to see what is being built nearby.
Returns cases newest first, NOT nearest first (a permit and a notification for one investment are two cases), plus an aggregate by year and statutory object category over ALL matched cases (do not add it up across pages) with the permit/notification split and building volume. truncated = more cases than the limit: pass the returned cursor back as cursor with the same filters.
Examples: apartment blocks → categories=[XIII]; drop utility-network noise (XXVI can be most of a list) → excludeCategories=[XXVI]; utility works as a sign that land is being serviced for development → categories=[XXVI]. For "how many / how much" pass aggregateOnly=true (same price). The list is ordered by date: for what is closest use a smaller radiusKm (e.g. 0.3) instead of paging; radiusKm is 0.1–2 (default 2), for a wider area make several calls for neighbouring centres.
Reading it: decision outcomes (granted or refused) are not held; notifications only where accepted without objection; pending cases not at all. Matching uses the parcel's current identifier and geometry, so cases filed before a split or merge may be missed, parcels without geometry are not searched and a parcel number with a sheet segment may be matched less exactly. The answer states how many parcels we hold in the circle (0 = no data for the area) and the date of the last refresh: loaded periodically, not live. A volume marked suspect stays in the sums. A short or empty list is never a statement that nothing is being built. A query over the time limit returns an error asking for a smaller radius.
Coordinates: for a parcel take them from resolve_parcel (or search_parcels); for a street use list_parcels_in_area(location, street) and the centre point of a returned row; otherwise from the user - never guess them.
Cost: 5 API tokens per call, also for an empty list; each page is a separate call. It can be switched off for maintenance (a plain "temporarily unavailable" reply).`,
  {
    // Bounds are the Poland bbox, same as estimate_value: the data is Polish, and a point outside it only buys a round-trip.
    lat: z.number().min(49).max(55).describe(
      "Circle centre latitude (WGS84, Poland), from resolve_parcel / list_parcels_in_area or the user; never guessed.",
    ),
    lng: z.number().min(14).max(25).describe(
      "Circle centre longitude (WGS84, Poland), from resolve_parcel / list_parcels_in_area or the user; never guessed.",
    ),
    // Custom messages: the default zod text would not tell the caller what to do instead.
    radiusKm: z.number().min(0.1, PERMITS_RADIUS_MESSAGE).max(2, PERMITS_RADIUS_MESSAGE).optional().describe(
      "Radius in km, 0.1–2 (default 2).",
    ),
    dateFrom: z.string().regex(/^\d{4}-\d{2}-\d{2}$/, "dateFrom must be YYYY-MM-DD").optional().describe(
      "Window start, YYYY-MM-DD (decision date; intake date for notifications). Default two years back; earlier than 2016-01-01 counts as 2016-01-01.",
    ),
    dateTo: z.string().regex(/^\d{4}-\d{2}-\d{2}$/, "dateTo must be YYYY-MM-DD").optional().describe(
      "Window end, YYYY-MM-DD, inclusive, not before dateFrom. When older than two years, pass dateFrom as well.",
    ),
    intent: z.enum(["multi_family", "single_family", "all"]).optional().describe(
      "multi_family = categories [XIII], single_family = [I] (incl. semi-detached and terraced), all = no filter (default). Not with categories.",
    ),
    categories: z.array(z.enum(PERMIT_OBJECT_CATEGORIES)).min(1).max(PERMIT_OBJECT_CATEGORIES.length).optional().describe(
      "Keep only these object categories (Roman numerals I–XXX). Not with intent other than all; must not overlap excludeCategories.",
    ),
    excludeCategories: z.array(z.enum(PERMIT_OBJECT_CATEGORIES)).min(1).max(PERMIT_OBJECT_CATEGORIES.length).optional().describe(
      "Drop these object categories (cases without a category stay). Must not overlap categories.",
    ),
    worksType: z.enum(["new_construction", "all"]).optional().describe(
      "new_construction (default) or all (adds extensions, demolitions and other works).",
    ),
    limit: z.number().int().min(1).max(200).optional().describe(
      "Cases in the list, 1–200 (default 50). The aggregate counts all matched cases.",
    ),
    cursor: z.string().min(1).max(300).optional().describe(
      "Cursor from the previous answer, for the next page; pass it back unchanged with the same filters. Not with aggregateOnly.",
    ),
    aggregateOnly: z.boolean().optional().describe(
      "true = only the aggregate (year × category counts, split, volumes), no case list. Same price; not with cursor.",
    ),
  },
  { readOnlyHint: true, destructiveHint: false, title: "Building Permits Within a Radius" },
  async (params) =>
    withErrorHandling("get_permits_in_area", apiKey, async () => {
      requireApiKey(apiKey);
      try {
        const { data, creditInfo } = await getPermitsInArea(
          {
            lat: params.lat,
            lng: params.lng,
            radiusKm: params.radiusKm,
            dateFrom: params.dateFrom,
            dateTo: params.dateTo,
            intent: params.intent,
            categories: params.categories,
            excludeCategories: params.excludeCategories,
            worksType: params.worksType,
            limit: params.limit,
            cursor: params.cursor,
            aggregateOnly: params.aggregateOnly,
          },
          apiKey,
        );
        return textResponse(formatPermitsInArea(data, { continued: Boolean(params.cursor) }) + formatCreditFooter(creditInfo));
      } catch (error) {
        // A 503 with the feature-off mode degrades into a plain message and is not reported to
        // error tracking. Other 503s are rethrown onto the normal path.
        if (error instanceof ApiHttpError && error.status === 503 && error.mode === "area-disabled") {
          return { content: [{ type: "text" as const, text: AREA_PERMITS_DISABLED_MESSAGE }], isError: true };
        }
        throw error;
      }
    }),
);

// ── Tool 17: get_transaction_planning ───────────────────────────────

server.tool(
  "get_transaction_planning",
  `General-plan (plan ogólny, POG) zoning for one transaction's land: per linked plot, the zones covering it - symbol, name, share of the plot, the building parameters the plan sets (max height, max development intensity, max built-up coverage, min biologically active area) - plus overlay areas (infill development area / obszar uzupełnienia zabudowy, central development area). Use it for feasibility and permitted-use questions on a plot.
Coverage is THREE-STATE: 'covered' returns zone data; 'covered_no_data' = the municipality has an adopted general plan but no zone data covers these plots yet; 'not_covered' = no published general-plan data for the municipality yet - NEVER a claim that it has no plan (general plans are still being adopted). Cost: 4 tokens (refunded for covered_no_data and not_covered).`,
  txIdShape(),
  { readOnlyHint: true, destructiveHint: false, title: "Transaction General-Plan Zoning" },
  async (params) =>
    withErrorHandling("get_transaction_planning", apiKey, async () => {
      requireApiKey(apiKey);
      const txId = resolveTxId(params);
      if (typeof txId !== "string") return txId;
      // `res` is the whole response body ({ data, truncated, coverage, ... }); `res.data` is the zone/overlay array.
      const { data: res, creditInfo } = await getTransactionPlanning(txId, apiKey);
      return textResponse(formatPlanningBreakdown(res) + formatCreditFooter(creditInfo));
    }),
);

// ── Tool 18: get_transaction_farmland ───────────────────────────────

server.tool(
  "get_transaction_farmland",
  `Parcel-by-parcel agricultural land-eligibility breakdown for one transaction, from official nationwide eligibility data (updated weekly): per linked parcel with a matched eligible area - the area in m², its share of the parcel (when the measured area is known) and the number of source features; also how many linked parcels carry a match and the snapshot date. Useful for due diligence on land actually eligible/maintained as agricultural, beyond the paper classification.
A parcel with no match returns nothing - absence is NEVER a statement that the property is non-agricultural (small plots not actively farmed are absent, the layer has its own update cadence, older transactions can reference renumbered parcels). Cost: 4 tokens (refunded when there is no eligible area).`,
  txIdShape(),
  { readOnlyHint: true, destructiveHint: false, title: "Transaction Agricultural Land-Eligibility Breakdown" },
  async (params) =>
    withErrorHandling("get_transaction_farmland", apiKey, async () => {
      requireApiKey(apiKey);
      const txId = resolveTxId(params);
      if (typeof txId !== "string") return txId;
      // `res` is the whole response body ({ data, truncated, parcels_total, parcels_with_data, as_of }).
      const { data: res, creditInfo } = await getTransactionFarmland(txId, apiKey);
      return textResponse(formatFarmland(res) + formatCreditFooter(creditInfo));
    }),
);

// ── Tool 19: get_transaction_nature ─────────────────────────────────

server.tool(
  "get_transaction_nature",
  `Parcel-by-parcel nature breakdown for one transaction: per linked plot with a nature signal - the nearest forest within 2 km (forest_distance_m, 0 = the plot overlaps forest, with the overlap share) and any overlapping protected areas: the sharpest form (protection_rank 1 = national park, 2 = nature reserve, 3 = Natura 2000, 4 = landscape park, 5 = protected landscape, 6 = other), building_restriction ('statutory_ban' = a ban following from the Nature Protection Act for parks and reserves, 'conditional' = depends on the establishing act), the share of the plot under protection and names.
Search results carry no nature signal: call this directly on a transaction id when forest proximity or protected-area build limits matter. For a parcel with no transaction, get_parcel_report names the protected areas. It describes the SOURCE of a restriction, not a permitting outcome; not legal advice.
An empty result is NEVER a statement that building is allowed (local plans and permit decisions are not covered). A buffer zone around a park or reserve is reported as 'buffer_zone' at rank 6, never as a statutory ban. An empty result says which kind it is: plots checked with no signal, or no nature data held yet - the second is never a finding of no forest or protected area. Cost: 4 tokens (refunded on any empty result).`,
  txIdShape(),
  { readOnlyHint: true, destructiveHint: false, title: "Transaction Nature (Forest & Protected Areas) Breakdown" },
  async (params) =>
    withErrorHandling("get_transaction_nature", apiKey, async () => {
      requireApiKey(apiKey);
      const txId = resolveTxId(params);
      if (typeof txId !== "string") return txId;
      // `res` is the whole response body ({ data, truncated, coverage }); `res.data` is the parcel array.
      // The formatter needs the envelope, not just the rows: `coverage` is what an empty result means.
      const { data: res, creditInfo } = await getTransactionNature(txId, apiKey);
      return textResponse(formatNatureBreakdown(res) + formatCreditFooter(creditInfo));
    }),
);

} // end registerTools
