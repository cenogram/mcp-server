import { getClientId } from "./client-id.js";

const BASE_URL = process.env.CENOGRAM_API_URL || "https://cenogram.pl";

// ── Types (adapted from explorer/src/types.ts) ─────────────────────

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
  building_number: string | null;
  city: string | null;
  parcel_area: number | null;
  unit_function: number | null;
  parcel_id: string | null;
  county_name: string | null;
  voivodeship_name: string | null;
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

// ── Shared HTTP helpers ────────────────────────────────────────────

function buildHeaders(apiKey?: string): Record<string, string> {
  const headers: Record<string, string> = {
    "X-Source": "mcp-server",
    "X-Cenogram-Client-Id": getClientId(),
  };
  const key = apiKey ?? process.env.CENOGRAM_API_KEY;
  if (key) headers["Authorization"] = `Bearer ${key}`;
  return headers;
}

async function handleErrorResponse(res: Response): Promise<never> {
  if (res.status === 402) {
    const body = await res.json().catch(() => ({})) as { currentBalance?: number; creditsRequired?: number };
    throw new Error(
      `Niewystarczające tokeny API. Saldo: ${body.currentBalance ?? 0}, wymagane: ${body.creditsRequired ?? "?"}. Doładuj: https://cenogram.pl/api#cennik`,
    );
  }
  if (res.status === 429) {
    const retryAfter = res.headers?.get?.("Retry-After");
    const days = retryAfter ? Math.ceil(parseInt(retryAfter, 10) / 86400) : null;
    const resetInfo = days !== null ? ` Reset za ${days} ${days === 1 ? "dzień" : "dni"}.` : "";
    throw new Error(`Zbyt wiele zapytań.${resetInfo}`);
  }
  throw new Error(`API error: HTTP ${res.status}`);
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
    if (!res.ok) await handleErrorResponse(res);
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
    if (!res.ok) await handleErrorResponse(res);
    return { data: (await res.json()) as T, creditInfo: extractCreditInfo(res) };
  } finally {
    clearTimeout(timeout);
  }
}

// ── Typed wrappers ──────────────────────────────────────────────────

export function getStats(apiKey?: string): Promise<ApiResponse<StatsResponse>> {
  return fetchApi("/api/stats", undefined, apiKey);
}

export interface TransactionParams {
  district?: string;
  street?: string;
  buildingNumber?: string;
  parcelId?: string;
  propertyType?: number;
  marketType?: number;
  minPrice?: number;
  maxPrice?: number;
  dateFrom?: string;
  dateTo?: string;
  minArea?: number;
  maxArea?: number;
  bbox?: string;
  limit?: number;
  page?: number;
  sort?: string;
  order?: string;
}

export function getTransactions(p: TransactionParams, apiKey?: string): Promise<ApiResponse<TransactionsResponse>> {
  return fetchApi("/api/transactions", toQueryParams({
    district: p.district,
    street: p.street,
    buildingNumber: p.buildingNumber,
    parcelId: p.parcelId,
    propertyType: p.propertyType,
    marketType: p.marketType,
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
  return fetchApi("/api/transactions/summary", toQueryParams({
    district: p.district,
    street: p.street,
    propertyType: p.propertyType,
    marketType: p.marketType,
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
  return fetchApi("/api/price-per-m2", undefined, apiKey);
}

export function getDistricts(apiKey?: string): Promise<ApiResponse<string[]>> {
  return fetchApi("/api/districts", undefined, apiKey);
}

export function getPriceHistogram(
  bins = 20,
  max = 3_000_000,
  apiKey?: string,
): Promise<ApiResponse<HistogramBin[]>> {
  return fetchApi("/api/stats/price-histogram", toQueryParams({ bins, max }), apiKey);
}

// ── Parcel search ──────────────────────────────────────────────────

export interface ParcelSearchResult {
  parcel_id: string;
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
  return fetchApi("/api/parcels/search", toQueryParams({ q, limit }), apiKey);
}

// ── Spatial search (polygon) ───────────────────────────────────────

export interface SpatialSearchParams {
  polygon: { type: "Polygon"; coordinates: number[][][] };
  propertyType?: number;
  marketType?: number;
  minPrice?: number;
  maxPrice?: number;
  dateFrom?: string;
  dateTo?: string;
  minArea?: number;
  maxArea?: number;
  district?: string;
  street?: string;
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
  building_number: string | null;
  city: string | null;
  district: string | null;
  parcel_area: number | null;
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
  if (p.minPrice != null) body.minPrice = p.minPrice;
  if (p.maxPrice != null) body.maxPrice = p.maxPrice;
  if (p.dateFrom) body.dateFrom = p.dateFrom;
  if (p.dateTo) body.dateTo = p.dateTo;
  if (p.minArea != null) body.minArea = p.minArea;
  if (p.maxArea != null) body.maxArea = p.maxArea;
  if (p.district) body.district = p.district;
  if (p.street) body.street = p.street;
  if (p.limit != null) body.limit = p.limit;
  return fetchApiPost("/api/transactions/spatial", body, apiKey);
}

// ── Compare locations ──────────────────────────────────────────────

export interface CompareEntry {
  median_price_m2: number | null;
  avg_area: number | null;
  min_date: string | null;
  max_date: string | null;
  total: number;
  suggestions?: string[];
}

export type CompareResponse = Record<string, CompareEntry>;

export interface CompareParams {
  districts: string;
  propertyType?: number;
  marketType?: number;
  minPrice?: number;
  maxPrice?: number;
  dateFrom?: string;
  dateTo?: string;
  minArea?: number;
  maxArea?: number;
  street?: string;
}

export function compareLocations(
  p: CompareParams,
  apiKey?: string,
): Promise<ApiResponse<CompareResponse>> {
  return fetchApi("/api/transactions/summary/compare", toQueryParams({
    districts: p.districts,
    propertyType: p.propertyType,
    marketType: p.marketType,
    minPrice: p.minPrice,
    maxPrice: p.maxPrice,
    dateFrom: p.dateFrom,
    dateTo: p.dateTo,
    minArea: p.minArea,
    maxArea: p.maxArea,
    street: p.street,
  }), apiKey);
}
