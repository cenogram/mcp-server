import { describe, it, expect } from "vitest";
import {
  mapPropertyType,
  mapMarketType,
  mapUnitFunction,
  mapBuildingType,
  mapOwnershipTypes,
  mapTransactionTypes,
  radiusKmToBbox,
  filterByLocation,
  PROPERTY_TYPES,
  MARKET_TYPES,
  resolveDistrict,
} from "../mappings.js";
import { encodeOAuthCtx, decodeOAuthCtx, OAUTH_CTX_PREFIX } from "../api-client.js";

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
  it("returns [minLng, minLat, maxLng, maxLat] - lng-first!", () => {
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

  it("'Warszawa' does not match Warsaw districts (filterByLocation is substring only)", () => {
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

describe("resolveDistrict", () => {
  const allDistricts = [
    "Warszawa", "Bemowo", "Białołęka", "Bielany", "Mokotów", "Ochota",
    "Praga-Południe", "Praga-Północ", "Rembertów", "Śródmieście", "Targówek",
    "Ursus", "Ursynów", "Wawer", "Wesoła", "Wilanów", "Włochy", "Wola", "Żoliborz",
    "Kraków", "Kraków-Krowodrza", "Kraków-Nowa Huta", "Kraków-Podgórze", "Kraków-Śródmieście",
    "Łódź", "Łódź-Bałuty", "Łódź-Górna", "Łódź-Polesie", "Łódź-Śródmieście", "Łódź-Widzew",
    "Gdańsk", "Wrocław",
  ];

  it("resolves 'Krakow' (no diacritics) to 5 sub-districts", () => {
    expect(resolveDistrict("Krakow", allDistricts)).toHaveLength(5);
  });

  it("resolves 'warszawa' (lowercase) to 19 sub-districts", () => {
    expect(resolveDistrict("warszawa", allDistricts)).toHaveLength(19);
  });

  it("resolves 'Lodz' to 6 sub-districts", () => {
    expect(resolveDistrict("Lodz", allDistricts)).toHaveLength(6);
  });

  it("resolves 'mokotow' to ['Mokotów']", () => {
    expect(resolveDistrict("mokotow", allDistricts)).toEqual(["Mokotów"]);
  });

  it("resolves 'gdansk' to ['Gdańsk']", () => {
    expect(resolveDistrict("gdansk", allDistricts)).toEqual(["Gdańsk"]);
  });

  it("passes through unknown district", () => {
    expect(resolveDistrict("xyz", allDistricts)).toEqual(["xyz"]);
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

describe("mapUnitFunction", () => {
  it("maps named functions to codes", () => {
    expect(mapUnitFunction("residential")).toBe(1);
    expect(mapUnitFunction("garage")).toBe(5);
  });

  it("maps 'unknown' to the 'unknown' sentinel string (resolved to IS NULL by the API)", () => {
    expect(mapUnitFunction("unknown")).toBe("unknown");
  });

  it("returns undefined for undefined / unmapped value", () => {
    expect(mapUnitFunction(undefined)).toBeUndefined();
    expect(mapUnitFunction("bogus")).toBeUndefined();
  });
});

describe("mapBuildingType", () => {
  it("maps named PKOB types to codes", () => {
    expect(mapBuildingType("residential")).toBe(110);
    expect(mapBuildingType("office")).toBe(124);
  });

  it("maps 'unknown' to the 'unknown' sentinel string", () => {
    expect(mapBuildingType("unknown")).toBe("unknown");
  });

  it("returns undefined for undefined / unmapped value", () => {
    expect(mapBuildingType(undefined)).toBeUndefined();
    expect(mapBuildingType("bogus")).toBeUndefined();
  });
});

describe("mapTransactionTypes", () => {
  it("joins mapped codes into a CSV string", () => {
    expect(mapTransactionTypes(["free_market", "auction"])).toBe("1,3");
  });

  it("passes the 'unknown' sentinel through alongside codes", () => {
    expect(mapTransactionTypes(["free_market", "unknown"])).toBe("1,unknown");
    expect(mapTransactionTypes(["unknown"])).toBe("unknown");
  });

  it("returns undefined for empty / undefined", () => {
    expect(mapTransactionTypes(undefined)).toBeUndefined();
    expect(mapTransactionTypes([])).toBeUndefined();
  });
});

describe("decodeOAuthCtx (identity decode for tool.call logging)", () => {
  const UUID = "3f9a1c22-1b7e-4d0a-9c11-2b3c4d5e6f70";

  it("round-trips a well-formed OAuth context key", () => {
    const key = encodeOAuthCtx(UUID, "grant-abc");
    expect(decodeOAuthCtx(key)).toEqual({ userId: UUID, grantId: "grant-abc" });
  });

  it("returns null for a plain api-key (no \\x01 prefix)", () => {
    expect(decodeOAuthCtx("cngrm_live_abcd1234")).toBeNull();
  });

  it("returns null when the separator is missing (only userId, no grantId sep)", () => {
    expect(decodeOAuthCtx(`${OAUTH_CTX_PREFIX}${UUID}`)).toBeNull();
  });

  it("returns null for an empty userId (\\x01\\x01grant)", () => {
    expect(decodeOAuthCtx(`${OAUTH_CTX_PREFIX}${OAUTH_CTX_PREFIX}grant`)).toBeNull();
  });

  it("returns null for an empty grantId (\\x01user\\x01)", () => {
    expect(decodeOAuthCtx(`${OAUTH_CTX_PREFIX}${UUID}${OAUTH_CTX_PREFIX}`)).toBeNull();
  });
});

describe("mapOwnershipTypes", () => {
  it("maps named legal-right types to registry codes", () => {
    expect(mapOwnershipTypes(["land_ownership"])).toBe("1");
    expect(mapOwnershipTypes(["ownership"])).toBe("5");
  });

  it("expands perpetual_usufruct to both registry codes 2 and 8", () => {
    // the registry records użytkowanie wieczyste under code 2 or 8 depending on the record — cover both.
    expect(mapOwnershipTypes(["perpetual_usufruct"])).toBe("2,8");
  });

  it("joins multi-select into one CSV (land + usufruct)", () => {
    expect(mapOwnershipTypes(["land_ownership", "perpetual_usufruct"])).toBe("1,2,8");
  });

  it("passes the 'unknown' sentinel through alongside codes", () => {
    expect(mapOwnershipTypes(["ownership", "unknown"])).toBe("5,unknown");
    expect(mapOwnershipTypes(["unknown"])).toBe("unknown");
  });

  it("returns undefined for empty / undefined", () => {
    expect(mapOwnershipTypes(undefined)).toBeUndefined();
    expect(mapOwnershipTypes([])).toBeUndefined();
  });
});
