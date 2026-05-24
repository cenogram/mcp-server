import type { Transaction, TransactionsResponse, TransactionsSummary, StatsResponse, PricePerM2Row, HistogramBin, ParcelSearchResponse, SpatialSearchResponse, SpatialFeature, CompareResponse, LocationItem } from "./api-client.js";
import { PROPERTY_TYPES, MARKET_TYPES } from "./mappings.js";

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

// ── Shared transaction formatting ──────────────────────────────────

interface FormattableFields {
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
  parcel_number?: string | null;
  county_name?: string | null;
  voivodeship_name?: string | null;
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
  if (loc && region) parts.push(`${loc} (${region})`);
  else if (loc) parts.push(loc);

  // Metadata line
  const meta: string[] = [];
  meta.push(`Date: ${f.transaction_date}`);
  meta.push(PROPERTY_TYPES[f.property_type] || `Type ${f.property_type}`);
  meta.push(MARKET_TYPES[f.market_type] || `Market ${f.market_type}`);
  parts.push(meta.join(" | "));

  // Price line
  const price: string[] = [];
  price.push(`Price: ${formatPLN(f.price_gross)}`);
  if (f.usable_area_m2 != null) price.push(`Area: ${formatArea(f.usable_area_m2)}`);
  if (f.price_per_m2 != null) price.push(`Price/m\u00B2: ${formatPLN(f.price_per_m2)}`);
  if (f.parcel_area != null && f.usable_area_m2 == null) price.push(`Parcel: ${formatArea(f.parcel_area)}`);
  parts.push(price.join(" | "));

  // Extra details
  const extra: string[] = [];
  if (f.parcel_number) extra.push(`Plot no: ${f.parcel_number}`);
  if (f.rooms != null) extra.push(`Rooms: ${f.rooms}`);
  if (f.floor != null) extra.push(`Floor: ${f.floor}`);
  if (f.coordinates) {
    const [lng, lat] = f.coordinates;
    extra.push(`Location: ${lat?.toFixed(4)}\u00B0N, ${lng?.toFixed(4)}\u00B0E`);
  }
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
    lines.push(`${i + 1}. ${p.parcel_id}`);
    lines.push(`   District: ${district} | Area: ${area} | Location: ${location}`);
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

  return lines.join("\n");
}
