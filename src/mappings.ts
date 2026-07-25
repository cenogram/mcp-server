// ── Property & market type enum maps ────────────────────────────────

export const PROPERTY_TYPES: Record<number, string> = {
  1: "Land (Grunt)",
  2: "Building (Budynek)",
  3: "Developed land (Grunt zabudowany)",
  4: "Unit/Apartment (Lokal)",
};

export const MARKET_TYPES: Record<number, string> = {
  1: "Primary market (Rynek pierwotny)",
  2: "Secondary market (Rynek wtórny)",
};

const PROPERTY_TYPE_MAP: Record<string, number> = {
  land: 1,
  building: 2,
  developed_land: 3,
  unit: 4,
};

const MARKET_TYPE_MAP: Record<string, number> = {
  primary: 1,
  secondary: 2,
};

export function mapPropertyType(value: string | undefined): number | undefined {
  if (!value) return undefined;
  return PROPERTY_TYPE_MAP[value];
}

export function mapMarketType(value: string | undefined): number | undefined {
  if (!value) return undefined;
  return MARKET_TYPE_MAP[value];
}

// ── Unit function enum maps ─────────────────────────────────────────

export const UNIT_FUNCTIONS: Record<number, string> = {
  1: "Residential (Mieszkalna)",
  2: "Commercial (Handlowo-usługowa)",
  3: "Office (Biurowa)",
  4: "Production (Produkcyjna)",
  5: "Garage (Garaż)",
  6: "Other (Inne)",
};

const UNIT_FUNCTION_MAP: Record<string, number | "unknown"> = {
  residential: 1,
  commercial: 2,
  office: 3,
  production: 4,
  garage: 5,
  other: 6,
  unknown: "unknown", // sentinel string — API resolves to IS NULL condition
};

export function mapUnitFunction(value: string | undefined): number | "unknown" | undefined {
  if (!value) return undefined;
  return UNIT_FUNCTION_MAP[value];
}

// ── Building type enum maps ─────────────────────────────────────────

export const BUILDING_TYPES: Record<number, string> = {
  110: "Residential (Mieszkalny)",
  121: "Commercial (Handlowo-usługowy)",
  122: "Industrial (Przemysłowy)",
  123: "Transport (Transportu i łączności)",
  124: "Office (Biurowy)",
  125: "Warehouse (Zbiorniki/Silosy/Magazyny)",
  126: "Education/Sports (Oświaty i sportu)",
  127: "Farm/Utility (Gospodarczy)",
  128: "Hospital (Szpitale)",
  129: "Other non-residential (Pozostałe niemieszkalne)",
};

const BUILDING_TYPE_MAP: Record<string, number | "unknown"> = {
  residential: 110,
  commercial: 121,
  industrial: 122,
  transport: 123,
  office: 124,
  warehouse: 125,
  education_sports: 126,
  farm_utility: 127,
  hospital: 128,
  other_nonresidential: 129,
  unknown: "unknown", // sentinel string — API resolves to IS NULL condition
};

export function mapBuildingType(value: string | undefined): number | "unknown" | undefined {
  if (!value) return undefined;
  return BUILDING_TYPE_MAP[value];
}

// ── Deed-detail enum maps ───────────────────────────────────────────
// Raw fields straight from the notarial deed. ENGLISH labels (MCP output is English) — established
// real-estate-law equivalents, not ad-hoc translations. Codes mirror the canonical label maps used
// across the product.

// Rodzaj prawa (nier_prawo), codes 1-8.
export const OWNERSHIP_TYPES: Record<number, string> = {
  1: "Land ownership",
  2: "Perpetual usufruct",
  3: "Cooperative ownership right",
  4: "Unit sale",
  5: "Ownership",
  6: "Unit ownership with appurtenant right",
  7: "Building ownership with appurtenant right",
  8: "Perpetual usufruct",
};

// Reverse-mapper for the ownership/legal-right filter: named enum → registry code(s).
// perpetual_usufruct expands to BOTH codes 2 and 8 — the registry records użytkowanie wieczyste
// under either code depending on the record, so filtering must include both.
// Multi-select: the array is expanded and joined into the CSV the API's resolveSmallintCsv accepts.
const OWNERSHIP_TYPE_FILTER_MAP: Record<string, string> = {
  land_ownership: "1",
  perpetual_usufruct: "2,8",
  cooperative_ownership: "3",
  unit_sale: "4",
  ownership: "5",
  unit_ownership_with_appurtenant_right: "6",
  building_ownership_with_appurtenant_right: "7",
  unknown: "unknown", // sentinel string — API resolves to IS NULL condition
};

export function mapOwnershipTypes(values: string[] | undefined): string | undefined {
  if (!values || values.length === 0) return undefined;
  const codes = values.map((v) => OWNERSHIP_TYPE_FILTER_MAP[v]).filter(Boolean);
  return codes.length > 0 ? codes.join(",") : undefined;
}

// Strony transakcji (seller/buyer share one dictionary), codes 1-7.
export const PARTY_TYPES: Record<number, string> = {
  1: "State Treasury",
  2: "Local-government unit",
  3: "Natural person",
  4: "Legal person",
  5: "Cooperative",
  6: "State legal person",
  7: "Other legal person",
};

// Land use (land_use) — RCN string codes from the GPKG, 5 values present.
export const LAND_USES: Record<string, string> = {
  gruntyZabudowaneIZurbanizowane: "Built-up and urbanized land",
  gruntyRolne: "Agricultural land",
  gruntyLesne: "Forest land",
  terenyKomunikacyjne: "Transport land",
  inne: "Other",
};

// ── Transaction type enum maps ──────────────────────────────────────

export const TRANSACTION_TYPES: Record<number, string> = {
  1: "Free market (Wolny rynek)",
  3: "Auction (Przetargowa)",
  4: "Non-auction (Bezprzetargowa)",
  5: "Subsidized (Z bonifikatą)",
  9: "Public purpose (Na cel publiczny)",
  10: "Foreclosure (Egzekucyjna)",
};

const TRANSACTION_TYPE_MAP: Record<string, number | "unknown"> = {
  free_market: 1,
  auction: 3,
  non_auction: 4,
  subsidized: 5,
  public_purpose: 9,
  foreclosure: 10,
  unknown: "unknown", // sentinel string — API resolves to IS NULL condition
};

export function mapTransactionTypes(values: string[] | undefined): string | undefined {
  if (!values || values.length === 0) return undefined;
  const mapped = values
    .map(v => TRANSACTION_TYPE_MAP[v])
    .filter((v): v is number | "unknown" => v !== undefined);
  if (mapped.length === 0) return undefined;
  return mapped.join(",");
}

// ── Bbox conversion ─────────────────────────────────────────────────

/** Convert lat/lng/radius to bbox [minLng, minLat, maxLng, maxLat] (lng-first!) */
export function radiusKmToBbox(
  lat: number,
  lng: number,
  radiusKm: number,
): [number, number, number, number] {
  const latDelta = radiusKm / 111.0;
  const lngDelta = radiusKm / (111.0 * Math.cos((lat * Math.PI) / 180));
  return [
    lng - lngDelta, // minLng
    lat - latDelta, // minLat
    lng + lngDelta, // maxLng
    lat + latDelta, // maxLat
  ];
}

// ── Location filtering ──────────────────────────────────────────────

export function stripDiacritics(s: string): string {
  return s.normalize("NFD").replace(/[̀-ͯ]/g, "").replace(/[łŁ]/g, (c) => c === "ł" ? "l" : "L");
}

/** Filter districts by location name (case-insensitive, diacritics-insensitive includes match) */
export function filterByLocation(
  location: string,
  districts: string[],
): string[] {
  const needle = stripDiacritics(location.toLowerCase());
  return districts.filter((d) => stripDiacritics(d.toLowerCase()).includes(needle));
}

// ── City → sub-district expansion ───────────────────────────────────
export const CITY_SUBDISTRICTS: ReadonlyMap<string, readonly string[]> = new Map([
  ["Warszawa", [
    "Warszawa", "Bemowo", "Białołęka", "Bielany", "Mokotów", "Ochota",
    "Praga-Południe", "Praga-Północ", "Rembertów", "Śródmieście", "Targówek",
    "Ursus", "Ursynów", "Wawer", "Wesoła", "Wilanów", "Włochy", "Wola", "Żoliborz",
  ]],
  ["Kraków", [
    "Kraków", "Kraków-Krowodrza", "Kraków-Nowa Huta", "Kraków-Podgórze", "Kraków-Śródmieście",
  ]],
  ["Łódź", [
    "Łódź", "Łódź-Bałuty", "Łódź-Górna", "Łódź-Polesie", "Łódź-Śródmieście", "Łódź-Widzew",
  ]],
]);

/** Returns sub-districts for known multi-district cities, or [district] for everything else. */
export function expandDistrict(district: string): string[] {
  return CITY_SUBDISTRICTS.get(district)?.slice() ?? [district];
}

// ── Normalized district resolution ──────────────────────────────────

export function buildNormalizedMap(districts: string[]): Map<string, string[]> {
  const map = new Map<string, string[]>();
  for (const d of districts) {
    const key = stripDiacritics(d.toLowerCase());
    const existing = map.get(key);
    if (existing) {
      existing.push(d);
    } else {
      map.set(key, [d]);
    }
  }
  for (const [cityName] of CITY_SUBDISTRICTS) {
    const key = stripDiacritics(cityName.toLowerCase());
    if (!map.has(key)) {
      map.set(key, [cityName]);
    }
  }
  return map;
}

let lastDistricts: string[] | null = null;
let normalizedMap: Map<string, string[]> | null = null;

function getNormalizedMap(districts: string[]): Map<string, string[]> {
  if (districts !== lastDistricts) {
    normalizedMap = buildNormalizedMap(districts);
    lastDistricts = districts;
  }
  return normalizedMap!;
}

/**
 * If `input` is a known multi-district city key (Warszawa/Kraków/Łódź, case- and
 * diacritics-insensitive), return a fresh copy of its sub-districts. Otherwise null.
 * Lets callers skip the /api/districts fetch for city keys — the
 * sub-district list is a static map, so no API round-trip is needed to resolve it.
 */
export function tryResolveCityKey(input: string): string[] | null {
  const normalized = stripDiacritics(input.trim().toLowerCase());
  for (const [cityName, subs] of CITY_SUBDISTRICTS) {
    if (stripDiacritics(cityName.toLowerCase()) === normalized) {
      return subs.slice();
    }
  }
  return null;
}

export function resolveDistrict(input: string, allDistricts: string[]): string[] {
  const city = tryResolveCityKey(input);
  if (city) return city;

  const normalized = stripDiacritics(input.trim().toLowerCase());
  const map = getNormalizedMap(allDistricts);

  const canonicals = map.get(normalized);
  if (canonicals) {
    const result: string[] = [];
    for (const c of canonicals) {
      const expanded = expandDistrict(c);
      result.push(...expanded);
    }
    return result;
  }

  return [input];
}
