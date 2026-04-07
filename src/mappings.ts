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

const UNIT_FUNCTION_MAP: Record<string, number> = {
  residential: 1,
  commercial: 2,
  office: 3,
  production: 4,
  garage: 5,
  other: 6,
};

export function mapUnitFunction(value: string | undefined): number | undefined {
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

const BUILDING_TYPE_MAP: Record<string, number> = {
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
};

export function mapBuildingType(value: string | undefined): number | undefined {
  if (!value) return undefined;
  return BUILDING_TYPE_MAP[value];
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

/** Filter districts by location name (case-insensitive includes match) */
export function filterByLocation(
  location: string,
  districts: string[],
): string[] {
  const lower = location.toLowerCase();
  return districts.filter((d) => d.toLowerCase().includes(lower));
}
