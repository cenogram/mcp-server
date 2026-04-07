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
