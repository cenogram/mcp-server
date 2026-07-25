import { describe, it, expect } from "vitest";
import { findGuardToken } from "./guard-tokens.js";
import {
  formatPLN,
  formatArea,
  formatNumber,
  formatTransaction,
  formatTransactionList,
  formatMarketOverview,
  formatPriceStats,
  formatHistogram,
  formatParcelResults,
  formatParcelResolve,
  formatSpatialResults,
  formatCompareResults,
  formatLocationHierarchy,
  formatRentalYield,
  formatRentalYieldLocations,
  formatPriceSpread,
  formatPriceSpreadLocations,
  formatValuation,
  formatBuildingBreakdown,
  formatFloodBreakdown,
  formatHeritageBreakdown,
  formatLandslideBreakdown,
  formatSurroundings,
  formatTransitBreakdown,
  formatPermitsBreakdown,
  formatPlanningBreakdown,
  formatFarmland,
  formatDemographics,
  formatParcelReport,
} from "../formatters.js";
import type { Transaction, TransactionsResponse, StatsResponse, PricePerM2Row, HistogramBin, ParcelSearchResponse, SpatialSearchResponse, SpatialFeature, CompareResponse, LocationItem, RentalYieldResponse, RentalYieldLocationsResponse, PriceSpreadResponse, PriceSpreadLocationsResponse, ValuationResponse, BuildingBreakdownResponse, FloodBreakdownResponse, HeritageBreakdownResponse, LandslideBreakdownResponse, SurroundingsResponse, TransitBreakdownResponse, PermitsResponse, PlanningResponse, FarmlandResponse, DemographicsResponse, ParcelResolveResponse, ParcelReportResponse } from "../api-client.js";

const sampleTx: Transaction = {
  id: "1",
  transaction_date: "2024-11-15",
  property_type: 4,
  market_type: 2,
  price_gross: 890000,
  usable_area_m2: 62.5,
  price_per_m2: 14240,
  rooms: 3,
  floor: 4,
  district: "Mokotów",
  street: "ul. Puławska",
  building_number: "15",
  city: "Warszawa",
  parcel_area: null,
  unit_function: 1,
  parcel_id: "146509_8.0501.12",
  parcel_number: "12",
  county_name: "Warszawa",
  voivodeship_name: "mazowieckie",
  centroid: { type: "Point", coordinates: [21.0060, 52.2317] },
};

describe("formatPLN", () => {
  it("formats positive number", () => {
    const result = formatPLN(1234567);
    expect(result).toContain("1");
    expect(result).toContain("234");
    expect(result).toContain("567");
    // Polish locale uses "zł" not "PLN"
    expect(result).toContain("zł");
  });

  it("formats zero", () => {
    const result = formatPLN(0);
    expect(result).toContain("0");
    expect(result).toContain("zł");
  });

  it("handles null", () => {
    expect(formatPLN(null)).toBe("N/A");
  });

  it("handles undefined", () => {
    expect(formatPLN(undefined)).toBe("N/A");
  });
});

describe("formatArea", () => {
  it("formats area", () => {
    expect(formatArea(65.3)).toContain("65,3");
    expect(formatArea(65.3)).toContain("m²");
  });

  it("handles zero", () => {
    expect(formatArea(0)).toBe("0 m²");
  });

  it("handles null", () => {
    expect(formatArea(null)).toBe("N/A");
  });
});

describe("formatNumber", () => {
  it("formats with thousand separators", () => {
    const result = formatNumber(8194025);
    expect(result).toContain("8");
    expect(result).toContain("194");
    expect(result).toContain("025");
  });

  it("handles null", () => {
    expect(formatNumber(null)).toBe("N/A");
  });
});

describe("formatTransaction", () => {
  it("includes address", () => {
    const result = formatTransaction(sampleTx);
    expect(result).toContain("Puławska");
    expect(result).toContain("Mokotów");
  });

  it("includes price", () => {
    const result = formatTransaction(sampleTx);
    expect(result).toContain("890");
    expect(result).toContain("zł");
  });

  it("includes date", () => {
    const result = formatTransaction(sampleTx);
    expect(result).toContain("2024-11-15");
  });

  it("includes property type", () => {
    const result = formatTransaction(sampleTx);
    expect(result).toContain("Unit/Apartment");
  });

  it("shows parcel area when no usable area", () => {
    const landTx: Transaction = {
      ...sampleTx,
      property_type: 1,
      usable_area_m2: null,
      price_per_m2: null,
      parcel_area: 1200,
      rooms: null,
      floor: null,
      parcel_id: "146509_8.0501.99",
    };
    const result = formatTransaction(landTx);
    expect(result).toContain("Parcel");
    expect(result).toMatch(/1.?200/);
  });

  it("handles zero price_per_m2", () => {
    const freeTx: Transaction = { ...sampleTx, price_per_m2: 0 };
    const result = formatTransaction(freeTx);
    expect(result).toContain("Price/m²");
  });

  it("hides parcel_id but shows coordinates", () => {
    const result = formatTransaction(sampleTx);
    expect(result).not.toContain("146509_8.0501.12");
    expect(result).toContain("52.2317");
    expect(result).toContain("21.0060");
  });

  it("shows county and voivodeship", () => {
    const result = formatTransaction(sampleTx);
    expect(result).toContain("county: Warszawa");
    expect(result).toContain("voivodeship: mazowieckie");
  });

  it("handles null centroid gracefully", () => {
    const noGeoTx: Transaction = { ...sampleTx, centroid: null };
    const result = formatTransaction(noGeoTx);
    expect(result).not.toContain("Location:");
    expect(result).toContain("Puławska"); // still renders address
  });

  it("handles null county/voivodeship", () => {
    const noRegionTx: Transaction = { ...sampleTx, county_name: null, voivodeship_name: null };
    const result = formatTransaction(noRegionTx);
    expect(result).not.toContain("pow.");
    expect(result).toContain("Mokotów");
  });

  it("shows village + building number for rural (no street)", () => {
    const ruralTx: Transaction = {
      ...sampleTx,
      street: null,
      building_number: "47",
      city: "Karsibór",
      district: "Karsibór",
    };
    const result = formatTransaction(ruralTx);
    expect(result).toContain("Karsibór 47");
    expect(result).not.toMatch(/47,\s*Karsibór/);
  });

  it("shows building number with district when city is null", () => {
    const ruralNoCity: Transaction = {
      ...sampleTx,
      street: null,
      building_number: "12",
      city: null,
      district: "Wałcz",
    };
    const result = formatTransaction(ruralNoCity);
    expect(result).toContain("Wałcz 12");
  });
});

describe("formatTransaction — building attrs", () => {
  // Developed land, single building with full attrs (NUMERIC arrives as string over the wire).
  const developedTx: Transaction = {
    ...sampleTx,
    property_type: 3,
    usable_area_m2: null,
    parcel_area: 800,
    building_count: 1,
    footprint_area_m2: "120.50" as unknown as number,
    building_storeys: 2,
    est_total_area_m2: "241.00" as unknown as number,
  };

  it("renders footprint, storeys and estimated total floor area", () => {
    const result = formatTransaction(developedTx);
    expect(result).toContain("Building footprint:");
    expect(result).toContain("120,5");
    expect(result).toContain("Storeys: 2");
    expect(result).toContain("Est. total floor area:");
    expect(result).toContain("241");
    expect(result).toContain("estimate: footprint × storeys, not from deed");
  });

  it("never names the source register", () => {
    const result = formatTransaction(developedTx).toLowerCase();
    expect(findGuardToken(result)).toBeNull();
  });

  it("gates on building_count: no building line when count is null", () => {
    const noBld: Transaction = { ...developedTx, building_count: null };
    const result = formatTransaction(noBld);
    expect(result).not.toContain("Building footprint:");
    expect(result).not.toContain("Storeys:");
  });

  it("multi-building: omits storeys (null) but keeps footprint sum + estimate", () => {
    const multi: Transaction = {
      ...developedTx,
      building_count: 3,
      building_storeys: null,
      footprint_area_m2: "450.00" as unknown as number,
      est_total_area_m2: "900.00" as unknown as number,
    };
    const result = formatTransaction(multi);
    expect(result).toContain("Building footprint:");
    expect(result).not.toContain("Storeys:");
    expect(result).toContain("Est. total floor area:");
  });

  it("surfaces the transaction id when the row has buildings (building_count != null)", () => {
    const result = formatTransaction({ ...developedTx, id: "abc-123" });
    expect(result).toContain("id: abc-123");
  });

  // id is now UNCONDITIONAL (feeds get_building_breakdown AND the map deep link),
  // no longer gated on building_count. The base sampleTx has no buildings.
  it("surfaces the id even when there are no buildings (deep-link broaden)", () => {
    const result = formatTransaction({ ...sampleTx, building_count: null, id: "abc-123" });
    expect(result).toContain("id: abc-123");
  });

  it("surfaces the id even when footprint/storeys/est are all null (buildings exist, no attrs)", () => {
    const attrlessButCounted: Transaction = {
      ...sampleTx,
      id: "abc-123",
      building_count: 2,
      footprint_area_m2: null,
      building_storeys: null,
      est_total_area_m2: null,
    };
    const result = formatTransaction(attrlessButCounted);
    expect(result).toContain("id: abc-123");
  });
});

describe("formatBuildingBreakdown", () => {
  const full: BuildingBreakdownResponse = {
    data: [
      { building_type: 110, footprint_area_m2: "250.00" as unknown as number, footprint_area_alt_m2: null, footprint_divergent: null, storeys: 3, est_total_area_m2: "750.00" as unknown as number, match_confidence: "high" },
      { building_type: 127, footprint_area_m2: "40.00" as unknown as number, footprint_area_alt_m2: null, footprint_divergent: null, storeys: 1, est_total_area_m2: "40.00" as unknown as number, match_confidence: "low" },
    ],
    truncated: false,
  };

  it("renders one numbered line per building with type, footprint, storeys, estimate, confidence", () => {
    const result = formatBuildingBreakdown(full);
    expect(result).toContain("Per-building breakdown (2 buildings)");
    expect(result).toContain("1. Residential (Mieszkalny)");
    expect(result).toContain("2. Farm/Utility (Gospodarczy)");
    expect(result).toMatch(/footprint 250/);
    expect(result).toContain("storeys 3");
    expect(result).toContain("estimate: footprint × storeys, not from deed");
    expect(result).toContain("match confidence: high");
    expect(result).toContain("match confidence: low");
  });

  it("singular 'building' when there is exactly one", () => {
    const one: BuildingBreakdownResponse = { data: [full.data[0]!], truncated: false };
    const result = formatBuildingBreakdown(one);
    expect(result).toContain("(1 building)");
    expect(result).not.toContain("(1 buildings)");
  });

  it("shows the alternate footprint + divergence flag only when divergent", () => {
    const divergent: BuildingBreakdownResponse = {
      data: [{ building_type: 110, footprint_area_m2: "250.00" as unknown as number, footprint_area_alt_m2: "280.00" as unknown as number, footprint_divergent: true, storeys: 2, est_total_area_m2: "500.00" as unknown as number, match_confidence: "high" }],
      truncated: false,
    };
    const result = formatBuildingBreakdown(divergent);
    expect(result).toContain("alt. measurement");
    expect(result).toContain("diverge");
    expect(result).toMatch(/280/);
  });

  it("renders nothing extra for null fields (no 'null', no alt, no confidence)", () => {
    const sparse: BuildingBreakdownResponse = {
      data: [{ building_type: null, footprint_area_m2: null, footprint_area_alt_m2: null, footprint_divergent: null, storeys: null, est_total_area_m2: null, match_confidence: null }],
      truncated: false,
    };
    const result = formatBuildingBreakdown(sparse);
    expect(result).toContain("1. Building"); // fallback label when building_type is null
    expect(result).not.toContain("null");
    expect(result).not.toContain("alt. measurement");
    expect(result).not.toContain("match confidence");
  });

  it("falls back to 'Type N' for an unknown building_type code", () => {
    const unknown: BuildingBreakdownResponse = {
      data: [{ building_type: 999, footprint_area_m2: "10.00" as unknown as number, footprint_area_alt_m2: null, footprint_divergent: null, storeys: null, est_total_area_m2: null, match_confidence: null }],
      truncated: false,
    };
    expect(formatBuildingBreakdown(unknown)).toContain("Type 999");
  });

  it("empty data → friendly message (covers no-buildings and unknown id)", () => {
    expect(formatBuildingBreakdown({ data: [], truncated: false })).toContain("No per-building data available");
  });

  it("truncated → appends the 500-building note", () => {
    const result = formatBuildingBreakdown({ ...full, truncated: true });
    expect(result).toContain("first 500 buildings");
  });

  it("never names the source register", () => {
    const result = formatBuildingBreakdown(full).toLowerCase();
    expect(findGuardToken(result)).toBeNull();
  });
});

describe("formatTransaction — flood-hazard", () => {
  it("surfaces a risk line with the return-period note when flood_risk is set", () => {
    const result = formatTransaction({ ...sampleTx, flood_risk: "high" });
    expect(result).toContain("Flood risk: high");
    expect(result).toContain("mapped flood-hazard zone");
    expect(result).toContain("1-in-10-year");
  });

  it("two-state: no flood line at all when flood_risk is null (never asserts safety)", () => {
    const result = formatTransaction({ ...sampleTx, flood_risk: null });
    expect(result).not.toContain("Flood risk");
  });

  it("two-state: no flood line when flood_risk is absent", () => {
    const result = formatTransaction(sampleTx);
    expect(result).not.toContain("Flood risk");
  });
});

describe("formatFloodBreakdown", () => {
  const full: FloodBreakdownResponse = {
    data: [
      // Input mirrors the API's already-scrubbed shape (neutral EN labels, no source-register fingerprint).
      {
        flood_risk: "high", severity_rank: 1, worst_scenario: "river flood, 1-in-10-year", source: "river",
        depth_class: null, pct_in_zone: "45.00" as unknown as number, nearest_zone_m: 0,
        scenarios: [
          { scenario: "river flood, 1-in-10-year", source: "river", returnPeriod: 10, severity: 1, isLeveeFailure: false, depthClass: null },
          { scenario: "river flood, 1-in-100-year", source: "river", returnPeriod: 100, severity: 2, isLeveeFailure: false, depthClass: null },
        ],
      },
      {
        flood_risk: "medium", severity_rank: 2, worst_scenario: "coastal flood, 1-in-100-year", source: "coastal",
        depth_class: null, pct_in_zone: "100.00" as unknown as number, nearest_zone_m: 0,
        scenarios: [{ scenario: "coastal flood, 1-in-100-year", source: "coastal", returnPeriod: 100, severity: 2, isLeveeFailure: false, depthClass: null }],
      },
    ],
    truncated: false,
  };

  it("renders one numbered line per in-zone parcel with risk, source, share and scenarios", () => {
    const result = formatFloodBreakdown(full);
    expect(result).toContain("Per-parcel flood-zone breakdown (2 parcels in a mapped flood-hazard zone)");
    expect(result).toContain("1. risk: high (~1-in-10-year)");
    expect(result).toContain("source: river");
    expect(result).toContain("45% of the parcel in the worst-scenario zone");
    expect(result).toContain("scenarios: river flood, 1-in-10-year; river flood, 1-in-100-year");
    expect(result).toContain("2. risk: medium");
    expect(result).toContain("source: coastal");
  });

  it("never leaks the source register's notation or tokens", () => {
    expect(findGuardToken(formatFloodBreakdown(full))).toBeNull();
  });

  it("singular 'parcel' when there is exactly one", () => {
    const one: FloodBreakdownResponse = { data: [full.data[0]!], truncated: false };
    const result = formatFloodBreakdown(one);
    expect(result).toContain("(1 parcel in");
    expect(result).not.toContain("(1 parcels");
  });

  it("two-state empty data → neutral message that never asserts safety", () => {
    const result = formatFloodBreakdown({ data: [], truncated: false });
    expect(result).toContain("No mapped flood-hazard zone");
    expect(result).toContain("not a guarantee of safety");
  });

  it("does not render deferred placeholder fields (depth_class null, nearest_zone_m 0)", () => {
    const result = formatFloodBreakdown(full);
    expect(result).not.toContain("depth");
    expect(result).not.toContain("nearest");
    expect(result).not.toContain("null");
  });

  it("truncated → appends the 500-parcel note", () => {
    const result = formatFloodBreakdown({ ...full, truncated: true });
    expect(result).toContain("first 500 parcels");
  });
});

describe("formatSurroundings", () => {
  const full: SurroundingsResponse = {
    data: [
      {
        assessed: true,
        cemetery_distance_m: 240.5,
        landfill_distance_m: null,
        sewage_treatment_distance_m: null,
        industrial_area_distance_m: 890.0,
        industrial_plant_distance_m: 1500.0,
        livestock_farm_distance_m: null,
      },
      {
        assessed: true,
        cemetery_distance_m: 0,
        // Distances may arrive as strings over the wire (REAL → driver/serializer variance).
        landfill_distance_m: "1234.56" as unknown as number,
        sewage_treatment_distance_m: null,
        industrial_area_distance_m: null,
        industrial_plant_distance_m: null,
        livestock_farm_distance_m: "2750.4" as unknown as number,
      },
      {
        assessed: false,
        cemetery_distance_m: null,
        landfill_distance_m: null,
        sewage_treatment_distance_m: null,
        industrial_area_distance_m: null,
        industrial_plant_distance_m: null,
        livestock_farm_distance_m: null,
      },
    ],
    truncated: false,
  };

  it("renders one numbered line per plot with approximate distances and radius-bounded absences", () => {
    const result = formatSurroundings(full);
    expect(result).toContain("Per-parcel surroundings (3 plots;");
    expect(result).toContain('"~" = approximate');
    expect(result).toContain("1. cemetery: ~241 m");
    expect(result).toContain("landfill (waste disposal): none within 3 km");
    expect(result).toContain("sewage treatment plant: none within 2 km");
    expect(result).toContain("industrial/storage area: ~890 m");
    expect(result).toContain("large industrial plant: ~1500 m");
    expect(result).toContain("intensive livestock farm: none within 3 km");
  });

  it("distance 0 → 'on or adjoining the plot', string distances coerced", () => {
    const result = formatSurroundings(full);
    expect(result).toContain("2. cemetery: on or adjoining the plot");
    expect(result).toContain("landfill (waste disposal): ~1235 m");
    expect(result).toContain("intensive livestock farm: ~2750 m"); // string coercion, new category
    expect(result).toContain("large industrial plant: none within 3 km");
  });

  it("assessed=false → 'not assessed yet' line with no distance claims", () => {
    const result = formatSurroundings(full);
    expect(result).toContain("3. not assessed yet");
    expect(result).not.toContain("3. cemetery");
  });

  it("singular 'plot' when there is exactly one", () => {
    const one: SurroundingsResponse = { data: [full.data[0]!], truncated: false };
    const result = formatSurroundings(one);
    expect(result).toContain("(1 plot;");
    expect(result).not.toContain("(1 plots");
  });

  it("two-state empty data → neutral message (no linked plots or unknown id)", () => {
    const result = formatSurroundings({ data: [], truncated: false });
    expect(result).toContain("No surroundings data is available");
  });

  it("handles an absent truncated flag (optional over the wire)", () => {
    const result = formatSurroundings({ data: [full.data[0]!] });
    expect(result).not.toContain("first 500");
  });

  it("truncated → appends the 500-plot note", () => {
    const result = formatSurroundings({ ...full, truncated: true });
    expect(result).toContain("first 500 plots");
  });

  it("output vocabulary stays within the documented labels", () => {
    // Positive guard: every line of the formatted output must match one of the documented,
    // user-facing shapes — the header, numbered rows built from the four category labels with
    // an approximate distance / radius-bounded absence / adjacency value, the pending-plot
    // note, the truncation footer, and the neutral empty-data message. Any other wording
    // (internal names, stray fields) fails the whitelist.
    const CATEGORY = "(?:cemetery|landfill \\(waste disposal\\)|sewage treatment plant|industrial\\/storage area|large industrial plant|intensive livestock farm)";
    const VALUE = "(?:~\\d+ m|none within \\d+ km|on or adjoining the plot)";
    const CELL = `${CATEGORY}: ${VALUE}`;
    const allowedLines: RegExp[] = [
      /^Per-parcel surroundings \(\d+ plots?; distance from the plot boundary to the nearest mapped object, "~" = approximate\):$/,
      /^$/,
      new RegExp(`^\\d+\\. ${CELL}(?: \\| ${CELL})*$`),
      /^\d+\. not assessed yet — this plot has not been evaluated \(no statement either way\)$/,
      /^Showing the first 500 plots \(the transaction is linked to more\)\.$/,
      /^No surroundings data is available for this transaction \(no linked plots, or the id was not found\)\.$/,
    ];

    const outputs = [
      formatSurroundings(full),
      formatSurroundings({ ...full, truncated: true }),
      formatSurroundings({ data: [], truncated: false }),
    ];
    for (const output of outputs) {
      for (const line of output.split("\n")) {
        expect(
          allowedLines.some((pattern) => pattern.test(line)),
          `line outside the documented vocabulary: "${line}"`,
        ).toBe(true);
      }
    }
  });
});

describe("formatTransitBreakdown", () => {
  const full: TransitBreakdownResponse = {
    data: [
      {
        rail_distance_m: 850, rail_stop_name: "Central Station",
        metro_distance_m: null, metro_stop_name: null,
        tram_distance_m: 300, tram_stop_name: "Market Square",
        bus_distance_m: 120, bus_stop_name: "Post Office",
      },
      {
        rail_distance_m: null, rail_stop_name: null,
        metro_distance_m: null, metro_stop_name: null,
        tram_distance_m: null, tram_stop_name: null,
        bus_distance_m: 450, bus_stop_name: "Town Hall",
      },
    ],
    truncated: false,
  };

  it("renders one numbered line per parcel with distance + stop name per mode present", () => {
    const result = formatTransitBreakdown(full);
    expect(result).toContain("Per-parcel public transport access (2 parcels");
    expect(result).toContain("1. Rail: 850 m (Central Station)");
    expect(result).toContain("Tram: 300 m (Market Square)");
    expect(result).toContain("Bus: 120 m (Post Office)");
    expect(result).toContain("2. Bus: 450 m (Town Hall)");
  });

  it("skips modes with a null distance (two-state: null ≠ no service)", () => {
    const result = formatTransitBreakdown(full);
    // Row 1 has no metro — "Metro:" must not appear anywhere near row 1's line.
    const row1 = result.split("\n").find((l) => l.startsWith("1. "));
    expect(row1).toBeDefined();
    expect(row1).not.toContain("Metro:");
    // Row 2 has only bus — rail/metro/tram absent from its line.
    const row2 = result.split("\n").find((l) => l.startsWith("2. "));
    expect(row2).toBeDefined();
    expect(row2).not.toContain("Rail:");
    expect(row2).not.toContain("Metro:");
    expect(row2).not.toContain("Tram:");
  });

  it("singular 'parcel' when there is exactly one", () => {
    const one: TransitBreakdownResponse = { data: [full.data[0]!], truncated: false };
    const result = formatTransitBreakdown(one);
    expect(result).toContain("(1 parcel with");
    expect(result).not.toContain("(1 parcels");
  });

  it("two-state empty data → neutral message that never asserts 'no transit access'", () => {
    const result = formatTransitBreakdown({ data: [], truncated: false });
    expect(result).toContain("No public transport stop is recorded");
    expect(result).not.toContain("no transit access");
  });

  it("always appends the GTFS coverage-gap note (empty and non-empty)", () => {
    const nonEmpty = formatTransitBreakdown(full);
    const empty = formatTransitBreakdown({ data: [], truncated: false });
    expect(nonEmpty).toContain("never read as 'no public transport access'");
    expect(empty).toContain("never read as 'no public transport access'");
  });

  it("truncated → appends the 500-parcel note", () => {
    const result = formatTransitBreakdown({ ...full, truncated: true });
    expect(result).toContain("first 500 parcels");
  });

  it("never names a feed aggregator, carrier, or transit authority", () => {
    expect(findGuardToken(formatTransitBreakdown(full))).toBeNull();
  });
});

describe("formatPlanningBreakdown", () => {
  const covered: PlanningResponse = {
    data: [
      {
        parcel_ord: 1,
        kind: "zone",
        zone_symbol: "SW",
        zone_name: "multi-family residential zone",
        pct_of_parcel: 80,
        max_building_height_m: 12,
        max_development_intensity: 1.2,
        max_built_up_coverage_pct: 40,
        min_bio_active_area_pct: 30,
        params_mixed: false,
        effective_from: "2025-12-03",
      },
      {
        parcel_ord: 1,
        kind: "zone",
        zone_symbol: "SJ",
        zone_name: "single-family residential zone",
        // Wire values may arrive as NUMERIC strings — the formatter must coerce.
        pct_of_parcel: "20" as unknown as number,
        max_building_height_m: null,
        max_development_intensity: null,
        max_built_up_coverage_pct: null,
        min_bio_active_area_pct: null,
        params_mixed: true,
        effective_from: "2025-12-03",
      },
      {
        parcel_ord: 1,
        kind: "infill_area",
        zone_symbol: null,
        zone_name: null,
        pct_of_parcel: 55,
        max_building_height_m: null,
        max_development_intensity: null,
        max_built_up_coverage_pct: null,
        min_bio_active_area_pct: null,
        params_mixed: false,
        effective_from: "2025-12-03",
      },
    ],
    truncated: false,
    coverage: "covered",
    parcels_total: 1,
    parcels_covered: 1,
    note: "server note (formatter authors its own footer)",
  };

  it("covered → header counts zones and overlays, lists symbol + name + share + parameters", () => {
    const result = formatPlanningBreakdown(covered);
    expect(result).toContain("General plan (plan ogólny) zoning for this transaction's land (2 planning zones, 1 overlay area):");
    expect(result).toContain("1. SW — multi-family residential zone | 80% of the parcel |");
    expect(result).toContain("max building height: 12 m");
    expect(result).toContain("max development intensity: 1.2");
    expect(result).toContain("max built-up coverage: 40%");
    expect(result).toContain("min biologically active area: 30%");
  });

  it("covered → coerces string share and omits ambiguous (null) parameters", () => {
    const result = formatPlanningBreakdown(covered);
    expect(result).toContain("2. SJ — single-family residential zone | 20% of the parcel");
    // Row 2 has all-null parameters → no parameter cell rendered for it.
    const row2 = result.split("\n").find((l) => l.startsWith("2. "))!;
    expect(row2).not.toContain("max building height");
  });

  it("covered → params_mixed row carries the ambiguity note (never 'no limit')", () => {
    const result = formatPlanningBreakdown(covered);
    expect(result).toContain("merges sub-zones with differing building parameters");
    expect(result).toContain("not 'no limit'");
  });

  it("covered → overlay rendered as its own line with lawful term, independent share", () => {
    const result = formatPlanningBreakdown(covered);
    expect(result).toContain("3. Infill development area (obszar uzupełnienia zabudowy) — overlay, 55% of the parcel");
  });

  it("covered → footer explains shares are independent and need not sum to 100%", () => {
    const result = formatPlanningBreakdown(covered);
    expect(result).toContain("relative to the cadastral parcel geometry");
    expect(result).toContain("need not add up to 100%");
  });

  // A transaction spanning several parcels repeats a symbol once per parcel. Flat, that reads as a
  // duplicate row and the model would double-count the zone; grouped under "Parcel N of M" it does not.
  it("multi-parcel → rows grouped per parcel, repeated symbol explained as not-a-duplicate", () => {
    const twoParcels: PlanningResponse = {
      ...covered,
      data: [
        { ...covered.data[0]!, parcel_ord: 1 },
        { ...covered.data[0]!, parcel_ord: 2 },
      ],
      parcels_total: 2,
      parcels_covered: 2,
    };
    const result = formatPlanningBreakdown(twoParcels);
    expect(result).toContain("Parcel 1 of 2:");
    expect(result).toContain("Parcel 2 of 2:");
    expect(result).toContain("the same symbol may appear under more than one parcel — that is not a duplicate");
    // Numbering runs across the whole listing, so the second parcel's zone is row 2, not row 1 again.
    expect(result).toContain("1. SW — multi-family residential zone");
    expect(result).toContain("2. SW — multi-family residential zone");
  });

  it("single-parcel → no per-parcel headers, no duplicate caveat", () => {
    const result = formatPlanningBreakdown(covered);
    expect(result).not.toContain("Parcel 1 of");
    expect(result).not.toContain("not a duplicate");
  });

  it("not_covered → honest message that never claims the municipality has no plan", () => {
    const result = formatPlanningBreakdown({ data: [], truncated: false, coverage: "not_covered", parcels_total: 1, parcels_covered: 0, note: null });
    expect(result).toContain("No published general plan (plan ogólny) data is available");
    expect(result).toContain("this is NOT a statement that no plan exists");
  });

  it("covered_no_data → distinct message: municipality has a plan, no zone data covers these parcels", () => {
    const result = formatPlanningBreakdown({ data: [], truncated: false, coverage: "covered_no_data", parcels_total: 1, parcels_covered: 1, note: null });
    expect(result).toContain("has an adopted general plan");
    expect(result).toContain("no planning-zone data covers these parcels");
  });

  it("singular 'planning zone' when there is exactly one and no overlays", () => {
    const one: PlanningResponse = { ...covered, data: [covered.data[0]!] };
    const result = formatPlanningBreakdown(one);
    expect(result).toContain("(1 planning zone):");
    expect(result).not.toContain("planning zones");
    // No overlay row is emitted (the footer still explains overlays in general).
    expect(result).not.toContain("— overlay");
    expect(result).not.toContain("overlay area");
  });

  it("truncated → appends the 500-row note", () => {
    const result = formatPlanningBreakdown({ ...covered, truncated: true });
    expect(result).toContain("first 500 rows");
  });

  it("overlay-only rows → header omits the zone count (never '0 planning zones')", () => {
    const overlayOnly: PlanningResponse = { ...covered, data: [covered.data[2]!] };
    const result = formatPlanningBreakdown(overlayOnly);
    expect(result).toContain("(1 overlay area):");
    expect(result).not.toContain("0 planning zone");
    expect(result).toContain("1. Infill development area (obszar uzupełnienia zabudowy) — overlay, 55% of the parcel");
  });

  it("never leaks source or provider terms", () => {
    const outputs = [
      formatPlanningBreakdown(covered),
      formatPlanningBreakdown({ ...covered, truncated: true }),
      formatPlanningBreakdown({ data: [], truncated: false, coverage: "not_covered", parcels_total: 1, parcels_covered: 0, note: null }),
      formatPlanningBreakdown({ data: [], truncated: false, coverage: "covered_no_data", parcels_total: 1, parcels_covered: 1, note: null }),
    ].join("\n").toLowerCase();
    expect(findGuardToken(outputs)).toBeNull();
    expect(outputs).not.toContain("http"); // no service endpoint of any kind reaches the user
  });
});

describe("formatPermitsBreakdown", () => {
  const full: PermitsResponse = {
    data: [
      // Input mirrors the API's already-scrubbed shape (neutral EN labels, no source-register
      // fingerprint, no parcel identity / registry number).
      {
        record_kind: "permit", intent_type: "new_building", object_category: "XIII", works_type: "new_construction",
        status: null, decision_date: "2023-05-10", intake_date: "2023-01-02", authority: "Prezydent Miasta Krakowa",
        address_street: "ul. Kwiatowa", address_number: "12A", address_city: "Kraków", volume_m3: 1234.7,
      },
      {
        record_kind: "notification", intent_type: "other", object_category: null, works_type: "other_works",
        status: "no_objection", decision_date: null, intake_date: "2022-08-15", authority: "Starosta Powiatu Wielickiego",
        address_street: null, address_number: null, address_city: "Wieliczka", volume_m3: null,
      },
    ],
    truncated: false,
  };

  it("renders one numbered line per record with kind, type, category, date, authority, address, volume", () => {
    const result = formatPermitsBreakdown(full);
    expect(result).toContain("Building permits & notifications on record for this transaction's parcels (2 records)");
    expect(result).toContain("1. permit");
    expect(result).toContain("intent: new_building");
    expect(result).toContain("works: new_construction");
    expect(result).toContain("category: XIII");
    expect(result).toContain("date: 2023-05-10"); // decision_date preferred
    expect(result).toContain("address: ul. Kwiatowa 12A, Kraków");
    expect(result).toContain("volume: 1235 m³"); // rounded
    expect(result).toContain("2. notification");
    expect(result).toContain("status: no_objection");
    expect(result).toContain("date: 2022-08-15"); // falls back to intake_date (no decision_date)
    expect(result).toContain("address: Wieliczka"); // city only, no stray separators
  });

  it("never leaks the source-register brand", () => {
    const result = formatPermitsBreakdown(full).toLowerCase();
    expect(findGuardToken(result)).toBeNull();
  });

  it("never renders parcel identity, registry number or free-text description", () => {
    const result = formatPermitsBreakdown(full).toLowerCase();
    // The register's own record number is covered by the token sweep in the test above.
    for (const term of ["parcel_id", "registry", "description", "id:"]) {
      expect(result).not.toContain(term);
    }
  });

  it("singular 'record' when there is exactly one", () => {
    const one: PermitsResponse = { data: [full.data[0]!], truncated: false };
    const result = formatPermitsBreakdown(one);
    expect(result).toContain("(1 record)");
    expect(result).not.toContain("(1 records)");
  });

  it("two-state empty data → neutral message that never asserts nothing was planned", () => {
    const result = formatPermitsBreakdown({ data: [], truncated: false });
    expect(result).toContain("No positively-resolved building permit");
    expect(result).toContain("never a statement that nothing was ever planned");
  });

  it("omits null fields without leaving stray labels", () => {
    const result = formatPermitsBreakdown(full);
    expect(result).not.toContain("null");
    // Second record has no address_street/number and no volume → no "address: undefined", no "volume:"
    expect(result).not.toContain("address: , Wieliczka");
  });

  it("truncated → appends the 500-record note", () => {
    const result = formatPermitsBreakdown({ ...full, truncated: true });
    expect(result).toContain("first 500 records");
  });
});

describe("formatTransactionList — flood cross-link", () => {
  function listOf(txs: Transaction[]): TransactionsResponse {
    return { data: txs, pagination: { page: 1, limit: 10, total: txs.length, pages: 1 } };
  }

  it("shows the get_transaction_flood tip when ≥1 row has a mapped flood risk", () => {
    const result = formatTransactionList(listOf([{ ...sampleTx, flood_risk: "medium" }]));
    expect(result).toContain("get_transaction_flood(transaction_id)");
  });

  it("no flood tip when no row has a flood risk", () => {
    const result = formatTransactionList(listOf([sampleTx]));
    expect(result).not.toContain("get_transaction_flood");
  });
});

describe("formatTransaction — heritage listing", () => {
  it("surfaces a heritage line with the meaning note when heritage_status is set", () => {
    const result = formatTransaction({ ...sampleTx, heritage_status: "listed" });
    expect(result).toContain("Heritage listing: listed");
    expect(result).toContain("protected monument on/at the parcel");
  });

  it("zone status renders the urban-layout/surroundings note", () => {
    const result = formatTransaction({ ...sampleTx, heritage_status: "zone" });
    expect(result).toContain("Heritage listing: zone");
    expect(result).toContain("within a protected urban layout or monument surroundings");
  });

  it("two-state: no heritage line at all when heritage_status is null (never asserts 'not listed')", () => {
    const result = formatTransaction({ ...sampleTx, heritage_status: null });
    expect(result).not.toContain("Heritage");
  });

  it("two-state: no heritage line when heritage_status is absent", () => {
    const result = formatTransaction(sampleTx);
    expect(result).not.toContain("Heritage");
  });
});

describe("formatHeritageBreakdown", () => {
  const full: HeritageBreakdownResponse = {
    data: [
      // Input mirrors the API's already-scrubbed shape (neutral EN categories, no source-register fingerprint).
      {
        heritage_status: "listed", severity_rank: 1, pct_in_zone: "12.50" as unknown as number, site_count: 2,
        sites: [
          { category: "building", name: "Townhouse", function: "residential", period: "19th c.", entry_date: "1967-05-12T00:00:00.000Z" },
          { category: "urban_layout", name: "Old Town", function: null, period: null, entry_date: "1953-10-01" },
        ],
      },
      {
        heritage_status: "zone", severity_rank: 2, pct_in_zone: null, site_count: 1,
        sites: [{ category: "surroundings", name: null, function: null, period: null, entry_date: null }],
      },
    ],
    truncated: false,
  };

  it("renders one numbered line per parcel with status, entry count and share", () => {
    const result = formatHeritageBreakdown(full);
    expect(result).toContain("Per-parcel heritage-listing breakdown (2 parcels with a detected listing)");
    expect(result).toContain("1. status: listed (protected monument on/at the parcel)");
    expect(result).toContain("entries: 2");
    expect(result).toContain("13% of the parcel in the protected area");
    expect(result).toContain("2. status: zone (within a protected urban layout or monument surroundings)");
  });

  it("renders individual entries as indented sub-lines with date-only entry_date", () => {
    const result = formatHeritageBreakdown(full);
    expect(result).toContain("   - building | Townhouse | function: residential | period: 19th c. | entered: 1967-05-12");
    expect(result).not.toContain("T00:00:00");
    expect(result).toContain("   - urban_layout | Old Town | entered: 1953-10-01");
    expect(result).toContain("   - surroundings");
  });

  it("omits the share cell when pct_in_zone is null (point/line-located entries only)", () => {
    const result = formatHeritageBreakdown(full);
    const zoneLine = result.split("\n").find((l) => l.startsWith("2."))!;
    expect(zoneLine).not.toContain("%");
  });

  it("always appends the indicative-data disclaimer", () => {
    const result = formatHeritageBreakdown(full);
    expect(result).toContain("Indicative data");
    expect(result).toContain("regional heritage conservator");
  });

  it("singular 'parcel' when there is exactly one", () => {
    const one: HeritageBreakdownResponse = { data: [full.data[0]!], truncated: false };
    const result = formatHeritageBreakdown(one);
    expect(result).toContain("(1 parcel with");
    expect(result).not.toContain("(1 parcels");
  });

  it("two-state empty data → neutral message that never asserts the absence of protection", () => {
    const result = formatHeritageBreakdown({ data: [], truncated: false });
    expect(result).toContain("No heritage-listing records found for this transaction's parcels");
    expect(result).toContain("not a statement that the property is free of heritage protection");
  });

  it("does not render literal null/undefined for missing fields", () => {
    const result = formatHeritageBreakdown(full);
    expect(result).not.toContain("null");
    expect(result).not.toContain("undefined");
  });

  it("truncated → appends the 500-parcel note", () => {
    const result = formatHeritageBreakdown({ ...full, truncated: true });
    expect(result).toContain("first 500 parcels");
  });

  it("never leaks the source register's tokens", () => {
    const lower = formatHeritageBreakdown(full).toLowerCase();
    expect(findGuardToken(lower)).toBeNull();
    expect(lower).not.toContain("rejestr"); // the Polish word alone would still point at a register
  });
});

describe("formatTransactionList — heritage cross-link", () => {
  function listOf(txs: Transaction[]): TransactionsResponse {
    return { data: txs, pagination: { page: 1, limit: 10, total: txs.length, pages: 1 } };
  }

  it("shows the get_transaction_heritage tip when ≥1 row has a detected listing", () => {
    const result = formatTransactionList(listOf([{ ...sampleTx, heritage_status: "listed" }]));
    expect(result).toContain("get_transaction_heritage(transaction_id)");
  });

  it("no heritage tip when no row has a heritage status", () => {
    const result = formatTransactionList(listOf([sampleTx]));
    expect(result).not.toContain("get_transaction_heritage");
  });
});

describe("formatTransaction — landslide-hazard", () => {
  it("surfaces a risk line with the category note when landslide_risk is set", () => {
    const result = formatTransaction({ ...sampleTx, landslide_risk: "landslide" });
    expect(result).toContain("Landslide risk: landslide");
    expect(result).toContain("a mapped landslide area");
    // Interpretation guard rides along inline — overlap with a mapped area, not "the parcel is a landslide".
    expect(result).toContain("intersects a mapped hazard area");
  });

  it("surfaces the 'threatened' category with its meaning", () => {
    const result = formatTransaction({ ...sampleTx, landslide_risk: "threatened" });
    expect(result).toContain("Landslide risk: threatened");
    expect(result).toContain("an area threatened by mass movements");
  });

  it("two-state: no landslide line at all when landslide_risk is null (never asserts safety)", () => {
    const result = formatTransaction({ ...sampleTx, landslide_risk: null });
    expect(result).not.toContain("Landslide risk");
  });

  it("two-state: no landslide line when landslide_risk is absent", () => {
    const result = formatTransaction(sampleTx);
    expect(result).not.toContain("Landslide risk");
  });

  it("landslide_assessed alone never renders anything affirmative", () => {
    const result = formatTransaction({ ...sampleTx, landslide_risk: null, landslide_assessed: true });
    expect(result).not.toContain("Landslide");
    expect(result).not.toContain("assessed");
  });
});

describe("formatLandslideBreakdown", () => {
  const full: LandslideBreakdownResponse = {
    data: [
      // Input mirrors the API's already-scrubbed shape (neutral EN kinds, no source-register fingerprint).
      {
        landslide_risk: "landslide", severity_rank: 1, pct_in_zone: "45.00" as unknown as number,
        zones: [
          { kind: "landslide", source_version_date: "2021-03-15" },
          { kind: "threatened", source_version_date: "2019-11-02" },
        ],
      },
      {
        landslide_risk: "threatened", severity_rank: 2, pct_in_zone: "100.00" as unknown as number,
        zones: [{ kind: "threatened", source_version_date: null }],
      },
    ],
    truncated: false,
  };

  it("renders one numbered line per in-zone parcel with risk, share and zones", () => {
    const result = formatLandslideBreakdown(full);
    expect(result).toContain("Per-parcel landslide-zone breakdown (2 parcels intersecting a mapped landslide-hazard zone)");
    expect(result).toContain("1. risk: landslide (a mapped landslide area)");
    expect(result).toContain("45% of the parcel in mapped zones");
    expect(result).toContain("zones: landslide (record version date: 2021-03-15); threatened (record version date: 2019-11-02)");
    expect(result).toContain("2. risk: threatened (an area threatened by mass movements)");
  });

  it("labels the zone date as a record version date, never as a survey date", () => {
    const result = formatLandslideBreakdown(full);
    expect(result).toContain("record version date");
    expect(result.toLowerCase()).not.toContain("survey");
    expect(result.toLowerCase()).not.toContain("observed");
  });

  it("appends the interpretation note (overlap with a mapped area, not 'the parcel is a landslide')", () => {
    const result = formatLandslideBreakdown(full);
    expect(result).toContain("1:10,000 scale");
    expect(result).toContain("not that the parcel itself is a landslide");
  });

  it("singular 'parcel' when there is exactly one", () => {
    const one: LandslideBreakdownResponse = { data: [full.data[0]!], truncated: false };
    const result = formatLandslideBreakdown(one);
    expect(result).toContain("(1 parcel intersecting");
    expect(result).not.toContain("(1 parcels");
  });

  it("two-state empty data → neutral message that never asserts safety", () => {
    const result = formatLandslideBreakdown({ data: [], truncated: false });
    expect(result).toContain("No mapped landslide-hazard zone intersects this transaction's parcels");
    expect(result).toContain("not a guarantee of safety");
  });

  it("skips a missing pct_in_zone and zones without a kind, never rendering 'null'", () => {
    const sparse: LandslideBreakdownResponse = {
      data: [{ landslide_risk: "landslide", severity_rank: 1, pct_in_zone: null, zones: [{ kind: null, source_version_date: "2020-01-01" }] }],
      truncated: false,
    };
    const result = formatLandslideBreakdown(sparse);
    expect(result).not.toContain("%");
    expect(result).not.toContain("zones:");
    expect(result).not.toContain("null");
  });

  it("truncated → appends the 500-parcel note", () => {
    const result = formatLandslideBreakdown({ ...full, truncated: true });
    expect(result).toContain("first 500 parcels");
  });
});

describe("formatTransactionList — landslide cross-link", () => {
  function listOf(txs: Transaction[]): TransactionsResponse {
    return { data: txs, pagination: { page: 1, limit: 10, total: txs.length, pages: 1 } };
  }

  it("shows the get_transaction_landslide tip when ≥1 row has a mapped landslide risk", () => {
    const result = formatTransactionList(listOf([{ ...sampleTx, landslide_risk: "threatened" }]));
    expect(result).toContain("get_transaction_landslide(transaction_id)");
  });

  it("no landslide tip when no row has a landslide risk", () => {
    const result = formatTransactionList(listOf([sampleTx]));
    expect(result).not.toContain("get_transaction_landslide");
  });
});

describe("formatTransaction — provenance & raw deed fields", () => {
  const landBase: Transaction = {
    ...sampleTx,
    property_type: 1,
    usable_area_m2: null,
    price_per_m2: null,
    parcel_area: 1500,
    rooms: null,
    floor: null,
  };

  it("(a) parcel_count >= 2 → [sum of N parcels] marker", () => {
    expect(formatTransaction({ ...landBase, parcel_count: 3 })).toContain("sum of 3 parcels");
  });

  it("(b) area_is_ha_converted → hectares marker", () => {
    expect(formatTransaction({ ...landBase, area_is_ha_converted: true })).toContain("converted from hectares");
  });

  it("combines both parcel markers when both apply", () => {
    const r = formatTransaction({ ...landBase, parcel_count: 2, area_is_ha_converted: true });
    expect(r).toContain("sum of 2 parcels");
    expect(r).toContain("converted from hectares");
  });

  it("(c) property_type_inferred → inferred marker on the type line", () => {
    expect(formatTransaction({ ...sampleTx, property_type_inferred: true })).toContain("type inferred");
  });

  it("property_type_reclassed takes precedence over inferred", () => {
    const r = formatTransaction({ ...sampleTx, property_type_reclassed: true, property_type_inferred: true });
    expect(r).toContain("registry recorded land");
    expect(r).not.toContain("type inferred");
  });

  it("(d) a purely-raw record carries NO provenance markers", () => {
    const r = formatTransaction(landBase);
    expect(r).not.toContain("[sum of");
    expect(r).not.toContain("converted from hectares");
    expect(r).not.toContain("inferred");
    expect(r).not.toContain("registry recorded land");
  });

  it("(e) unit_price gating: string '0', == price_gross (number & string), on land → hidden; != on a unit → shown", () => {
    // sampleTx.price_gross === 890000; NUMERIC arrives as string over the wire → both forms must gate.
    expect(formatTransaction({ ...sampleTx, unit_price: "0" as unknown as number })).not.toContain("Deed unit price");
    expect(formatTransaction({ ...sampleTx, unit_price: 890000 })).not.toContain("Deed unit price");
    expect(formatTransaction({ ...sampleTx, unit_price: "890000" as unknown as number })).not.toContain("Deed unit price");
    expect(formatTransaction({ ...landBase, unit_price: 850000 })).not.toContain("Deed unit price");
    const shown = formatTransaction({ ...sampleTx, unit_price: 850000 });
    expect(shown).toContain("Deed unit price (not per-m²)");
    expect(shown).toMatch(/850/);
  });

  it("ha conversion marks the area even with a single parcel (parcel_count = 1)", () => {
    const r = formatTransaction({ ...landBase, parcel_count: 1, area_is_ha_converted: true });
    expect(r).toContain("converted from hectares");
    expect(r).not.toContain("sum of");
  });

  it("(f) ownership/seller/buyer/land_use render dictionary labels", () => {
    const r = formatTransaction({ ...sampleTx, ownership_type: 2, seller_type: 1, buyer_type: 3, land_use: "gruntyRolne" });
    expect(r).toContain("Ownership: Perpetual usufruct");
    expect(r).toContain("Seller: State Treasury");
    expect(r).toContain("Buyer: Natural person");
    expect(r).toContain("Land use: Agricultural land");
  });

  it("(g) unknown enum code → fallback label", () => {
    const r = formatTransaction({ ...sampleTx, ownership_type: 99, seller_type: 88 });
    expect(r).toContain("Ownership: Type 99");
    expect(r).toContain("Seller: Party type 88");
  });

  it("(h) vat: non-null string shown without a unit; null/empty → absent", () => {
    const shown = formatTransaction({ ...sampleTx, vat: "23000.00" as unknown as number });
    expect(shown).toContain("VAT (as recorded");
    expect(shown).toMatch(/23.?000/);
    expect(formatTransaction({ ...sampleTx, vat: null })).not.toContain("VAT");
    expect(formatTransaction({ ...sampleTx, vat: "" as unknown as number })).not.toContain("VAT");
    // vat = 0 is a meaningful explicit record (possible exemption / 0% rate) → shown, not hidden.
    const zero = formatTransaction({ ...sampleTx, vat: 0 });
    expect(zero).toContain("VAT (as recorded");
    expect(zero).toMatch(/:\s*0/);
  });

  it("(i) ownership_share shown only when share_basis = 'fraction'", () => {
    expect(formatTransaction({ ...sampleTx, ownership_share: "1/2", share_basis: "fraction" })).toContain("Share: 1/2");
    expect(formatTransaction({ ...sampleTx, ownership_share: "1/1", share_basis: "full" })).not.toContain("Share: 1/1");
  });

  it("markers also appear on the spatial path (shared formatTransactionCore)", () => {
    const feat: SpatialFeature = {
      type: "Feature",
      geometry: { type: "Point", coordinates: [21.05, 52.22] },
      properties: {
        id: "1", price_gross: 500000, transaction_date: "2024-06-15T00:00:00.000Z",
        property_type: 1, market_type: 2, usable_area_m2: null, price_per_m2: null,
        rooms: null, floor: null, street: null, building_number: "5", city: "X", district: "X",
        parcel_area: 2000, parcel_number: "1", parcel_count: 4,
      },
    };
    const res: SpatialSearchResponse = { type: "FeatureCollection", features: [feat], truncated: false, total: 1 };
    expect(formatSpatialResults(res)).toContain("sum of 4 parcels");
  });
});

describe("formatTransactionList", () => {
  it("shows 'no transactions' for empty results", () => {
    const empty: TransactionsResponse = {
      data: [],
      pagination: { page: 1, limit: 10, total: 0, pages: 0 },
    };
    expect(formatTransactionList(empty)).toContain("No transactions found");
  });

  it("formats list with summary", () => {
    const res: TransactionsResponse = {
      data: [sampleTx],
      pagination: { page: 1, limit: 10, total: 1234, pages: 124 },
    };
    const summary = { median_price_m2: 15200, avg_area: 58.3, min_date: "2024-01-01", max_date: "2024-12-31", total: 1234 };
    const result = formatTransactionList(res, summary);
    // Intl may use non-breaking space - check digits exist
    expect(result).toMatch(/1.?234/);
    expect(result).toContain("Puławska");
    expect(result).toContain("Median");
  });

  it("appends the get_building_breakdown tip when a row has buildings, not otherwise", () => {
    const withBld: TransactionsResponse = {
      data: [{ ...sampleTx, building_count: 2 }],
      pagination: { page: 1, limit: 10, total: 1, pages: 1 },
    };
    expect(formatTransactionList(withBld)).toContain("get_building_breakdown");

    const noBld: TransactionsResponse = {
      data: [sampleTx],
      pagination: { page: 1, limit: 10, total: 1, pages: 1 },
    };
    expect(formatTransactionList(noBld)).not.toContain("get_building_breakdown");
  });
});

describe("formatMarketOverview", () => {
  const stats: StatsResponse = {
    counts: { transactions: 8194025, parcels: 100, buildings: 50, units: 30, addresses: 20 },
    prices: { total: 8194025, avg_price: 456789, median_price: 280000, min_price: 1, max_price: 999999999 },
    dateRange: { min_date: "2003-01-02", max_date: "2024-12-31" },
    byDistrict: [{ district: "Warszawa-Mokotów", transaction_count: 312456 }],
    byPropertyType: [{ type: 4, total: 3245678, label: "Lokal" }],
    byMarketType: [{ type: 2, total: 5890123, label: "Wtórny" }],
  };

  it("includes total count", () => {
    // Intl may use non-breaking space as thousand separator
    expect(formatMarketOverview(stats)).toMatch(/8.?194.?025/);
  });

  it("includes date range", () => {
    const result = formatMarketOverview(stats);
    expect(result).toContain("2003");
    expect(result).toContain("2024");
  });

  it("includes Cenogram branding", () => {
    expect(formatMarketOverview(stats)).toContain("Cenogram");
  });
});

describe("formatPriceStats", () => {
  const rows: PricePerM2Row[] = [
    { district: "Mokotów", avg_price_m2: 16000, median_price_m2: 15200, count: 5000 },
    { district: "Kraków-Podgórze", avg_price_m2: 12000, median_price_m2: 11500, count: 3000 },
  ];

  it("shows stats table", () => {
    const result = formatPriceStats(rows);
    expect(result).toContain("Mokotów");
    expect(result).toContain("residential");
  });

  it("shows filtered results", () => {
    const result = formatPriceStats(rows, "Kraków");
    expect(result).toContain("Kraków");
  });

  it("shows helpful message when empty", () => {
    const result = formatPriceStats([], "Warszawa");
    expect(result).toContain("No price statistics");
    expect(result).toContain("list_locations");
  });
});

describe("formatRentalYield", () => {
  const full: RentalYieldResponse = {
    location: { name: "Warszawa", country_code: "PL", location_type: "city", teryt: "1465" },
    metric: "indicative_gross_rental_yield",
    currency: "PLN",
    segment: { market_type: "secondary", property_type: "apartment", area_bucket: null },
    result: { gross_yield_pct: 5.5, calculation_method: "ratio_of_market_medians", matched_observations: false },
    inputs: {
      rent: { median_monthly_asking_per_m2: 75.49, annualized_per_m2: 905.88, sample_n: 7468, snapshot_date: "2025-11-20" },
      transaction: { median_price_per_m2: 16472, sample_n: 13263, window: { from: "2024-11-20", to: "2025-11-23" } },
    },
    distribution: {
      asking_rent_monthly_per_m2: { p10: 50, p25: 62, p50: 75.49, p75: 90, p90: 110 },
      transaction_price_per_m2: { p10: 12000, p25: 14000, p50: 16472, p75: 19000, p90: 22000 },
    },
    assumptions: { vacancy_included: false, tax_included: false, maintenance_included: false, transaction_costs_included: false },
    quality: { coverage: "full", confidence: "high", as_of: "2025-11-23", stale: true, notes: ["indykatywny yield brutto, bez vacancy/podatku", "mianownik: rynek wtórny"] },
  };

  it("renders the yield, calculation, samples and notes", () => {
    const result = formatRentalYield(full);
    expect(result).toContain("Warszawa");
    expect(result).toContain("5.5%");
    expect(result).toContain("secondary market");
    expect(result).toContain("rent offers");
    expect(result).toContain("transactions");
    expect(result).toContain("2024-11-20 to 2025-11-23");
    // offer-side freshness: the rent snapshot date renders as a point-in-time suffix
    expect(result).toContain("(as of 2025-11-20)");
    expect(result).toContain("Coverage: full");
    expect(result).toContain("indykatywny yield brutto");
    // arithmetic-consistency regression: monthly rent shown with decimals so "× 12" adds up
    // (75,49 × 12 = 905,88 ≈ 906), not the misleading rounded "75 × 12 = 906"
    expect(result).toContain("75,49");
    expect(result).not.toContain("75 zł/m²/mo");
  });

  it("uses singular nouns when a sample count is exactly 1", () => {
    const single: RentalYieldResponse = {
      ...full,
      inputs: {
        rent: { ...full.inputs.rent, sample_n: 1 },
        transaction: { ...full.inputs.transaction, sample_n: 1 },
      },
    };
    const result = formatRentalYield(single);
    expect(result).toContain("1 rent offer (as of");
    expect(result).toContain("1 transaction ");
    expect(result).not.toContain("1 rent offers");
    expect(result).not.toContain("1 transactions");
  });

  it("handles a suppressed / null-yield result without crashing", () => {
    const suppressed: RentalYieldResponse = {
      ...full,
      result: { ...full.result, gross_yield_pct: null },
      inputs: {
        rent: { median_monthly_asking_per_m2: null, annualized_per_m2: null, sample_n: null, snapshot_date: "2025-11-20" },
        transaction: { median_price_per_m2: null, sample_n: null, window: { from: null, to: null } },
      },
      quality: { ...full.quality, coverage: "suppressed", confidence: "low", notes: [] },
    };
    const result = formatRentalYield(suppressed);
    expect(result).toContain("N/A");
    expect(result).toContain("coverage: suppressed");
    expect(result).toContain("no rent data");
    expect(result).toContain("no transaction data");
    // W1 regression: a null tx sample_n must not leak "N/A transactions" mid-sentence
    expect(result).not.toContain("N/A transactions");
    // offer-date suffix is gated on sample_n: a present snapshot_date must NOT show next to "no rent data"
    expect(result).not.toContain("(as of");
  });

  it("never leaks the rent-data source brand", () => {
    const result = formatRentalYield(full).toLowerCase();
    expect(findGuardToken(result)).toBeNull();
  });

  it("no_rental_data → appends list_rental_yield_locations tip, hides REST-URL note", () => {
    const noData: RentalYieldResponse = {
      ...full,
      result: { ...full.result, gross_yield_pct: null },
      inputs: { rent: { ...full.inputs.rent, sample_n: null }, transaction: full.inputs.transaction },
      quality: { ...full.quality, coverage: "no_rental_data", notes: ["Brak danych czynszowych dla tej lokalizacji — listę pokrytych miast zwraca GET /api/v1/rental-yield/locations"] },
    };
    const result = formatRentalYield(noData);
    expect(result).toContain("list_rental_yield_locations");
    expect(result).not.toContain("/api/v1/rental-yield/locations");
  });

  it("strips the legacy /api/ note variant too (old published stdio backward-compat)", () => {
    const noData: RentalYieldResponse = {
      ...full,
      result: { ...full.result, gross_yield_pct: null },
      inputs: { rent: { ...full.inputs.rent, sample_n: null }, transaction: full.inputs.transaction },
      quality: { ...full.quality, coverage: "no_rental_data", notes: ["Brak danych czynszowych dla tej lokalizacji — listę pokrytych miast zwraca GET /api/rental-yield/locations"] },
    };
    const result = formatRentalYield(noData);
    expect(result).not.toContain("/api/rental-yield/locations");
  });
});

describe("formatRentalYieldLocations", () => {
  const catalog: RentalYieldLocationsResponse = {
    data: [
      { location: "Warszawa", county_code: "1465", voivodeship: "Mazowieckie", type: "city", rent_sample_n: 7040, confidence: "high" },
      { location: "legionowski", county_code: "1408", voivodeship: "Mazowieckie", type: "county", rent_sample_n: 120, confidence: "high" },
    ],
    meta: { total: 2, snapshot_date: "2026-06-02" },
  };

  it("renders header with count + snapshot and one line per location", () => {
    const result = formatRentalYieldLocations(catalog);
    expect(result).toContain("2 locations");
    expect(result).toContain("2026-06-02");
    expect(result).toContain("Warszawa (teryt 1465, Mazowieckie, city) — n=7040, high confidence");
    expect(result).toContain("legionowski (teryt 1408, Mazowieckie, county) — n=120, high confidence");
  });

  it("singular 'location' when total is 1", () => {
    const one: RentalYieldLocationsResponse = { data: [catalog.data[0]!], meta: { total: 1, snapshot_date: "2026-06-02" } };
    const result = formatRentalYieldLocations(one);
    expect(result).toContain("1 location,");
    expect(result).not.toContain("1 locations");
  });

  it("empty data → friendly no-match message", () => {
    const result = formatRentalYieldLocations({ data: [], meta: { total: 0, snapshot_date: null } });
    expect(result).toContain("No rental-yield-covered locations match");
  });

  it("never leaks the rent-data source brand", () => {
    const result = formatRentalYieldLocations(catalog).toLowerCase();
    expect(findGuardToken(result)).toBeNull();
  });
});

describe("formatPriceSpread", () => {
  const full: PriceSpreadResponse = {
    location: { name: "Warszawa", country_code: "PL", location_type: "city", teryt: "1465" },
    metric: "asking_to_transaction_price_spread",
    currency: "PLN",
    segment: { market_type: "all", property_type: "apartment", area_bucket: null },
    result: { spread_pct: 8.41, calculation_method: "relative_difference_of_market_medians", matched_observations: false },
    inputs: {
      asking: { median_price_per_m2: 16585, sample_n: 200, snapshot_date: "2026-06-01" },
      transaction: { median_price_per_m2: 15298, sample_n: 500, window: { from: "2025-06-01", to: "2026-06-01" } },
    },
    distribution: {
      asking_sale_per_m2: { p10: 12000, p25: 14500, p50: 16585, p75: 19000, p90: 23000 },
      transaction_price_per_m2: { p10: 11000, p25: 13200, p50: 15298, p75: 18000, p90: 21000 },
    },
    // Realistic production notes (incl. the source-availability caveat) so the brand-scrub test
    // below is a genuine guard — not a fixture that happens to omit the risky note (CR B1).
    quality: {
      coverage: "full",
      confidence: "high",
      as_of: "2026-06-01",
      stale: false,
      notes: [
        "spread = how far the median asking price exceeds the median transaction price (may be negative)",
        "sale offers are a mix of primary and secondary market",
        "denominator: whole market (fractional shares and non-market deeds excluded)",
        "offer-source coverage changed on 2026-03-23 (may affect offer counts)",
      ],
    },
  };

  it("renders a positive spread with both medians and the market segment", () => {
    const result = formatPriceSpread(full);
    expect(result).toContain("Warszawa");
    expect(result).toContain("+8.41%");
    expect(result).toContain("above transaction");
    expect(result).toContain("all market");
    expect(result).toContain("2025-06-01 to 2026-06-01");
    // offer-side freshness: the asking snapshot date renders as a point-in-time suffix
    expect(result).toContain("(as of 2026-06-01)");
  });

  it("renders a negative spread as 'below transaction'", () => {
    const result = formatPriceSpread({ ...full, result: { ...full.result, spread_pct: -6.67 } });
    expect(result).toContain("-6.67%");
    expect(result).toContain("below transaction");
  });

  it("handles a suppressed / null-spread result without crashing", () => {
    const suppressed: PriceSpreadResponse = {
      ...full,
      result: { ...full.result, spread_pct: null },
      inputs: {
        asking: { median_price_per_m2: null, sample_n: null, snapshot_date: "2026-06-01" },
        transaction: { median_price_per_m2: null, sample_n: null, window: { from: null, to: null } },
      },
      quality: { ...full.quality, coverage: "suppressed", confidence: "low", notes: [] },
    };
    const result = formatPriceSpread(suppressed);
    expect(result).toContain("N/A");
    expect(result).toContain("coverage: suppressed");
    expect(result).toContain("no asking data");
    expect(result).toContain("no transaction data");
    expect(result).not.toContain("N/A transactions");
    // offer-date suffix is gated on sample_n: a present snapshot_date must NOT show next to "no asking data"
    expect(result).not.toContain("(as of");
  });

  it("uses singular nouns when a sample count is exactly 1", () => {
    const single: PriceSpreadResponse = {
      ...full,
      inputs: {
        asking: { ...full.inputs.asking, sample_n: 1 },
        transaction: { ...full.inputs.transaction, sample_n: 1 },
      },
    };
    const result = formatPriceSpread(single);
    expect(result).toContain("1 sale offer (as of");
    expect(result).toContain("1 transaction ");
    expect(result).not.toContain("1 sale offers");
    expect(result).not.toContain("1 transactions");
  });

  it("never leaks the data source brand", () => {
    const result = formatPriceSpread(full).toLowerCase();
    expect(findGuardToken(result)).toBeNull();
  });

  it("no_asking_data → appends list_price_spread_locations tip, hides REST-URL note", () => {
    const noData: PriceSpreadResponse = {
      ...full,
      result: { ...full.result, spread_pct: null },
      inputs: { asking: { ...full.inputs.asking, sample_n: null }, transaction: full.inputs.transaction },
      quality: { ...full.quality, coverage: "no_asking_data", notes: ["Brak danych ofertowych sprzedaży dla tej lokalizacji — listę pokrytych miast zwraca GET /api/v1/price-spread/locations"] },
    };
    const result = formatPriceSpread(noData);
    expect(result).toContain("list_price_spread_locations");
    expect(result).not.toContain("/api/v1/price-spread/locations");
  });

  it("strips the legacy /api/ note variant too (old published stdio backward-compat)", () => {
    const noData: PriceSpreadResponse = {
      ...full,
      result: { ...full.result, spread_pct: null },
      inputs: { asking: { ...full.inputs.asking, sample_n: null }, transaction: full.inputs.transaction },
      quality: { ...full.quality, coverage: "no_asking_data", notes: ["Brak danych ofertowych sprzedaży dla tej lokalizacji — listę pokrytych miast zwraca GET /api/price-spread/locations"] },
    };
    const result = formatPriceSpread(noData);
    expect(result).not.toContain("/api/price-spread/locations");
  });
});

describe("formatPriceSpreadLocations", () => {
  const catalog: PriceSpreadLocationsResponse = {
    data: [
      { location: "Warszawa", county_code: "1465", voivodeship: "Mazowieckie", type: "city", asking_sample_n: 5000, confidence: "high" },
      { location: "Kraków", county_code: "1261", voivodeship: "Małopolskie", type: "city", asking_sample_n: 900, confidence: "high" },
    ],
    meta: { total: 2, snapshot_date: "2026-06-02" },
  };

  it("renders header with count + snapshot and one line per location", () => {
    const result = formatPriceSpreadLocations(catalog);
    expect(result).toContain("2 locations");
    expect(result).toContain("2026-06-02");
    expect(result).toContain("Warszawa (teryt 1465, Mazowieckie, city) — n=5000, high confidence");
    expect(result).toContain("Kraków (teryt 1261, Małopolskie, city) — n=900, high confidence");
  });

  it("singular 'location' when total is 1", () => {
    const one: PriceSpreadLocationsResponse = { data: [catalog.data[0]!], meta: { total: 1, snapshot_date: "2026-06-02" } };
    const result = formatPriceSpreadLocations(one);
    expect(result).toContain("1 location,");
    expect(result).not.toContain("1 locations");
  });

  it("empty data → friendly no-match message", () => {
    const result = formatPriceSpreadLocations({ data: [], meta: { total: 0, snapshot_date: null } });
    expect(result).toContain("No price-spread-covered locations match");
  });

  it("never leaks the data source brand", () => {
    const result = formatPriceSpreadLocations(catalog).toLowerCase();
    expect(findGuardToken(result)).toBeNull();
  });
});

describe("formatValuation", () => {
  const covered: ValuationResponse = {
    location: { country_code: "PL", lat: 52.2297, lng: 21.0122, county_code: "1465" },
    metric: "estimated_apartment_value",
    currency: "PLN",
    segment: { property_type: "apartment", market_type: "all", area_m2: 55, rooms: null },
    result: {
      estimated_value: 1210000,
      price_per_m2: 22000,
      value_range_likely: { low: 1100000, high: 1320000 },
      value_range_wide: { low: 950000, high: 1450000 },
      confidence: 0.82,
      confidence_band: "high",
    },
    inputs: {
      comps_total: 34,
      radius_m: 1000,
      window_months: 24,
      comparables: [
        { distance_m: 210, transaction_date: "2025-08-12", area_m2: 54, price_per_m2: 21500, rooms: 3, floor: 4, market_type: "secondary", district: "Mokotów", has_unit_number: true, unit_number: "11_LOK" },
        { distance_m: 640, transaction_date: "2025-05-02", area_m2: 58, price_per_m2: 20800, rooms: 3, floor: 2, market_type: "secondary", district: "Mokotów", has_unit_number: false },
      ],
    },
    quality: {
      coverage: "covered",
      as_of: "2025-11-23",
      price_basis: "apartment",
      ess: 18.4,
      accuracy_segment: "wwa",
      note: "Indicative market-value estimate for an apartment. This is an orientation estimate, NOT a certified appraisal (operat szacunkowy).",
    },
  };

  it("renders the estimate, ranges, confidence, comps and disclaimer", () => {
    const result = formatValuation(covered);
    expect(result).toContain("Apartment value estimate");
    expect(result).toContain("Estimated value:");
    expect(result).toContain("Likely range:");
    expect(result).toContain("Wide range:");
    expect(result).toContain("Confidence: high (0.82)");
    expect(result).toContain("34 comparable transactions within");
    expect(result).toContain("last 24 months");
    expect(result).toContain("Transaction data as of: 2025-11-23");
    expect(result).toContain("Comparables (nearest 2):");
    expect(result).toContain("Mokotów");
    expect(result).toContain("operat szacunkowy");
  });

  it("no_data → no estimate + refund hint, no range lines", () => {
    const noData: ValuationResponse = {
      ...covered,
      location: { country_code: "PL", lat: 52.9, lng: 19.1, county_code: null },
      result: {
        estimated_value: null, price_per_m2: null,
        value_range_likely: { low: null, high: null }, value_range_wide: { low: null, high: null },
        confidence: null, confidence_band: null,
      },
      inputs: { comps_total: 2, radius_m: null, window_months: 24, comparables: null },
      quality: { ...covered.quality, coverage: "no_data", as_of: null, accuracy_segment: null, ess: null },
    };
    const result = formatValuation(noData);
    expect(result).toContain("No estimate");
    expect(result).toContain("refunded");
    expect(result).not.toContain("Likely range:");
    expect(result).toContain("operat szacunkowy");
  });

  it("not_covered → property-type message", () => {
    const notCovered: ValuationResponse = {
      ...covered,
      result: { estimated_value: null, price_per_m2: null, value_range_likely: { low: null, high: null }, value_range_wide: { low: null, high: null }, confidence: null, confidence_band: null },
      inputs: { comps_total: 0, radius_m: null, window_months: 24, comparables: null },
      quality: { ...covered.quality, coverage: "not_covered", as_of: null },
    };
    const result = formatValuation(notCovered);
    expect(result).toContain("apartments only");
  });

  it("omits the comparables block when includeComps was off (null)", () => {
    const noComps: ValuationResponse = { ...covered, inputs: { ...covered.inputs, comparables: null } };
    const result = formatValuation(noComps);
    expect(result).not.toContain("Comparables (nearest");
    expect(result).toContain("Estimated value:");
  });

  // A truncated/proxied body used to throw a raw TypeError naming our internal fields — inside
  // a PUBLIC artifact. The server never emits these shapes; the point is that the failure stays boring.
  it("degrades to a plain message on a malformed body instead of throwing", () => {
    const malformed: unknown[] = [
      undefined, null, {}, [], "boom",
      { ...covered, result: undefined },
      { ...covered, quality: undefined },
      { ...covered, inputs: undefined },
      { ...covered, location: undefined },
      { ...covered, segment: undefined },
    ];
    for (const body of malformed) {
      const out = formatValuation(body as ValuationResponse);
      expect(out).toContain("could not be rendered");
      expect(out).not.toMatch(/TypeError|Cannot read properties/);
    }
  });

  it("survives partial nulls inside a well-shaped body", () => {
    const ragged = {
      ...covered,
      result: { ...covered.result, value_range_likely: undefined, value_range_wide: undefined },
      inputs: { ...covered.inputs, comparables: "boom" },
      quality: { ...covered.quality, note: null },
    } as unknown as ValuationResponse;
    const out = formatValuation(ragged);
    expect(out).toContain("Estimated value:");
    expect(out).not.toContain("Likely range:");
    expect(out).not.toContain("Comparables (nearest");
    expect(out).not.toContain("null");
  });

  it("says the parcel did not resolve, rather than blaming the neighbourhood", () => {
    const unresolved: ValuationResponse = {
      ...covered,
      location: { country_code: "PL", lat: null, lng: null, county_code: null },
      result: { estimated_value: null, price_per_m2: null, value_range_likely: { low: null, high: null }, value_range_wide: { low: null, high: null }, confidence: null, confidence_band: null },
      inputs: { comps_total: 0, radius_m: null, window_months: 24, comparables: null },
      quality: { ...covered.quality, coverage: "no_data", as_of: null, accuracy_segment: null, ess: null },
    };
    const out = formatValuation(unresolved);
    expect(out).toContain("could not be resolved");
    expect(out).toContain("refunded");
  });

  it("never leaks a source brand", () => {
    const result = formatValuation(covered).toLowerCase();
    expect(findGuardToken(result)).toBeNull();
  });
});

describe("formatHistogram", () => {
  const bins: HistogramBin[] = [
    { bucket: 0, count: 100, range_min: 0, range_max: 150000 },
    { bucket: 1, count: 500, range_min: 150000, range_max: 300000 },
    { bucket: 2, count: 200, range_min: 300000, range_max: 450000 },
  ];

  it("renders bars", () => {
    const result = formatHistogram(bins);
    expect(result).toContain("█");
  });

  it("handles empty bins", () => {
    expect(formatHistogram([])).toContain("No histogram data");
  });
});

describe("formatParcelResults", () => {
  it("formats results with district and area", () => {
    const res: ParcelSearchResponse = {
      results: [
        { parcel_id: "146518_8.0108.27", district: "Wawer", area_m2: 1200, lat: 52.1234, lng: 21.0567 },
        { parcel_id: "146518_8.0108.28", district: "Wawer", area_m2: 800, lat: 52.1235, lng: 21.0568 },
      ],
    };
    const result = formatParcelResults(res, "146518_8.01");
    expect(result).toContain("Found 2 parcels");
    expect(result).toContain("146518_8.0108.27");
    expect(result).toContain("Wawer");
    expect(result).toContain("52.1234");
  });

  it("handles empty results", () => {
    const result = formatParcelResults({ results: [] }, "999999");
    expect(result).toContain("No parcels found");
    expect(result).toContain("999999");
  });

  it("handles null district and area", () => {
    const res: ParcelSearchResponse = {
      results: [{ parcel_id: "100_1.0001.1", district: null, area_m2: null, lat: 50.0, lng: 20.0 }],
    };
    const result = formatParcelResults(res, "100");
    expect(result).toContain("Unknown");
    expect(result).toContain("N/A");
  });

});

describe("formatParcelResolve", () => {
  const base: ParcelResolveResponse = {
    query: { mode: "q", q: "Wawer 27" },
    coverage: "covered",
    as_of: "2026-06-30T00:00:00.000Z",
    matches: [
      { id: "u1", parcel_id: "146518_8.0108.27", parcel_key: "146518_8.0108.27", district: "Wawer", county_code: "1465", parcel_number: "27", area_m2: 1200, has_geometry: true, centroid: { lat: 52.1234, lng: 21.0567 } },
    ],
    truncated: false,
  };

  it("formats a match with id, district, area, location and as_of", () => {
    const result = formatParcelResolve(base);
    expect(result).toContain("Found 1 parcel");
    expect(result).toContain("146518_8.0108.27");
    expect(result).toContain("Wawer");
    expect(result).toContain("52.1234");
    expect(result).toContain("2026-06-30");
  });

  it("reports not_covered as a refunded miss", () => {
    const result = formatParcelResolve({ ...base, coverage: "not_covered", matches: [], as_of: null });
    expect(result).toContain("No parcel matched");
    expect(result).toContain("refunded");
  });

  it("notes truncation when matches were capped", () => {
    const result = formatParcelResolve({ ...base, truncated: true });
    expect(result).toContain("More matches exist");
  });

  it("renders a paid-plan hint when identity is stripped and no-geometry", () => {
    const result = formatParcelResolve({
      ...base,
      matches: [{ ...base.matches[0]!, parcel_id: null, parcel_key: null, has_geometry: false, centroid: null }],
    });
    expect(result).toContain("requires a paid plan");
    expect(result).toContain("no geometry");
  });
});

describe("formatSpatialResults", () => {
  const sampleFeature: SpatialFeature = {
    type: "Feature",
    geometry: { type: "Point", coordinates: [21.05, 52.22] },
    properties: {
      id: "1",
      price_gross: 500000,
      transaction_date: "2024-06-15",
      property_type: 4,
      market_type: 2,
      usable_area_m2: 55.0,
      price_per_m2: 9091,
      rooms: 3,
      floor: 2,
      street: "Puławska",
      building_number: "12",
      city: "Warszawa",
      district: "Mokotów",
      parcel_area: null,
      parcel_number: "45/2",
    },
  };

  it("formats features with count", () => {
    const res: SpatialSearchResponse = {
      type: "FeatureCollection",
      features: [sampleFeature],
      truncated: false,
      total: 1,
    };
    const result = formatSpatialResults(res);
    expect(result).toContain("Found 1 transactions");
    expect(result).toContain("Puławska 12, Mokotów");
    expect(result).toContain("2024-06-15");
  });

  it("shows truncation warning", () => {
    const res: SpatialSearchResponse = {
      type: "FeatureCollection",
      features: [sampleFeature],
      truncated: true,
      total: 5000,
    };
    const result = formatSpatialResults(res);
    expect(result).toContain("truncated");
  });

  it("handles empty features", () => {
    const res: SpatialSearchResponse = {
      type: "FeatureCollection",
      features: [],
      truncated: false,
      total: 0,
    };
    const result = formatSpatialResults(res);
    expect(result).toContain("No transactions found");
  });

  it("caps display at 50 features", () => {
    const features = Array.from({ length: 60 }, (_, i) => ({
      ...sampleFeature,
      properties: { ...sampleFeature.properties, id: String(i) },
    }));
    const res: SpatialSearchResponse = {
      type: "FeatureCollection",
      features,
      truncated: false,
      total: 60,
    };
    const result = formatSpatialResults(res);
    expect(result).toContain("showing 50");
    expect(result).toContain("10 more");
  });

  it("surfaces the id inline + breakdown tip on the spatial path when a feature has buildings", () => {
    const withBld: SpatialFeature = {
      ...sampleFeature,
      properties: { ...sampleFeature.properties, id: "abc-123", building_count: 2, footprint_area_m2: "300.00" as unknown as number },
    };
    const res: SpatialSearchResponse = { type: "FeatureCollection", features: [withBld], truncated: false, total: 1 };
    const result = formatSpatialResults(res);
    expect(result).toContain("id: abc-123");
    expect(result).toContain("get_building_breakdown");
  });

  it("surfaces id but NOT the breakdown tip on the spatial path when no feature has buildings", () => {
    // id is unconditional (deep link), but the list-level get_building_breakdown tip
    // stays gated on at least one feature having buildings.
    const res: SpatialSearchResponse = { type: "FeatureCollection", features: [sampleFeature], truncated: false, total: 1 };
    const result = formatSpatialResults(res);
    expect(result).not.toContain("get_building_breakdown");
    expect(result).toContain("id: 1");
  });
});

describe("formatCompareResults", () => {
  it("renders comparison table", () => {
    const res: CompareResponse = {
      "Mokotów": { median_price_m2: 15200, avg_area: 58.3, min_date: "2024-01-01", max_date: "2024-12-31", total: 1234 },
      "Wola": { median_price_m2: 12100, avg_area: 45.0, min_date: "2024-02-15", max_date: "2024-11-30", total: 987 },
    };
    const result = formatCompareResults(res);
    expect(result).toContain("Location comparison (2 districts)");
    expect(result).toContain("Mokotów");
    expect(result).toContain("Wola");
    expect(result).toContain("2024-01-01");
  });

  it("shows suggestions for unmatched districts", () => {
    const res: CompareResponse = {
      "Mokotow": { median_price_m2: null, avg_area: null, min_date: null, max_date: null, total: 0, suggestions: ["Mokotów"] },
    };
    const result = formatCompareResults(res);
    expect(result).toContain("Did you mean: Mokotów");
  });

  it("handles null median and area", () => {
    const res: CompareResponse = {
      "Test": { median_price_m2: null, avg_area: null, min_date: null, max_date: null, total: 0 },
    };
    const result = formatCompareResults(res);
    expect(result).toContain("N/A");
  });

  it("handles empty response", () => {
    const result = formatCompareResults({});
    expect(result).toContain("No comparison data");
  });
});

describe("formatFarmland", () => {
  const full: FarmlandResponse = {
    data: [
      { eligible_area_m2: 3984, pct_of_parcel: 87, feature_count: 2 },
      { eligible_area_m2: 12000, pct_of_parcel: null, feature_count: 1 },
    ],
    truncated: false,
    parcels_total: 3,
    parcels_with_data: 2,
    as_of: "2026-07-01",
  };

  it("renders one numbered line per matched parcel with area, share and feature count", () => {
    const result = formatFarmland(full);
    expect(result).toContain("Per-parcel agricultural land-eligibility (2 of 3 linked parcels with a matched eligible area)");
    expect(result).toContain(`1. eligible agricultural area: ${formatArea(3984)} | 87% of the parcel | 2 features`);
  });

  it("omits the share cell when pct_of_parcel is null (parcel measured area unavailable)", () => {
    const result = formatFarmland(full);
    const secondLine = result.split("\n").find((l) => l.startsWith("2."))!;
    expect(secondLine).toContain(`eligible agricultural area: ${formatArea(12000)}`);
    expect(secondLine).not.toContain("% of the parcel");
  });

  it("omits the feature-count cell when a single feature composes the area", () => {
    const result = formatFarmland(full);
    const secondLine = result.split("\n").find((l) => l.startsWith("2."))!;
    expect(secondLine).not.toContain("feature");
  });

  it("surfaces the coverage counters and the snapshot freshness date", () => {
    const result = formatFarmland(full);
    expect(result).toContain("2 of 3 linked parcels");
    expect(result).toContain("snapshot as of 2026-07-01");
    expect(result).toContain("updated weekly");
  });

  it("singular 'parcel' when the transaction links exactly one", () => {
    const one: FarmlandResponse = {
      data: [full.data[0]!], truncated: false, parcels_total: 1, parcels_with_data: 1, as_of: "2026-07-01",
    };
    const result = formatFarmland(one);
    expect(result).toContain("(1 of 1 linked parcel with");
    expect(result).not.toContain("linked parcels with");
  });

  it("two-state empty data → neutral message that never asserts the land is non-agricultural", () => {
    const result = formatFarmland({ data: [], truncated: false, parcels_total: 2, parcels_with_data: 0, as_of: null });
    expect(result).toContain("No eligible agricultural area found for the linked parcels");
    expect(result).toContain("not a statement that the property is non-agricultural");
    expect(result.toLowerCase()).toContain("absence of a match is never asserted");
  });

  it("does not render literal null/undefined for missing fields", () => {
    const result = formatFarmland(full);
    expect(result).not.toContain("null");
    expect(result).not.toContain("undefined");
  });

  it("truncated → appends the 500-parcel note", () => {
    const result = formatFarmland({ ...full, truncated: true });
    expect(result).toContain("first 500 parcels");
  });

  it("never leaks the source register's tokens", () => {
    const lower = formatFarmland(full).toLowerCase();
    expect(findGuardToken(lower)).toBeNull();
  });
});

describe("formatLocationHierarchy", () => {
  const voivodeships: LocationItem[] = [
    { code: "02", name: "dolnośląskie", typeName: null, level: "voivodeship" },
    { code: "14", name: "mazowieckie", typeName: null, level: "voivodeship" },
  ];

  const counties: LocationItem[] = [
    { code: "1401", name: "Warszawa", typeName: null, level: "county" },
    { code: "1402", name: "ciechanowski", typeName: null, level: "county" },
  ];

  const municipalities: LocationItem[] = [
    { code: "140101", name: "Warszawa", typeName: "gmina miejska", level: "municipality" },
    { code: "321705", name: "Wałcz", typeName: "gmina wiejska", level: "municipality" },
  ];

  const precincts: LocationItem[] = [
    { code: "321705_2.0054", name: "Strączno", typeName: null, level: "precinct" },
    { code: "321705_2.0055", name: "Szwecja", typeName: null, level: "precinct" },
  ];

  it("formats voivodeships without parent", () => {
    const result = formatLocationHierarchy(voivodeships);
    expect(result).toContain("Poland");
    expect(result).toContain("voivodeship");
    expect(result).toContain("02 - dolnośląskie");
    expect(result).toContain("14 - mazowieckie");
    expect(result).toContain("2-digit code");
  });

  it("formats counties with parent", () => {
    const result = formatLocationHierarchy(counties, "14");
    expect(result).toContain("parent: 14");
    expect(result).toContain("county");
    expect(result).toContain("1401 - Warszawa");
    expect(result).toContain("4-digit code");
  });

  it("formats municipalities with typeName", () => {
    const result = formatLocationHierarchy(municipalities, "3217");
    expect(result).toContain("(gmina wiejska)");
    expect(result).toContain("(gmina miejska)");
    expect(result).toContain("municipalities");
  });

  it("formats precincts with search_transactions tip", () => {
    const result = formatLocationHierarchy(precincts, "321705");
    expect(result).toContain("precinct");
    expect(result).toContain("search_transactions");
    expect(result).not.toContain("browse");
  });

  it("shows helpful message for empty results with 6-digit parent (leaf)", () => {
    const result = formatLocationHierarchy([], "321705");
    expect(result).toContain("No sub-locations");
    expect(result).toContain("321705");
    expect(result).toContain("search_transactions");
  });

  it("does NOT suggest search_transactions for empty 2-digit parent", () => {
    const result = formatLocationHierarchy([], "00");
    expect(result).toContain("No sub-locations");
    expect(result).not.toContain("search_transactions");
    expect(result).toContain("Verify the code");
  });

  it("does NOT suggest search_transactions for empty 4-digit parent", () => {
    const result = formatLocationHierarchy([], "0000");
    expect(result).toContain("No sub-locations");
    expect(result).not.toContain("search_transactions");
    expect(result).toContain("Verify the code");
  });

  it("shows generic message for empty results without parent", () => {
    const result = formatLocationHierarchy([]);
    expect(result).toBe("No locations available.");
  });

  it("uses first item level for header when items have mixed levels", () => {
    const mixed: LocationItem[] = [
      { code: "1401", name: "Warszawa", typeName: null, level: "county" },
      { code: "140101", name: "Warszawa", typeName: "gmina miejska", level: "municipality" },
    ];
    const result = formatLocationHierarchy(mixed, "14");
    expect(result).toContain("level: county");
    expect(result).toContain("counties");
    expect(result).toContain("1401 - Warszawa");
    expect(result).toContain("140101 - Warszawa");
  });
});

describe("formatDemographics", () => {
  const base: DemographicsResponse = {
    location: { name: "Warszawa", country_code: "PL", location_type: "city", teryt: "1465", level: "powiat", hierarchy: {} },
    coverage: "full",
    indicators: {
      population_density: { name: "Gęstość zaludnienia", unit: "osoba/km²", variable_id: 60559, category: "demographics", level: "powiat", values: { "2024": 3500 } },
      unemployment_rate: { name: "Stopa bezrobocia", unit: "%", variable_id: 60270, category: "economy", level: "powiat", values: { "2024": 3.2 } },
      higher_education_pct: { name: "% z wyższym wykształceniem", unit: "%", variable_id: null, category: "education", level: "powiat", values: { "2021": 45.6 }, derived: true, snapshot: true },
    },
    meta: { variables_count: 3, categories: ["demographics", "economy", "education"], levels_included: ["powiat"], data_source: "GUS BDL (Bank Danych Lokalnych)", as_of: "2024" },
  };

  it("groups by category and surfaces the location header + as_of", () => {
    const out = formatDemographics(base);
    expect(out).toContain("Warszawa (powiat, teryt 1465)");
    expect(out).toContain("as of 2024");
    expect(out).toContain("Demographics");
    expect(out).toContain("Economy");
    expect(out).toContain("Education");
    expect(out).toContain("Gęstość zaludnienia");
  });

  it("flags derived + snapshot indicators", () => {
    const out = formatDemographics(base);
    expect(out).toContain("[derived, snapshot]");
  });

  it("compacts a >5-year time series to latest + span", () => {
    const ts: DemographicsResponse = {
      ...base,
      indicators: {
        population_density: {
          name: "Gęstość zaludnienia", unit: "osoba/km²", variable_id: 60559, category: "demographics", level: "powiat",
          values: { "2018": 3400, "2019": 3420, "2020": 3450, "2021": 3470, "2022": 3480, "2023": 3490, "2024": 3500 },
        },
      },
    };
    const out = formatDemographics(ts);
    expect(out).toContain("7 yrs 2018→2024");
    expect(out).toContain("from 3400"); // span start
  });

  it("renders a readable message for coverage:no_data and never throws", () => {
    const empty: DemographicsResponse = {
      location: { name: null, country_code: "PL", location_type: "county", teryt: "9999", level: "powiat", hierarchy: {} },
      coverage: "no_data",
      indicators: {},
      meta: { variables_count: 0, categories: [], levels_included: [], data_source: "GUS BDL (Bank Danych Lokalnych)", as_of: null },
    };
    const out = formatDemographics(empty);
    expect(out).toContain("No GUS BDL indicators are available");
    expect(out).toContain("9999");
  });

  it("only names GUS BDL — never a source brand", () => {
    const out = formatDemographics(base).toLowerCase();
    expect(out).toContain("gus bdl");
    expect(findGuardToken(out)).toBeNull();
  });
});

describe("formatCompareResults — demographics enrichment", () => {
  it("renders demographics per district and tolerates a district without the key", () => {
    const res: CompareResponse = {
      "Mokotów": {
        median_price_m2: 15200, avg_area: 58.3, min_date: "2024-01-01", max_date: "2024-12-31", total: 1234,
        demographics: {
          unemployment_rate: { value: 3.2, year: 2024, unit: "%" },
          price_to_income_years: { value: 14.5, year: null, unit: "years", derived: true, cross_source: true },
        },
      },
      "Wola": { median_price_m2: 12100, avg_area: 45.0, min_date: "2024-02-15", max_date: "2024-11-30", total: 987 },
    };
    const out = formatCompareResults(res);
    expect(out).toContain("Demographics (GUS BDL");
    expect(out).toContain("unemployment_rate");
    expect(out).toContain("[derived, cross-source]");
    expect(out).toContain("no demographic data for Wola");
  });

  it("shows no demographics section when no district carries the key", () => {
    const res: CompareResponse = {
      "Mokotów": { median_price_m2: 15200, avg_area: 58.3, min_date: "2024-01-01", max_date: "2024-12-31", total: 1234 },
      "Wola": { median_price_m2: 12100, avg_area: 45.0, min_date: "2024-02-15", max_date: "2024-11-30", total: 987 },
    };
    const out = formatCompareResults(res);
    expect(out).not.toContain("Demographics (GUS BDL");
  });
});

// ── Parcel report ──────────────────────────────────────────────────

describe("formatParcelReport", () => {
  function makeReport(overrides: Partial<ParcelReportResponse> = {}): ParcelReportResponse {
    const base: ParcelReportResponse = {
      parcel: {
        id: "uuid-1", parcel_id: "141201_1.0001.123/4", parcel_key: "141201_1.0001.123-4",
        district: "Śródmieście", county_name: "Warszawa", voivodeship_name: "mazowieckie",
        area_m2: 850, land_use: "B", mpzp_designation: null, has_geometry: true,
        centroid: { lat: 52.23, lng: 21.01 },
      },
      coverage: "covered",
      as_of: "2026-05-01T00:00:00.000Z",
      sections: {
        transactions: { coverage: "covered", as_of: "2026-05-01", total: 3, truncated: false, data: [
          { transaction_date: "2024-11-15", property_type: 4, market_type: 2, price_gross: 890000, usable_area_m2: 62.5, price_per_m2: 14240 },
        ] },
        flood: { coverage: "covered", as_of: "2026-04-01", flood_risk: "medium", pct_in_zone: 40 },
        heritage: { coverage: "covered_no_data", as_of: null, heritage_status: null, site_count: null },
        landslide: { coverage: "not_covered", as_of: null, landslide_risk: null },
        surroundings: { coverage: "covered", as_of: "2026-04-01", cemetery_distance_m: 320, landfill_distance_m: null, sewage_treatment_distance_m: 1200, industrial_area_distance_m: null, industrial_plant_distance_m: null, livestock_farm_distance_m: null },
        transit: { coverage: "covered", as_of: "2026-04-01", bus_distance_m: 150, tram_distance_m: 600, rail_distance_m: null, metro_distance_m: null },
        planning: { coverage: "covered", as_of: "2026-03-01", data: [{ zone_symbol: "MW", zone_name: "zabudowa mieszkaniowa" }], truncated: false },
        buildings: { coverage: "covered", as_of: "2026-02-01", data: [{}, {}], truncated: false },
        permits: { coverage: "not_computed", as_of: null, data: [], truncated: false },
        farmland: { coverage: "covered_no_data", as_of: null, eligible_area_m2: null, pct_of_parcel: null, feature_count: null },
        market_context: {
          coverage: "full", as_of: null,
          county: { coverage: "full", median_price_per_m2: 15200, n: 4200, county_code: "1412" },
          locality: { coverage: "low_sample", median_price_per_m2: 16100, n: 12, district: "Śródmieście" },
        },
        location_context: {
          coverage: "full", as_of: "2025-12-31", gmina_teryt: "141201",
          demographics: { coverage: "full", as_of: "2025-12-31", name: "Warszawa", indicators: {
            population: { name: "Population", unit: "persons", variable_id: 1, category: "demographics", level: "gmina", values: { "2024": 1861599 } },
          } },
          infra_signals: { coverage: "partial", as_of: "2026-01-15", gmina_name: "Warszawa",
            tenders: { window_months: 12, by_category: { roads: 3, water: 1 }, recent: [], truncated: false },
            kposk: { in_agglomeration: true, agglomerations: [], truncated: false },
            capex: { by_year: {} } },
        },
      },
      billing: { charged: 35, refunded: 0, rule: "full" },
      note: "A composite parcel dossier.",
    };
    return { ...base, ...overrides };
  }

  it("renders the core, every layer's explicit four-state, and the full-billing footer", () => {
    const out = formatParcelReport(makeReport());
    expect(out).toContain("Parcel report: 141201_1.0001.123/4");
    expect(out).toContain("Śródmieście, Warszawa, mazowieckie");
    expect(out).toContain("Core: covered (as of 2026-05-01)");
    // Four-state explicit per layer.
    expect(out).toContain("Flood risk: covered — medium risk, 40% of the parcel in the mapped zone");
    expect(out).toContain("Heritage listing: covered_no_data (checked — nothing found, still billed)");
    expect(out).toContain("Landslide risk: not_covered (outside our data — refunded)");
    expect(out).toContain("Building activity: not_computed (could not finish in time — refunded, retry)");
    expect(out).toContain("Nuisance surroundings: covered — cemetery 320 m, sewage treatment 1200 m");
    expect(out).toContain("Public transport: covered — bus 150 m, tram 600 m");
    expect(out).toContain("Planning (general plan): covered — zones: MW");
    expect(out).toContain("Buildings: covered — 2 building(s) on the parcel");
    // Transaction history + price context + municipal context.
    expect(out).toContain("Transaction history: covered");
    expect(out).toContain("- County:");
    expect(out).toContain("(n=4200)");
    expect(out).toContain("[small sample]"); // locality low_sample flag
    expect(out).toContain("Municipal context (gmina 141201)");
    expect(out).toContain("in a collective-sewerage agglomeration");
    // Billing footer.
    expect(out).toContain("Billing: 35 charged, 0 refunded — billed in full");
  });

  it("renders the core-floor billing explanation with partial refund", () => {
    const out = formatParcelReport(makeReport({ billing: { charged: 1, refunded: 34, rule: "core_floor" } }));
    expect(out).toContain("Billing: 1 charged, 34 refunded — resolved, but no enrichment layer had data");
  });

  it("short-circuits a total miss to a one-line refund message", () => {
    const out = formatParcelReport(makeReport({
      parcel: { id: null, parcel_id: "999999_9.9999.9/9", parcel_key: "999999_9.9999.9-9" },
      coverage: "not_covered",
      billing: { charged: 0, refunded: 35, rule: "total_miss_refund" },
    }));
    expect(out).toContain("could not be resolved");
    expect(out).toContain("Billing: 0 charged, 35 refunded — fully refunded");
    expect(out).not.toContain("Enrichment layers:");
  });

  it("disabled kill-switch → its own header (not the transient 'retry' one)", () => {
    const out = formatParcelReport(makeReport({
      coverage: "not_computed",
      billing: { charged: 0, refunded: 35, rule: "disabled" },
    }));
    expect(out).toContain("temporarily unavailable");
    expect(out).not.toContain("a live lookup did not finish");
    expect(out).toContain("Billing: 0 charged, 35 refunded — fully refunded — the composite report is temporarily unavailable");
    expect(out).not.toContain("Enrichment layers:");
  });

  it("a transient not_computed core → the 'retry' header (distinct from disabled)", () => {
    const out = formatParcelReport(makeReport({
      parcel: { id: null, parcel_id: "141201_1.0001.123/4", parcel_key: "141201_1.0001.123-4" },
      coverage: "not_computed",
      billing: { charged: 0, refunded: 35, rule: "not_computed_refund" },
    }));
    expect(out).toContain("a live lookup did not finish — retry");
    expect(out).not.toContain("temporarily unavailable");
  });

  it("suppresses a median with too few sales", () => {
    const r = makeReport();
    r.sections.market_context.county = { coverage: "suppressed", median_price_per_m2: null, n: 3, county_code: "1412" };
    const out = formatParcelReport(r);
    expect(out).toContain("County: withheld (only 3 sale(s) — too few to publish)");
  });
});
