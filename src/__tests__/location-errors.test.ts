import { describe, it, expect } from "vitest";
import { ApiHttpError, isExpectedApiError, parseLocationCandidates, type LocationItem } from "../api-client.js";
import { formatLocationError, withLocationErrors, type LocationErrorTool } from "../location-errors.js";
import { terytArgForTool } from "../teryt-calls.js";

const voivodeship: LocationItem = { code: "06", name: "Lubelskie", typeName: null, level: "voivodeship", parent_name: null };
const county: LocationItem = { code: "0618", name: "puławski", typeName: null, level: "county", parent_name: "Lubelskie" };
const gmina: LocationItem = { code: "061806", name: "Puławy", typeName: "gmina miejska", level: "municipality", parent_name: "Puławski" };
const precinct: LocationItem = { code: "061806_1.0002", name: "Bronowice", typeName: null, level: "precinct", parent_name: "Puławy" };
const district: LocationItem = { code: "146505", name: "Mokotów", typeName: "dzielnica", level: "municipality", parent_name: "Warszawa" };
const delegation: LocationItem = { code: "126101", name: "Kraków-Krowodrza", typeName: "delegatura", level: "municipality", parent_name: "Kraków" };

const UNKNOWN =
  "Unknown location: Bronowice. Look up the code with /api/locations?search=<fragment> (free, returns a TERYT code to pass as teryt=), or pass a 4-digit county TERYT directly.";

function notFound(candidates?: LocationItem[], detail = UNKNOWN) {
  return { status: 404, detail, hint: candidates ? "Pass the code of the unit you mean as teryt=." : undefined, candidates };
}

describe("terytArgForTool", () => {
  it("gives list_locations follow-ups the same rules as before (precinct skipped where the tool cannot take it)", () => {
    expect(terytArgForTool("search_transactions", precinct, "skip")).toBe("061806_1.0002");
    expect(terytArgForTool("list_parcels_in_area", precinct, "skip")).toBe("061806_1.0002");
    expect(terytArgForTool("get_demographics", voivodeship, "skip")).toBe("06");
    expect(terytArgForTool("get_demographics", precinct, "skip")).toBeNull();
    expect(terytArgForTool("get_infrastructure_signals", voivodeship, "skip")).toBeNull();
    expect(terytArgForTool("get_infrastructure_signals", gmina, "skip")).toBe("061806");
  });

  it("falls back to the 6-digit gmina prefix for a precinct when asked", () => {
    expect(terytArgForTool("get_demographics", precinct, "municipality")).toBe("061806");
    expect(terytArgForTool("get_flood_risk", precinct, "municipality")).toBe("061806");
    expect(terytArgForTool("get_flood_risk", voivodeship, "municipality")).toBeNull();
  });

  it("gives yield and spread the same calls as flood risk: county, gmina and a precinct's gmina", () => {
    for (const tool of ["get_rental_yield", "get_price_spread"] as const) {
      expect(terytArgForTool(tool, county, "municipality")).toBe("0618");
      expect(terytArgForTool(tool, district, "municipality")).toBe("146505");
      expect(terytArgForTool(tool, delegation, "municipality")).toBe("126101");
      expect(terytArgForTool(tool, gmina, "municipality")).toBe("061806");
      expect(terytArgForTool(tool, precinct, "municipality")).toBe("061806");
      expect(terytArgForTool(tool, precinct, "skip")).toBeNull();
      expect(terytArgForTool(tool, voivodeship, "municipality")).toBeNull();
    }
  });
});

describe("formatLocationError", () => {
  it("drops voivodeship candidates for get_flood_risk and sends a precinct to its 6-digit gmina", () => {
    const text = formatLocationError("get_flood_risk", { location: "Bronowice" }, notFound([voivodeship, county, precinct]))!;
    expect(text).not.toContain("06 - Lubelskie");
    expect(text).not.toContain('teryt="06"');
    expect(text).toContain('get_flood_risk(teryt="0618")');
    expect(text).toContain('get_flood_risk(teryt="061806")');
    expect(text).toContain("061806_1.0002 - Bronowice, Puławy");
  });

  it("never mentions the REST lookup path, with or without candidates", () => {
    const withCandidates = formatLocationError("get_flood_risk", { location: "Bronowice" }, notFound([county]))!;
    const without = formatLocationError("get_flood_risk", { location: "Bronowice" }, notFound())!;
    for (const text of [withCandidates, without]) {
      expect(text).not.toContain("/api/");
      expect(text).toContain('list_locations(search="Bronowice")');
    }
    expect(without).not.toContain("Closest matches");
    expect(withCandidates).toContain("Closest matches by name:");
  });

  it("keeps the API's own sentence otherwise intact", () => {
    const text = formatLocationError("get_flood_risk", { location: "Bronowice" }, notFound())!;
    expect(text).toBe(
      'Unknown location: Bronowice. Look up the code with list_locations(search="Bronowice") (free, returns a TERYT code to pass as teryt=), or pass a 4-digit county TERYT directly.',
    );
  });

  it("takes the name to search for from the error text, falling back to the query", () => {
    expect(formatLocationError("get_demographics", {}, notFound(undefined, UNKNOWN.replace("Bronowice", "Łomianki")))).toContain('search="Łomianki"');
    const bare = "Look up the code with /api/locations?search=<fragment> (free).";
    expect(formatLocationError("get_demographics", { location: " Nysa " }, notFound(undefined, bare))).toContain('search="Nysa"');
    expect(formatLocationError("get_demographics", {}, notFound(undefined, bare))).toContain('search="<name>"');
  });

  it("gives get_demographics a voivodeship call and list_parcels_in_area the exact precinct code", () => {
    const demographics = formatLocationError("get_demographics", { location: "Bronowice" }, notFound([voivodeship, precinct]))!;
    expect(demographics).toContain('get_demographics(teryt="06")');
    expect(demographics).toContain('get_demographics(teryt="061806")');
    const parcels = formatLocationError("list_parcels_in_area", { location: "Bronowice" }, notFound([voivodeship, precinct]))!;
    expect(parcels).toContain('list_parcels_in_area(teryt="06")');
    expect(parcels).toContain('list_parcels_in_area(teryt="061806_1.0002")');
  });

  it("gives get_rental_yield a ready call for a gmina and for a precinct's gmina, and keeps the catalog pointer for an unknown name", () => {
    const text = formatLocationError("get_rental_yield", { location: "Puławy" }, notFound([gmina, precinct], UNKNOWN.replace("Bronowice", "Puławy")))!;
    expect(text).toContain("061806 - Puławy (gmina miejska), Puławski");
    expect(text).toContain("061806_1.0002 - Bronowice, Puławy");
    expect(text).toContain('get_rental_yield(teryt="061806")');
    expect(text).toContain('list_rental_yield_locations(search="Puławy")');
    expect(text).not.toContain("answers only");
  });

  it("keeps county, city-part and gmina calls for get_price_spread", () => {
    const text = formatLocationError("get_price_spread", { location: "Mokotów" }, notFound([county, district, gmina]))!;
    expect(text).toContain('get_price_spread(teryt="0618")');
    expect(text).toContain('get_price_spread(teryt="146505")');
    expect(text).toContain('get_price_spread(teryt="061806")');
    expect(text).toContain("list_price_spread_locations(");
  });

  it("leads an ambiguous gmina name for yield and spread to the candidates, not to the catalog", () => {
    const detail = "Ambiguous location: Dąbrowa — 2 municipalities share this name: 061806 (gmina miejska, powiat puławski), 280502 (gmina wiejska, powiat ełcki). Pass teryt=<code> instead.";
    const other: LocationItem = { ...gmina, code: "280502", typeName: "gmina wiejska", parent_name: "Ełcki" };
    for (const tool of ["get_rental_yield", "get_price_spread"] as const) {
      const text = formatLocationError(tool, { location: "Dąbrowa" }, {
        status: 400, detail, hint: "Pass the code of the unit you mean as teryt=.", candidates: [gmina, other],
      })!;
      expect(text.startsWith(`Invalid request: ${detail}`)).toBe(true);
      expect(text).toContain(`${tool}(teryt="061806")`);
      expect(text).toContain(`${tool}(teryt="280502")`);
      expect(text).not.toMatch(/list_(rental_yield|price_spread)_locations/);
      expect(text).not.toContain("answers only");
    }
  });

  it("keeps the 'Invalid request' framing for a 400 and drops the generic API hint when candidates are listed", () => {
    const detail = "Ambiguous location: Dąbrowa — 2 municipalities share this name: 061806 (gmina miejska, powiat puławski), 280502 (gmina wiejska, powiat ełcki). Pass teryt=<code> instead.";
    const text = formatLocationError("get_demographics", { location: "Dąbrowa" }, {
      status: 400, detail, hint: "Pass the code of the unit you mean as teryt= (for a precinct, the first 6 digits of its code).", candidates: [gmina, { ...gmina, code: "280502", parent_name: "Ełcki" }],
    })!;
    expect(text.startsWith(`Invalid request: ${detail}`)).toBe(true);
    expect(text).not.toContain("for a precinct");
    expect(text).toContain('get_demographics(teryt="061806")');
    expect(text).toContain('get_demographics(teryt="280502")');
  });

  it("translates the parcels path of the address hint into a list_parcels_in_area call", () => {
    const text = formatLocationError("resolve_parcel", {}, {
      status: 400,
      detail: "Provide a parcel number",
      hint: "This looks like a street address; look it up with GET /api/parcels?location=<locality>&street=<street>&buildingNumber=<number> (if the locality name is ambiguous, use teryt= from the candidates).",
      candidates: undefined,
    })!;
    expect(text).toContain('list_parcels_in_area(location="<locality>", street="<street>", buildingNumber="<number>")');
    expect(text).not.toContain("/api/");
    expect(text.startsWith("Invalid request: Provide a parcel number.")).toBe(true);
    expect(text).toContain("(if the locality name is ambiguous, use teryt= from the candidates)");
  });

  it("returns null when nothing needs rewriting so the caller keeps its own message", () => {
    expect(formatLocationError("resolve_parcel", {}, { status: 400, detail: "Provide a parcel number", hint: "q= needs a parcel number at the end.", candidates: undefined })).toBeNull();
    expect(formatLocationError("get_flood_risk", {}, { status: 404, detail: "Unknown county for teryt 9999", hint: undefined, candidates: undefined })).toBeNull();
    expect(formatLocationError("get_flood_risk", {}, { status: 500, detail: UNKNOWN, hint: undefined, candidates: [county] })).toBeNull();
    expect(formatLocationError("get_flood_risk", {}, { status: 404, detail: undefined, hint: undefined, candidates: [county] })).toBeNull();
    // Only a voivodeship came back and the tool starts at county level: nothing to offer, nothing to rewrite.
    expect(formatLocationError("get_flood_risk", {}, { status: 404, detail: "Unknown county for teryt 99", hint: undefined, candidates: [voivodeship] })).toBeNull();
  });

  it("renders a candidate without type or parent without crashing", () => {
    const bare: LocationItem = { code: "0618", name: "puławski", typeName: null, level: "county", parent_name: null };
    expect(formatLocationError("get_flood_risk", { location: "x" }, notFound([bare]))).toContain("  0618 - puławski\n");
  });
});

describe("withLocationErrors", () => {
  const opts = { status: 404, authMode: "api_key" as const, code: "Unknown location", detail: UNKNOWN };

  it("rethrows a location 404 as an ApiHttpError worded for tools, still an expected one", async () => {
    const original = new ApiHttpError(UNKNOWN, { ...opts, candidates: [county] });
    const err = await withLocationErrors("get_flood_risk", { location: "Bronowice" }, () => Promise.reject(original)).catch((e: unknown) => e);
    expect(err).toBeInstanceOf(ApiHttpError);
    const rewritten = err as ApiHttpError;
    expect(rewritten.message).toContain('get_flood_risk(teryt="0618")');
    expect(rewritten.status).toBe(404);
    expect(rewritten.code).toBe("Unknown location");
    expect(rewritten.candidates).toEqual([county]);
    expect(isExpectedApiError(rewritten)).toBe(true);
  });

  it("passes through an error it has nothing to say about, by identity", async () => {
    const other = new ApiHttpError("Invalid request: cursor is not valid", { status: 400, authMode: "api_key", detail: "cursor is not valid" });
    await expect(withLocationErrors("list_parcels_in_area", {}, () => Promise.reject(other))).rejects.toBe(other);
    const plain = new Error("boom");
    await expect(withLocationErrors("list_parcels_in_area", {}, () => Promise.reject(plain))).rejects.toBe(plain);
  });

  it("returns the value of a successful call untouched", async () => {
    await expect(withLocationErrors("get_flood_risk", {}, () => Promise.resolve(42))).resolves.toBe(42);
  });

  it("covers every tool name it accepts without throwing on a candidate-less 404", () => {
    const tools: LocationErrorTool[] = [
      "list_parcels_in_area", "get_demographics", "get_infrastructure_signals",
      "get_flood_risk", "get_rental_yield", "get_price_spread", "resolve_parcel",
    ];
    for (const tool of tools) expect(() => formatLocationError(tool, { location: "x" }, notFound())).not.toThrow();
  });
});

describe("parseLocationCandidates", () => {
  it("keeps well-formed rows including typeName and skips odd ones", () => {
    const parsed = parseLocationCandidates([
      { code: "061806", name: "Puławy", typeName: "gmina miejska", level: "municipality", parent_name: "Puławski" },
      { code: "x1", name: "bad code", level: "county" },
      { code: "0618", name: "no level" },
      "string",
      null,
      { code: "0618", name: "puławski", level: "county" },
    ]);
    expect(parsed).toEqual([
      { code: "061806", name: "Puławy", typeName: "gmina miejska", level: "municipality", parent_name: "Puławski" },
      { code: "0618", name: "puławski", typeName: null, level: "county", parent_name: null },
    ]);
  });

  it("is undefined for an absent, non-array or empty field and caps at five", () => {
    expect(parseLocationCandidates(undefined)).toBeUndefined();
    expect(parseLocationCandidates({ code: "0618" })).toBeUndefined();
    expect(parseLocationCandidates([])).toBeUndefined();
    const many = Array.from({ length: 9 }, (_, i) => ({ code: `06180${i}`, name: `n${i}`, level: "municipality" }));
    expect(parseLocationCandidates(many)).toHaveLength(5);
  });
});
