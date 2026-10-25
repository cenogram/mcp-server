import { describe, it, expect } from "vitest";
import {
  MPZP_DESIGNATIONS,
  MPZP_DESIGNATION_LABELS,
  PLAN_DESIGNATION_SOURCE_NOTE,
  formatDesignationTokens,
} from "../mappings.js";

describe("MPZP_DESIGNATIONS", () => {
  it("lists exactly the 42 measured codes", () => {
    expect(MPZP_DESIGNATIONS).toHaveLength(42);
    expect(new Set(MPZP_DESIGNATIONS).size).toBe(42);
    for (const code of ["MN", "TIT", "cmentarz", "terenWodPowierzchniowychMorskich", "brakMPZPLubWZ"]) {
      expect(MPZP_DESIGNATIONS).toContain(code);
    }
  });

  it("has a non-empty label for every code", () => {
    for (const code of MPZP_DESIGNATIONS) {
      expect(MPZP_DESIGNATION_LABELS[code]?.length).toBeGreaterThan(0);
    }
  });

  it("keeps the agreed source note", () => {
    expect(PLAN_DESIGNATION_SOURCE_NOTE).toBe("as recorded in RCN deed data, not from the planning register");
  });
});

describe("formatDesignationTokens", () => {
  it("maps a single token", () => {
    expect(formatDesignationTokens("budownictwoMieszkanioweJednorodzinne")).toBe("single-family housing");
  });

  it("splits on ';' and keeps first-seen order", () => {
    expect(formatDesignationTokens("terenZabudowyUslugowej;budownictwoMieszkanioweJednorodzinne")).toBe(
      "service development, single-family housing",
    );
  });

  it("deduplicates tokens within a string and across array items", () => {
    expect(formatDesignationTokens("las;las; las")).toBe("forest");
    expect(formatDesignationTokens(["las;terenRolniczy", "terenRolniczy", "las"])).toBe("forest, agricultural land");
  });

  it("keeps unknown tokens raw", () => {
    expect(formatDesignationTokens("las;XYZ")).toBe("forest, XYZ");
  });

  it("keeps inherited Object keys raw instead of mislabelling them", () => {
    expect(formatDesignationTokens("toString")).toBe("toString");
    expect(formatDesignationTokens("las;constructor;hasOwnProperty")).toBe("forest, constructor, hasOwnProperty");
  });

  it("explains sentinel values", () => {
    expect(formatDesignationTokens("brakMPZPLubWZ")).toBe("no local plan or zoning decision recorded");
    expect(formatDesignationTokens("innyNiewymieniony;decyzjaWarunkiZabudowy")).toBe(
      "other / not specified, zoning decision (WZ) recorded",
    );
  });

  it("returns an empty string for empty input", () => {
    expect(formatDesignationTokens("")).toBe("");
    expect(formatDesignationTokens(";; ")).toBe("");
    expect(formatDesignationTokens([])).toBe("");
  });
});
