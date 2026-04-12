import { describe, it, expect } from "vitest";
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
  formatSpatialResults,
  formatCompareResults,
} from "../formatters.js";
import type { Transaction, TransactionsResponse, StatsResponse, PricePerM2Row, HistogramBin, ParcelSearchResponse, SpatialSearchResponse, SpatialFeature, CompareResponse } from "../api-client.js";

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
    const result = formatNumber(7352087);
    expect(result).toContain("7");
    expect(result).toContain("352");
    expect(result).toContain("087");
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

  it("hides parcel_id but shows coordinates (DPIA B3)", () => {
    const result = formatTransaction(sampleTx);
    expect(result).not.toContain("146509_8.0501.12");
    expect(result).toContain("52.2317");
    expect(result).toContain("21.0060");
  });

  it("shows county and voivodeship", () => {
    const result = formatTransaction(sampleTx);
    expect(result).toContain("pow. Warszawa");
    expect(result).toContain("woj. mazowieckie");
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
});

describe("formatMarketOverview", () => {
  const stats: StatsResponse = {
    counts: { transactions: 7352087, parcels: 100, buildings: 50, units: 30, addresses: 20 },
    prices: { total: 7352087, avg_price: 456789, median_price: 280000, min_price: 1, max_price: 999999999 },
    dateRange: { min_date: "2003-01-02", max_date: "2024-12-31" },
    byDistrict: [{ district: "Warszawa-Mokotów", transaction_count: 312456 }],
    byPropertyType: [{ type: 4, total: 3245678, label: "Lokal" }],
    byMarketType: [{ type: 2, total: 5890123, label: "Wtórny" }],
  };

  it("includes total count", () => {
    // Intl may use non-breaking space as thousand separator
    expect(formatMarketOverview(stats)).toMatch(/7.?352.?087/);
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
