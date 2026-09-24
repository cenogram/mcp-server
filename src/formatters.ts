import type { Transaction, TransactionsResponse, TransactionsSummary, StatsResponse, PricePerM2Row, HistogramBin, ParcelSearchResponse, ParcelResolveResponse, ParcelListRow, ParcelListResponse, StreetListResponse, ParcelFeature, ParcelFeatureCollection, CorpusCoverage, SpatialSearchResponse, SpatialFeature, CompareResponse, LocationItem, LocationSearchItem, RentalYieldResponse, RentalYieldLocationsResponse, PriceSpreadResponse, PriceSpreadLocationsResponse, FloodRiskResponse, FloodRiskLocationsResponse, ValuationResponse, ValuationComparable, Percentiles, TxWindow, BuildingBreakdownResponse, BuildingAgeEstimate, FloodBreakdownResponse, HeritageBreakdownResponse, LandslideBreakdownResponse, NatureBreakdownResponse, SubsurfaceBreakdownResponse, SurroundingsResponse, SurroundingsRow, RoadsBreakdownResponse, RoadsBreakdownRow, TransitBreakdownResponse, PermitsResponse, PlanningResponse, PlanningRow, FarmlandResponse, DemographicsResponse, DemographicsIndicator, InfrastructureSignalsResponse, ParcelReportResponse, ParcelLandClassResponse, ReportSection, ReportMarketContext, ReportMarketLevel, ReportLocationContext } from "./api-client.js";
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
      ? `No price statistics found for "${location}". Note: this endpoint only covers residential units (apartments), and matches on name only. Call list_locations(search=...) to confirm the name is a valid RCN district (rcn_district).`
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
    // A miss here is not proof the parcel does not exist: coverage is near-complete but not the whole
    // register and not live, so "no match" points to a recent change, an odd spelling, or a parcel we
    // do not hold — saying so is the difference between a useful next step and a model reporting that
    // the land does not exist.
    return `No parcels found matching "${query}". This searches the parcels we hold, which are near-complete coverage of the cadastral register rather than the whole of it, so a miss is more likely a recent change or a mistyped prefix than evidence that no such parcel exists — ${CORPUS_COVERAGE_HINT}${formatCorpusCoverage(res.corpus_coverage)}`;
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
  return lines.join("\n") + formatCorpusCoverage(res.corpus_coverage);
}

// ── Parcel collection formatting ───────────────────────────────────

// Gated identity renders as a sentence, never as "null" or "undefined": a reader who meets an empty
// slot concludes the parcel has no number, which is a different (and false) statement.
const PARCEL_IDENTITY_WITHHELD = "(parcel number requires a paid plan)";

// ── Corpus coverage: printed with every parcel collection ──────────────────────────────────────
//
// The parcel endpoints answer from the cadastral register we hold, which is near-complete but not the
// whole of it and not live. Every empty or short list therefore has two possible readings — "the land
// is not there" and "we do not have it (yet)" — and the second is the safer default. These renderers
// exist so a model on the other side is never left to pick between them on its own.
const CORPUS_COVERAGE_HINT =
  "looking the parcel up by its FULL cadastral id (resolve_parcel) goes down a different path that can confirm and add a parcel we do not yet hold.";

// Said only when there is a measurement to report; without one the server's own note is passed
// through instead of a guess. The two unmeasured states are NOT the same statement — an area query
// cannot be sized at all, while a named scope may simply never have been measured — and the note is
// what tells them apart, so inventing one sentence for both is how a caller who asked by scope ends
// up being told to ask by scope.
const COVERAGE_UNMEASURED_FALLBACK =
  "we hold near-complete coverage of the cadastral register, though not the whole of it and not live, " +
  "and how much of it this query covers is not measured. Read the answer above as what we hold, not " +
  "as what is there.";

/** A finite number or nothing: a field arriving as a string must not reach `.toFixed` or `.toLocaleString`. */
function finiteOrNull(value: unknown): number | null {
  return typeof value === "number" && Number.isFinite(value) ? value : null;
}

// The scope in words. A count we do not have is described, never printed — "these null counties" is
// worse than saying nothing about how many.
function coverageScopeLabel(counties: number | null): string {
  if (counties === 1) return "this county";
  if (counties != null && counties > 1) return `these ${counties.toLocaleString("en-US")} counties`;
  return "the counties this query addresses";
}

// Rounding must not turn a real gap into "we have everything", nor a real holding into "we have
// nothing": both ends get a bounded form instead of a misleading 100.0% / 0.0%.
// The two counts we are about to print decide the boundary, not the rounded share the server sent —
// the server's own value is already rounded and reads "0" for a real, tiny holding.
function coveragePctLabel(held: number, source: number, reported: number | null): string {
  const exact = (held / source) * 100;
  if (held > 0 && exact < 0.05) return "<0.1%";
  if (held < source && exact >= 99.95) return ">99.9%";
  return `${(reported ?? exact).toFixed(1)}%`;
}

// Printed only when it says something: a fully covered scope needs no caveat. Nulls are NOT rendered
// as zeroes — "we did not size this" and "there is nothing here" must never look alike.
export function formatCorpusCoverage(cov: CorpusCoverage | null | undefined): string {
  if (!cov) return "";
  // The date of the measurement travels with it. A share of the register without one cannot be told
  // apart from a share measured half a year ago, and the two lead to different decisions.
  const asOf = typeof cov.as_of === "string" ? cov.as_of.split("T")[0] : null;
  const held = finiteOrNull(cov.held_parcels);
  const source = finiteOrNull(cov.source_parcels);

  if (held != null && source != null && source > 0) {
    if (held >= source) return "";
    const scope = coverageScopeLabel(finiteOrNull(cov.counties));
    const pct = coveragePctLabel(held, source, finiteOrNull(cov.held_pct));
    const stamp = asOf ? `, measured ${asOf}` : "";
    return `\n\nCOVERAGE: we hold ${held.toLocaleString("en-US")} of the ${source.toLocaleString("en-US")} parcels the cadastral register lists for ${scope} (${pct}${stamp}). A short or empty list above reflects that, not the land.`;
  }

  const note = typeof cov.note === "string" && cov.note.trim().length > 0
    ? cov.note.trim()
    : COVERAGE_UNMEASURED_FALLBACK;
  const stamp = asOf ? ` Our latest coverage measurement is dated ${asOf}.` : "";
  return `\n\nCOVERAGE: ${note}${stamp}`;
}

// Collect every [lng, lat] pair out of a GeoJSON coordinates tree. The same route answers with a
// Polygon or a MultiPolygon depending on the parcel, so walking the nesting is what keeps one
// renderer correct for both; an unexpected shape yields no pairs instead of throwing.
function collectPositions(node: unknown, out: Array<[number, number]>): void {
  if (!Array.isArray(node)) return;
  if (node.length >= 2 && typeof node[0] === "number" && typeof node[1] === "number") {
    out.push([node[0], node[1]]);
    return;
  }
  for (const child of node) collectPositions(child, out);
}

// Mid-point of the outline's bounding box, deliberately NOT called a centroid — it is here so a
// reader can tell where a parcel is without parsing the ring, and a true centroid would be more
// arithmetic for a number nobody asked for. Labelled "outline centre" wherever it is rendered.
function outlineCentre(geometry: ParcelFeature["geometry"]): { lat: number; lng: number } | null {
  if (!geometry) return null;
  const positions: Array<[number, number]> = [];
  collectPositions(geometry.coordinates, positions);
  if (positions.length === 0) return null;
  let minLng = Infinity, maxLng = -Infinity, minLat = Infinity, maxLat = -Infinity;
  for (const [lng, lat] of positions) {
    if (lng < minLng) minLng = lng;
    if (lng > maxLng) maxLng = lng;
    if (lat < minLat) minLat = lat;
    if (lat > maxLat) maxLat = lat;
  }
  return { lat: (minLat + maxLat) / 2, lng: (minLng + maxLng) / 2 };
}

/**
 * The address line of one parcel row, or null when there is nothing to print.
 *
 * A street we worked out ourselves is tagged, in the same words the transaction rows use, so an
 * approximated street is never read back as one on record. A row with no street prints no address
 * line at all rather than "none": the answer to "which street is this parcel on" is that we hold
 * none, and most rural parcels are in that position — a line saying so on every one of them would
 * bury the rows that do carry an address. The absence is described once, in the tool description.
 */
function formatParcelAddress(p: ParcelListRow): string | null {
  if (p.street == null || p.street === "") return null;
  const approx = p.address_source === "approx_high" || p.address_source === "approx_low";
  const tag = approx ? " [street approximate — derived, not from the record]" : "";
  return [p.street, p.building_number].filter(Boolean).join(" ") + tag;
}

// The light collection: identifiers, district, centroid, and the street address where we hold one.
// No outline and no surface — see the tool description for why, and for which call returns each.
export function formatParcelList(res: ParcelListResponse, scope: string, creditsRefunded = false): string {
  if (res.data.length === 0) {
    const lines = [
      `No parcels found for ${scope}. The filter is valid; nothing matched it AMONG THE PARCELS WE HOLD, which are near-complete coverage of the cadastral register rather than the whole of it. So this is not evidence that the area has no parcels.`,
    ];
    // Say the tokens came back only when the header confirmed it — never infer a refund from the shape.
    if (creditsRefunded) lines.push("The tokens for this call were refunded — an unmatched street page costs nothing.");
    const streets = res.suggestions?.streets ?? [];
    const numbers = res.suggestions?.building_numbers ?? [];
    if (streets.length > 0) {
      lines.push("Close street names on record here — matching is case- and accent-insensitive but does not inflect, so retry with one of these, each a ready next call:");
      for (const s of streets) lines.push(`  - street="${s}"`);
    }
    if (numbers.length > 0) {
      lines.push("The street is on record but that number is not; these are the numbers held on it, in the compound form the register uses — retry with one of them:");
      for (const n of numbers) lines.push(`  - buildingNumber="${n}"`);
    }
    if (streets.length === 0 && numbers.length === 0) {
      lines.push("Widening the area or dropping a surface filter is the next step.");
    }
    lines.push(CORPUS_COVERAGE_HINT);
    return lines.join("\n") + formatCorpusCoverage(res.corpus_coverage);
  }

  const lines: string[] = [`Found ${res.data.length} parcel${res.data.length === 1 ? "" : "s"} for ${scope}:\n`];
  for (const [i, p] of res.data.entries()) {
    const district = p.district ?? "Unknown";
    const location = p.lat != null && p.lng != null
      ? `${p.lat.toFixed(4)}°N, ${p.lng.toFixed(4)}°E`
      : "no outline held";
    lines.push(`${i + 1}. ${p.parcel_id ?? PARCEL_IDENTITY_WITHHELD}`);
    lines.push(`   District: ${district} | Location: ${location}`);
    const address = formatParcelAddress(p);
    if (address) lines.push(`   Address: ${address}`);
  }

  // has_more is a fact about paging, not about coverage — and it is the difference between "these
  // are the parcels here" and "these are the first ones". Saying so is the whole point of printing it.
  if (res.pagination.has_more && res.pagination.next_cursor) {
    lines.push(`\nMore parcels match than are shown. Pass cursor="${res.pagination.next_cursor}" to get the next page (the value is opaque — pass it back unchanged).`);
  } else if (res.pagination.has_more) {
    lines.push(`\nMore parcels match than are shown, but no cursor came back — narrow the filter instead of paging.`);
  }
  lines.push(`\nNo outline and no surface on these rows: call list_parcels_in_area with includeGeometry=true (or a polygon) for outlines, or get_parcel_report for one parcel in full.`);
  return lines.join("\n") + formatCorpusCoverage(res.corpus_coverage);
}

/**
 * The street catalogue for one scope.
 *
 * An empty list is said in words, because an empty list and an unavailable catalogue are different
 * answers and the caller cannot tell them apart from the shape alone. The unavailable case never
 * reaches this function — it is answered as an error, on purpose.
 *
 * ⚠ No tool calls this — the catalogue answers over REST only, for the reasons written where its
 * registration would have gone. It is kept here because the route is live.
 */
export function formatStreetList(res: StreetListResponse, q: string, scope: string): string {
  if (res.data.length === 0) {
    // TWO things produce an empty list here and the answer names both, because it cannot tell which
    // one happened. Naming only one is what the earlier wording did — it led with "a rural area can
    // come back empty", which is false in its premise for a city and sends the caller off after a
    // precinct number instead of a shorter fragment. An answer may not assert something about a set
    // it has not checked.
    //
    // A third reason used to belong here and no longer does: matching now reads ANYWHERE inside the
    // name, so a name stored with its generic member in front of it ("ulica X", "aleja X") answers
    // to "X". That was the single largest source of empty answers and it is gone.
    return `No street name in ${scope} matches "${q}". The scope is valid and nothing we hold there contains that fragment — two different things can put you here, and this answer cannot tell them apart:\n`
      + `  1. We hold no street addresses in this area at all. Coverage follows the addresses themselves and is thin outside towns, so rural parcels are often there while their streets are not — for one of those, resolve_parcel with the precinct name and the parcel number is the way in, not a street.\n`
      + `  2. There is genuinely no such street here.\n`
      + `Matching is case- and accent-insensitive but does not inflect, so pass the name in the nominative ('karmelicka' or 'Karmelicką' both find 'Karmelicka', but 'Karmelickiej' does not).`;
  }

  const lines: string[] = [
    `${res.data.length} street name${res.data.length === 1 ? "" : "s"} in ${scope} matching "${q}":\n`,
  ];
  for (const row of res.data) {
    // Only the derived names are tagged. Marking both would double the length of every line to say
    // "ordinary" on most of them; the untagged case is explained once, below the list.
    const tag = row.address_source === "approx" ? " [approximate — derived, not from the record]" : "";
    lines.push(`  - ${row.street}${tag}`);
  }
  lines.push(
    "\nUntagged names are on record; tagged ones we worked out for parcels the record left without a street. " +
    "Any of these can be passed to list_parcels_in_area as street= inside the same scope.",
  );
  if (res.pagination.has_more) {
    // No cursor by design, so the honest next step is a longer fragment, not a second page. Saying
    // so stops the caller looking for a paging parameter that does not exist.
    lines.push(`More names match than are shown (the answer is capped at ${res.pagination.limit}). Type more of the name — there is no second page.`);
  }
  return lines.join("\n");
}

// A geometric collection: each feature carries the full outline. The GeoJSON goes out verbatim —
// it is what the caller asked for — with the outline centre alongside it so the answer is readable
// without parsing every ring.
export function formatParcelFeatures(res: ParcelFeatureCollection, scope: string): string {
  if (res.features.length === 0) {
    return `No parcels found in ${scope}. The area is valid and holds no parcel WE CAN PLACE THERE — coverage is near-complete but not the whole cadastral register and not live, so read this as "we have nothing mapped here", not as "there is nothing here". ${CORPUS_COVERAGE_HINT}${formatCorpusCoverage(res.corpus_coverage)}`;
  }

  const lines: string[] = [`Found ${res.features.length} parcel${res.features.length === 1 ? "" : "s"} in ${scope}:`];
  if (res.truncated) {
    // Stated before the data, not after it: a reader who meets the list first reads it as complete.
    lines.push(`TRUNCATED — more of the parcels we hold match than the limit returns, and the ones below are an arbitrary subset, not the first, nearest or largest. Read this as a sample of the area, never as its parcel list. A smaller area returns everything WE HOLD there, which is not the same as every parcel there: coverage is near-complete but not the whole cadastral register and not live.`);
  }
  lines.push("");

  for (const [i, f] of res.features.entries()) {
    const district = f.properties.district ?? "Unknown";
    const centre = outlineCentre(f.geometry);
    const where = centre ? `${centre.lat.toFixed(4)}°N, ${centre.lng.toFixed(4)}°E` : "unknown";
    lines.push(`${i + 1}. ${f.properties.parcel_id ?? PARCEL_IDENTITY_WITHHELD}`);
    lines.push(`   District: ${district} | Outline centre: ${where}`);
    lines.push(`   Outline (GeoJSON, WGS84): ${f.geometry ? JSON.stringify(f.geometry) : "not returned"}`);
  }
  return lines.join("\n") + formatCorpusCoverage(res.corpus_coverage);
}

// ── Parcel resolve formatting ──────────────────────────────────────

export function formatParcelResolve(res: ParcelResolveResponse): string {
  // not_computed FIRST: it is not a miss. The lookup did not finish (a live confirmation failed, or the
  // name sits on more precincts than one search covers), so telling the caller to check the spelling would
  // be advice about a question we never answered.
  if (res.coverage === "not_computed") {
    return "The lookup could not be completed, so this says nothing about whether the parcel exists (the credit is refunded). Best next step: pass the full cadastral id in parcelId — that path does not go through the name at all. A retry helps only if a live confirmation timed out; it will not change the answer for a name carried by very many precincts.";
  }
  if (res.coverage === "not_covered" || res.matches.length === 0) {
    return "No parcel matched (the credit is refunded). Two different causes, and with near-complete coverage the first is now the common one: the name may be spelled differently than the register spells it (for 'name + number' it is matched against the gmina name and the cadastral precinct (obręb) name, exactly), OR we do not hold the parcel — coverage is near-complete but not the whole cadastral register and not live, so a discovery lookup can still miss a parcel that exists. This is not a confirmation that the parcel does not exist. Passing the FULL cadastral id in parcelId goes down a different path that can confirm and add a parcel we do not yet hold." + formatCorpusCoverage(res.corpus_coverage);
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
  // State the cost on the success path too, not only via the "refunded" wording on a miss — so a
  // caller sees the price whatever the outcome. Resolving is free, and the server sends no credit
  // header on a free call (the footer helper stays empty), so the line is stated here explicitly.
  lines.push(`\nQuery cost: 0 API tokens — resolving a parcel is free.`);
  return lines.join("\n") + formatCorpusCoverage(res.corpus_coverage);
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

// ── Building age ────────────────────────────────────────────────────

// One clause describing a building's construction age, or "" when there is nothing to say at all.
//
// Two things this deliberately does NOT do. It does not drop a refusal: every status other than an
// absent field produces a sentence, because a reader who sees no age line concludes the age was never
// discussed rather than that it could not be established. And it does not print a bare year: the value
// is an interval derived from permit records, and collapsing it to one number would present an
// estimate as a registry fact — which is exactly what a valuer must not paste into an appraisal.
export function formatBuildingAge(age: BuildingAgeEstimate | undefined): string {
  // Field absent = the API on the other side does not send it yet (or was rolled back). Say nothing.
  if (age == null) return "";
  // Appended to EVERY branch, not just to the dated one: a rebuild or an extension is the most
  // decision-relevant thing we know about a building we could not date, and dropping it on the
  // ambiguous branches would hide it exactly where the reader has least else to go on.
  const works = age.last_works_year != null ? `; later works ${age.last_works_year}` : "";
  const clause = (body: string): string => `construction year not established: ${body}${works}`;
  switch (age.status) {
    case "estimated": {
      // "estimated" without both edges of the interval is a contradiction, not a silent case: say so
      // rather than dropping the line, because a dropped line reads as "nobody looked at the age".
      if (age.year_from == null || age.year_to == null) {
        return clause("an estimate came back without the interval it has to carry, so there is no honest year to state");
      }
      const range = age.year_from === age.year_to ? `${age.year_from}` : `${age.year_from}-${age.year_to}`;
      // The range comes first and the single year after it. That order is the message: the range is the
      // part that was measured against real first sales, the single year is the least certain number
      // here, and a reader who sees a year first will quote the year.
      const point = age.year_point != null ? `, point estimate ~${age.year_point} (least certain)` : "";
      // Spelled out, not shortened to "high confidence": this grades how well the building was tied to
      // a construction record, and our own measurement found it does NOT order the error on the year —
      // the top grade carries the worst hard error on one of the two routes. A reader (human or model)
      // who meets a bare grade next to a pair of years reads it as certainty about the years and passes
      // that on to an appraisal, so the clause has to name what is being graded and what is not.
      const conf = age.confidence ? `, ${age.confidence} confidence in the permit match (not in the year)` : "";
      return `built range ${range}${point} [estimate from permit records, not a registry date${conf}]${works}`;
    }
    case "older_than_register":
      // Deliberately says what we could not establish, not that the building is old: the same empty
      // result also appears when a split or merge renumbered the land after the works were registered.
      return clause("no construction record for this land falls inside our coverage, which starts in 2016 — the works may predate it, or the land may have been renumbered since");
    case "ambiguous_permits":
    case "ambiguous_buildings":
    case "ambiguous_both":
      return clause("construction records for this land could not be tied to this specific building");
    case "no_parcel_key":
      return clause("this land has no cadastral identifier to match records against");
    case "not_applicable":
      return clause("this building has no outline we can place on the land");
    case "not_computed":
      return clause("the lookup could not be completed for this request — retrying later may return one");
    default:
      // Reachable in production despite the union: the status set is closed in the types, not at
      // runtime, and this package ships separately from the service it reads. A status added on the
      // other side would otherwise render as no line at all — "the age was never discussed" instead of
      // "we cannot state it", which is the one misreading this whole function exists to prevent.
      return clause("the answer came back in a form this client version does not recognise — a newer client may be able to state it");
  }
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

    // Age: a REFUSAL renders as a sentence, never as a missing line. A model reading this has to be
    // able to tell "we cannot date this building" from "nobody mentioned the age", and an omitted line
    // reads as the second. Absent field = an older API on the other side; then we say nothing at all.
    const age = formatBuildingAge(b.age_estimate);
    if (age) cells.push(age);

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

// ── Nature (forest amenity + protected-area restriction) formatting (per-transaction, per-parcel) ───

// Sharpest overlapping protection form → readable label (protection_rank 1 = sharpest … 6 = loosest).
const PROTECTION_RANK_LABEL: Record<number, string> = {
  1: "national park",
  2: "nature reserve",
  3: "Natura 2000",
  4: "landscape park",
  5: "protected landscape",
  6: "a minor protection form, or a buffer zone",
};

// building_restriction → what the classification means. It names the SOURCE of the restriction, never the
// outcome of a specific case, and never renders as legal advice.
const BUILDING_RESTRICTION_NOTE: Record<string, string> = {
  statutory_ban: "a build ban that follows directly from the Nature Protection Act (national parks and reserves), with statutory exceptions — not a ruling on any specific project",
  conditional: "no blanket statutory ban; restrictions depend on the act that established the area",
};

// What an EMPTY breakdown is allowed to say, by `coverage`. The distinction is the whole point: a settled
// negative ("there is no forest and no protected area here") is a claim about the world, and we may only
// make it when the plots were really checked. Before the reference data lands, an empty response means
// nothing at all — rendering it as a negative would put a fact we never established into a model's mouth.
const NATURE_EMPTY_MESSAGE: Record<"covered_no_data" | "not_covered" | "unknown", string> = {
  // Earned: the plots were evaluated and neither signal is present. Still hedged on the id, because an
  // unknown transaction id also yields an empty result and we cannot tell the two apart here.
  covered_no_data:
    "No forest within 2 km and no protected natural area overlaps this transaction's parcels (or the id was not found). An empty result is never a statement that building is allowed — this layer does not cover local zoning plans, planning-permission decisions or areas under designation.",
  // Not earned: nothing was checked. Say that, and say plainly what it does NOT mean.
  not_covered:
    "This layer holds no nature reference data for these parcels yet, so nothing was checked. That is NOT a finding that there is no forest nearby and no protected natural area here — it means the check could not be made. The credit for this call is refunded; try again later.",
  // A server that predates the coverage field: we cannot tell the two cases apart, so we assert neither.
  unknown:
    "No forest or protected-area signal was returned for this transaction's parcels. This response does not distinguish 'checked, nothing found' from 'not checked' (the id may also be unknown), so do not read it as a finding that there is no forest or protected area — and never as a statement that building is allowed.",
};

export function formatNatureBreakdown(res: NatureBreakdownResponse): string {
  const { data, truncated } = res;
  // A row exists ONLY on a signal (forest within 2 km OR an overlapping protected area). Empty is not one
  // situation but three, and `coverage` is what tells them apart (see the table above).
  if (data.length === 0) {
    const key = res.coverage === "covered_no_data" || res.coverage === "not_covered" ? res.coverage : "unknown";
    return NATURE_EMPTY_MESSAGE[key];
  }

  const lines: string[] = [
    `Per-parcel nature breakdown (${data.length} parcel${data.length === 1 ? "" : "s"} with a forest or protected-area signal):`,
    "",
  ];

  data.forEach((r, i) => {
    const cells: string[] = [];

    // Forest: distance in metres; 0 = the parcel overlaps forest (with an optional overlap share).
    const dist = r.forest_distance_m != null ? Number(r.forest_distance_m) : null;
    if (dist != null && Number.isFinite(dist)) {
      if (dist === 0) {
        const ov = r.forest_overlap_pct != null ? Number(r.forest_overlap_pct) : null;
        cells.push(`forest: overlaps the parcel${ov != null && Number.isFinite(ov) ? ` (${Math.round(ov)}% of area)` : ""}`);
      } else {
        cells.push(`forest: ${dist} m away`);
      }
    }

    // Protection: sharpest form, the build-restriction class + its meaning, overlap share, named areas.
    if (r.protection_rank != null) {
      const label = PROTECTION_RANK_LABEL[r.protection_rank] ?? `protection rank ${r.protection_rank}`;
      cells.push(`protection: ${label}`);
      if (r.building_restriction) {
        const note = BUILDING_RESTRICTION_NOTE[r.building_restriction];
        cells.push(`build restriction: ${r.building_restriction}${note ? ` (${note})` : ""}`);
      }
      if (r.protected_overlap_pct != null) {
        const p = Number(r.protected_overlap_pct);
        if (Number.isFinite(p)) cells.push(`${Math.round(p)}% of the parcel under protection`);
      }
      if (Array.isArray(r.protected_areas) && r.protected_areas.length > 0) {
        const labels = r.protected_areas.map((a) => a.name ?? a.form).filter((x): x is string => !!x);
        if (labels.length > 0) cells.push(`areas: ${labels.join("; ")}`);
      }
    }

    lines.push(`${i + 1}. ${cells.join(" | ")}`);
  });

  if (truncated) {
    lines.push("", "Showing the first 500 parcels (the transaction is linked to more).");
  }

  // Two legal guards: an empty result is not permission to build, and the restriction class
  // names the source of the limit (statute vs the establishing act), not the outcome of any specific case.
  lines.push(
    "",
    "Note: forest_distance_m is the nearest forest within 2 km (0 = the parcel overlaps forest). building_restriction names the SOURCE of the restriction (statute vs the act that established the area), not the outcome of any permitting case; an empty result is never a statement that building is allowed — this layer does not cover local zoning plans, planning-permission decisions or areas under designation. A buffer zone around a park or reserve IS reported, as form 'buffer_zone' at rank 6, and never as a statutory ban. Forest coverage is mainly publicly-managed land, so private forests may be incomplete.",
  );

  return lines.join("\n");
}

// ── Subsurface breakdown formatting (per-transaction, per-parcel) ───

// Mineral class → what it means for the parcel (distinction 1, the one that makes a "mining terrain" line
// meaningful: a gravel pit is not a coal mine). Neutral EN; the source register is never named.
const MINERAL_CLASS_NOTE: Record<string, string> = {
  subsidence: "extraction with surface deformation — the actual mining-damage risk",
  surface: "open-pit working — mostly local impact (neighbourhood, noise)",
  fluid: "borehole extraction — usually no surface deformation, but a concession and zones still apply",
  other: "mineral not classified",
};

// Carries all three load-bearing distinctions in one closing note: (1) mining terrain = advisory signal,
// approximate location, verify with the mining-supervision authority; (2) a reservoir's extent alone is
// not a restriction; (3) absence is never 'safe'. No source register or institution is named.
const SUBSURFACE_NOTE =
  "Note: a mining terrain is a legally defined zone of anticipated mining influence; its mapped location is approximate — an intersection is an advisory signal to verify with the competent mining-supervision authority (named per terrain as the oversight authority), not a legal determination. Some terrains with status 'active' carry a valid_until already in the past, because the register entry can lag behind the expiry of a concession. A groundwater reservoir's extent alone imposes NO restriction; a restriction would come only from an established protection zone, which is not published here. Absence of a match is never asserted as 'safe': the mining register covers concession areas, so historic or shallow workings may not appear, and an absent reservoir does not mean there is no groundwater beneath the parcel.";

// pct fields arrive as NUMERIC → string over the wire; round for display.
function subsurfacePct(v: number | string | null): number | null {
  if (v == null) return null;
  const n = Number(v);
  return Number.isFinite(n) ? Math.round(n) : null;
}

export function formatSubsurfaceBreakdown(res: SubsurfaceBreakdownResponse): string {
  const { data, truncated } = res;
  // TWO-STATE (distinction 3): empty covers both "no linked parcel overlaps either layer" and
  // "unknown/garbage id" (REST returns 200 + [] for both). One neutral message fits both, and it NEVER
  // asserts safety — the mining register covers concession areas, so historic workings may be absent.
  if (data.length === 0) {
    return "No mapped mining terrain or major groundwater reservoir overlaps this transaction's parcels (or the id was not found). Absence of mapped data is never asserted as 'safe' — the mining register covers concession areas, so historic or shallow workings may not appear.";
  }

  const lines: string[] = [
    `Per-parcel subsurface breakdown (${data.length} parcel${data.length === 1 ? "" : "s"} overlapping a mining terrain or a major groundwater reservoir):`,
    "",
  ];

  let n = 0;
  for (const r of data) {
    const cells: string[] = [];

    // Mining dimension. mineral_class (distinction 1) is spelled out — a "terrain" line without it is an
    // alarm with no content.
    if (r.mining_status) {
      const cls = r.mineral_class ?? null;
      const clsNote = cls ? MINERAL_CLASS_NOTE[cls] : undefined;
      const pct = subsurfacePct(r.mining_overlap_pct);
      cells.push(
        `mining terrain: ${r.mining_status}${cls ? `, ${cls}${clsNote ? ` (${clsNote})` : ""}` : ""}${pct != null ? `, ${pct}% of the parcel in the terrain` : ""}`,
      );
      if (Array.isArray(r.mining_terrains) && r.mining_terrains.length > 0) {
        const labels = r.mining_terrains
          .map((t) => {
            const parts: string[] = [];
            if (t.name) parts.push(t.name);
            if (t.oversight_authority) parts.push(`oversight: ${t.oversight_authority}`);
            if (t.valid_until) parts.push(`valid until ${t.valid_until}`);
            if (t.revoked_on) parts.push(`revoked ${t.revoked_on}`);
            return parts.length > 0 ? parts.join(", ") : null;
          })
          .filter((s): s is string => !!s);
        // Say only what the payload supports: the list reached its cap. Never "there are more" —
        // neither derivation keeps the pre-cap total, so that claim would be invented here.
        if (labels.length > 0) cells.push(`terrains: ${labels.join("; ")}${r.mining_terrains_capped ? " (list reached the 5-entry cap)" : ""}`);
      }
    }

    // Groundwater dimension. The extent-only caveat (distinction 2) rides on the line itself so it can
    // never be quoted as a restriction.
    if (r.groundwater_status) {
      const pct = subsurfacePct(r.groundwater_overlap_pct);
      cells.push(
        `groundwater reservoir: ${r.groundwater_status} (reservoir extent only — not a restriction)${pct != null ? `, ${pct}% of the parcel in the reservoir` : ""}`,
      );
      if (Array.isArray(r.groundwater_bodies) && r.groundwater_bodies.length > 0) {
        const labels = r.groundwater_bodies
          .map((b) => {
            const parts: string[] = [];
            if (b.number != null) parts.push(`no. ${b.number}`);
            if (b.name) parts.push(b.name);
            if (b.documented_year != null) parts.push(`documented ${b.documented_year}`);
            if (b.depth_from_m != null) parts.push(`from ${b.depth_from_m} m`);
            if (b.medium_type) parts.push(b.medium_type);
            return parts.length > 0 ? parts.join(", ") : null;
          })
          .filter((s): s is string => !!s);
        if (labels.length > 0) cells.push(`reservoirs: ${labels.join("; ")}${r.groundwater_bodies_capped ? " (list reached the 5-entry cap)" : ""}`);
      }
    }

    // Defense-in-depth: the API CHECK guarantees each row carries ≥1 dimension, but never emit a bare
    // "N." row if a future shape change ever produced a both-null row — skip it and keep numbering contiguous.
    if (cells.length === 0) continue;
    n += 1;
    lines.push(`${n}. ${cells.join(" | ")}`);
  }

  if (truncated) {
    lines.push("", "Showing the first 500 parcels (the transaction is linked to more).");
  }

  lines.push("", SUBSURFACE_NOTE);

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
  // Overhead power lines, OPTIONAL on the row: the service may omit these two keys entirely instead of
  // sending nulls, so they are rendered ONLY when the key is present — see the `in` check in the
  // renderer. An absent key is no claim; rendering "none within 1 km" for it would manufacture the
  // claim "nothing within the radius", which only a null carries.
  { key: "power_line_hv_distance_m", label: "high-voltage overhead power line", radiusLabel: "1 km" },
  { key: "power_line_ehv_distance_m", label: "extra-high-voltage overhead power line", radiusLabel: "1 km" },
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

    // A category whose key is absent from the row is DROPPED, not rendered as "none within …": the
    // service withholds a field it cannot yet answer for, and turning that silence into a negative
    // statement is the one mistake this whole two-state contract exists to avoid.
    const cells = SURROUNDINGS_CATEGORIES.filter(({ key }) => key in r).map(({ key, label, radiusLabel }) => {
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

// ── Road access formatting (per-transaction, per-parcel) ───────────

// Carried once per breakdown. It is the whole framing of the layer and must not be trimmed to save
// lines: the indicator is evidence, not a determination, and a reader who acts on it as if it settled
// legal access is the failure mode this layer has to design against.
const ROADS_NOTE =
  "Note: access_indicator is geometric evidence measured from carriageway centrelines in reference road-network data. It does NOT determine legal access and says nothing about easements or rights of way, which are recorded in the land register and are not published here. Distances are approximate and measured from the plot boundary; a public road and a road of any kind are searched within 500 m, a motorway/expressway/dual-carriageway (a traffic-nuisance proxy, not access) within 3 km. A null distance means nothing of that kind within that radius — never a guarantee of absence.";

const ROAD_INDICATOR_GLOSS: Record<string, string> = {
  likely: "access likely",
  uncertain: "access uncertain",
  unlikely: "access unlikely",
};

/** One "label: value" cell list for a plot's road evidence. Absent measurements are stated as absent. */
function roadCells(r: RoadsBreakdownRow): string[] {
  const cells: string[] = [];
  const indicator = typeof r.access_indicator === "string" ? r.access_indicator : null;
  // An unknown indicator from a newer service keeps the "access" prefix, so slot 1 always reads as an
  // indicator rather than a bare token.
  cells.push(indicator ? ROAD_INDICATOR_GLOSS[indicator] ?? `access ${indicator}` : "access not classified");
  // The rule version travels WITH the indicator, not in a footnote: a later recalibration must be visible
  // to the client instead of silently changing what "access likely" means.
  if (typeof r.access_rule_version === "number") cells.push(`rule v${r.access_rule_version}`);

  const pub = toNum(r.public_road_distance_m);
  const edge = toNum(r.public_road_edge_distance_m);
  if (pub == null) {
    cells.push("public road: none within 500 m");
  } else {
    const kind = [r.public_road_category, r.public_road_class].filter((x): x is string => typeof x === "string");
    const edgePart = edge != null ? `, ~${Math.round(edge)} m to the carriageway edge` : "";
    cells.push(`public road: ~${Math.round(pub)} m${kind.length > 0 ? ` (${kind.join(", ")})` : ""}${edgePart}`);
    if (r.public_road_at_grade === false) cells.push("that road crosses on a viaduct or in a tunnel");
  }

  const any = toNum(r.any_road_distance_m);
  cells.push(any == null ? "any road: none within 500 m" : `any road: ~${Math.round(any)} m`);
  const major = toNum(r.major_road_distance_m);
  cells.push(major == null ? "major road: none within 3 km" : `major road: ~${Math.round(major)} m`);
  return cells;
}

export function formatRoads(res: RoadsBreakdownResponse): string {
  const { data, truncated } = res;
  // TWO-STATE: empty covers both "the transaction has no linked plots" and "unknown/garbage id" (the
  // service answers 200 + [] for both). One neutral message fits both without leaking which case it was.
  if (data.length === 0) {
    return "No road-access data is available for this transaction (no linked plots, or the id was not found).";
  }

  const lines: string[] = [
    `Per-parcel road access (${data.length} plot${data.length === 1 ? "" : "s"}; distances from the plot boundary, "~" = approximate):`,
    "",
  ];

  data.forEach((r, i) => {
    if (!r.assessed) {
      lines.push(`${i + 1}. not assessed yet — this plot has not been evaluated (no statement either way)`);
      return;
    }
    lines.push(`${i + 1}. ${roadCells(r).join(" | ")}`);
  });

  if (truncated) {
    lines.push("", "Showing the first 500 plots (the transaction is linked to more).");
  }

  // Freshness signal, same shape as farmland. The road layer is loaded county by county, so the snapshot
  // date is more load-bearing here than for a nationally refreshed layer, not less.
  // The OLDEST date across the plots, not the first one found: a transaction can span counties loaded on
  // different dates, and the freshest of them would overstate how current the whole answer is.
  const dates = data
    .map((r) => r.source_as_of)
    .filter((d): d is string => typeof d === "string" && d.length > 0)
    .sort();
  if (dates.length > 0) lines.push("", `Reference road-network snapshot as of ${dates[0]} (oldest of the plots shown).`);

  lines.push("", ROADS_NOTE);
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
//
// This constant carries the whole disclaimer on its own: `res.note` from the API is not rendered
// anywhere in formatPermitsBreakdown, so an empty result shows nothing but this string. Hence the
// wording states what is held — permits once a decision has been issued, notifications only where
// they were accepted without objection — and never characterises the outcome of a decision, which
// is not part of the data at all.
const PERMITS_EMPTY_NOTE =
  "No building permit or works notification is on record for this transaction's parcels (or the id was not found). Permits are held once a decision has been issued, and notifications only where they were accepted without objection; cases registered since 2016 are matched by the parcel's current identifier — an empty list is never a statement that nothing was ever planned.";

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

// ── Location name-search formatting ───────────────────────────────

const SEARCH_LEVEL_ORDER: Record<string, number> = {
  voivodeship: 0,
  county: 1,
  municipality: 2,
  precinct: 3,
};

const SEARCH_LEVEL_LABEL: Record<string, string> = {
  voivodeship: "Voivodeships",
  county: "Counties",
  municipality: "Municipalities",
  precinct: "Precincts",
};

// Ready-to-use follow-up calls for one TERYT unit. What is valid depends on the level (the target
// tools reject codes they cannot resolve) and on rcn_district (name-based calls only work when the
// name is a valid location= value). Experimental catalogues (yield/spread/flood) are never printed —
// they have their own coverage catalogues and list_locations does not stand in for them.
function searchCallsForItem(it: LocationSearchItem): string[] {
  const code = it.code;
  const calls: string[] = [
    `search_transactions(teryt="${code}")`,
    `list_parcels_in_area(teryt="${code}")`,
  ];
  // Drill down into children — replaces the withdrawn auto-expansion.
  if (it.level === "county" || it.level === "municipality") {
    calls.push(`list_locations(parent="${code}")`);
  }
  // get_demographics accepts voivodeship / county / municipality codes, not precinct codes.
  if (it.level !== "precinct") {
    calls.push(`get_demographics(teryt="${code}")`);
  }
  // get_infrastructure_signals accepts county and municipality codes only.
  if (it.level === "county" || it.level === "municipality") {
    calls.push(`get_infrastructure_signals(teryt="${code}")`);
  }
  // Name-based calls: valid only when this name is an RCN district label.
  if (it.rcn_district) {
    calls.push(`search_transactions(location="${it.name}")`);
    calls.push(`compare_locations(districts="${it.name},…")`);
    calls.push(`get_price_statistics(location="${it.name}")`);
  }
  return calls;
}

// Multi-level result: TERYT units (grouped by administrative level, each with the codes and the
// exact follow-up calls) followed by RCN district names that carry no TERYT code. A name present on
// the TERYT side is printed there only — the caller passes such names in rcnOnly already deduped.
export function formatLocationSearch(
  items: LocationSearchItem[],
  rcnOnly: string[],
  query: string,
): string {
  const lines: string[] = [`Location search for "${query}":`, ""];

  const byLevel = new Map<string, LocationSearchItem[]>();
  for (const it of items) {
    const bucket = byLevel.get(it.level) ?? [];
    bucket.push(it);
    byLevel.set(it.level, bucket);
  }
  const levels = [...byLevel.keys()].sort(
    (a, b) => (SEARCH_LEVEL_ORDER[a] ?? 99) - (SEARCH_LEVEL_ORDER[b] ?? 99),
  );

  for (const level of levels) {
    lines.push(`${SEARCH_LEVEL_LABEL[level] ?? level}:`);
    for (const it of byLevel.get(level)!) {
      const typeSuffix = it.typeName ? ` (${it.typeName})` : "";
      const parentSuffix = it.parent_name ? `, ${it.parent_name}` : "";
      lines.push(`  ${it.code} - ${it.name}${typeSuffix}${parentSuffix}`);
      for (const call of searchCallsForItem(it)) {
        lines.push(`      ${call}`);
      }
    }
    lines.push("");
  }

  if (rcnOnly.length > 0) {
    lines.push("RCN district names without a TERYT code:");
    for (const name of rcnOnly) {
      lines.push(`  - ${name}`);
      lines.push(`      search_transactions(location="${name}")`);
    }
    lines.push("");
  }

  // Bare array response, no pagination envelope — signal the cap in prose (§ route contract).
  if (items.length === 50) {
    lines.push("Showing the first 50 matches — type more letters to narrow the search.");
  }

  return lines.join("\n").trimEnd();
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

// ── Flood-risk formatting ───────────────────────────────

// Version-agnostic substring (no /api prefix) — strips the backend discovery note for /api/ and /api/v1/.
const FLOOD_RISK_LOCATIONS_PATH = "flood-risk/locations";

export function formatFloodRisk(r: FloodRiskResponse): string {
  const q = r.quality;
  const sev = r.result.by_severity;
  const lines: string[] = [`Flood-hazard exposure — ${r.location.name}`, ""];

  lines.push(
    r.result.flood_share_pct != null
      ? `Share in a mapped flood-hazard zone: ${r.result.flood_share_pct}% of assessed transactions`
      : `Share: N/A (coverage: ${q.coverage})`,
  );

  // Severity breakdown only when not suppressed (all null → skip the block).
  if (sev.low != null || sev.medium != null || sev.high != null) {
    lines.push("");
    lines.push("Transactions by severity (return period):");
    lines.push(`  High (~1-in-10-year): ${formatNumber(sev.high ?? 0)}`);
    lines.push(`  Medium (~1-in-100-year): ${formatNumber(sev.medium ?? 0)}`);
    lines.push(`  Low (~1-in-500-year): ${formatNumber(sev.low ?? 0)}`);
  }

  lines.push("");
  lines.push(
    `Assessed transactions: ${r.inputs.assessed_sample_n != null ? formatNumber(r.inputs.assessed_sample_n) : "N/A"} (all-time)`,
  );
  lines.push(`Coverage: ${q.coverage} | Confidence: ${q.confidence}${q.stale ? " | transaction data lags publication" : ""}`);
  if (q.as_of) lines.push(`Transaction data as of: ${q.as_of}`);

  // Drop the REST-flavored discovery note (names the HTTP path); the tool tip below carries the same
  // cross-link as a tool name an LLM can call.
  const visibleNotes = q.notes.filter((n) => !n.includes(FLOOD_RISK_LOCATIONS_PATH));
  if (visibleNotes.length > 0) {
    lines.push("", "Notes:");
    for (const n of visibleNotes) lines.push(`  - ${n}`);
  }

  return lines.join("\n");
}

// Discovery catalog formatter. Entries arrive pre-sorted (assessed_sample_n desc) from the API.
export function formatFloodRiskLocations(r: FloodRiskLocationsResponse): string {
  const { data, meta } = r;
  if (data.length === 0) {
    return "No flood-risk-covered locations match.";
  }
  const dateSuffix = meta.snapshot_date ? `, data from ${meta.snapshot_date}` : "";
  const lines: string[] = [
    `Flood-risk coverage — ${meta.total} location${meta.total === 1 ? "" : "s"}${dateSuffix}`,
    "",
  ];
  for (const loc of data) {
    lines.push(
      `- ${loc.location} (teryt ${loc.county_code}, ${loc.voivodeship}, ${loc.type}) — n=${formatNumber(loc.assessed_sample_n)}, ${loc.confidence} confidence`,
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

/** A wire array narrowed to the strings in it — anything else on the wire is dropped, never rendered. */
function stringList(v: unknown): string[] {
  return Array.isArray(v) ? v.filter((x): x is string => typeof x === "string") : [];
}

/**
 * The one headline for a land-use / soil-quality result, shared by the standalone layer and the report's
 * section so the two surfaces never describe the same parcel differently.
 *
 * SETS, joined — never a prevailing category and never a share. The source records no per-category area,
 * so any ranking or percentage here would be invented rather than read.
 */
function landClassHeadline(useNames: string[], soilClasses: string[]): string {
  return [
    useNames.length ? useNames.join(", ") : null,
    soilClasses.length ? `soil class ${soilClasses.join(", ")}` : null,
  ].filter(Boolean).join("; ");
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
    case "subsurface": {
      // Neutral, source-register-free rendering (the register is never named). Two dimensions: a mining
      // terrain (status + the deformation-risk mineral class) and a major groundwater reservoir (documented
      // /undocumented). A reservoir's extent alone is not a restriction; absence is never rendered as "safe".
      if (!covered) return "";
      const parts: string[] = [];
      const mining = typeof s.mining_status === "string" ? s.mining_status : null;
      const mineral = typeof s.mineral_class === "string" ? s.mineral_class : null;
      if (mining) parts.push(`mining terrain ${mining}${mineral ? ` (${mineral})` : ""}`);
      const gw = typeof s.groundwater_status === "string" ? s.groundwater_status : null;
      if (gw) parts.push(`groundwater reservoir ${gw}`);
      return parts.join("; ");
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
    case "roads": {
      // Geometric evidence, never a determination of legal access — so the indicator is glossed, not
      // reduced to a yes/no, and the distance that produced it travels with it.
      if (!covered) return "";
      const indicator = typeof s.access_indicator === "string" ? s.access_indicator : null;
      if (!indicator) return "";
      const edge = toNum(s.public_road_edge_distance_m);
      const pub = toNum(s.public_road_distance_m);
      const gloss = ROAD_INDICATOR_GLOSS[indicator] ?? indicator;
      if (edge != null) return `${gloss} (~${Math.round(edge)} m to the nearest public road's carriageway edge)`;
      if (pub != null) return `${gloss} (nearest public road ~${Math.round(pub)} m)`;
      return `${gloss} (no public road within 500 m)`;
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
      const rows = Array.isArray(s.data) ? (s.data as Array<Record<string, unknown>>) : [];
      // Summarise the age dimension rather than repeating it per building: the report is a dossier,
      // and "1 of 3 dated" tells the reader whether it is worth asking for the breakdown. Silent when
      // the API does not send the field.
      const ages = rows
        .map((r) => (r.age_estimate as BuildingAgeEstimate | undefined)?.status)
        .filter((x): x is NonNullable<typeof x> => x != null);
      const dated = ages.filter((x) => x === "estimated").length;
      const agePart = ages.length === 0
        ? ""
        : dated === 0
          ? "; construction year not established for any of them"
          : `; construction year estimated for ${dated} of ${ages.length} (estimate from permit records, not a registry date)`;
      return `${rows.length} building(s) on the parcel${agePart}`;
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
    case "land_class": {
      if (!covered) return "";
      const note = typeof s.legal_note === "string" ? s.legal_note : null;
      const head = landClassHeadline(stringList(s.use_names), stringList(s.soil_classes));
      return [head || null, note].filter(Boolean).join(" — ");
    }
    case "nature": {
      if (!covered) return "";
      const rank = toNum(s.protection_rank);
      const dist = toNum(s.forest_distance_m);
      const parts: string[] = [];
      if (rank != null) {
        const label = PROTECTION_RANK_LABEL[rank] ?? `protection rank ${rank}`;
        parts.push(s.building_restriction === "statutory_ban" ? `${label} (statutory build ban)` : label);
      }
      if (dist != null) parts.push(dist === 0 ? "overlaps forest" : `forest ${Math.round(dist)} m`);
      return parts.join(", ");
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
// Exported for the test that pins it against the report fixture in both directions. That test is the
// only mechanical guard on this list: the render loop below reads `sections[key as ...]` through a cast,
// so dropping an entry costs a layer in every rendered report and costs the compiler nothing.
export const REPORT_LAYER_ORDER: Array<[string, string]> = [
  ["flood", "Flood risk"],
  ["heritage", "Heritage listing"],
  ["landslide", "Landslide risk"],
  ["subsurface", "Subsurface constraints"],
  ["surroundings", "Nuisance surroundings"],
  ["transit", "Public transport"],
  ["planning", "Planning (general plan)"],
  ["buildings", "Buildings"],
  ["permits", "Building activity"],
  ["farmland", "Agricultural land"],
  ["land_class", "Land use & soil class"],
  ["nature", "Nature (forest & protected areas)"],
  ["roads", "Road access"],
];

export function formatParcelReport(res: ParcelReportResponse): string {
  const p = res.parcel;
  const id = p.parcel_id ?? p.parcel_key ?? "(parcel id requires a paid plan)";

  // A total miss, or the layer is unavailable: the core never resolved. Say so plainly (the billing
  // footer explains the refund). An unavailable layer also surfaces as a top-level not_computed, but it
  // is NOT transient — so it gets its own header (no misleading "retry").
  if (res.coverage !== "covered") {
    const head = res.coverage === "not_covered"
      // Honest about the cause: "not ours" is a much weaker statement than "does not exist", and a
      // report is exactly where that gets read as the strong one.
      ? `Parcel ${id} could not be resolved — we do not hold it. Coverage is near-complete but not the whole cadastral register and not live, so this is not a finding that the parcel does not exist.`
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
    const s = sections[key as keyof typeof sections] as ReportSection | undefined;
    // A section this client knows about but the server did not send: SKIP the line, never throw. The
    // cast above is a promise the compiler cannot keep — a newer client always can, and eventually will,
    // talk to an older service, which need not send every section this client knows about. Reading
    // `s.coverage` blind would take down the formatting of the ENTIRE report over one absent key,
    // turning a missing line into a total failure.
    if (s == null) continue;
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

// ── Land-use / soil-quality classification (standalone layer) ──────

/**
 * Render the standalone land-class layer. The four states are told apart in words, because the difference
 * between "this county publishes no classification" and "the county publishes one and this parcel has no
 * entry" is the whole answer for a caller deciding whether to look elsewhere.
 */
export function formatParcelLandClass(res: ParcelLandClassResponse): string {
  // Fall back to the internal id before the paid-plan wording: a parcel addressed by an internal id only
  // HAS no cadastral id, so telling a paying caller to upgrade would be plain wrong.
  const id = res.parcel.parcel_id ?? res.parcel.parcel_key ?? res.parcel.id ?? "(identifier withheld)";
  const asOfDay = typeof res.as_of === "string" ? res.as_of.split("T")[0] : null;

  if (res.coverage === "not_computed") {
    return `The classification lookup for parcel ${id} could not be completed, so this says nothing about what is recorded for it (the tokens are refunded). Retry shortly.`;
  }
  if (res.coverage === "not_covered") {
    // Three different causes share this state (the county publishes nothing, we do not hold this parcel,
    // the parcel has no cadastral id at all), so the lead must not name one of them. The server's own
    // note says which applies when it knows; pass it through rather than guessing.
    const why = res.note ? ` ${res.note}` : "";
    return `No land-use or soil-quality classification is available for parcel ${id} (the tokens are refunded). Either the county does not publish one, or we hold no classification for this parcel.${why}`;
  }
  if (res.coverage === "covered_no_data") {
    const asOf = asOfDay ? ` (county data as of ${asOfDay})` : "";
    return `The county publishes the classification, but parcel ${id} has no entry in it${asOf}. That is a checked negative, not a gap in coverage: it says nothing about what the land is, only that the county's dataset holds no entry for this parcel — and it is billed as an answer.`;
  }
  if (res.coverage !== "covered") {
    // Anything else on the wire is a state this build does not know. Degrading to the full rendering
    // would state "Protected soil grade (I-III) present: no" out of an empty body — a categorical legal
    // claim from no data. A published npm build is pinned and immutable, so a future fifth state would
    // meet THIS code on an installed client; say plainly that we cannot read it. Same discipline as
    // fourStateGloss, which renders an unexpected token verbatim instead of guessing.
    return `The classification for parcel ${id} came back in a state this client does not recognise (${String(res.coverage)}); it says nothing about what is recorded for the parcel.`;
  }

  // Wire arrays are narrowed here for the same reason: a missing or dirty array must not throw AFTER the
  // call was billed, and a non-string member must never reach the caller as "[object Object]".
  const useNames = stringList(res.use_names);
  const soilClasses = stringList(res.soil_classes);
  const useCodes = stringList(res.use_codes);
  const lines: string[] = [`Land-use and soil-quality classification: ${id}`];
  const headline = landClassHeadline(useNames, soilClasses);
  if (headline) lines.push(headline);
  if (useCodes.length > 0) lines.push(`Use codes: ${useCodes.join(", ")}`);
  lines.push(
    `Protected soil grade (I-III) present: ${res.protected_class_present ? "yes" : "no"}`,
  );
  // in_city drives which re-designation rule applies, and it is read from the cadastral id, so an
  // undetermined value is a real third answer rather than a missing field.
  lines.push(
    `Inside a city's administrative boundary: ${res.in_city == null ? "could not be determined from the parcel id" : res.in_city ? "yes" : "no"}`,
  );
  // The sets are exhaustive for the parcel and carry no area, so state that instead of letting a reader
  // infer an order from the listing.
  lines.push("", "Categories and grades are listed as sets: the source records no area for any of them, so this cannot say which prevails on the parcel.");
  if (res.legal_note) {
    lines.push("", `Re-designation: ${res.legal_note}`);
  }
  if (res.legal_state_as_of) {
    lines.push(`Legal state verified as of ${res.legal_state_as_of}.`);
  }
  if (asOfDay) lines.push(`Classification data as of ${asOfDay}.`);
  if (res.note) lines.push("", res.note);
  return lines.join("\n");
}
