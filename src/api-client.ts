import { fetch, type Response } from "undici";
import { getClientId } from "./client-id.js";
import { authErrorMessage, getAuthMode, type ErrorBody } from "./error-messages.js";
import { requestContext } from "./request-context.js";

const BASE_URL = process.env.CENOGRAM_API_URL || "https://cenogram.pl";

// ── Types ──────────────────────────────────────────────────────────

export interface StatsResponse {
  counts: {
    transactions: number;
    parcels: number;
    buildings: number;
    units: number;
    addresses: number;
  };
  prices: {
    total: number;
    avg_price: number;
    median_price: number;
    min_price: number;
    max_price: number;
  };
  dateRange: { min_date: string; max_date: string };
  byDistrict: { district: string; transaction_count: number }[];
  byPropertyType: { type: number; total: number; label: string }[];
  byMarketType: { type: number; total: number; label: string }[];
}

export interface Transaction {
  id: string;
  transaction_date: string;
  property_type: number;
  market_type: number;
  price_gross: number;
  usable_area_m2: number | null;
  price_per_m2: number | null;
  rooms: number | null;
  floor: number | null;
  district: string | null;
  street: string | null;
  // Street provenance: 'rcn' = from the deed/registry; 'approx_high'/'approx_low' =
  // approximated by us (not from the deed); 'none' = no street. Surfaced so callers and the LLM
  // never treat an approximated street as registry-sourced.
  address_source?: "rcn" | "approx_high" | "approx_low" | "none" | null;
  building_number: string | null;
  city: string | null;
  parcel_area: number | null;
  unit_function: number | null;
  // Garage provenance. is_garage = the row is a garage/parking space (opt-in via
  // unitFunction=garage). area_basis: 'unit' = usable_area_m2 is a plausible single spot area
  // (price/m² computed); 'building' = it's the whole garage-building footprint (price/m² omitted).
  is_garage?: boolean | null;
  area_basis?: "unit" | "building" | null;
  parcel_id: string | null;
  parcel_number: string | null;
  county_name: string | null;
  voivodeship_name: string | null;
  // Share basis: 'fraction' = price reflects a fractional ownership share,
  // excluded from market median. Surfaced per-row so users see which comparables are fractional.
  share_basis?: "full" | "fraction" | "ambiguous" | null;
  // ── Provenance signals — drive the "Z RCN / Obliczone" markers. ──
  // parcel_count >= 2 → parcel_area is a SUM of plots (computed). area_is_ha_converted → parcel_area
  // was converted from hectares the county reports in ha (computed). property_type_inferred /
  // property_type_reclassed → property_type is derived/corrected by us, not the registry's literal code.
  parcel_count?: number | null;
  area_is_ha_converted?: boolean | null;
  property_type_inferred?: boolean | null;
  property_type_reclassed?: boolean | null;
  // ── Raw deed fields — straight from the notarial deed (RCN), no marker. ──
  // ownership_type / seller_type / buyer_type = enum codes (mappings.ts dicts). ownership_share = the
  // raw share text ("1/2"). land_use = RCN land-use code. unit_price = deed price of the unit alone
  // (PLN, NOT per-m²) — NUMERIC over the wire → string. vat = raw VAT field (may be a rate % OR an
  // amount, as recorded — no unit) — NUMERIC over the wire → string.
  ownership_type?: number | null;
  ownership_share?: string | null;
  seller_type?: number | null;
  buyer_type?: number | null;
  land_use?: string | null;
  unit_price?: number | string | null;
  vat?: number | string | null;
  // Building attrs — per-transaction aggregates. Neutral names (no source register).
  // Gate on building_count first (NULL = no buildings, not 0). SUM fields are NULL unless every
  // linked building is complete. NUMERIC arrives as string over the wire (Intl.format coerces).
  building_count?: number | null;
  footprint_area_m2?: number | null;
  est_total_area_m2?: number | null;
  building_storeys?: number | null; // single-building transactions only
  // Flood-hazard (per-transaction worst-case over the linked parcels). TWO-STATE: flood_risk is
  // 'high'|'medium'|'low' ONLY when a linked parcel sits in a mapped flood-hazard zone; absence is null and
  // is NEVER surfaced as "safe". flood_assessed = ≥1 linked parcel had geometry (plumbing for the aggregate,
  // NOT "assessed safe") — never surfaced affirmatively. get_transaction_flood gives the per-parcel detail.
  flood_risk?: "high" | "medium" | "low" | null;
  flood_assessed?: boolean | null;
  // Heritage listing (per-transaction worst-case over the linked parcels). TWO-STATE: heritage_status
  // is 'listed' (a protected monument on/at a linked parcel) or 'zone' (within a protected urban layout
  // or designated monument surroundings) ONLY when a listing was detected; absence is null and is NEVER
  // surfaced as "not listed". The status is a floor ("at least") — a listed property may also sit inside
  // a protected zone. heritage_assessed = ≥1 linked parcel had geometry (plumbing for the aggregate, NOT
  // "assessed clear") — never surfaced affirmatively. get_transaction_heritage gives the per-parcel detail.
  heritage_status?: "listed" | "zone" | null;
  heritage_assessed?: boolean | null;
  // Landslide-hazard (per-transaction worst-case over the linked parcels), from official
  // landslide-hazard maps (1:10,000 scale). TWO-STATE: landslide_risk is 'landslide'|'threatened' ONLY
  // when a linked parcel intersects a mapped hazard area; absence is null and is NEVER surfaced as
  // "safe". An intersection means the parcel overlaps a mapped area, not that the parcel itself is a
  // landslide. landslide_assessed = ≥1 linked parcel had geometry (plumbing for the aggregate, NOT
  // "assessed safe") — never surfaced affirmatively. get_transaction_landslide gives per-parcel detail.
  landslide_risk?: "landslide" | "threatened" | null;
  landslide_assessed?: boolean | null;
  centroid: { type: string; coordinates: [number, number] } | null;
}

export interface TransactionsResponse {
  data: Transaction[];
  pagination: { page: number; limit: number; total: number; pages: number; estimated?: boolean };
}

export interface TransactionsSummary {
  median_price_m2: number | null;
  avg_area: number | null;
  min_date: string | null;
  max_date: string | null;
  total: number;
}

export interface PricePerM2Row {
  district: string;
  avg_price_m2: number;
  median_price_m2: number;
  count: number;
}

export interface HistogramBin {
  bucket: number;
  count: number;
  range_min: number;
  range_max: number;
}

// Component price-per-m2 percentile ladder (shared by both endpoints' distribution blocks).
export interface Percentiles {
  p10: number | null;
  p25: number | null;
  p50: number | null;
  p75: number | null;
  p90: number | null;
}

// Resolved location envelope. teryt = 4-digit county code.
export interface LocationRef {
  name: string;
  country_code: "PL";
  location_type: "city" | "county";
  teryt: string;
}

// Trailing transaction window (full ISO dates; each bound independently nullable).
export interface TxWindow {
  from: string | null;
  to: string | null;
}

// Nested response envelope. Shallow grouping: location / metric / currency / segment / result /
// inputs / distribution / assumptions / quality. Units explicit (top-level currency + _per_m2),
// dates full ISO, floats rounded.
export interface RentalYieldResponse {
  location: LocationRef;
  metric: "indicative_gross_rental_yield";
  currency: "PLN";
  segment: {
    market_type: "primary" | "secondary" | "all";
    property_type: "apartment";
    area_bucket: string | null; // m² range; null = whole stock
  };
  result: {
    gross_yield_pct: number | null;
    calculation_method: "ratio_of_market_medians";
    matched_observations: false;
  };
  inputs: {
    rent: {
      median_monthly_asking_per_m2: number | null;
      annualized_per_m2: number | null;
      sample_n: number | null;
      snapshot_date: string | null; // active-offer snapshot (a point in time, NOT a window)
    };
    transaction: {
      median_price_per_m2: number | null;
      sample_n: number | null;
      window: TxWindow;
    };
  };
  distribution: {
    asking_rent_monthly_per_m2: Percentiles;
    transaction_price_per_m2: Percentiles;
  };
  assumptions: {
    vacancy_included: false;
    tax_included: false;
    maintenance_included: false;
    transaction_costs_included: false;
  };
  quality: {
    coverage: "full" | "low_sample" | "no_rental_data" | "suppressed" | "data_stale";
    confidence: "high" | "low";
    as_of: string | null;
    stale: boolean;
    notes: string[];
  };
}

export interface RentalYieldLocation {
  location: string;
  county_code: string;
  voivodeship: string;
  type: "city" | "county";
  rent_sample_n: number;
  confidence: "high" | "low";
}

export interface RentalYieldLocationsResponse {
  data: RentalYieldLocation[];
  meta: { total: number; snapshot_date: string | null };
}

// ── Price spread ────────────────────────────────────────

// Mirrors RentalYieldResponse. Differences: metric, result.spread_pct (MAY be negative),
// inputs.asking (sale, not /month), NO assumptions block (the time-basis caveat lives in quality.notes).
export interface PriceSpreadResponse {
  location: LocationRef;
  metric: "asking_to_transaction_price_spread";
  currency: "PLN";
  segment: {
    market_type: "primary" | "secondary" | "all";
    property_type: "apartment";
    area_bucket: string | null;
  };
  result: {
    spread_pct: number | null;
    calculation_method: "relative_difference_of_market_medians";
    matched_observations: false;
  };
  inputs: {
    asking: {
      median_price_per_m2: number | null;
      sample_n: number | null;
      snapshot_date: string | null;
      window?: TxWindow;
    };
    transaction: {
      median_price_per_m2: number | null;
      sample_n: number | null;
      window: TxWindow;
    };
  };
  distribution: {
    asking_sale_per_m2: Percentiles;
    transaction_price_per_m2: Percentiles;
  };
  quality: {
    coverage: "full" | "low_sample" | "no_asking_data" | "suppressed" | "data_stale";
    confidence: "high" | "low";
    as_of: string | null;
    stale: boolean;
    notes: string[];
  };
}

export interface PriceSpreadLocation {
  location: string;
  county_code: string;
  voivodeship: string;
  type: "city" | "county";
  asking_sample_n: number;
  confidence: "high" | "low";
}

export interface PriceSpreadLocationsResponse {
  data: PriceSpreadLocation[];
  meta: { total: number; snapshot_date: string | null };
}

// ── Demographics (GUS BDL) ──────────────────────────────────────────

// One indicator series. values is a year-keyed map (single entry for latest-year queries, multiple
// for yearFrom/yearTo time series). variable_id is null for derived metrics.
export interface DemographicsIndicator {
  name: string;
  unit: string;
  variable_id: number | null;
  category: string;
  level: string;
  values: Record<string, number>;
  note?: string;
  derived?: boolean;
  snapshot?: boolean;
  snapshot_note?: string;
}

export interface DemographicsResponse {
  location: {
    name: string | null;
    country_code: "PL";
    location_type: "city" | "county" | "municipality" | "voivodeship";
    teryt: string;
    level: string;
    // Parent administrative units; absent in demo mode. Possible keys: powiat, podregion, wojewodztwo.
    hierarchy?: Record<string, { teryt: string | null; name: string }>;
  };
  coverage: "full" | "no_data";
  indicators: Record<string, DemographicsIndicator>;
  meta: {
    variables_count: number;
    categories: string[];
    levels_included: string[];
    data_source: string;
    as_of: string | null;
  };
  demo?: boolean;
}

export function getDemographics(
  params: { location?: string; teryt?: string; year?: number; yearFrom?: number; yearTo?: number; category?: string },
  apiKey?: string,
): Promise<ApiResponse<DemographicsResponse>> {
  return fetchApi("/api/v1/demographics", toQueryParams({
    location: params.location,
    teryt: params.teryt,
    year: params.year,
    yearFrom: params.yearFrom,
    yearTo: params.yearTo,
    category: params.category,
  }), apiKey);
}

// ── Infrastructure signals ──────────────────────────────────────────

export interface InfraTender {
  title: string;
  category: string;
  notice_type: string;
  published_at: string;
  value_pln: number | null;
  value_kind: string | null;
  /** "high" only when the contracting authority is the municipality itself. */
  attribution_confidence: string | null;
  bzp_url: string | null;
}

export interface InfrastructureSignalsResponse {
  location: {
    name: string | null;
    country_code: "PL";
    location_type: "city" | "county" | "municipality";
    teryt: string;
    level: string;
  };
  coverage: "full" | "partial" | "no_data";
  tenders: {
    window_months: number;
    by_category: Record<string, number>;
    recent: InfraTender[];
    truncated: boolean;
  };
  /** Membership in an agglomeration of the national urban waste-water treatment programme. */
  kposk: {
    in_agglomeration: boolean;
    agglomerations: Array<{ name: string; rlm: number | null }>;
    truncated: boolean;
  };
  capex: {
    by_year: Record<string, { value_pln: number; doc_category: string; resolution_date: string | null; gmina_count: number }>;
  };
  meta: { coverage_note: string; as_of: string | null };
}

export function getInfrastructureSignals(
  params: { location?: string; teryt?: string },
  apiKey?: string,
): Promise<ApiResponse<InfrastructureSignalsResponse>> {
  return fetchApi("/api/v1/infrastructure-signals", toQueryParams({
    location: params.location,
    teryt: params.teryt,
  }), apiKey);
}

// ── Credit info types ───────────────────────────────────────────────

export interface CreditInfo {
  balance: number;
  cost: number;
}

export interface ApiResponse<T> {
  data: T;
  creditInfo: CreditInfo | null;
}

function extractCreditInfo(res: Response): CreditInfo | null {
  if (!res.headers) return null;
  const balance = parseInt(res.headers.get("X-Credits-Balance") ?? "", 10);
  const cost = parseInt(res.headers.get("X-Credits-Cost") ?? "", 10);
  if (isNaN(balance) || isNaN(cost)) return null;
  return { balance, cost };
}

// ── OAuth internal auth ────────────────────────────────────────────

// SOH char (\x01) is impossible in base64url or ctx_ keys - used as both prefix and separator.
// Exported so the tool layer can gate on the OAuth channel before decoding (identity logging).
export const OAUTH_CTX_PREFIX = "\x01";

export function encodeOAuthCtx(userId: string, grantId: string): string {
  // \x01{userId}\x01{grantId} - \x01 cannot appear in UUIDs (hex + hyphens only)
  return `${OAUTH_CTX_PREFIX}${userId}${OAUTH_CTX_PREFIX}${grantId}`;
}

// Inverse of encodeOAuthCtx. Returns null for anything that is not a well-formed OAuth context key
// (not \x01-prefixed, missing separator, empty userId, or empty grantId). Mirrors buildHeaders'
// parse below, but returns null on malformed input instead of throwing - the identity-logging caller
// must never crash a tool call, it just omits user_id.
export function decodeOAuthCtx(key: string): { userId: string; grantId: string } | null {
  if (!key.startsWith(OAUTH_CTX_PREFIX)) return null;
  const rest = key.slice(OAUTH_CTX_PREFIX.length);
  const sepIdx = rest.indexOf(OAUTH_CTX_PREFIX);
  if (sepIdx <= 0) return null; // no separator, or empty userId
  const grantId = rest.slice(sepIdx + OAUTH_CTX_PREFIX.length);
  if (!grantId) return null; // empty grantId
  return { userId: rest.slice(0, sepIdx), grantId };
}

// ── Shared HTTP helpers ────────────────────────────────────────────

function buildHeaders(apiKey?: string): Record<string, string> {
  const headers: Record<string, string> = {
    "X-Source": "mcp-server",
    "X-Cenogram-Client-Id": getClientId(),
  };
  const ctx = requestContext.getStore();
  if (ctx?.clientUserAgent) headers["X-MCP-User-Agent"] = ctx.clientUserAgent;
  const key = apiKey ?? process.env.CENOGRAM_API_KEY;
  if (key?.startsWith(OAUTH_CTX_PREFIX)) {
    const rest = key.slice(OAUTH_CTX_PREFIX.length);
    const sepIdx = rest.indexOf(OAUTH_CTX_PREFIX);
    if (sepIdx <= 0) {
      throw new Error("BUG: malformed OAuth context key");
    }
    const internalSecret = process.env.INTERNAL_AUTH_SECRET;
    if (internalSecret) {
      headers["X-Internal-Auth"] = internalSecret;
    }
    headers["X-OAuth-User"] = rest.slice(0, sepIdx);
    headers["X-OAuth-Grant"] = rest.slice(sepIdx + OAUTH_CTX_PREFIX.length);
  } else if (key) {
    headers["Authorization"] = `Bearer ${key}`;
  }
  return headers;
}

/**
 * Reads `Retry-After` as whole seconds. Returns null when the header is absent or
 * unusable, so the caller can stay silent about timing rather than invent a number.
 *
 * RFC 7231 allows either a delta in seconds or an HTTP-date; a proxy in front of the
 * API may send the date form even though the API itself always sends seconds.
 */
export function parseRetryAfterSeconds(headerValue: string | null | undefined): number | null {
  if (!headerValue) return null;
  const raw = headerValue.trim();
  if (/^\d+$/.test(raw)) return Math.max(1, parseInt(raw, 10));
  // Only the date form is left, and every HTTP-date names a weekday and a month. Without that
  // check `Date.parse` happily turns junk like "-5" into a year and invents a wait out of it.
  if (!/[A-Za-z]/.test(raw)) return null;
  const asDate = Date.parse(raw);
  if (Number.isNaN(asDate)) return null;
  return Math.max(1, Math.ceil((asDate - Date.now()) / 1000));
}

/** Turns a delay in seconds into the largest unit that still reads naturally. */
export function formatRetryAfter(seconds: number): string {
  const unit = (value: number, name: string) => `${value} ${name}${value === 1 ? "" : "s"}`;
  if (seconds < 60) return unit(seconds, "second");
  if (seconds < 3600) return unit(Math.ceil(seconds / 60), "minute");
  if (seconds < 86400) return unit(Math.ceil(seconds / 3600), "hour");
  return unit(Math.ceil(seconds / 86400), "day");
}

async function handleErrorResponse(res: Response, apiKey?: string): Promise<never> {
  // 429 has special Retry-After handling - keep dedicated path
  if (res.status === 429) {
    const seconds = parseRetryAfterSeconds(res.headers?.get?.("Retry-After"));
    // Every 429 the API emits is a short rate limit; an exhausted allowance is a 402.
    // Spelling that out stops the caller from reporting a few seconds' wait as "come back later".
    const wait = seconds !== null ? ` Retry in ${formatRetryAfter(seconds)}.` : " Retry shortly.";
    throw new Error(`Too many requests - this is a rate limit, not an exhausted allowance.${wait}`);
  }
  const body = (await res.json().catch(() => ({}))) as ErrorBody;
  const mode = getAuthMode(apiKey ?? process.env.CENOGRAM_API_KEY);
  throw new Error(authErrorMessage(res.status, mode, body));
}

function toQueryParams(obj: Record<string, string | number | undefined | null>): Record<string, string> {
  const params: Record<string, string> = {};
  for (const [k, v] of Object.entries(obj)) {
    if (v != null && v !== "") params[k] = String(v);
  }
  return params;
}

// ── HTTP client ─────────────────────────────────────────────────────

export async function fetchApi<T>(
  path: string,
  params?: Record<string, string>,
  apiKey?: string,
): Promise<ApiResponse<T>> {
  const url = new URL(path, BASE_URL);
  if (params) {
    for (const [k, v] of Object.entries(params)) {
      if (v !== undefined && v !== "") url.searchParams.set(k, v);
    }
  }

  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 10_000);

  try {
    const res = await fetch(url.toString(), { signal: controller.signal, headers: buildHeaders(apiKey) });
    if (!res.ok) await handleErrorResponse(res, apiKey);
    return { data: (await res.json()) as T, creditInfo: extractCreditInfo(res) };
  } finally {
    clearTimeout(timeout);
  }
}

export async function fetchApiPost<T>(
  path: string,
  body: unknown,
  apiKey?: string,
): Promise<ApiResponse<T>> {
  const url = new URL(path, BASE_URL);

  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 30_000);

  try {
    const headers = buildHeaders(apiKey);
    headers["Content-Type"] = "application/json";

    const res = await fetch(url.toString(), {
      method: "POST",
      signal: controller.signal,
      headers,
      body: JSON.stringify(body),
    });
    if (!res.ok) await handleErrorResponse(res, apiKey);
    return { data: (await res.json()) as T, creditInfo: extractCreditInfo(res) };
  } finally {
    clearTimeout(timeout);
  }
}

// ── Typed wrappers ──────────────────────────────────────────────────

export function getStats(apiKey?: string): Promise<ApiResponse<StatsResponse>> {
  return fetchApi("/api/v1/stats", undefined, apiKey);
}

export interface TransactionParams {
  district?: string;
  teryt?: string;
  street?: string;
  buildingNumber?: string;
  parcelId?: string;
  propertyType?: number;
  marketType?: number;
  unitFunction?: number | string; // string carries the "unknown"=NULL sentinel (mapUnitFunction)
  buildingType?: number | string; // string carries the "unknown"=NULL sentinel (mapBuildingType)
  ownershipType?: number | string; // CSV of registry codes (mapOwnershipTypes; "unknown"=NULL sentinel)
  mpzpDesignation?: string;
  minPrice?: number;
  maxPrice?: number;
  dateFrom?: string;
  dateTo?: string;
  minArea?: number;
  maxArea?: number;
  bbox?: string;
  transactionType?: string;
  rooms?: string;
  floor?: string;
  floodRisk?: string;
  heritageStatus?: string;
  landslideRisk?: string;
  limit?: number;
  page?: number;
  sort?: string;
  order?: string;
}

export function getTransactions(p: TransactionParams, apiKey?: string): Promise<ApiResponse<TransactionsResponse>> {
  return fetchApi("/api/v1/transactions", toQueryParams({
    district: p.district,
    teryt: p.teryt,
    street: p.street,
    buildingNumber: p.buildingNumber,
    parcelId: p.parcelId,
    propertyType: p.propertyType,
    marketType: p.marketType,
    unitFunction: p.unitFunction,
    ownershipType: p.ownershipType,
    buildingType: p.buildingType,
    mpzpDesignation: p.mpzpDesignation,
    transactionType: p.transactionType,
    rooms: p.rooms,
    floor: p.floor,
    floodRisk: p.floodRisk,
    heritageStatus: p.heritageStatus,
    landslideRisk: p.landslideRisk,
    minPrice: p.minPrice,
    maxPrice: p.maxPrice,
    dateFrom: p.dateFrom,
    dateTo: p.dateTo,
    minArea: p.minArea,
    maxArea: p.maxArea,
    bbox: p.bbox,
    limit: p.limit,
    page: p.page,
    sort: p.sort,
    order: p.order,
  }), apiKey);
}

export function getTransactionsSummary(p: TransactionParams, apiKey?: string): Promise<ApiResponse<TransactionsSummary>> {
  return fetchApi("/api/v1/transactions/summary", toQueryParams({
    district: p.district,
    teryt: p.teryt,
    street: p.street,
    buildingNumber: p.buildingNumber,
    parcelId: p.parcelId,
    propertyType: p.propertyType,
    marketType: p.marketType,
    unitFunction: p.unitFunction,
    ownershipType: p.ownershipType,
    buildingType: p.buildingType,
    mpzpDesignation: p.mpzpDesignation,
    transactionType: p.transactionType,
    rooms: p.rooms,
    floor: p.floor,
    floodRisk: p.floodRisk,
    heritageStatus: p.heritageStatus,
    // Summary must carry the same row-filtering params as getTransactions — otherwise the
    // "Found N" count reports an unfiltered total (same drift guard as floodRisk).
    landslideRisk: p.landslideRisk,
    minPrice: p.minPrice,
    maxPrice: p.maxPrice,
    dateFrom: p.dateFrom,
    dateTo: p.dateTo,
    minArea: p.minArea,
    maxArea: p.maxArea,
    bbox: p.bbox,
  }), apiKey);
}

export function getPricePerM2(apiKey?: string): Promise<ApiResponse<PricePerM2Row[]>> {
  return fetchApi("/api/v1/price-per-m2", undefined, apiKey);
}

export function getDistricts(apiKey?: string): Promise<ApiResponse<string[]>> {
  return fetchApi("/api/v1/districts", undefined, apiKey);
}

export function getRentalYield(
  params: { location?: string; teryt?: string; areaBucket?: string },
  apiKey?: string,
): Promise<ApiResponse<RentalYieldResponse>> {
  return fetchApi("/api/v1/rental-yield", toQueryParams({
    location: params.location,
    teryt: params.teryt,
    areaBucket: params.areaBucket,
  }), apiKey);
}

export function getRentalYieldLocations(
  params: { search?: string },
  apiKey?: string,
): Promise<ApiResponse<RentalYieldLocationsResponse>> {
  return fetchApi("/api/v1/rental-yield/locations", toQueryParams({
    search: params.search,
  }), apiKey);
}

export function getPriceSpread(
  params: { location?: string; teryt?: string; marketType?: string; areaBucket?: string },
  apiKey?: string,
): Promise<ApiResponse<PriceSpreadResponse>> {
  return fetchApi("/api/v1/price-spread", toQueryParams({
    location: params.location,
    teryt: params.teryt,
    marketType: params.marketType,
    areaBucket: params.areaBucket,
  }), apiKey);
}

export function getPriceSpreadLocations(
  params: { search?: string },
  apiKey?: string,
): Promise<ApiResponse<PriceSpreadLocationsResponse>> {
  return fetchApi("/api/v1/price-spread/locations", toQueryParams({
    search: params.search,
  }), apiKey);
}

// ── Valuation (comparable-sales apartment estimate) ─────────────────

// One comparable transaction echoed by /valuations when includeComps is set. Mirrors the REST envelope
// (inputs.comparables[]). unit_number may be absent from responses; has_unit_number indicates whether
// the unit has a number on record.
export interface ValuationComparable {
  distance_m: number;
  transaction_date: string;
  area_m2: number;
  price_per_m2: number;
  rooms: number | null;
  floor: number | null;
  market_type: "primary" | "secondary" | null;
  district: string | null;
  has_unit_number: boolean;
  unit_number?: string | null;
}

// Envelope from GET /api/valuations (comparable-sales apartment estimate). coverage: "covered" = an
// estimate was produced; "no_data" = too few comparables near the point (credit refunded); "not_covered"
// is reserved for property types the estimate does not serve. Monetary fields are PLN. as_of = transaction-data
// freshness anchor (lags by county). All estimate fields are null on no_data.
export interface ValuationResponse {
  location: { country_code: string; lat: number | null; lng: number | null; county_code: string | null };
  metric: string;
  currency: string;
  segment: { property_type: string; market_type: "primary" | "secondary" | "all"; area_m2: number; rooms: number | null };
  result: {
    estimated_value: number | null;
    price_per_m2: number | null;
    value_range_likely: { low: number | null; high: number | null };
    value_range_wide: { low: number | null; high: number | null };
    confidence: number | null;
    confidence_band: "high" | "medium" | "low" | null;
  };
  inputs: {
    comps_total: number;
    radius_m: number | null;
    window_months: number;
    comparables: ValuationComparable[] | null;
  };
  quality: {
    coverage: "covered" | "no_data" | "not_covered";
    as_of: string | null;
    price_basis: "apartment" | "deed";
    ess: number | null;
    accuracy_segment: "wwa" | "duze" | "srednie" | "male" | null;
    note: string;
  };
}

// GET /api/valuations — apartment value estimate from comparable registered transactions near a point.
// Address by lat+lng OR parcelId (the parcel centroid is used); area (m²) is required. Costs 5 credits,
// refunded on coverage:"no_data".
export function getValuation(
  params: { lat?: number; lng?: number; parcelId?: string; area: number; rooms?: number; market?: "primary" | "secondary"; includeComps?: boolean },
  apiKey?: string,
): Promise<ApiResponse<ValuationResponse>> {
  return fetchApi("/api/v1/valuations", toQueryParams({
    lat: params.lat,
    lng: params.lng,
    parcelId: params.parcelId,
    area: params.area,
    rooms: params.rooms,
    market: params.market,
    // Tri-state collapse: a falsy includeComps (false OR undefined) omits the param → server default
    // (comps excluded). The tool layer always passes an explicit boolean, so this only matters for
    // future direct callers: pass true to include comps; anything else means "estimate only".
    includeComps: params.includeComps ? "true" : undefined,
  }), apiKey);
}

export interface LocationItem {
  code: string;
  name: string;
  typeName: string | null;
  level: "voivodeship" | "county" | "municipality" | "precinct";
}

export function getLocations(parent?: string, apiKey?: string): Promise<ApiResponse<LocationItem[]>> {
  return fetchApi("/api/v1/locations", parent ? { parent } : undefined, apiKey);
}

export function getPriceHistogram(
  bins = 20,
  max = 3_000_000,
  apiKey?: string,
): Promise<ApiResponse<HistogramBin[]>> {
  return fetchApi("/api/v1/stats/price-histogram", toQueryParams({ bins, max }), apiKey);
}

// ── Parcel search ──────────────────────────────────────────────────

export interface ParcelSearchResult {
  // Optional in the server contract. This client always calls with an API key, so in practice it is
  // present — typed optional anyway, to keep the formatter honest if that ever changes.
  parcel_id?: string;
  district: string | null;
  area_m2: number | null;
  lat: number;
  lng: number;
}

export interface ParcelSearchResponse {
  results: ParcelSearchResult[];
}

export function searchParcels(
  q: string,
  limit?: number,
  apiKey?: string,
): Promise<ApiResponse<ParcelSearchResponse>> {
  return fetchApi("/api/v1/parcels/search", toQueryParams({ q, limit }), apiKey);
}

// ── Parcel resolve (discovery → cadastral identity) ─────────────────

// One candidate returned by /parcels/resolve. parcel_id/parcel_key are the cadastral identity; typed
// nullable to match the server contract (may be absent in some responses), so guard against null at the
// render layer. county_code = the 4-digit administrative prefix of the id.
export interface ParcelResolveMatch {
  id: string;
  parcel_id: string | null;
  parcel_key: string | null;
  district: string | null;
  county_code: string | null;
  parcel_number: string | null;
  area_m2: number | null;
  has_geometry: boolean;
  centroid: { lat: number; lng: number } | null;
}

// Envelope from /parcels/resolve. coverage: covered = ≥1 match; not_covered = no confirmed parcel (the
// credit is refunded). as_of = freshness of our cadastral copy (a global value; matches may span areas).
export interface ParcelResolveResponse {
  query: { mode: string; q?: string; parcelId?: string; lat?: number; lng?: number };
  coverage: "covered" | "not_covered";
  as_of: string | null;
  matches: ParcelResolveMatch[];
  truncated: boolean;
}

export interface ResolveParcelParams {
  q?: string;
  parcelId?: string;
  lat?: number;
  lng?: number;
}

// Exactly one of q / parcelId / (lat+lng) — enforced by the caller (tool layer) and the server.
export function resolveParcel(
  params: ResolveParcelParams,
  apiKey?: string,
): Promise<ApiResponse<ParcelResolveResponse>> {
  return fetchApi("/api/v1/parcels/resolve", toQueryParams({
    q: params.q,
    parcelId: params.parcelId,
    lat: params.lat,
    lng: params.lng,
  }), apiKey);
}

// ── Parcel report (composite dossier) ───────────────────────────────

// One price level (county or locality) inside market_context. coverage is the STATISTICAL canon
// (full/low_sample/suppressed/no_data), NOT the four-state — a context section, not a per-parcel one.
// median_price_per_m2 is null when suppressed (too few sales) or no_data. n = the sample size behind it.
export interface ReportMarketLevel {
  coverage: string;
  median_price_per_m2: number | null;
  n: number;
  county_code?: string | null;
  district?: string | null;
}

// Local price context: 12-month median zł/m² at the county and locality grain. coverage rolls up the
// two levels (statistical canon). as_of is null here (aggregates carry no per-location freshness marker).
export interface ReportMarketContext {
  coverage: string;
  as_of: string | null;
  county: ReportMarketLevel;
  locality: ReportMarketLevel;
  note?: string | null;
}

// The demographics half of location_context: a headline GUS subset for the gmina. coverage is the
// statistical canon (full/no_data). indicators is a name-keyed map (empty when no_data).
export interface ReportDemographicsSection {
  coverage: string;
  as_of: string | null;
  name: string | null;
  indicators: Record<string, DemographicsIndicator>;
}

// The infrastructure-signals half of location_context: the three upcoming-investment overlays for the
// gmina. coverage is full/partial/no_data (statistical canon). Shape mirrors InfrastructureSignalsResponse
// minus its `location` envelope (the gmina identity lives on location_context.gmina_teryt).
export interface ReportInfraSection {
  coverage: string;
  as_of: string | null;
  gmina_name: string | null;
  tenders: { window_months: number; by_category: Record<string, number>; recent: InfraTender[]; truncated: boolean };
  kposk: { in_agglomeration: boolean; agglomerations: Array<{ name: string; rlm: number | null }>; truncated: boolean };
  capex: { by_year: Record<string, unknown> };
  note?: string | null;
}

// Municipal context: the demographics + infrastructure-signals bundle for the parcel's gmina. coverage
// rolls up the two sub-sections (statistical canon). gmina_teryt is null for a parcel with no cadastral id.
export interface ReportLocationContext {
  coverage: string;
  as_of: string | null;
  gmina_teryt: string | null;
  demographics: ReportDemographicsSection;
  infra_signals: ReportInfraSection;
  note?: string | null;
}

// One per-parcel enrichment section (flood/heritage/landslide/surroundings/transit/planning/buildings/
// permits/farmland/transactions). Every section carries its own FOUR-STATE coverage + as_of, then its
// layer-specific fields. Typed open (index signature) because each layer contributes a different field
// set — the formatter reads coverage/as_of plus a handful of known keys defensively.
export interface ReportSection {
  coverage: string;
  as_of: string | null;
  note?: string | null;
  [key: string]: unknown;
}

// Envelope from GET /api/parcels/:key/report — the composite parcel dossier. Top-level `coverage` is the
// four-state of the parcel CORE (covered / not_covered / not_computed). `sections` bundles the 9 enrichment
// layers + transaction history (each four-state) and the two context sections (statistical canon). `billing`
// carries the net outcome: charged + refunded (their sum is the gross for a non-demo caller) and a `rule`
// naming why (full / core_floor / total_miss_refund / not_computed_refund / disabled / demo).
export interface ParcelReportResponse {
  parcel: {
    id: string | null;
    parcel_id: string | null;
    parcel_key: string | null;
    district?: string | null;
    county_code?: string | null;
    county_name?: string | null;
    voivodeship_name?: string | null;
    parcel_number?: string | null;
    area_m2?: number | null;
    land_use?: string | null;
    mpzp_designation?: string | null;
    has_geometry?: boolean;
    centroid?: { lat: number; lng: number } | null;
  };
  coverage: string;
  as_of: string | null;
  sections: {
    transactions: ReportSection;
    flood: ReportSection;
    heritage: ReportSection;
    landslide: ReportSection;
    surroundings: ReportSection;
    transit: ReportSection;
    planning: ReportSection;
    buildings: ReportSection;
    permits: ReportSection;
    farmland: ReportSection;
    market_context: ReportMarketContext;
    location_context: ReportLocationContext;
  };
  billing: { charged: number; refunded: number; rule: string };
  note?: string | null;
}

// GET /api/parcels/:key/report — the whole parcel dossier in one call. The path key must be the URL-safe
// dash form (a '/' in the number segment becomes '-'); we normalise a raw-slash id here so callers can pass
// the natural '142907_2.0014.342/5' form. A UUID passes through unchanged. Costs 35 API tokens, refunded in
// full or in part by outcome (see billing.rule on the response).
export function getParcelReport(
  parcelKey: string,
  apiKey?: string,
): Promise<ApiResponse<ParcelReportResponse>> {
  const urlKey = parcelKey.trim().replace(/\//g, "-");
  return fetchApi(`/api/v1/parcels/${encodeURIComponent(urlKey)}/report`, undefined, apiKey);
}

// ── Spatial search (polygon) ───────────────────────────────────────

export interface SpatialSearchParams {
  polygon: { type: "Polygon"; coordinates: number[][][] };
  propertyType?: number;
  marketType?: number;
  unitFunction?: number | string; // string carries the "unknown"=NULL sentinel (mapUnitFunction)
  buildingType?: number | string; // string carries the "unknown"=NULL sentinel (mapBuildingType)
  ownershipType?: number | string; // CSV of registry codes (mapOwnershipTypes; "unknown"=NULL sentinel)
  mpzpDesignation?: string;
  minPrice?: number;
  maxPrice?: number;
  dateFrom?: string;
  dateTo?: string;
  minArea?: number;
  maxArea?: number;
  district?: string;
  street?: string;
  transactionType?: string;
  rooms?: string;
  floor?: string;
  limit?: number;
}

export interface SpatialFeatureProperties {
  id: string;
  price_gross: number;
  transaction_date: string;
  property_type: number;
  market_type: number;
  usable_area_m2: number | null;
  price_per_m2: number | null;
  rooms: number | null;
  floor: number | null;
  street: string | null;
  // Street provenance — see Transaction.address_source. /spatial returns it
  // (the API) and formatSpatialFeature spreads it through; type was out-of-sync with runtime.
  address_source?: "rcn" | "approx_high" | "approx_low" | "none" | null;
  building_number: string | null;
  city: string | null;
  district: string | null;
  parcel_area: number | null;
  parcel_number: string | null;
  share_basis?: "full" | "fraction" | "ambiguous" | null;
  // Garage provenance — see Transaction.is_garage / area_basis.
  is_garage?: boolean | null;
  area_basis?: "unit" | "building" | null;
  // ── Provenance signals + raw deed fields — see Transaction for semantics. ──
  parcel_count?: number | null;
  area_is_ha_converted?: boolean | null;
  property_type_inferred?: boolean | null;
  property_type_reclassed?: boolean | null;
  ownership_type?: number | null;
  ownership_share?: string | null;
  seller_type?: number | null;
  buyer_type?: number | null;
  land_use?: string | null;
  unit_price?: number | string | null;
  vat?: number | string | null;
  // Building attrs — see Transaction. Carried on /spatial since the fix that added them
  // to the GeoJSON properties; gate on building_count first.
  building_count?: number | null;
  footprint_area_m2?: number | null;
  est_total_area_m2?: number | null;
  building_storeys?: number | null;
}

export interface SpatialFeature {
  type: "Feature";
  geometry: { type: string; coordinates: [number, number] } | null;
  properties: SpatialFeatureProperties;
}

export interface SpatialSearchResponse {
  type: "FeatureCollection";
  features: SpatialFeature[];
  truncated: boolean;
  total: number;
}

export function searchByPolygon(
  p: SpatialSearchParams,
  apiKey?: string,
): Promise<ApiResponse<SpatialSearchResponse>> {
  const body: Record<string, unknown> = { polygon: p.polygon };
  if (p.propertyType != null) body.propertyType = p.propertyType;
  if (p.marketType != null) body.marketType = p.marketType;
  if (p.unitFunction != null) body.unitFunction = p.unitFunction;
  if (p.buildingType != null) body.buildingType = p.buildingType;
  if (p.ownershipType != null) body.ownershipType = p.ownershipType;
  if (p.mpzpDesignation) body.mpzpDesignation = p.mpzpDesignation;
  if (p.minPrice != null) body.minPrice = p.minPrice;
  if (p.maxPrice != null) body.maxPrice = p.maxPrice;
  if (p.dateFrom) body.dateFrom = p.dateFrom;
  if (p.dateTo) body.dateTo = p.dateTo;
  if (p.minArea != null) body.minArea = p.minArea;
  if (p.maxArea != null) body.maxArea = p.maxArea;
  if (p.district) body.district = p.district;
  if (p.street) body.street = p.street;
  if (p.transactionType) body.transactionType = p.transactionType;
  if (p.rooms) body.rooms = p.rooms;
  if (p.floor) body.floor = p.floor;
  if (p.limit != null) body.limit = p.limit;
  return fetchApiPost("/api/v1/transactions/spatial", body, apiKey);
}

// ── Compare locations ──────────────────────────────────────────────

// One demographics indicator on a compare entry (?include=demographics). Curated top-10 + a few
// cross-source derived metrics. Present only when enrichment was requested AND the district resolved
// to a county — REST omits the whole `demographics` key for unresolved districts.
export interface CompareDemographicsIndicator {
  value: number | null;
  year: number | null;
  unit: string;
  derived?: boolean;
  cross_source?: boolean;
  note?: string;
}

export interface CompareEntry {
  median_price_m2: number | null;
  avg_area: number | null;
  min_date: string | null;
  max_date: string | null;
  total: number;
  suggestions?: string[];
  demographics?: Record<string, CompareDemographicsIndicator>;
}

export type CompareResponse = Record<string, CompareEntry>;

export interface CompareParams {
  districts: string;
  propertyType?: number;
  marketType?: number;
  unitFunction?: number | string; // string carries the "unknown"=NULL sentinel (mapUnitFunction)
  buildingType?: number | string; // string carries the "unknown"=NULL sentinel (mapBuildingType)
  ownershipType?: number | string; // CSV of registry codes (mapOwnershipTypes; "unknown"=NULL sentinel)
  mpzpDesignation?: string;
  minPrice?: number;
  maxPrice?: number;
  dateFrom?: string;
  dateTo?: string;
  minArea?: number;
  maxArea?: number;
  street?: string;
  transactionType?: string;
  rooms?: string;
  floor?: string;
  // Enrichment layers — comma-separated on the wire, per the API's list-param convention.
  include?: string;
}

export function compareLocations(
  p: CompareParams,
  apiKey?: string,
): Promise<ApiResponse<CompareResponse>> {
  return fetchApi("/api/v1/transactions/summary/compare", toQueryParams({
    districts: p.districts,
    include: p.include,
    propertyType: p.propertyType,
    marketType: p.marketType,
    unitFunction: p.unitFunction,
    ownershipType: p.ownershipType,
    buildingType: p.buildingType,
    mpzpDesignation: p.mpzpDesignation,
    transactionType: p.transactionType,
    rooms: p.rooms,
    floor: p.floor,
    minPrice: p.minPrice,
    maxPrice: p.maxPrice,
    dateFrom: p.dateFrom,
    dateTo: p.dateTo,
    minArea: p.minArea,
    maxArea: p.maxArea,
    street: p.street,
  }), apiKey);
}

// ── Building breakdown (per-transaction, per-building) ──────────────

// One building linked to a transaction. Mirrors the /api/transactions/:id/buildings row contract.
// NUMERIC columns arrive as strings over the wire (Intl.format coerces). Field names are neutral —
// no source register is named. footprint_area_alt_m2 / footprint_divergent are NULL unless a
// second independent footprint measurement exists; est_total_area_m2 is NULL without footprint+storeys.
export interface BuildingBreakdownRow {
  building_type: number | null;
  footprint_area_m2: number | null;
  footprint_area_alt_m2: number | null;
  footprint_divergent: boolean | null;
  storeys: number | null;
  est_total_area_m2: number | null;
  match_confidence: string | null;
}

export interface BuildingBreakdownResponse {
  data: BuildingBreakdownRow[];
  truncated: boolean;
}

// No encodeURIComponent: the tool layer validates transactionId as a UUID (zod regex) before this
// runs, so it is always [0-9a-f-] — the other path-param wrappers here don't escape either.
export function getBuildingBreakdown(
  transactionId: string,
  apiKey?: string,
): Promise<ApiResponse<BuildingBreakdownResponse>> {
  return fetchApi(`/api/v1/transactions/${transactionId}/buildings`, undefined, apiKey);
}

// ── Flood-zone breakdown (per-transaction, per-parcel) ──────────────

// One flood scenario carried inside a parcel row's `scenarios` array. Bounded: the hazard model has only a
// handful of scenario types (river/coastal at a few return periods, plus defence-failure variants).
// depthClass is always null: the hazard data carries no depth detail.
export interface FloodScenario {
  scenario: string | null;
  source: string | null;
  returnPeriod: number | null;
  severity: number;
  isLeveeFailure: boolean;
  depthClass: string | null;
}

// One linked parcel that sits in a mapped flood-hazard zone. Mirrors the /api/transactions/:id/flood row
// contract. TWO-STATE: a row exists ONLY for an in-zone parcel — absence of rows is never asserted as
// "safe". pct_in_zone is NUMERIC → string over the wire (formatters coerce). nearest_zone_m is a constant
// 0 placeholder — every row already intersects a zone, so there is no distance to report. depth_class is null.
export interface FloodBreakdownRow {
  flood_risk: "high" | "medium" | "low" | null;
  severity_rank: number | null;
  worst_scenario: string | null;
  source: string | null;
  depth_class: string | null;
  pct_in_zone: number | string | null;
  nearest_zone_m: number | null;
  scenarios: FloodScenario[] | null;
}

export interface FloodBreakdownResponse {
  data: FloodBreakdownRow[];
  truncated: boolean;
}

// No encodeURIComponent: the tool layer validates transactionId as a UUID (zod regex) before this runs,
// so it is always [0-9a-f-] — the sibling path-param wrappers here don't escape either.
export function getTransactionFlood(
  transactionId: string,
  apiKey?: string,
): Promise<ApiResponse<FloodBreakdownResponse>> {
  return fetchApi(`/api/v1/transactions/${transactionId}/flood`, undefined, apiKey);
}

// ── Heritage-listing breakdown (per-transaction, per-parcel) ────────

// One heritage entry carried inside a parcel row's `sites` array (capped server-side). Neutral EN
// labels mapped server-side; category is a bounded vocabulary (building, urban_layout, surroundings,
// cemetery, park, ensemble, landscape, other) — typed open (string) for forward compatibility, with
// 'other' as the server's fallback. name may be absent (field-level gating server-side).
export interface HeritageSite {
  category: string;
  name?: string | null;
  function: string | null;
  period: string | null;
  entry_date: string | null;
}

// One linked parcel with a detected heritage listing. Mirrors the /api/transactions/:id/heritage row
// contract. TWO-STATE: a row exists ONLY when a listing was detected — absence of rows is never
// asserted as "not listed". pct_in_zone is NUMERIC → string over the wire (formatters coerce); it is
// null when only point/line-located entries matched (no areal geometry to measure coverage against).
export interface HeritageBreakdownRow {
  heritage_status: "listed" | "zone" | null;
  severity_rank: number | null;
  pct_in_zone: number | string | null;
  site_count: number | null;
  sites: HeritageSite[] | null;
}

export interface HeritageBreakdownResponse {
  data: HeritageBreakdownRow[];
  truncated: boolean;
}

// ── Landslide-zone breakdown (per-transaction, per-parcel) ──────────

// One mapped hazard record carried inside a parcel row's `zones` array. Bounded: only two kinds exist
// and records are deduplicated per (kind, source_version_date), so the array stays a handful of compact
// entries. source_version_date = the source-record VERSION date, NOT a survey/observation date.
export interface LandslideZone {
  kind: string | null;
  source_version_date: string | null;
}

// One linked parcel that intersects a mapped landslide-hazard zone (official 1:10,000-scale maps).
// Mirrors the /api/transactions/:id/landslide row contract. TWO-STATE: a row exists ONLY for an
// in-zone parcel — absence of rows is never asserted as "safe". pct_in_zone is NUMERIC → string over
// the wire (formatters coerce).
export interface LandslideBreakdownRow {
  landslide_risk: "landslide" | "threatened" | null;
  severity_rank: number | null;
  pct_in_zone: number | string | null;
  zones: LandslideZone[] | null;
}

export interface LandslideBreakdownResponse {
  data: LandslideBreakdownRow[];
  truncated: boolean;
}

// ── Public-transport access breakdown (per-transaction, per-parcel) ─

// One linked parcel's nearest-stop distance + name per mode. Mirrors the /api/transactions/:id/transit row
// contract. TWO-STATE: a row exists ONLY when at least one mode is within its cap — a null column means no
// stop of that mode within the cap, NOT "no transit access" (open feeds don't cover every rural gmina).
export interface TransitBreakdownRow {
  rail_distance_m: number | null;
  rail_stop_name: string | null;
  metro_distance_m: number | null;
  metro_stop_name: string | null;
  tram_distance_m: number | null;
  tram_stop_name: string | null;
  bus_distance_m: number | null;
  bus_stop_name: string | null;
}

export interface TransitBreakdownResponse {
  data: TransitBreakdownRow[];
  truncated: boolean;
}

// ── Building-permit breakdown (per-transaction, per-parcel) ──────────

// One positively-resolved case (permit or notification) registered against one of the
// transaction's parcels. Mirrors the /api/transactions/:id/permits row contract. TWO-STATE:
// a row exists ONLY for a registered case — an empty list is never asserted as "nothing was
// ever planned". The response carries NO parcel identity and NO source-registry number by
// design (identity-stripped). record_kind: permit = building-permit decision, notification = works
// notification. intent_type / works_type / status are neutral English codes (unknown source
// values map to "other"); object_category is the statutory Roman-numeral class; authority /
// address / volume are administrative facts. Dates are YYYY-MM-DD strings; notifications have
// no decision_date.
export interface PermitRecord {
  record_kind: "permit" | "notification";
  intent_type: string | null;
  object_category: string | null;
  works_type: string | null;
  status: string | null;
  decision_date: string | null;
  intake_date: string | null;
  authority: string | null;
  address_street: string | null;
  address_number: string | null;
  address_city: string | null;
  volume_m3: number | null;
}

export interface PermitsResponse {
  data: PermitRecord[];
  truncated: boolean;
  // Two-state disclaimer, shipped on every response (including empty).
  note?: string;
}

// No encodeURIComponent: the tool layer validates transactionId as a UUID (zod regex) before this runs,
// so it is always [0-9a-f-] — the sibling path-param wrappers here don't escape either.
export function getTransactionHeritage(
  transactionId: string,
  apiKey?: string,
): Promise<ApiResponse<HeritageBreakdownResponse>> {
  return fetchApi(`/api/v1/transactions/${transactionId}/heritage`, undefined, apiKey);
}

// No encodeURIComponent: transactionId is zod-validated as a UUID at the tool layer (see above).
export function getTransactionLandslide(
  transactionId: string,
  apiKey?: string,
): Promise<ApiResponse<LandslideBreakdownResponse>> {
  return fetchApi(`/api/v1/transactions/${transactionId}/landslide`, undefined, apiKey);
}

// ── Surroundings (per-transaction, per-parcel nuisance distances) ───

// One linked plot with the distance (meters, from the plot boundary) to the nearest object of each
// nuisance category. TWO-STATE: a null distance = no such object within that category's search radius
// in the reference data — NEVER asserted as "none exists". assessed=false = the plot has not been
// evaluated yet (all distances null then). Distances may arrive as strings over the wire
// (formatters coerce), mirroring the flood row contract.
export interface SurroundingsRow {
  assessed: boolean;
  cemetery_distance_m: number | string | null;
  landfill_distance_m: number | string | null;
  sewage_treatment_distance_m: number | string | null;
  industrial_area_distance_m: number | string | null;
  industrial_plant_distance_m: number | string | null;
  livestock_farm_distance_m: number | string | null;
}

export interface SurroundingsResponse {
  data: SurroundingsRow[];
  truncated?: boolean;
}

// No encodeURIComponent: transactionId is zod-validated as a UUID at the tool layer (see above).
export function getTransactionSurroundings(
  transactionId: string,
  apiKey?: string,
): Promise<ApiResponse<SurroundingsResponse>> {
  return fetchApi(`/api/v1/transactions/${transactionId}/surroundings`, undefined, apiKey);
}

// No encodeURIComponent: transactionId is zod-validated as a UUID at the tool layer (see above).
export function getTransactionTransit(
  transactionId: string,
  apiKey?: string,
): Promise<ApiResponse<TransitBreakdownResponse>> {
  return fetchApi(`/api/v1/transactions/${transactionId}/transit`, undefined, apiKey);
}

// No encodeURIComponent: transactionId is zod-validated as a UUID at the tool layer (see above).
export function getTransactionPermits(
  transactionId: string,
  apiKey?: string,
): Promise<ApiResponse<PermitsResponse>> {
  return fetchApi(`/api/v1/transactions/${transactionId}/permits`, undefined, apiKey);
}

// ── General-plan (POG) planning-zone breakdown (per-transaction) ────

// One planning-zone or overlay row for a transaction's land. kind = 'zone' (a base planning zone,
// carrying a symbol + name + building parameters) or an overlay area ('infill_area' = an infill
// development area / obszar uzupełnienia zabudowy, 'downtown_area' = a central-development area);
// overlays carry a coverage share only, no symbol/parameters. pct_of_parcel and the four building
// parameters are numeric but may arrive as strings over the wire (formatters coerce). params_mixed =
// this row merges sub-zones of one symbol whose building parameters were not all in agreement, so an
// ambiguous parameter is reported as null rather than guessed. parcel_ord is an opaque 1..N ordinal
// grouping the rows of one land parcel (no cadastral identity): a transaction spanning several parcels
// repeats a zone symbol once per parcel, and parcel_ord is what tells those repetitions apart.
export interface PlanningRow {
  parcel_ord: number;
  kind: string;
  zone_symbol: string | null;
  zone_name: string | null;
  pct_of_parcel: number | string | null;
  max_building_height_m: number | string | null;
  max_development_intensity: number | string | null;
  max_built_up_coverage_pct: number | string | null;
  min_bio_active_area_pct: number | string | null;
  params_mixed: boolean;
  effective_from: string | null;
}

// Response of /api/transactions/:id/planning. THREE-STATE coverage (NOT the two-state hazard pattern):
//   'covered'         — planning-zone data was returned for the transaction's land (data non-empty)
//   'covered_no_data' — the municipality has an adopted general plan, but no zone data covers these
//                       parcels in our sources yet (data empty, but the municipality is mapped)
//   'not_covered'     — no published general-plan data for this municipality yet (data empty)
// 'not_covered' is NEVER a claim that the municipality has no plan — coverage grows as plans are
// adopted and published nationwide. parcels_total / parcels_covered are the coverage counters.
export interface PlanningResponse {
  data: PlanningRow[];
  truncated: boolean;
  coverage: "covered" | "covered_no_data" | "not_covered";
  parcels_total: number;
  parcels_covered: number;
  note: string | null;
}

// No encodeURIComponent: transactionId is zod-validated as a UUID at the tool layer (see above).
export function getTransactionPlanning(
  transactionId: string,
  apiKey?: string,
): Promise<ApiResponse<PlanningResponse>> {
  return fetchApi(`/api/v1/transactions/${transactionId}/planning`, undefined, apiKey);
}

// ── Farmland (agricultural land-eligibility) breakdown (per-transaction, per-parcel) ──

// One linked parcel matched against official nationwide agricultural land-eligibility data (updated
// weekly). eligible_area_m2 = the eligible agricultural area matched onto the parcel; feature_count = how
// many source features compose it; pct_of_parcel = that area as a share of the parcel's measured area
// (integer 0–100), or null when the parcel's measured area is unavailable. TWO-STATE: a row exists ONLY
// for a parcel with a positive matched area — absence of a row is never asserted as "not agricultural".
export interface FarmlandRow {
  eligible_area_m2: number;
  pct_of_parcel: number | null;
  feature_count: number;
}

// Response envelope. Diverges from the sibling {data,truncated} shape on purpose: the coverage counters
// and freshness date carry signal this layer needs. parcels_total = linked parcels; parcels_with_data =
// linked parcels with a matched eligible area; as_of = the source snapshot date (YYYY-MM-DD), null when
// there are no rows.
export interface FarmlandResponse {
  data: FarmlandRow[];
  truncated: boolean;
  parcels_total: number;
  parcels_with_data: number;
  as_of: string | null;
}

// No encodeURIComponent: transactionId is zod-validated as a UUID at the tool layer (see above).
export function getTransactionFarmland(
  transactionId: string,
  apiKey?: string,
): Promise<ApiResponse<FarmlandResponse>> {
  return fetchApi(`/api/v1/transactions/${transactionId}/farmland`, undefined, apiKey);
}
