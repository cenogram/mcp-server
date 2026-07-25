import type { Transaction, TransactionsResponse, TransactionsSummary, StatsResponse, PricePerM2Row, HistogramBin, ParcelSearchResponse, ParcelResolveResponse, SpatialSearchResponse, SpatialFeature, CompareResponse, LocationItem, RentalYieldResponse, RentalYieldLocationsResponse, PriceSpreadResponse, PriceSpreadLocationsResponse, ValuationResponse, ValuationComparable, Percentiles, TxWindow, BuildingBreakdownResponse, FloodBreakdownResponse, HeritageBreakdownResponse, LandslideBreakdownResponse, SurroundingsResponse, SurroundingsRow, TransitBreakdownResponse, PermitsResponse, PlanningResponse, PlanningRow, FarmlandResponse, DemographicsResponse, DemographicsIndicator, InfrastructureSignalsResponse, ParcelReportResponse, ReportSection, ReportMarketContext, ReportMarketLevel, ReportLocationContext } from "./api-client.js";
import { PROPERTY_TYPES, MARKET_TYPES, BUILDING_TYPES, OWNERSHIP_TYPES, PARTY_TYPES, LAND_USES } from "./mappings.js";

// Cross-link shown once on a transaction list when ≥1 row carries building data — tells the LLM the
// transaction id can be expanded into a per-building split via the dedicated tool.
const BUILDING_BREAKDOWN_TIP =
  "Tip: call get_building_breakdown(transaction_id) for per-building detail (footprint, storeys, est. area).";

// Cross-link shown once on a transaction list when ≥1 row has a mapped flood risk.
const FLOOD_BREAKDOWN_TIP =
  "Tip: call get_transaction_flood(transaction_id) for the per-parcel flood-zone breakdown (scenario, hazard source, share in zone).";

// Flood-hazard category → return-period note. high = most frequent flood, low = rarest.
// Used both inline (search list) and in the per-parcel breakdown. Neutral wording — never asserts safety.
const FLOOD_RISK_NOTE: Record<string, string> = {
  high: "~1-in-10-year",
  medium: "~1-in-100-year",
  low: "~1-in-500-year",
};

// Cross-link shown once on a transaction list when ≥1 row has a detected heritage listing.
const HERITAGE_BREAKDOWN_TIP =
  "Tip: call get_transaction_heritage(transaction_id) for the per-parcel heritage-listing breakdown (entries, category, share in protected area).";

// Heritage status → short meaning note. listed = a protected monument on/at the parcel itself;
// zone = the parcel lies within a protected urban layout or the designated surroundings of a monument.
// Used both inline (search list) and in the per-parcel breakdown. Neutral wording — never asserts
// that a property without a detected listing is free of heritage protection.
const HERITAGE_STATUS_NOTE: Record<string, string> = {
  listed: "protected monument on/at the parcel",
  zone: "within a protected urban layout or monument surroundings",
};

// Indicative-data disclaimer rendered with heritage output. Neutral — no source register is named.
const HERITAGE_DISCLAIMER =
  "Indicative data — the regional heritage conservator makes the final, binding determination.";

// Cross-link shown once on a transaction list when ≥1 row has a mapped landslide risk.
const LANDSLIDE_BREAKDOWN_TIP =
  "Tip: call get_transaction_landslide(transaction_id) for the per-parcel landslide-zone breakdown (category, share in zone, source-record version date).";

// Landslide-hazard category → readable meaning, from official landslide-hazard maps (1:10,000 scale).
// Used both inline (search list) and in the per-parcel breakdown. Neutral wording — never asserts
// safety; an intersection means the parcel overlaps a mapped hazard area, not that the parcel itself
// is a landslide.
const LANDSLIDE_RISK_NOTE: Record<string, string> = {
  landslide: "a mapped landslide area",
  threatened: "an area threatened by mass movements",
};

// Area-bucket suffix for headers ("(40-50 m2)"); empty for 'all'/missing.
function areaBucketSuffix(bucket: string | null | undefined): string {
  return bucket && bucket !== "all" ? ` (${bucket} m2)` : "";
}

// Trailing transaction window as a readable suffix, or "" when either bound is missing.
function windowSuffix(w: TxWindow): string {
  return w.from && w.to ? ` (${w.from} to ${w.to})` : "";
}

// Active-offer snapshot as a readable suffix (a point in time, not a window), or "" when missing.
function offerDateSuffix(date: string | null): string {
  return date ? ` (as of ${date})` : "";
}

// One-line percentile ladder, or null when the side has no data (suppressed/missing).
function formatPercentileLadder(p: Percentiles): string | null {
  if ([p.p10, p.p25, p.p50, p.p75, p.p90].every((v) => v == null)) return null;
  const f = (v: number | null) => (v == null ? "—" : formatPLN(v));
  return `p10 ${f(p.p10)} · p25 ${f(p.p25)} · p50 ${f(p.p50)} · p75 ${f(p.p75)} · p90 ${f(p.p90)} /m2`;
}

// Distribution block lines (empty array when neither side has data). Each endpoint passes its own
// asking-side ladder (rent-monthly for yield, sale for spread) + the shared transaction ladder.
function distributionLines(asking: Percentiles, tx: Percentiles): string[] {
  const ask = formatPercentileLadder(asking);
  const txLadder = formatPercentileLadder(tx);
  if (!ask && !txLadder) return [];
  const out = ["", "Distribution (price per m2):"];
  if (ask) out.push(`  Asking: ${ask}`);
  if (txLadder) out.push(`  Transaction: ${txLadder}`);
  return out;
}

// Market-price methodology caveat. Median/avg price aggregates exclude
// fractional ownership shares and non-market deeds; transaction counts/coverage stay full.
// Reused in tool descriptions (tools.ts) and rendered into price-tool output.
export const MARKET_CAVEAT =
  "Note: median/average prices are market-based — fractional ownership shares and non-market deeds (public tenders, foreclosures, privileged/subsidized sales) are excluded from price aggregates. Transaction counts and coverage stay complete.";

// ── Primitives ──────────────────────────────────────────────────────

export function formatPLN(value: number | null | undefined): string {
  if (value == null) return "N/A";
  return new Intl.NumberFormat("pl-PL", {
    style: "currency",
    currency: "PLN",
    maximumFractionDigits: 0,
  }).format(value);
}

export function formatArea(m2: number | null | undefined): string {
  if (m2 == null) return "N/A";
  if (m2 === 0) return "0 m\u00B2";
  return `${new Intl.NumberFormat("pl-PL", { maximumFractionDigits: 1 }).format(m2)} m\u00B2`;
}

export function formatNumber(value: number | null | undefined): string {
  if (value == null) return "N/A";
  return new Intl.NumberFormat("pl-PL").format(value);
}

// Like formatPLN but keeps up to 2 decimals - for small per-m² values (e.g. monthly rent
// ~60-80 PLN) where rounding to whole złoty would make a displayed "× 12" not add up.
function formatPLNExact(value: number | null | undefined): string {
  if (value == null) return "N/A";
  return new Intl.NumberFormat("pl-PL", {
    style: "currency",
    currency: "PLN",
    maximumFractionDigits: 2,
  }).format(value);
}

// ── Shared transaction formatting ──────────────────────────────────

interface FormattableFields {
  // Transaction id (UUID). Surfaced for EVERY transaction: the model uses it both to
  // call get_building_breakdown(id) and to build a cenogram.pl deep link (#...&tx=<id>). Kept
  // optional so callers that don't pass it stay unaffected.
  id?: string;
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
  // Provenance of `street`: 'rcn' = from the notarial deed/registry;
  // 'approx_high'/'approx_low' = approximated by us (not from the deed); 'none' = no street.
  // Surfaced so the model never presents an approximated street as registry-sourced.
  address_source?: "rcn" | "approx_high" | "approx_low" | "none" | null;
  building_number: string | null;
  city: string | null;
  parcel_area: number | null;
  parcel_number?: string | null;
  county_name?: string | null;
  voivodeship_name?: string | null;
  share_basis?: "full" | "fraction" | "ambiguous" | null;
  // Provenance signals + raw deed fields. Signals drive computed-markers on
  // parcel_area / property_type; raw fields render (gated) in the extra block. See api-client Transaction.
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
  // Garage provenance. is_garage = the unit is a garage/parking space (opt-in via
  // unitFunction=garage). area_basis describes what usable_area_m2 measures for a garage:
  // 'unit' = a plausible single parking-spot area (price/m² is computed); 'building' = the whole
  // garage-building footprint (the source records the whole building, not the spot) → price/m² is omitted.
  is_garage?: boolean | null;
  area_basis?: "unit" | "building" | null;
  // Building attrs. Neutral names (no source register). Gate on building_count first
  // (NULL = no buildings, not 0). Footprint/est are NUMERIC → string over the wire (formatArea coerces).
  building_count?: number | null;
  footprint_area_m2?: number | null;
  est_total_area_m2?: number | null;
  building_storeys?: number | null;
  // Flood-hazard. TWO-STATE: a category is set ONLY when a linked parcel sits in a mapped
  // flood-hazard zone; null/absent is never rendered as "safe". flood_assessed is plumbing, not surfaced.
  flood_risk?: "high" | "medium" | "low" | null;
  // Heritage listing. TWO-STATE: a status is set ONLY when a listing was detected on/around a linked
  // parcel; null/absent is never rendered as "not listed". heritage_assessed is plumbing, not surfaced.
  heritage_status?: "listed" | "zone" | null;
  // Landslide-hazard. TWO-STATE: a category is set ONLY when a linked parcel intersects a mapped
  // landslide-hazard zone (official 1:10,000-scale maps); null/absent is never rendered as "safe".
  // landslide_assessed is plumbing, not surfaced.
  landslide_risk?: "landslide" | "threatened" | null;
  coordinates?: [number, number] | null;
}

function formatTransactionCore(f: FormattableFields): string {
  const parts: string[] = [];

  // Address with optional county/voivodeship
  const streetAddr = [f.street, f.building_number].filter(Boolean).join(" ");
  const district = f.district || f.city;
  const region = [f.county_name ? `county: ${f.county_name}` : null, f.voivodeship_name ? `voivodeship: ${f.voivodeship_name}` : null].filter(Boolean).join(", ");
  const loc = f.street
    ? [streetAddr, district].filter(Boolean).join(", ")
    : [district, f.building_number].filter(Boolean).join(" ");
  // Street derived by us (not from the deed) → neutral marker so the model doesn't quote it as
  // registry-sourced. Shown only when a street is actually present (street = rcn ?? derived).
  const streetApprox = f.street != null && (f.address_source === "approx_high" || f.address_source === "approx_low");
  const approxTag = streetApprox ? " [street approximate — derived, not from deed]" : "";
  if (loc && region) parts.push(`${loc} (${region})${approxTag}`);
  else if (loc) parts.push(`${loc}${approxTag}`);

  // Metadata line
  const meta: string[] = [];
  meta.push(`Date: ${f.transaction_date}`);
  // Property type is raw (from the registry) unless we derived/corrected it → neutral
  // marker so the model doesn't quote a computed type as the registry's literal classification.
  // 'reclassed' is the more specific case (registry recorded land, the deed is a residential unit).
  let typeLabel = PROPERTY_TYPES[f.property_type] || `Type ${f.property_type}`;
  if (f.property_type_reclassed) typeLabel += " [shown as a unit — registry recorded land, the deed is a residential unit]";
  else if (f.property_type_inferred) typeLabel += " [type inferred from transaction structure — not stated in the registry]";
  meta.push(typeLabel);
  meta.push(MARKET_TYPES[f.market_type] || `Market ${f.market_type}`);
  parts.push(meta.join(" | "));

  // Price line
  const price: string[] = [];
  price.push(`Price: ${formatPLN(f.price_gross)}`);
  if (f.usable_area_m2 != null) {
    // A building-basis garage area is the whole garage building, not the parking spot \u2014
    // flag it so the model never reports it as the unit's area or back-computes a price/m\u00B2.
    const areaNote = f.area_basis === "building" ? " [whole garage building, not the parking space]" : "";
    price.push(`Area: ${formatArea(f.usable_area_m2)}${areaNote}`);
  }
  if (f.price_per_m2 != null) price.push(`Price/m\u00B2: ${formatPLN(f.price_per_m2)}`);
  if (f.parcel_area != null && f.usable_area_m2 == null) {
    // parcel_area is raw unless we computed it: summed across plots (parcel_count >= 2)
    // and/or converted from hectares the county reports in ha. Neutral marker(s), combined if both.
    const pNotes: string[] = [];
    if (f.parcel_count != null && f.parcel_count >= 2) pNotes.push(`sum of ${f.parcel_count} parcels`);
    if (f.area_is_ha_converted) pNotes.push("converted from hectares — county reports area in ha");
    const pTag = pNotes.length > 0 ? ` [${pNotes.join("; ")}]` : "";
    price.push(`Parcel: ${formatArea(f.parcel_area)}${pTag}`);
  }
  // Fractional-share flag: neutral signal that this price reflects a partial
  // ownership share (share \u2260 whole), so it is excluded from the market median. NOT "sale of a
  // share" \u2014 that would be false for some new-build co-ownership (1/10 of common areas).
  if (f.share_basis === "fraction") price.push("fractional share (excluded from market median)");
  parts.push(price.join(" | "));

  // Building attrs. Footprint + storeys + estimated total floor area, when present.
  // Gate on building_count FIRST (NULL = no buildings, not 0). Storeys is given only for
  // single-building transactions. Neutral wording — no source register named.
  if (f.building_count != null) {
    const bld: string[] = [];
    if (f.footprint_area_m2 != null) bld.push(`Building footprint: ${formatArea(f.footprint_area_m2)}`);
    if (f.building_storeys != null) bld.push(`Storeys: ${f.building_storeys}`);
    if (f.est_total_area_m2 != null) {
      bld.push(`Est. total floor area: ${formatArea(f.est_total_area_m2)} [estimate: footprint × storeys, not from deed]`);
    }
    if (bld.length > 0) parts.push(bld.join(" | "));
  }

  // Flood-hazard. TWO-STATE: surface a risk line ONLY when flood_risk is set (a linked parcel
  // sits in a mapped hazard zone). Absence → no line at all; we never render an affirmative "no flood
  // risk" (absence of a mapped zone is not evidence of safety). Detail via get_transaction_flood(id).
  if (f.flood_risk) {
    const note = FLOOD_RISK_NOTE[f.flood_risk];
    parts.push(`Flood risk: ${f.flood_risk}${note ? ` [mapped flood-hazard zone — ${note}]` : ""}`);
  }

  // Heritage listing. TWO-STATE: surface a heritage line ONLY when heritage_status is set (a listing
  // was detected on/around a linked parcel). Absence → no line at all; we never render an affirmative
  // "not listed" (absence of a detection is not evidence there is no listing). The status is a floor —
  // a listed property may also sit inside a protected zone. Detail via get_transaction_heritage(id).
  if (f.heritage_status) {
    const note = HERITAGE_STATUS_NOTE[f.heritage_status];
    parts.push(`Heritage listing: ${f.heritage_status}${note ? ` [${note}]` : ""}`);
  }
  // Landslide-hazard. TWO-STATE: surface a risk line ONLY when landslide_risk is set (a linked parcel
  // intersects a mapped hazard area on the official 1:10,000-scale maps). Absence → no line at all; we
  // never render an affirmative "no landslide risk" (absence of mapped data is not evidence of safety).
  // Detail via get_transaction_landslide(id).
  if (f.landslide_risk) {
    const note = LANDSLIDE_RISK_NOTE[f.landslide_risk];
    parts.push(`Landslide risk: ${f.landslide_risk}${note ? ` [${note} — parcel intersects a mapped hazard area, 1:10,000-scale maps]` : ""}`);
  }

  // Extra details
  const extra: string[] = [];
  if (f.parcel_number) extra.push(`Plot no: ${f.parcel_number}`);
  if (f.rooms != null) extra.push(`Rooms: ${f.rooms}`);
  if (f.floor != null) extra.push(`Floor: ${f.floor}`);
  // ── Raw deed fields — straight from the notarial deed, no provenance marker.
  // Gated to suppress noise/NULLs and mirror the web drawer.
  if (f.ownership_type != null) extra.push(`Ownership: ${OWNERSHIP_TYPES[f.ownership_type] || `Type ${f.ownership_type}`}`);
  // ownership_share adds the share magnitude over share_basis — only meaningful for fractional rows
  // (gate on share_basis, NOT on parsing "1/2"; a "1/1" full share would be noise).
  if (f.share_basis === "fraction" && f.ownership_share) extra.push(`Share: ${f.ownership_share}`);
  if (f.seller_type != null) extra.push(`Seller: ${PARTY_TYPES[f.seller_type] || `Party type ${f.seller_type}`}`);
  if (f.buyer_type != null) extra.push(`Buyer: ${PARTY_TYPES[f.buyer_type] || `Party type ${f.buyer_type}`}`);
  if (f.land_use) extra.push(`Land use: ${LAND_USES[f.land_use] || f.land_use}`);
  // unit_price = deed price of the unit alone (PLN, never per-m²). Show only for units, only when > 0
  // and different from the total price — otherwise it duplicates price_gross or misleads for land/buildings
  // (mirror the web drawer). NUMERIC arrives as string → coerce.
  if (f.property_type === 4 && f.unit_price != null && Number(f.unit_price) > 0 && Number(f.unit_price) !== Number(f.price_gross)) {
    extra.push(`Deed unit price (not per-m²): ${formatPLN(Number(f.unit_price))}`);
  }
  // vat = raw RCN field: may be a rate (%) OR an amount (zł), as recorded — no unit appended (the column
  // mixes both; guessing would mislead). NUMERIC → string. Omit when NULL/empty/non-numeric.
  if (f.vat != null && f.vat !== "") {
    const vatNum = Number(f.vat);
    if (Number.isFinite(vatNum)) extra.push(`VAT (as recorded — rate % or amount): ${formatNumber(vatNum)}`);
  }
  if (f.coordinates) {
    const [lng, lat] = f.coordinates;
    extra.push(`Location: ${lat?.toFixed(4)}\u00B0N, ${lng?.toFixed(4)}\u00B0E`);
  }
  // Transaction id, last: unconditional now \u2014 feeds get_building_breakdown(id) AND the
  // cenogram.pl deep link (#...&tx=<id>). Compact, after the human-readable fields.
  if (f.id) extra.push(`id: ${f.id}`);
  if (extra.length > 0) parts.push(extra.join(" | "));

  return parts.join("\n   ");
}

// ── Transaction formatting ──────────────────────────────────────────

export function formatTransaction(tx: Transaction): string {
  return formatTransactionCore({
    ...tx,
    coordinates: tx.centroid?.coordinates ?? null,
  });
}

export function formatTransactionList(
  res: TransactionsResponse,
  summary?: TransactionsSummary | null,
): string {
  const { data, pagination } = res;
  if (data.length === 0) {
    return "No transactions found matching the criteria.";
  }

  const lines: string[] = [];
  const totalStr = summary ? formatNumber(summary.total) : formatNumber(pagination.total);
  lines.push(`Found ${totalStr} transactions (showing ${data.length}):\n`);

  data.forEach((tx, i) => {
    lines.push(`${i + 1}. ${formatTransaction(tx)}`);
  });

  if (summary) {
    const parts: string[] = [];
    if (summary.median_price_m2 != null) parts.push(`Median price/m\u00B2: ${formatPLN(summary.median_price_m2)}`);
    if (summary.avg_area != null) parts.push(`Avg area: ${formatArea(summary.avg_area)}`);
    if (summary.min_date && summary.max_date) parts.push(`Date range: ${summary.min_date} \u2013 ${summary.max_date}`);
    if (parts.length > 0) lines.push(`\nSummary: ${parts.join(" | ")}`);
  }

  // Cross-link to get_building_breakdown when at least one row has buildings (id is surfaced inline).
  if (data.some((tx) => tx.building_count != null)) {
    lines.push(`\n${BUILDING_BREAKDOWN_TIP}`);
  }
  // Cross-link to get_transaction_flood when at least one row sits in a mapped flood zone.
  if (data.some((tx) => tx.flood_risk != null)) {
    lines.push(`\n${FLOOD_BREAKDOWN_TIP}`);
  }
  // Cross-link to get_transaction_heritage when at least one row has a detected heritage listing.
  if (data.some((tx) => tx.heritage_status != null)) {
    lines.push(`\n${HERITAGE_BREAKDOWN_TIP}`);
  }
  // Cross-link to get_transaction_landslide when at least one row intersects a mapped landslide zone.
  if (data.some((tx) => tx.landslide_risk != null)) {
    lines.push(`\n${LANDSLIDE_BREAKDOWN_TIP}`);
  }

  return lines.join("\n");
}

// ── Stats formatting ────────────────────────────────────────────────

export function formatMarketOverview(stats: StatsResponse): string {
  const lines: string[] = [];
  lines.push("Polish Real Estate Transaction Database \u2014 Cenogram.pl\n");
  lines.push(`Total transactions: ${formatNumber(stats.counts.transactions)}`);
  lines.push(`Data range: ${stats.dateRange.min_date} \u2013 ${stats.dateRange.max_date}\n`);

  lines.push("By property type:");
  for (const item of stats.byPropertyType) {
    const pct = stats.counts.transactions > 0
      ? ((item.total / stats.counts.transactions) * 100).toFixed(1)
      : "0";
    lines.push(`  - ${PROPERTY_TYPES[item.type] || item.label}: ${formatNumber(item.total)} (${pct}%)`);
  }

  lines.push("\nBy market type:");
  for (const item of stats.byMarketType) {
    const pct = stats.counts.transactions > 0
      ? ((item.total / stats.counts.transactions) * 100).toFixed(1)
      : "0";
    lines.push(`  - ${MARKET_TYPES[item.type] || item.label}: ${formatNumber(item.total)} (${pct}%)`);
  }

  lines.push(`\nPrice statistics:`);
  lines.push(`  Average: ${formatPLN(stats.prices.avg_price)} | Median: ${formatPLN(stats.prices.median_price)}`);

  if (stats.byDistrict.length > 0) {
    lines.push(`\nTop 10 locations by transaction count:`);
    const top = stats.byDistrict.slice(0, 10);
    top.forEach((d, i) => {
      lines.push(`  ${i + 1}. ${d.district} \u2014 ${formatNumber(d.transaction_count)} transactions`);
    });
  }

  lines.push(`\n${MARKET_CAVEAT}`);

  return lines.join("\n");
}

export function formatPriceStats(
  rows: PricePerM2Row[],
  location?: string,
): string {
  if (rows.length === 0) {
    return location
      ? `No price statistics found for "${location}". Note: this endpoint only covers residential units (apartments). Use list_locations to find valid location names.`
      : "No price statistics available.";
  }

  const header = location
    ? `Price statistics for "${location}" (residential units only):\n`
    : "Price statistics by location (residential units only):\n";

  const lines: string[] = [header];

  // Sort by median descending
  const sorted = [...rows].sort((a, b) => b.median_price_m2 - a.median_price_m2);
  const shown = sorted.slice(0, 30);

  lines.push("Location | Median PLN/m\u00B2 | Avg PLN/m\u00B2 | Transactions");
  lines.push("-".repeat(65));

  for (const r of shown) {
    lines.push(
      `${r.district} | ${formatPLN(r.median_price_m2)} | ${formatPLN(r.avg_price_m2)} | ${formatNumber(r.count)}`,
    );
  }

  if (sorted.length > 30) {
    lines.push(`\n...and ${sorted.length - 30} more locations.`);
  }

  lines.push(`\n${MARKET_CAVEAT}`);

  return lines.join("\n");
}

export function formatHistogram(bins: HistogramBin[]): string {
  if (bins.length === 0) return "No histogram data available.";

  const maxCount = Math.max(...bins.map((b) => b.count));
  const barWidth = 30;

  const lines: string[] = ["Price distribution (transaction count per price range):\n"];

  for (const bin of bins) {
    const bar = maxCount > 0
      ? "\u2588".repeat(Math.round((bin.count / maxCount) * barWidth))
      : "";
    lines.push(
      `${formatPLN(bin.range_min).padStart(15)} - ${formatPLN(bin.range_max).padEnd(15)} | ${bar} ${formatNumber(bin.count)}`,
    );
  }

  lines.push(`\n${MARKET_CAVEAT}`);

  return lines.join("\n");
}

// ── Parcel search formatting ───────────────────────────────────────

export function formatParcelResults(res: ParcelSearchResponse, query: string): string {
  if (res.results.length === 0) {
    return `No parcels found matching "${query}".`;
  }

  const lines: string[] = [`Found ${res.results.length} parcels matching "${query}":\n`];
  for (const [i, p] of res.results.entries()) {
    const district = p.district ?? "Unknown";
    const area = p.area_m2 != null ? formatArea(p.area_m2) : "N/A";
    const location = `${p.lat.toFixed(4)}\u00B0N, ${p.lng.toFixed(4)}\u00B0E`;
    // parcel_id is gated identity. MCP token callers always receive it; guard anyway so a
    // stripped response never renders the literal "undefined".
    lines.push(`${i + 1}. ${p.parcel_id ?? "(parcel number requires a paid plan)"}`);
    lines.push(`   District: ${district} | Area: ${area} | Location: ${location}`);
  }
  return lines.join("\n");
}

// ── Parcel resolve formatting ──────────────────────────────────────

export function formatParcelResolve(res: ParcelResolveResponse): string {
  if (res.coverage === "not_covered" || res.matches.length === 0) {
    return "No parcel matched. The identifier or 'name + number' is not in our cadastral copy (the credit is refunded). Check the spelling of the locality name, or use search_parcels to look up a parcel id by prefix.";
  }

  const lines: string[] = [`Found ${res.matches.length} parcel${res.matches.length === 1 ? "" : "s"}:\n`];
  for (const [i, m] of res.matches.entries()) {
    // parcel_id may be null per the server contract; guard so a null identity never renders literally.
    const id = m.parcel_id ?? "(parcel id requires a paid plan)";
    const district = m.district ?? "Unknown";
    const area = m.area_m2 != null ? formatArea(m.area_m2) : "N/A";
    const location = m.centroid ? `${m.centroid.lat.toFixed(4)}°N, ${m.centroid.lng.toFixed(4)}°E` : "no geometry";
    lines.push(`${i + 1}. ${id}`);
    lines.push(`   District: ${district} | Area: ${area} | Location: ${location}`);
  }
  if (res.truncated) {
    lines.push(`\nMore matches exist than shown — narrow the locality name or provide the full parcel id.`);
  }
  if (res.as_of) {
    lines.push(`\nCadastral copy as of ${res.as_of.split("T")[0]}.`);
  }
  return lines.join("\n");
}

// ── Spatial search formatting ──────────────────────────────────────

function formatSpatialFeature(f: SpatialFeature): string {
  return formatTransactionCore({
    ...f.properties,
    transaction_date: f.properties.transaction_date.split("T")[0]!,
    coordinates: f.geometry?.coordinates ?? null,
  });
}

export function formatSpatialResults(res: SpatialSearchResponse): string {
  if (res.features.length === 0) {
    return `No transactions found in the specified polygon (total: ${res.total}).`;
  }

  const lines: string[] = [];
  const displayCap = 50;
  const showing = Math.min(res.features.length, displayCap);
  lines.push(`Found ${formatNumber(res.total)} transactions in polygon (showing ${showing}):`);
  if (res.truncated) {
    lines.push(`Results truncated by API limit. Narrow your polygon or add filters to see all.`);
  }
  lines.push("");

  const shown = res.features.slice(0, displayCap);
  for (const [i, f] of shown.entries()) {
    lines.push(`${i + 1}. ${formatSpatialFeature(f)}`);
  }
  if (res.features.length > displayCap) {
    lines.push(`\n...and ${res.features.length - displayCap} more in response (not displayed). Use a smaller limit or narrower polygon.`);
  }

  // Same cross-link as the list formatter, so polygon/area callers also discover get_building_breakdown.
  if (res.features.some((f) => f.properties.building_count != null)) {
    lines.push(`\n${BUILDING_BREAKDOWN_TIP}`);
  }

  return lines.join("\n");
}

// ── Building breakdown formatting (per-transaction, per-building) ───

export function formatBuildingBreakdown(res: BuildingBreakdownResponse): string {
  const { data, truncated } = res;
  // Empty data covers both "transaction has no buildings" and "unknown/garbage id" (REST returns
  // 200 + [] for both) — a single neutral message fits both without leaking which case it was.
  if (data.length === 0) {
    return "No per-building data available for this transaction.";
  }

  const lines: string[] = [`Per-building breakdown (${data.length} building${data.length === 1 ? "" : "s"}):`, ""];

  data.forEach((b, i) => {
    const cells: string[] = [];

    const typeLabel = b.building_type != null
      ? (BUILDING_TYPES[b.building_type] ?? `Type ${b.building_type}`)
      : "Building";
    cells.push(typeLabel);

    if (b.footprint_area_m2 != null) {
      // Surface the second measurement only when the two diverge (>10%) — a neutral "two independent
      // measurements disagree" signal, no source register named. When they agree, the canonical
      // footprint already represents both, so the alt is noise.
      const alt = b.footprint_divergent === true && b.footprint_area_alt_m2 != null
        ? ` (alt. measurement ${formatArea(b.footprint_area_alt_m2)} — diverge)`
        : "";
      cells.push(`footprint ${formatArea(b.footprint_area_m2)}${alt}`);
    }

    if (b.storeys != null) cells.push(`storeys ${b.storeys}`);

    if (b.est_total_area_m2 != null) {
      cells.push(`est. total floor area ${formatArea(b.est_total_area_m2)} [estimate: footprint × storeys, not from deed]`);
    }

    // match_confidence is a readable enum (high/low) or null — render verbatim when present.
    if (b.match_confidence) cells.push(`match confidence: ${b.match_confidence}`);

    lines.push(`${i + 1}. ${cells.join(" | ")}`);
  });

  if (truncated) {
    lines.push("", "Showing the first 500 buildings (the transaction has more).");
  }

  return lines.join("\n");
}

// ── Flood-zone breakdown formatting (per-transaction, per-parcel) ───

export function formatFloodBreakdown(res: FloodBreakdownResponse): string {
  const { data, truncated } = res;
  // TWO-STATE: empty covers both "no linked parcel sits in a mapped zone" and "unknown/garbage id" (REST
  // returns 200 + [] for both). We NEVER assert "no flood risk" — absence of a mapped zone is not evidence
  // of safety. One neutral message fits both without leaking which case it was.
  if (data.length === 0) {
    return "No mapped flood-hazard zone is recorded for this transaction's land (or the id was not found). Absence of a mapped zone is not a guarantee of safety — it is never asserted as 'no risk'.";
  }

  const lines: string[] = [
    `Per-parcel flood-zone breakdown (${data.length} parcel${data.length === 1 ? "" : "s"} in a mapped flood-hazard zone):`,
    "",
  ];

  data.forEach((r, i) => {
    const cells: string[] = [];

    const note = r.flood_risk ? FLOOD_RISK_NOTE[r.flood_risk] : undefined;
    cells.push(`risk: ${r.flood_risk ?? "—"}${note ? ` (${note})` : ""}`);

    if (r.source) cells.push(`source: ${r.source}`);

    // pct_in_zone = share of the parcel inside the worst-scenario zone (NUMERIC → string over the wire).
    if (r.pct_in_zone != null) {
      const pct = Number(r.pct_in_zone);
      if (Number.isFinite(pct)) cells.push(`${Math.round(pct)}% of the parcel in the worst-scenario zone`);
    }

    // scenarios = bounded list (≤7) of distinct hazard scenarios for this parcel. Only the readable
    // labels are rendered; the numeric fields alongside them carry no meaningful value.
    if (Array.isArray(r.scenarios) && r.scenarios.length > 0) {
      const labels = r.scenarios.map((s) => s.scenario).filter((s): s is string => !!s);
      if (labels.length > 0) cells.push(`scenarios: ${labels.join("; ")}`);
    }

    lines.push(`${i + 1}. ${cells.join(" | ")}`);
  });

  if (truncated) {
    lines.push("", "Showing the first 500 parcels (the transaction is linked to more).");
  }

  return lines.join("\n");
}

// ── Heritage-listing breakdown formatting (per-transaction, per-parcel) ──

export function formatHeritageBreakdown(res: HeritageBreakdownResponse): string {
  const { data, truncated } = res;
  // TWO-STATE: empty covers both "no listing detected for any linked parcel" and "unknown/garbage id"
  // (REST returns 200 + [] for both). We NEVER assert "not a listed monument" — absence of a detection
  // is not evidence there is no listing. One neutral message fits both without leaking which case it was.
  if (data.length === 0) {
    return "No heritage-listing records found for this transaction's parcels (or the id was not found). This is not a statement that the property is free of heritage protection — absence of a detection is never asserted as 'not listed'.";
  }

  const lines: string[] = [
    `Per-parcel heritage-listing breakdown (${data.length} parcel${data.length === 1 ? "" : "s"} with a detected listing):`,
    "",
  ];

  data.forEach((r, i) => {
    const cells: string[] = [];

    const note = r.heritage_status ? HERITAGE_STATUS_NOTE[r.heritage_status] : undefined;
    cells.push(`status: ${r.heritage_status ?? "—"}${note ? ` (${note})` : ""}`);

    if (r.site_count != null) cells.push(`entries: ${r.site_count}`);

    // pct_in_zone = share of the parcel inside the protected area (NUMERIC → string over the wire).
    // Null when only point/line-located entries matched — nothing areal to measure coverage against.
    if (r.pct_in_zone != null) {
      const pct = Number(r.pct_in_zone);
      if (Number.isFinite(pct)) cells.push(`${Math.round(pct)}% of the parcel in the protected area`);
    }

    lines.push(`${i + 1}. ${cells.join(" | ")}`);

    // Individual entries, one indented line each. Entries carry more fields than fit a single cell
    // (category, name, function, period, entry date) — sub-lines keep a multi-entry parcel readable.
    // entry_date may arrive as a full ISO timestamp — keep the date part only.
    if (Array.isArray(r.sites)) {
      for (const s of r.sites) {
        const detail: string[] = [s.category];
        if (s.name) detail.push(s.name);
        if (s.function) detail.push(`function: ${s.function}`);
        if (s.period) detail.push(`period: ${s.period}`);
        if (s.entry_date) detail.push(`entered: ${s.entry_date.split("T")[0]}`);
        lines.push(`   - ${detail.join(" | ")}`);
      }
    }
  });

  if (truncated) {
    lines.push("", "Showing the first 500 parcels (the transaction is linked to more).");
  }

  lines.push("", HERITAGE_DISCLAIMER);

  return lines.join("\n");
}

// ── Landslide-zone breakdown formatting (per-transaction, per-parcel) ───

export function formatLandslideBreakdown(res: LandslideBreakdownResponse): string {
  const { data, truncated } = res;
  // TWO-STATE: empty covers both "no linked parcel intersects a mapped zone" and "unknown/garbage id"
  // (REST returns 200 + [] for both). We NEVER assert "no landslide risk" — absence of mapped data is
  // not evidence of safety. One neutral message fits both without leaking which case it was.
  if (data.length === 0) {
    return "No mapped landslide-hazard zone intersects this transaction's parcels (or the id was not found). Absence of mapped data is not a guarantee of safety — it is never asserted as 'no risk'.";
  }

  const lines: string[] = [
    `Per-parcel landslide-zone breakdown (${data.length} parcel${data.length === 1 ? "" : "s"} intersecting a mapped landslide-hazard zone):`,
    "",
  ];

  data.forEach((r, i) => {
    const cells: string[] = [];

    const note = r.landslide_risk ? LANDSLIDE_RISK_NOTE[r.landslide_risk] : undefined;
    cells.push(`risk: ${r.landslide_risk ?? "—"}${note ? ` (${note})` : ""}`);

    // pct_in_zone = share of the parcel inside the mapped zones (NUMERIC → string over the wire).
    if (r.pct_in_zone != null) {
      const pct = Number(r.pct_in_zone);
      if (Number.isFinite(pct)) cells.push(`${Math.round(pct)}% of the parcel in mapped zones`);
    }

    // zones = bounded list of distinct mapped-hazard records for this parcel (two kinds exist, deduped
    // per kind + version date). source_version_date = the source-record version date, NOT a
    // survey/observation date — label it as such so the model never quotes it as "surveyed on".
    if (Array.isArray(r.zones) && r.zones.length > 0) {
      const labels = r.zones
        .map((z) => {
          if (!z.kind) return null;
          return z.source_version_date ? `${z.kind} (record version date: ${z.source_version_date})` : z.kind;
        })
        .filter((s): s is string => !!s);
      if (labels.length > 0) cells.push(`zones: ${labels.join("; ")}`);
    }

    lines.push(`${i + 1}. ${cells.join(" | ")}`);
  });

  if (truncated) {
    lines.push("", "Showing the first 500 parcels (the transaction is linked to more).");
  }

  // Interpretation guard: intersection at map scale 1:10,000 = the parcel overlaps a mapped hazard
  // area — NOT a statement that the parcel itself is a landslide.
  lines.push("", "Note: based on official landslide-hazard maps (1:10,000 scale). An intersection means the parcel overlaps a mapped hazard area, not that the parcel itself is a landslide.");

  return lines.join("\n");
}

// ── Surroundings formatting (per-transaction, per-parcel) ──────────

// Nuisance categories with the fixed per-category search radius (meters) used by the assessment.
// A null distance means nothing of that category was found within this radius — it is NOT a claim
// that none exists farther away (two-state semantics, like flood).
const SURROUNDINGS_CATEGORIES: { key: keyof SurroundingsRow; label: string; radiusLabel: string }[] = [
  { key: "cemetery_distance_m", label: "cemetery", radiusLabel: "1 km" },
  { key: "landfill_distance_m", label: "landfill (waste disposal)", radiusLabel: "3 km" },
  { key: "sewage_treatment_distance_m", label: "sewage treatment plant", radiusLabel: "2 km" },
  { key: "industrial_area_distance_m", label: "industrial/storage area", radiusLabel: "1 km" },
  { key: "industrial_plant_distance_m", label: "large industrial plant", radiusLabel: "3 km" },
  { key: "livestock_farm_distance_m", label: "intensive livestock farm", radiusLabel: "3 km" },
];

export function formatSurroundings(res: SurroundingsResponse): string {
  const { data, truncated } = res;
  // TWO-STATE: empty covers both "the transaction has no linked plots" and "unknown/garbage id"
  // (REST returns 200 + [] for both). One neutral message fits both without leaking which case it was.
  if (data.length === 0) {
    return "No surroundings data is available for this transaction (no linked plots, or the id was not found).";
  }

  const lines: string[] = [
    `Per-parcel surroundings (${data.length} plot${data.length === 1 ? "" : "s"}; distance from the plot boundary to the nearest mapped object, "~" = approximate):`,
    "",
  ];

  data.forEach((r, i) => {
    if (!r.assessed) {
      lines.push(`${i + 1}. not assessed yet — this plot has not been evaluated (no statement either way)`);
      return;
    }

    const cells = SURROUNDINGS_CATEGORIES.map(({ key, label, radiusLabel }) => {
      const raw = r[key];
      const dist = raw == null ? null : Number(raw);
      if (dist == null || !Number.isFinite(dist)) {
        // Absence within the search radius — never rendered as "none exists".
        return `${label}: none within ${radiusLabel}`;
      }
      if (dist === 0) return `${label}: on or adjoining the plot`;
      return `${label}: ~${Math.round(dist)} m`;
    });

    lines.push(`${i + 1}. ${cells.join(" | ")}`);
  });

  if (truncated) {
    lines.push("", "Showing the first 500 plots (the transaction is linked to more).");
  }

  return lines.join("\n");
}

// ── Public transport access breakdown formatting (per-transaction, per-parcel) ──

// Reminder that a missing mode in the breakdown below is a coverage gap, not a fact about the world — open
// GTFS feeds cover cities and national rail, not every rural area or bus-only route. Shown once per
// response so it isn't lost among the per-parcel lines.
const TRANSIT_COVERAGE_NOTE =
  "Note: distances are from open public-transport schedules (GTFS format); coverage is cities and national rail, not every rural area. A mode missing above means no stop of that mode was found within its distance cap — never read as 'no public transport access'.";

export function formatTransitBreakdown(res: TransitBreakdownResponse): string {
  const { data, truncated } = res;
  // TWO-STATE: empty covers both "no linked parcel has a stop within cap in any mode" and "unknown/garbage
  // id" (REST returns 200 + [] for both). We NEVER assert "no transit access" — open GTFS feeds don't
  // cover every rural area or bus-only route. One neutral message fits both without leaking which case it was.
  if (data.length === 0) {
    return `No public transport stop is recorded near this transaction's land in any mode (or the id was not found). ${TRANSIT_COVERAGE_NOTE}`;
  }

  const lines: string[] = [
    `Per-parcel public transport access (${data.length} parcel${data.length === 1 ? "" : "s"} with a stop nearby, from open GTFS data):`,
    "",
  ];

  // Invariant: every row has ≥1 non-null mode (enforced upstream by a data-layer CHECK constraint and
  // the endpoint's two-state filter), so `cells` is never empty here — no bare "N. " line can be emitted.
  data.forEach((r, i) => {
    const cells: string[] = [];
    if (r.rail_distance_m != null) cells.push(`Rail: ${r.rail_distance_m} m${r.rail_stop_name ? ` (${r.rail_stop_name})` : ""}`);
    if (r.metro_distance_m != null) cells.push(`Metro: ${r.metro_distance_m} m${r.metro_stop_name ? ` (${r.metro_stop_name})` : ""}`);
    if (r.tram_distance_m != null) cells.push(`Tram: ${r.tram_distance_m} m${r.tram_stop_name ? ` (${r.tram_stop_name})` : ""}`);
    if (r.bus_distance_m != null) cells.push(`Bus: ${r.bus_distance_m} m${r.bus_stop_name ? ` (${r.bus_stop_name})` : ""}`);
    lines.push(`${i + 1}. ${cells.join(" | ")}`);
  });

  if (truncated) {
    lines.push("", "Showing the first 500 parcels (the transaction is linked to more).");
  }

  lines.push("", TRANSIT_COVERAGE_NOTE);

  return lines.join("\n");
}

// ── Building-permit breakdown formatting (per-transaction, per-parcel) ──

// Neutral disclaimer for an empty permits result. Identity-safe (no source-registry name) and
// TWO-STATE: an empty list is never rendered as "nothing was ever planned". Covers both
// "no registered case for any linked parcel" and "unknown/garbage id" (REST returns 200 + []
// for both) — one message fits both without leaking which case it was.
const PERMITS_EMPTY_NOTE =
  "No positively-resolved building permit or works notification is on record for this transaction's parcels (or the id was not found). The register covers cases resolved since 2016, matched by the parcel's current identifier — an empty list is never a statement that nothing was ever planned.";

export function formatPermitsBreakdown(res: PermitsResponse): string {
  const { data, truncated } = res;
  if (data.length === 0) {
    return PERMITS_EMPTY_NOTE;
  }

  const lines: string[] = [
    `Building permits & notifications on record for this transaction's parcels (${data.length} record${data.length === 1 ? "" : "s"}):`,
    "",
  ];

  data.forEach((r, i) => {
    const cells: string[] = [];
    cells.push(r.record_kind);
    if (r.intent_type) cells.push(`intent: ${r.intent_type}`);
    if (r.works_type) cells.push(`works: ${r.works_type}`);
    if (r.object_category) cells.push(`category: ${r.object_category}`);
    if (r.status) cells.push(`status: ${r.status}`);
    // Prefer the decision date (permits); fall back to the intake date (notifications have no
    // decision date). Both are YYYY-MM-DD strings.
    const date = r.decision_date ?? r.intake_date;
    if (date) cells.push(`date: ${date}`);
    if (r.authority) cells.push(`authority: ${r.authority}`);
    // Investment address (street / number / city) — administrative fact, no parcel identity.
    const addr = [r.address_street, r.address_number].filter(Boolean).join(" ");
    const addrFull = [addr, r.address_city].filter(Boolean).join(", ");
    if (addrFull) cells.push(`address: ${addrFull}`);
    if (r.volume_m3 != null && Number.isFinite(Number(r.volume_m3))) {
      cells.push(`volume: ${Math.round(Number(r.volume_m3))} m³`);
    }
    lines.push(`${i + 1}. ${cells.join(" | ")}`);
  });

  if (truncated) {
    lines.push("", "Showing the first 500 records (the transaction's parcels have more).");
  }

  return lines.join("\n");
}

// ── General-plan (POG) planning-zone breakdown formatting ──────────

// Overlay kinds → readable label. Overlays sit on top of base zones (their coverage is independent of
// the base-zone shares), so they are rendered as their own lines. Only the two lawful overlay kinds
// exist; an unknown kind falls back to a neutral label.
const PLANNING_OVERLAY_LABEL: Record<string, string> = {
  infill_area: "Infill development area (obszar uzupełnienia zabudowy)",
  downtown_area: "Central development area (obszar zabudowy śródmiejskiej)",
};

// Coerce a wire value (number or NUMERIC-as-string) to a finite number, or null. Mirrors the flood /
// heritage row contract where NUMERIC columns can arrive as strings.
function planningNum(raw: number | string | null | undefined): number | null {
  if (raw == null) return null;
  const n = Number(raw);
  return Number.isFinite(n) ? n : null;
}

// Render a numeric building parameter at its source precision. Never round: an intensity of 1.25 is a
// binding limit, and 1.3 would be a different one. String(n) already drops a trailing ".0".
function planningParam(raw: number | string | null | undefined, unit: string): string | null {
  const n = planningNum(raw);
  if (n == null) return null;
  return `${String(n)}${unit}`;
}

export function formatPlanningBreakdown(res: PlanningResponse): string {
  const { data, coverage, truncated } = res;

  // THREE-STATE (not the two-state hazard pattern). Empty data splits into two honest cases by
  // `coverage`, and NEITHER ever asserts the municipality has no general plan.
  if (data.length === 0) {
    if (coverage === "covered_no_data") {
      return "This transaction's municipality has an adopted general plan (plan ogólny), but no planning-zone data covers these parcels in our sources yet.";
    }
    // 'not_covered' (also the fallback for an unknown/garbage id, which returns 200 + empty).
    return "No published general plan (plan ogólny) data is available for this transaction's municipality yet — this is NOT a statement that no plan exists. General plans are still being adopted across Poland, so coverage grows over time.";
  }

  const zones = data.filter((r) => r.kind === "zone");
  const overlays = data.filter((r) => r.kind !== "zone");

  // Build the count phrase from whatever is actually present, so an overlay-only transaction (rare, but
  // structurally possible at the parcel×kind grain) never reads "0 planning zones".
  const counts: string[] = [];
  if (zones.length > 0) counts.push(`${zones.length} planning zone${zones.length === 1 ? "" : "s"}`);
  if (overlays.length > 0) counts.push(`${overlays.length} overlay area${overlays.length === 1 ? "" : "s"}`);

  const lines: string[] = [
    `General plan (plan ogólny) zoning for this transaction's land (${counts.join(", ")}):`,
    "",
  ];

  // Group by parcel. A transaction spanning several parcels repeats a zone symbol once per parcel, and a
  // flat list makes that look like a duplicate row — the model would then double-count the zone.
  const byParcel = new Map<number, PlanningRow[]>();
  for (const r of data) {
    const list = byParcel.get(r.parcel_ord);
    if (list) list.push(r);
    else byParcel.set(r.parcel_ord, [r]);
  }
  const multiParcel = byParcel.size > 1;

  let n = 0;
  for (const [ord, prows] of byParcel) {
    if (multiParcel) {
      if (n > 0) lines.push("");
      lines.push(`Parcel ${ord} of ${byParcel.size}:`);
    }

    // Base planning zones first: symbol + name + share + building parameters (each nullable).
    for (const r of prows.filter((x) => x.kind === "zone")) {
      n += 1;
      const cells: string[] = [];

      const label = r.zone_symbol
        ? `${r.zone_symbol}${r.zone_name ? ` — ${r.zone_name}` : ""}`
        : r.zone_name ?? "planning zone";
      cells.push(label);

      const pct = planningNum(r.pct_of_parcel);
      if (pct != null) cells.push(`${Math.round(pct)}% of the parcel`);

      const params: string[] = [];
      const height = planningParam(r.max_building_height_m, " m");
      if (height) params.push(`max building height: ${height}`);
      const intensity = planningParam(r.max_development_intensity, "");
      if (intensity) params.push(`max development intensity: ${intensity}`);
      const coveragePct = planningParam(r.max_built_up_coverage_pct, "%");
      if (coveragePct) params.push(`max built-up coverage: ${coveragePct}`);
      const bioPct = planningParam(r.min_bio_active_area_pct, "%");
      if (bioPct) params.push(`min biologically active area: ${bioPct}`);
      if (params.length > 0) cells.push(params.join(", "));

      lines.push(`${n}. ${cells.join(" | ")}`);

      // params_mixed: this symbol merges sub-zones whose parameters disagreed — the ambiguous ones are
      // reported as null above (never guessed). Flag it so the model does not read a missing parameter
      // as "no limit".
      if (r.params_mixed) {
        lines.push("   - note: this symbol merges sub-zones with differing building parameters; only values that agreed across them are shown, the rest are omitted as ambiguous (not 'no limit').");
      }
    }

    // Overlay areas as their own lines — their coverage is independent of (and may overlap) base zones.
    for (const r of prows.filter((x) => x.kind !== "zone")) {
      n += 1;
      const label = PLANNING_OVERLAY_LABEL[r.kind] ?? "development overlay area";
      const pct = planningNum(r.pct_of_parcel);
      lines.push(`${n}. ${label} — overlay${pct != null ? `, ${Math.round(pct)}% of the parcel` : ""}`);
    }
  }

  if (multiParcel) {
    lines.push("", "Note: this transaction covers several land parcels. Zones are listed per parcel, so the same symbol may appear under more than one parcel — that is not a duplicate.");
  }

  if (truncated) {
    lines.push("", "Showing the first 500 rows (this transaction's land carries more zones/overlays).");
  }

  // Interpretation guard: shares are measured against the cadastral parcel geometry, and overlay shares
  // are independent of base-zone shares (overlays may overlap zones), so the percentages need not sum to
  // 100. Authored here (not echoed from the response) so the wording is deterministic and testable.
  lines.push("", "Note: shares are relative to the cadastral parcel geometry; base-zone and overlay shares are independent (overlays may sit on top of zones), so they need not add up to 100%.");

  return lines.join("\n");
}

// ── Farmland (agricultural land-eligibility) formatting (per-transaction, per-parcel) ──

export function formatFarmland(res: FarmlandResponse): string {
  const { data, truncated, parcels_total, parcels_with_data, as_of } = res;
  // TWO-STATE: empty covers both "no linked parcel has a matched eligible area" and "unknown/garbage id"
  // (REST returns 200 + [] for both). We NEVER assert "not agricultural" — the reference layer has its
  // own update cadence, small plots that are not actively farmed are simply absent, and older
  // transactions can reference renumbered parcels. One neutral message fits both.
  if (data.length === 0) {
    const asOfNote = as_of ? ` (reference data as of ${as_of})` : "";
    return `No eligible agricultural area found for the linked parcels (or the id was not found)${asOfNote}. This is not a statement that the property is non-agricultural — absence of a match is never asserted as "not agricultural".`;
  }

  const lines: string[] = [
    // Header carries the coverage counters: how many of the transaction's linked parcels carry a match.
    `Per-parcel agricultural land-eligibility (${parcels_with_data} of ${parcels_total} linked parcel${parcels_total === 1 ? "" : "s"} with a matched eligible area):`,
    "",
  ];

  data.forEach((r, i) => {
    const cells: string[] = [];

    // eligible_area_m2 = the eligible agricultural area matched onto this parcel.
    cells.push(`eligible agricultural area: ${formatArea(r.eligible_area_m2)}`);

    // pct_of_parcel = that area as a share of the parcel's measured area. Null when the parcel's measured
    // area is unavailable — omit the cell rather than render a misleading value.
    if (r.pct_of_parcel != null) {
      const pct = Number(r.pct_of_parcel);
      if (Number.isFinite(pct)) cells.push(`${Math.round(pct)}% of the parcel`);
    }

    // feature_count = number of source features composing the matched area (surface only when >1 adds info).
    if (r.feature_count != null && Number(r.feature_count) > 1) {
      cells.push(`${Number(r.feature_count)} features`);
    }

    lines.push(`${i + 1}. ${cells.join(" | ")}`);
  });

  if (truncated) {
    lines.push("", "Showing the first 500 parcels (the transaction is linked to more).");
  }

  // Freshness signal — the reference layer is refreshed on its own cadence; expose the snapshot date so
  // the model can frame the answer against it rather than treating it as current-day ground truth.
  if (as_of) {
    lines.push("", `Official nationwide agricultural land-eligibility data (updated weekly); this snapshot as of ${as_of}.`);
  }

  return lines.join("\n");
}

// ── Location hierarchy formatting ─────────────────────────────────

const LEVEL_TIPS: Record<string, string> = {
  voivodeship: "Use a 2-digit code as 'parent' to browse counties.",
  county: "Use a 4-digit code as 'parent' to browse municipalities.",
  municipality: "Use a 6-digit code as 'parent' to browse precincts, or use any code with 'teryt' in search_transactions.",
  precinct: "Use these precinct codes with 'teryt' in search_transactions for precise area filtering.",
};

export function formatLocationHierarchy(items: LocationItem[], parent?: string): string {
  if (items.length === 0) {
    if (parent) {
      if (parent.length >= 6) {
        return `No sub-locations found for TERYT code '${parent}'. This may be a leaf code - use it directly with search_transactions(teryt='${parent}').`;
      }
      return `No sub-locations found for TERYT code '${parent}'. Verify the code is correct using list_locations.`;
    }
    return "No locations available.";
  }

  const level = items[0]!.level;
  const header = parent
    ? `TERYT location hierarchy (parent: ${parent}, level: ${level}):`
    : `TERYT location hierarchy (Poland, level: ${level}):`;

  const plural: Record<string, string> = { voivodeship: "voivodeships", county: "counties", municipality: "municipalities", precinct: "precincts" };
  const lines: string[] = [header, "", `Found ${items.length} ${plural[level] ?? `${level}s`}:`, ""];

  for (const item of items) {
    const typeSuffix = item.typeName ? ` (${item.typeName})` : "";
    lines.push(`  ${item.code} - ${item.name}${typeSuffix}`);
  }

  const tip = LEVEL_TIPS[level];
  if (tip) {
    lines.push("", `Tip: ${tip}`);
  }

  return lines.join("\n");
}

// ── Compare locations formatting ───────────────────────────────────

export function formatCompareResults(res: CompareResponse): string {
  const districts = Object.keys(res);
  if (districts.length === 0) {
    return "No comparison data available.";
  }

  const lines: string[] = [`Location comparison (${districts.length} districts):\n`];

  lines.push("District".padEnd(25) + " | Median PLN/m\u00B2" + " | Avg Area".padEnd(12) + " | Transactions" + " | Date Range");
  lines.push("-".repeat(95));

  const suggestions: string[] = [];
  for (const name of districts) {
    const d = res[name]!;
    if (d.suggestions && d.suggestions.length > 0) {
      suggestions.push(`"${name}" not found. Did you mean: ${d.suggestions.join(", ")}?`);
    }
    const median = d.median_price_m2 != null ? formatPLN(d.median_price_m2).padStart(14) : "N/A".padStart(14);
    const area = d.avg_area != null ? formatArea(d.avg_area).padEnd(10) : "N/A".padEnd(10);
    const total = formatNumber(d.total).padStart(12);
    const dateRange = d.min_date && d.max_date ? `${d.min_date} \u2013 ${d.max_date}` : "N/A";
    lines.push(`${name.padEnd(25)} | ${median} | ${area} | ${total} | ${dateRange}`);
  }

  if (suggestions.length > 0) {
    lines.push("");
    for (const s of suggestions) {
      lines.push(`Note: ${s}`);
    }
  }

  // Demographics enrichment (?include=demographics → includeDemographics=true). REST OMITS the
  // whole `demographics` key for any district it couldn't resolve to a county, so tolerate its
  // absence: render only the districts that carry it, then one footnote for the rest.
  const withDemo = districts.filter((name) => {
    const d = res[name]?.demographics;
    return d && Object.keys(d).length > 0;
  });
  if (withDemo.length > 0) {
    lines.push("", "Demographics (GUS BDL, county-level):");
    for (const name of withDemo) {
      lines.push("", `${name}:`);
      for (const [slug, ind] of Object.entries(res[name]!.demographics!)) {
        const unit = ind.unit ? ` ${ind.unit}` : "";
        const year = ind.year != null ? ` (${ind.year})` : "";
        const flags = [ind.derived ? "derived" : null, ind.cross_source ? "cross-source" : null].filter(Boolean);
        const flagSuffix = flags.length > 0 ? ` [${flags.join(", ")}]` : "";
        const value = ind.value != null ? `${formatNumber(ind.value)}${unit}` : "N/A";
        lines.push(`  - ${slug}: ${value}${year}${flagSuffix}`);
      }
    }
    const missing = districts.filter((name) => !withDemo.includes(name));
    if (missing.length > 0) {
      lines.push("", `Note: no demographic data for ${missing.join(", ")} (not resolved to a county).`);
    }
  }

  lines.push(`\n${MARKET_CAVEAT}`);

  return lines.join("\n");
}

// ── Demographics formatting (GUS BDL) ──────────────────────────────

// category key → readable section header. Order also sets the section order in the output.
const DEMOGRAPHICS_CATEGORY_LABELS: Record<string, string> = {
  demographics: "Demographics",
  economy: "Economy",
  economy_macro: "Macro-economy (GDP, NUTS3/region)",
  housing: "Housing",
  planning: "Spatial planning (MPZP zoning)",
  infrastructure: "Infrastructure",
  environment: "Environment",
  safety: "Safety",
  re_market: "Real estate market (historical)",
  education: "Education",
  prices: "Prices (CPI)",
};
const DEMOGRAPHICS_CATEGORY_ORDER = Object.keys(DEMOGRAPHICS_CATEGORY_LABELS);

// One indicator → "  - Name: value unit (year) [flags]". Compacts a long time series so ~50
// indicators stay scannable: single year → value+year; ≤5 years → inline series; >5 → latest +
// span summary. Surfaces derived/snapshot flags and any data-quality note.
function formatDemographicsIndicator(ind: DemographicsIndicator): string {
  const years = Object.keys(ind.values).map(Number).filter((n) => Number.isFinite(n)).sort((a, b) => a - b);
  const unit = ind.unit ? ` ${ind.unit}` : "";
  const flags = [ind.derived ? "derived" : null, ind.snapshot ? "snapshot" : null].filter(Boolean);
  const flagSuffix = flags.length > 0 ? ` [${flags.join(", ")}]` : "";
  const noteSuffix = ind.note ? ` — ${ind.note}` : "";

  let valueStr: string;
  if (years.length === 0) {
    valueStr = "N/A";
  } else if (years.length === 1) {
    const y = years[0]!;
    valueStr = `${formatNumber(ind.values[String(y)]!)}${unit} (${y})`;
  } else if (years.length <= 5) {
    valueStr = years.map((y) => `${y}: ${formatNumber(ind.values[String(y)]!)}`).join(", ") + unit;
  } else {
    const first = years[0]!;
    const last = years[years.length - 1]!;
    valueStr = `${formatNumber(ind.values[String(last)]!)}${unit} (${last}); ${years.length} yrs ${first}→${last}, from ${formatNumber(ind.values[String(first)]!)}`;
  }
  return `  - ${ind.name}: ${valueStr}${flagSuffix}${noteSuffix}`;
}

export function formatDemographics(r: DemographicsResponse): string {
  const loc = r.location;
  const title = loc.name ?? `TERYT ${loc.teryt}`;
  const lines: string[] = [`Demographics & local statistics — ${title} (${loc.level}, teryt ${loc.teryt})`];
  const asOf = r.meta.as_of ? ` · as of ${r.meta.as_of}` : "";
  lines.push(`Source: ${r.meta.data_source}${asOf}`);

  if (r.coverage === "no_data" || Object.keys(r.indicators).length === 0) {
    lines.push(
      "",
      `No GUS BDL indicators are available for this location (teryt ${loc.teryt}).`,
      "Tip: a city/county name resolves to powiat (county) level — pass a 6/7-digit teryt for gmina-level data, or use list_locations to find a valid code.",
    );
    return lines.join("\n");
  }

  // Group indicators by category, then emit in canonical order (unknown categories last).
  const byCategory = new Map<string, DemographicsIndicator[]>();
  for (const ind of Object.values(r.indicators)) {
    const arr = byCategory.get(ind.category) ?? [];
    arr.push(ind);
    byCategory.set(ind.category, arr);
  }
  const orderedCats = [
    ...DEMOGRAPHICS_CATEGORY_ORDER.filter((c) => byCategory.has(c)),
    ...[...byCategory.keys()].filter((c) => !DEMOGRAPHICS_CATEGORY_ORDER.includes(c)),
  ];
  for (const cat of orderedCats) {
    lines.push("", DEMOGRAPHICS_CATEGORY_LABELS[cat] ?? cat);
    for (const ind of byCategory.get(cat)!) lines.push(formatDemographicsIndicator(ind));
  }

  // A gmina/powiat query returns parent-level rows too — flag when indicators span multiple levels
  // so the model reads each line's level rather than assuming all are the requested level.
  const levels = [...new Set(Object.values(r.indicators).map((i) => i.level))];
  if (levels.length > 1) {
    lines.push("", `Note: indicators draw from multiple administrative levels (${levels.join(", ")}); each line's level is where GUS publishes that metric.`);
  }
  return lines.join("\n");
}

// ── Infrastructure signals formatting ──────────────────────────────

const INFRA_CATEGORY_LABELS: Record<string, string> = {
  sewerage: "Sewerage",
  water_supply: "Water supply",
  roads: "Roads",
  lighting: "Street lighting",
  gas: "Gas network",
  cycling: "Cycling infrastructure",
};

// An estimate published before bidding is a very different number from a signed contract — never
// let the model read them as the same thing.
const INFRA_VALUE_KIND_LABELS: Record<string, string> = {
  estimated: "estimated value",
  winning_bid: "winning bid",
  contract: "contract value",
};

export function formatInfrastructureSignals(r: InfrastructureSignalsResponse): string {
  const loc = r.location;
  const title = loc.name ?? `TERYT ${loc.teryt}`;
  const scope = loc.level === "powiat" ? "aggregated over every municipality in this county" : "this municipality";
  const lines: string[] = [
    `Infrastructure signals — ${title} (${loc.level}, teryt ${loc.teryt})`,
    `Scope: ${scope}. Coverage: ${r.coverage}.`,
  ];

  // Dual-state: nothing found is NOT evidence that nothing is planned. Say so before any data.
  if (r.coverage === "no_data") {
    lines.push(
      "",
      "No infrastructure signals are recorded for this location.",
      "This does NOT mean the municipality is not investing — the tender feed carries below-EU-threshold contracts only (from 2021), and the other two sources may simply not list it.",
      r.meta.coverage_note,
    );
    return lines.join("\n");
  }

  const cats = Object.entries(r.tenders.by_category).sort((a, b) => b[1] - a[1]);
  lines.push("", `Public tenders, last ${r.tenders.window_months} months (municipal contracting authorities only)`);
  if (cats.length === 0) lines.push("  None recorded in this window.");
  else for (const [cat, n] of cats) lines.push(`  - ${INFRA_CATEGORY_LABELS[cat] ?? cat}: ${n}`);

  if (r.tenders.recent.length > 0) {
    lines.push("", "Recent notices (all contracting authorities)");
    for (const t of r.tenders.recent) {
      const value = t.value_pln == null
        ? ""
        : ` · ${formatNumber(t.value_pln)} PLN (${INFRA_VALUE_KIND_LABELS[t.value_kind ?? ""] ?? t.value_kind ?? "value"})`;
      // Flag anything the municipality did not tender itself — those works may sit elsewhere.
      const attribution = t.attribution_confidence === "high" ? "" : " · authority based here, works may be elsewhere";
      lines.push(`  - [${t.published_at}] ${INFRA_CATEGORY_LABELS[t.category] ?? t.category}: ${t.title}${value}${attribution}`);
    }
    if (r.tenders.truncated) lines.push(`  … list truncated at ${r.tenders.recent.length} notices.`);
  }

  lines.push("", "National urban waste-water treatment programme");
  if (r.kposk.in_agglomeration) {
    lines.push("  In a designated agglomeration — collective sewerage exists or is planned here.");
    for (const a of r.kposk.agglomerations) {
      const rlm = a.rlm == null ? "" : ` (${formatNumber(a.rlm)} population equivalent)`;
      lines.push(`  - ${a.name}${rlm}`);
    }
    if (r.kposk.truncated) lines.push(`  … list truncated at ${r.kposk.agglomerations.length} agglomerations.`);
  } else {
    lines.push("  Not listed in a designated agglomeration.");
  }

  // Rendered even when empty, like the other two overlays — an omitted section reads as "not
  // checked" rather than "checked, nothing there".
  const years = Object.entries(r.capex.by_year).sort(([a], [b]) => a.localeCompare(b));
  lines.push("", "Planned capital expenditure (municipal multi-year financial forecast)");
  if (years.length === 0) lines.push("  No forecast rows recorded for this location.");
  for (const [year, c] of years) {
    const across = c.gmina_count > 1 ? ` · summed across ${c.gmina_count} municipalities` : "";
    const adopted = c.resolution_date ? ` · adopted ${c.resolution_date}` : "";
    lines.push(`  - ${year}: ${formatNumber(c.value_pln)} PLN${across}${adopted}`);
  }

  lines.push("", r.meta.coverage_note);
  if (r.meta.as_of) lines.push(`Most recent tender notice: ${r.meta.as_of}.`);
  return lines.join("\n");
}

// ── Rental yield formatting ────────────────────────────────────────

// Version-agnostic substring (no /api prefix) so the backend discovery note is stripped whether it
// arrives as /api/... (legacy) or /api/v1/... (post-migration) — the formatter re-renders it itself.
const RENTAL_YIELD_LOCATIONS_PATH = "rental-yield/locations";

export function formatRentalYield(r: RentalYieldResponse): string {
  const { rent, transaction: tx } = r.inputs;
  const q = r.quality;
  const lines: string[] = [`Gross rental yield — ${r.location.name}${areaBucketSuffix(r.segment.area_bucket)}`, ""];

  lines.push(
    r.result.gross_yield_pct != null
      ? `Gross yield: ${r.result.gross_yield_pct}% per year`
      : `Gross yield: N/A (coverage: ${q.coverage})`,
  );

  lines.push("");
  lines.push("Calculation (gross, top-line — no vacancy/management/tax/maintenance):");
  lines.push(
    rent.median_monthly_asking_per_m2 != null && rent.annualized_per_m2 != null
      ? `  Annualized rent: ${formatPLNExact(rent.median_monthly_asking_per_m2)}/m²/mo × 12 = ${formatPLN(rent.annualized_per_m2)}/m²/yr`
      : "  Annualized rent: N/A",
  );
  lines.push(
    tx.median_price_per_m2 != null
      ? `  Median transaction price: ${formatPLN(tx.median_price_per_m2)}/m² (${r.segment.market_type} market)`
      : `  Median transaction price: N/A (${r.segment.market_type} market)`,
  );
  lines.push("  (market median — fractional shares & non-market deeds excluded)");

  lines.push("");
  const rentN = rent.sample_n != null
    ? `${formatNumber(rent.sample_n)} rent offer${rent.sample_n === 1 ? "" : "s"}${offerDateSuffix(rent.snapshot_date)}`
    : "no rent data";
  const txN = tx.sample_n != null
    ? `${formatNumber(tx.sample_n)} transaction${tx.sample_n === 1 ? "" : "s"}${windowSuffix(tx.window)}`
    : "no transaction data";
  lines.push(`Samples: ${rentN}, ${txN}`);
  lines.push(`Coverage: ${q.coverage} | Confidence: ${q.confidence}${q.stale ? " | transaction data lags publication" : ""}`);
  if (q.as_of) lines.push(`Transaction data as of: ${q.as_of}`);

  lines.push(...distributionLines(r.distribution.asking_rent_monthly_per_m2, r.distribution.transaction_price_per_m2));

  // Skip the REST-flavored discovery note (it names the HTTP path) — MCP surfaces the same
  // cross-link as a tool tip below, so an LLM gets the tool name, not a URL it can't call.
  const visibleNotes = q.notes.filter((n) => !n.includes(RENTAL_YIELD_LOCATIONS_PATH));
  if (visibleNotes.length > 0) {
    lines.push("", "Notes:");
    for (const n of visibleNotes) lines.push(`  - ${n}`);
  }

  // Discovery cross-link: county resolved but there is no rent coverage → point the LLM
  // at the catalog TOOL so it stops guessing which cities are covered. Reacts to coverage, not to
  // the REST note string (decoupled).
  if (q.coverage === "no_rental_data") {
    lines.push("", "Tip: call list_rental_yield_locations to see which cities have rental-yield coverage.");
  }

  return lines.join("\n");
}

// Discovery catalog formatter. Entries arrive pre-sorted (rent_sample_n desc) from the API.
export function formatRentalYieldLocations(r: RentalYieldLocationsResponse): string {
  const { data, meta } = r;
  if (data.length === 0) {
    return "No rental-yield-covered locations match.";
  }
  const dateSuffix = meta.snapshot_date ? `, data from ${meta.snapshot_date}` : "";
  const lines: string[] = [
    `Rental-yield coverage — ${meta.total} location${meta.total === 1 ? "" : "s"}${dateSuffix}`,
    "",
  ];
  for (const loc of data) {
    lines.push(
      `- ${loc.location} (teryt ${loc.county_code}, ${loc.voivodeship}, ${loc.type}) — n=${formatNumber(loc.rent_sample_n)}, ${loc.confidence} confidence`,
    );
  }
  return lines.join("\n");
}

// ── Price spread formatting ─────────────────────────────

// Version-agnostic substring (no /api prefix) — strips the backend note for both /api/ and /api/v1/.
const PRICE_SPREAD_LOCATIONS_PATH = "price-spread/locations";

export function formatPriceSpread(r: PriceSpreadResponse): string {
  const { asking, transaction: tx } = r.inputs;
  const q = r.quality;
  const spread = r.result.spread_pct;
  const lines: string[] = [`Asking-vs-transaction price spread — ${r.location.name}${areaBucketSuffix(r.segment.area_bucket)}`, ""];

  lines.push(
    spread != null
      ? `Spread: ${spread > 0 ? "+" : ""}${spread}% (asking ${spread >= 0 ? "above" : "below"} transaction)`
      : `Spread: N/A (coverage: ${q.coverage})`,
  );

  lines.push("");
  lines.push("Calculation ((asking − transaction) / transaction × 100):");
  lines.push(
    asking.median_price_per_m2 != null
      ? `  Median asking price: ${formatPLN(asking.median_price_per_m2)}/m² (apartments for sale)`
      : "  Median asking price: N/A",
  );
  lines.push(
    tx.median_price_per_m2 != null
      ? `  Median transaction price: ${formatPLN(tx.median_price_per_m2)}/m² (${r.segment.market_type} market)`
      : `  Median transaction price: N/A (${r.segment.market_type} market)`,
  );
  lines.push("  (market median — fractional shares & non-market deeds excluded)");

  lines.push("");
  const askN = asking.sample_n != null
    ? `${formatNumber(asking.sample_n)} sale offer${asking.sample_n === 1 ? "" : "s"}${offerDateSuffix(asking.snapshot_date)}`
    : "no asking data";
  const txN = tx.sample_n != null
    ? `${formatNumber(tx.sample_n)} transaction${tx.sample_n === 1 ? "" : "s"}${windowSuffix(tx.window)}`
    : "no transaction data";
  lines.push(`Samples: ${askN}, ${txN}`);
  lines.push(`Coverage: ${q.coverage} | Confidence: ${q.confidence}${q.stale ? " | transaction data lags publication" : ""}`);
  if (q.as_of) lines.push(`Transaction data as of: ${q.as_of}`);

  lines.push(...distributionLines(r.distribution.asking_sale_per_m2, r.distribution.transaction_price_per_m2));

  // Drop the REST-flavored discovery note (names the HTTP path) — the tool tip below gives the LLM
  // the tool name instead of a URL it can't call.
  const visibleNotes = q.notes.filter((n) => !n.includes(PRICE_SPREAD_LOCATIONS_PATH));
  if (visibleNotes.length > 0) {
    lines.push("", "Notes:");
    for (const n of visibleNotes) lines.push(`  - ${n}`);
  }

  // Discovery cross-link: county resolved but there is no sale coverage → point at the catalog TOOL.
  if (q.coverage === "no_asking_data") {
    lines.push("", "Tip: call list_price_spread_locations to see which cities have asking-price coverage.");
  }

  return lines.join("\n");
}

export function formatPriceSpreadLocations(r: PriceSpreadLocationsResponse): string {
  const { data, meta } = r;
  if (data.length === 0) {
    return "No price-spread-covered locations match.";
  }
  const dateSuffix = meta.snapshot_date ? `, data from ${meta.snapshot_date}` : "";
  const lines: string[] = [
    `Price-spread coverage — ${meta.total} location${meta.total === 1 ? "" : "s"}${dateSuffix}`,
    "",
  ];
  for (const loc of data) {
    lines.push(
      `- ${loc.location} (teryt ${loc.county_code}, ${loc.voivodeship}, ${loc.type}) — n=${formatNumber(loc.asking_sample_n)}, ${loc.confidence} confidence`,
    );
  }
  return lines.join("\n");
}

// ── Valuation formatting (comparable-sales apartment estimate) ──────

// One comparable line. market_type / district appended only when present.
function valuationCompLine(c: ValuationComparable): string {
  const parts = [`${formatNumber(c.distance_m)} m`, c.transaction_date, formatArea(c.area_m2), `${formatPLN(c.price_per_m2)}/m²`];
  if (c.market_type) parts.push(c.market_type);
  if (c.district) parts.push(c.district);
  return `  - ${parts.join(" · ")}`;
}

// Render a comparable-sales apartment valuation. The disclaimer text (q.note) is authored server-side
// and carried verbatim.
export function formatValuation(r: ValuationResponse): string {
  const { result: res, inputs, quality: q, segment } = r ?? ({} as ValuationResponse);
  const loc = r?.location;
  // Shape guard (defensive): a truncated or proxied response used to blow up here with a raw TypeError.
  // The server never emits such a body; this only makes the failure mode boring.
  if (!res || !inputs || !q || !segment || !loc) {
    return "Unexpected response from the Cenogram API — the valuation could not be rendered. Try again shortly.";
  }
  const where =
    loc.lat != null && loc.lng != null
      ? `near ${loc.lat}, ${loc.lng}`
      : loc.county_code
        ? `county ${loc.county_code}`
        : "the requested point";
  const lines: string[] = [`Apartment value estimate — ${formatArea(segment.area_m2)} ${where}`, ""];

  // no_data / not_covered → no estimate. On no_data the 5-credit charge is refunded server-side.
  if (res.estimated_value == null) {
    // lat/lng are always echoed for a point query, so a no_data with BOTH null means the parcelId itself
    // never resolved — say so instead of blaming the neighbourhood for having too few sales.
    const parcelUnresolved = q.coverage !== "not_covered" && loc.lat == null && loc.lng == null;
    lines.push(
      q.coverage === "not_covered"
        ? "No estimate: outside the covered property type (v1 covers apartments only)."
        : parcelUnresolved
          ? "No estimate: that parcel could not be resolved (unknown id, or no geometry on record). The credit is refunded — check the id, or address the apartment by lat/lng."
          : "No estimate: too few comparable transactions near this point (credit refunded). Try a point in a denser urban area.",
    );
    if (q.note) lines.push("", q.note);
    return lines.join("\n");
  }

  lines.push(`Estimated value: ${formatPLN(res.estimated_value)}${res.price_per_m2 != null ? ` (${formatPLN(res.price_per_m2)}/m²)` : ""}`);
  const likely = res.value_range_likely;
  const wide = res.value_range_wide;
  if (likely?.low != null && likely.high != null) lines.push(`Likely range: ${formatPLN(likely.low)} – ${formatPLN(likely.high)}`);
  if (wide?.low != null && wide.high != null) lines.push(`Wide range: ${formatPLN(wide.low)} – ${formatPLN(wide.high)}`);
  if (res.confidence_band) lines.push(`Confidence: ${res.confidence_band}${res.confidence != null ? ` (${res.confidence})` : ""}`);

  lines.push("");
  const radius = inputs.radius_m != null ? ` within ${formatNumber(inputs.radius_m)} m` : "";
  lines.push(`Based on ${formatNumber(inputs.comps_total)} comparable transaction${inputs.comps_total === 1 ? "" : "s"}${radius}, last ${inputs.window_months} months.`);
  if (q.as_of) lines.push(`Transaction data as of: ${q.as_of} (varies by county — publication lag)`);

  if (Array.isArray(inputs.comparables) && inputs.comparables.length > 0) {
    const shown = inputs.comparables.slice(0, 5);
    lines.push("", `Comparables (nearest ${shown.length}):`);
    for (const c of shown) lines.push(valuationCompLine(c));
  }

  if (q.note) lines.push("", q.note);
  return lines.join("\n");
}

// ── Parcel report (composite dossier) ──────────────────────────────

// Four-state gloss for a per-parcel section, kept EXPLICIT (the literal state token stays visible so the
// model never has to guess): covered = a definitive positive, covered_no_data = checked and nothing found
// (still billed), not_covered = outside our data (refunded), not_computed = could not finish (refunded,
// retry). Any unexpected token renders verbatim.
function fourStateGloss(coverage: string): string {
  switch (coverage) {
    case "covered": return "covered";
    case "covered_no_data": return "covered_no_data (checked — nothing found, still billed)";
    case "not_covered": return "not_covered (outside our data — refunded)";
    case "not_computed": return "not_computed (could not finish in time — refunded, retry)";
    default: return coverage;
  }
}

// A NUMERIC-or-string wire value coerced to a number (the API sends some NUMERIC columns as strings).
function toNum(v: unknown): number | null {
  if (v == null) return null;
  const n = typeof v === "number" ? v : Number(v);
  return Number.isFinite(n) ? n : null;
}

// Drop the null-distance entries (no object of that kind within range) and sort nearest-first.
function nearestDistances(entries: Array<[string, number | null]>): Array<[string, number]> {
  return entries
    .filter((d): d is [string, number] => d[1] != null)
    .sort((a, b) => a[1] - b[1]);
}

// One compact detail suffix for a covered section (empty string when there is nothing extra to say).
function reportSectionDetail(name: string, s: ReportSection): string {
  const covered = s.coverage === "covered";
  switch (name) {
    case "flood": {
      if (!covered) return "";
      const risk = typeof s.flood_risk === "string" ? s.flood_risk : null;
      const pct = toNum(s.pct_in_zone);
      return risk ? `${risk} risk${pct != null ? `, ${pct}% of the parcel in the mapped zone` : ""}` : "";
    }
    case "heritage": {
      if (!covered) return "";
      const status = typeof s.heritage_status === "string" ? s.heritage_status : null;
      const sites = toNum(s.site_count);
      return status ? `${status}${sites != null ? `, ${sites} listing(s)` : ""}` : "";
    }
    case "landslide": {
      if (!covered) return "";
      const risk = typeof s.landslide_risk === "string" ? s.landslide_risk : null;
      return risk ? LANDSLIDE_RISK_NOTE[risk] ?? risk : "";
    }
    case "surroundings": {
      if (!covered) return "";
      // Nearest of the nuisance distances (a null = none within the search radius, never "none exists").
      const dists = nearestDistances([
        ["cemetery", toNum(s.cemetery_distance_m)],
        ["landfill", toNum(s.landfill_distance_m)],
        ["sewage treatment", toNum(s.sewage_treatment_distance_m)],
        ["industrial area", toNum(s.industrial_area_distance_m)],
        ["industrial plant", toNum(s.industrial_plant_distance_m)],
        ["livestock farm", toNum(s.livestock_farm_distance_m)],
      ]);
      if (dists.length === 0) return "no mapped nuisance object within range";
      return dists.slice(0, 3).map(([k, m]) => `${k} ${Math.round(m)} m`).join(", ");
    }
    case "transit": {
      if (!covered) return "";
      const modes = nearestDistances([
        ["rail", toNum(s.rail_distance_m)],
        ["metro", toNum(s.metro_distance_m)],
        ["tram", toNum(s.tram_distance_m)],
        ["bus", toNum(s.bus_distance_m)],
      ]);
      if (modes.length === 0) return "";
      return modes.map(([k, m]) => `${k} ${Math.round(m)} m`).join(", ");
    }
    case "planning": {
      if (!covered) return "";
      const rows = Array.isArray(s.data) ? (s.data as Array<Record<string, unknown>>) : [];
      const symbols = [...new Set(rows.map((r) => r.zone_symbol).filter((x): x is string => typeof x === "string"))];
      return symbols.length > 0 ? `zones: ${symbols.join(", ")}` : `${rows.length} zone row(s)`;
    }
    case "buildings": {
      if (!covered) return "";
      const rows = Array.isArray(s.data) ? s.data : [];
      return `${rows.length} building(s) on the parcel`;
    }
    case "permits": {
      if (!covered) return "";
      const rows = Array.isArray(s.data) ? s.data : [];
      return `${rows.length} registered case(s)`;
    }
    case "farmland": {
      if (!covered) return "";
      const area = toNum(s.eligible_area_m2);
      const pct = toNum(s.pct_of_parcel);
      return area != null ? `${formatArea(area)} eligible${pct != null ? ` (${pct}% of parcel)` : ""}` : "";
    }
    default:
      return "";
  }
}

// One compact transaction line for the report's history section (newest-first, capped upstream at 20).
function reportTxLine(r: Record<string, unknown>): string {
  const date = typeof r.transaction_date === "string" ? r.transaction_date.split("T")[0] : "?";
  const type = PROPERTY_TYPES[Number(r.property_type)] || `Type ${r.property_type}`;
  const market = MARKET_TYPES[Number(r.market_type)] || `Market ${r.market_type}`;
  const price = formatPLN(toNum(r.price_gross));
  const area = toNum(r.usable_area_m2);
  const ppm2 = toNum(r.price_per_m2);
  const tail = [area != null ? formatArea(area) : null, ppm2 != null ? `${formatPLN(ppm2)}/m2` : null].filter(Boolean).join(", ");
  return `  - ${date} — ${type}, ${market} — ${price}${tail ? ` (${tail})` : ""}`;
}

// One market-context price level as a readable line. coverage is the statistical canon: suppressed hides
// the median (too few sales), no_data means no sample.
function reportMarketLine(label: string, lvl: ReportMarketLevel): string {
  if (lvl.coverage === "no_data") return `  - ${label}: no data`;
  if (lvl.median_price_per_m2 == null) return `  - ${label}: withheld (only ${lvl.n} sale(s) — too few to publish)`;
  const flag = lvl.coverage === "low_sample" ? " [small sample]" : "";
  return `  - ${label}: ${formatPLN(lvl.median_price_per_m2)}/m2 (n=${lvl.n})${flag}`;
}

// Human-readable billing outcome for the report's footer: the net numbers plus WHY (billing.rule).
function reportBillingFooter(billing: { charged: number; refunded: number; rule: string }): string {
  const why: Record<string, string> = {
    full: "billed in full — at least one enrichment layer had data",
    core_floor: "resolved, but no enrichment layer had data — only the parcel-core floor is billed, the rest refunded",
    total_miss_refund: "fully refunded — the parcel could not be resolved",
    not_computed_refund: "fully refunded — no layer could be computed right now (retry-worthy)",
    disabled: "fully refunded — the composite report is temporarily unavailable",
    demo: "no charge (demo / web session)",
  };
  const reason = why[billing.rule] ?? billing.rule;
  return `Billing: ${billing.charged} charged, ${billing.refunded} refunded — ${reason}`;
}

// The layers rendered in report order, with a readable label each.
const REPORT_LAYER_ORDER: Array<[string, string]> = [
  ["flood", "Flood risk"],
  ["heritage", "Heritage listing"],
  ["landslide", "Landslide risk"],
  ["surroundings", "Nuisance surroundings"],
  ["transit", "Public transport"],
  ["planning", "Planning (general plan)"],
  ["buildings", "Buildings"],
  ["permits", "Building activity"],
  ["farmland", "Agricultural land"],
];

export function formatParcelReport(res: ParcelReportResponse): string {
  const p = res.parcel;
  const id = p.parcel_id ?? p.parcel_key ?? "(parcel id requires a paid plan)";

  // A total miss, or the layer is unavailable: the core never resolved. Say so plainly (the billing
  // footer explains the refund). An unavailable layer also surfaces as a top-level not_computed, but it
  // is NOT transient — so it gets its own header (no misleading "retry").
  if (res.coverage !== "covered") {
    const head = res.coverage === "not_covered"
      ? `Parcel ${id} could not be resolved — it is not in our cadastral copy.`
      : res.billing.rule === "disabled"
        ? `The composite report is temporarily unavailable for parcel ${id}.`
        : `Parcel ${id} could not be resolved right now (a live lookup did not finish — retry).`;
    return `${head}\n\n---\n${reportBillingFooter(res.billing)}`;
  }

  const lines: string[] = [`Parcel report: ${id}`];

  // Core identity + facts.
  const place = [p.district, p.county_name, p.voivodeship_name].filter(Boolean).join(", ");
  if (place) lines.push(place);
  const facts = [
    p.area_m2 != null ? `Area: ${formatArea(p.area_m2)}` : null,
    p.land_use ? `Land use: ${p.land_use}` : null,
    p.mpzp_designation ? `Plan designation: ${p.mpzp_designation}` : null,
  ].filter(Boolean);
  if (facts.length > 0) lines.push(facts.join(" | "));
  const asOf = res.as_of ? ` (as of ${res.as_of.split("T")[0]})` : "";
  lines.push(`Core: covered${asOf}`);

  // Enrichment layers (each four-state explicit).
  lines.push("", "Enrichment layers:");
  const sections = res.sections;
  for (const [key, label] of REPORT_LAYER_ORDER) {
    const s = sections[key as keyof typeof sections] as ReportSection;
    const detail = reportSectionDetail(key, s);
    lines.push(`- ${label}: ${fourStateGloss(s.coverage)}${detail ? ` — ${detail}` : ""}`);
  }

  // Transaction history.
  const tx = sections.transactions;
  const total = toNum(tx.total) ?? 0;
  const rows = Array.isArray(tx.data) ? (tx.data as Array<Record<string, unknown>>) : [];
  lines.push("", `Transaction history: ${fourStateGloss(tx.coverage)}`);
  if (tx.coverage === "covered") {
    lines.push(`  ${total} recorded${rows.length < total ? ` (showing newest ${rows.length})` : ""}:`);
    for (const r of rows) lines.push(reportTxLine(r));
    if (rows.length < total) lines.push(`  … call search_transactions(parcelId="${p.parcel_id ?? id}") for the full history.`);
  }

  // Local price context (market_context — statistical canon).
  const m: ReportMarketContext = sections.market_context;
  lines.push("", "Local price context (median zł/m², last 12 months):");
  if (m.coverage === "no_data") {
    lines.push("  - no data for this location");
  } else {
    lines.push(reportMarketLine("County", m.county));
    lines.push(reportMarketLine(m.locality.district ? `Locality (${m.locality.district})` : "Locality", m.locality));
  }

  // Municipal context (location_context — demographics + infrastructure signals).
  const loc: ReportLocationContext = sections.location_context;
  lines.push("", `Municipal context${loc.gmina_teryt ? ` (gmina ${loc.gmina_teryt})` : ""}:`);
  const demo = loc.demographics;
  if (demo.coverage === "no_data") {
    lines.push("  - Demographics: no data");
  } else {
    const inds = Object.values(demo.indicators).slice(0, 4);
    const indText = inds.map((i) => {
      const years = Object.keys(i.values);
      const latest = years.length > 0 ? i.values[years[years.length - 1]!] : null;
      return latest != null ? `${i.name} ${formatNumber(latest)} ${i.unit}`.trim() : i.name;
    });
    lines.push(`  - Demographics${demo.name ? ` (${demo.name})` : ""}: ${indText.length > 0 ? indText.join("; ") : "—"}`);
  }
  const infra = loc.infra_signals;
  if (infra.coverage === "no_data") {
    lines.push("  - Infrastructure signals: no data");
  } else {
    const tenderTotal = Object.values(infra.tenders.by_category).reduce((a, b) => a + b, 0);
    const kposk = infra.kposk.in_agglomeration ? "in a collective-sewerage agglomeration" : "not in a collective-sewerage agglomeration";
    lines.push(`  - Infrastructure signals: ${tenderTotal} municipal tender(s) in the last ${infra.tenders.window_months} months; ${kposk}`);
  }

  if (res.note) lines.push("", res.note);
  lines.push("", "---", reportBillingFooter(res.billing));
  return lines.join("\n");
}
