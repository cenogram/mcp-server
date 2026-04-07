import { describe, it, expect } from "vitest";
import {
  mapPropertyType,
  mapMarketType,
  radiusKmToBbox,
  filterByLocation,
  PROPERTY_TYPES,
  MARKET_TYPES,
} from "../mappings.js";

describe("mapPropertyType", () => {
  it("maps 'unit' to 4", () => {
    expect(mapPropertyType("unit")).toBe(4);
  });

  it("maps 'land' to 1", () => {
    expect(mapPropertyType("land")).toBe(1);
  });

  it("maps 'building' to 2", () => {
    expect(mapPropertyType("building")).toBe(2);
  });

  it("maps 'developed_land' to 3", () => {
    expect(mapPropertyType("developed_land")).toBe(3);
  });

  it("returns undefined for undefined", () => {
    expect(mapPropertyType(undefined)).toBeUndefined();
  });

  it("returns undefined for unknown value", () => {
    expect(mapPropertyType("unknown")).toBeUndefined();
  });
});

describe("mapMarketType", () => {
  it("maps 'primary' to 1", () => {
    expect(mapMarketType("primary")).toBe(1);
  });

  it("maps 'secondary' to 2", () => {
    expect(mapMarketType("secondary")).toBe(2);
  });

  it("returns undefined for undefined", () => {
    expect(mapMarketType(undefined)).toBeUndefined();
  });

  it("returns undefined for unknown value", () => {
    expect(mapMarketType("other")).toBeUndefined();
  });
});

describe("radiusKmToBbox", () => {
  it("returns [minLng, minLat, maxLng, maxLat] — lng-first!", () => {
    const [minLng, minLat, maxLng, maxLat] = radiusKmToBbox(52.23, 21.01, 2);

    // Verify order: longitude first, latitude second
    expect(minLng).toBeLessThan(21.01);
    expect(maxLng).toBeGreaterThan(21.01);
    expect(minLat).toBeLessThan(52.23);
    expect(maxLat).toBeGreaterThan(52.23);
  });

  it("produces symmetric bbox around center", () => {
    const [minLng, minLat, maxLng, maxLat] = radiusKmToBbox(52.23, 21.01, 2);

    expect(maxLat - 52.23).toBeCloseTo(52.23 - minLat, 5);
    expect(maxLng - 21.01).toBeCloseTo(21.01 - minLng, 5);
  });

  it("lat delta is ~0.018 per km (1/111)", () => {
    const [, minLat, , maxLat] = radiusKmToBbox(52, 21, 1);
    const latDelta = maxLat - minLat;
    // 2km total span / 111 ≈ 0.018
    expect(latDelta).toBeCloseTo(2 / 111, 3);
  });

  it("lng delta is wider than lat delta at Polish latitudes", () => {
    const [minLng, minLat, maxLng, maxLat] = radiusKmToBbox(52, 21, 5);
    const latSpan = maxLat - minLat;
    const lngSpan = maxLng - minLng;
    // At lat 52°, cos(52°) ≈ 0.616, so lng span should be ~1.62x lat span
    expect(lngSpan).toBeGreaterThan(latSpan);
    expect(lngSpan / latSpan).toBeCloseTo(1 / Math.cos((52 * Math.PI) / 180), 2);
  });

  it("small radius produces small bbox", () => {
    const [minLng, minLat, maxLng, maxLat] = radiusKmToBbox(52, 21, 0.1);
    expect(maxLat - minLat).toBeLessThan(0.01);
    expect(maxLng - minLng).toBeLessThan(0.01);
  });
});

describe("filterByLocation", () => {
  const districts = [
    "Mokotów",
    "Śródmieście",
    "Wola",
    "Kraków-Podgórze",
    "Kraków-Śródmieście",
    "Gdańsk",
    "Lublin",
  ];

  it("matches exact city name", () => {
    expect(filterByLocation("Gdańsk", districts)).toEqual(["Gdańsk"]);
  });

  it("matches partial name (Kraków)", () => {
    const result = filterByLocation("Kraków", districts);
    expect(result).toEqual(["Kraków-Podgórze", "Kraków-Śródmieście"]);
  });

  it("is case-insensitive", () => {
    expect(filterByLocation("mokotów", districts)).toEqual(["Mokotów"]);
    expect(filterByLocation("GDAŃSK", districts)).toEqual(["Gdańsk"]);
  });

  it("'Warszawa' does NOT match Warsaw districts", () => {
    const result = filterByLocation("Warszawa", districts);
    expect(result).toEqual([]);
  });

  it("returns empty array for no match", () => {
    expect(filterByLocation("Poznań", districts)).toEqual([]);
  });

  it("matches district name directly", () => {
    expect(filterByLocation("Mokotów", districts)).toEqual(["Mokotów"]);
  });
});

describe("enum constants", () => {
  it("PROPERTY_TYPES has all 4 types", () => {
    expect(PROPERTY_TYPES[1]).toContain("Land");
    expect(PROPERTY_TYPES[2]).toContain("Building");
    expect(PROPERTY_TYPES[3]).toContain("Developed");
    expect(PROPERTY_TYPES[4]).toContain("Unit");
  });

  it("MARKET_TYPES has 2 types", () => {
    expect(MARKET_TYPES[1]).toContain("Primary");
    expect(MARKET_TYPES[2]).toContain("Secondary");
  });
});
