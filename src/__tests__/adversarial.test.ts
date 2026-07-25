import { describe, it, expect } from "vitest";
import {
  resolveDistrict,
  buildNormalizedMap,
  stripDiacritics,
  CITY_SUBDISTRICTS,
} from "../mappings.js";

const SAMPLE_DISTRICTS = [
  "Kraków-Podgórze",
  "Kraków-Krowodrza",
  "Kraków-Nowa Huta",
  "Kraków-Śródmieście",
  "Warszawa",
  "Mokotów",
  "Wola",
  "Poznań",
  "Gdańsk",
];

describe("resolveDistrict — adversarial inputs", () => {
  // ─── 1. Empty/null inputs ───────────────────────────────────────────
  describe("empty/null inputs", () => {
    it("empty string returns passthrough", () => {
      const result = resolveDistrict("", SAMPLE_DISTRICTS);
      expect(result).toEqual([""]);
    });

    it("whitespace-only string returns passthrough (not matched)", () => {
      const result = resolveDistrict("   ", SAMPLE_DISTRICTS);
      expect(result).toEqual(["   "]);
    });

    it("tab and newline string returns passthrough", () => {
      const result = resolveDistrict("\t\n", SAMPLE_DISTRICTS);
      expect(result).toEqual(["\t\n"]);
    });
  });

  // ─── 2. Very long strings ──────────────────────────────────────────
  describe("very long strings", () => {
    it("10000 char input does not throw", () => {
      const longInput = "a".repeat(10000);
      expect(() => resolveDistrict(longInput, SAMPLE_DISTRICTS)).not.toThrow();
    });

    it("10000 char input returns passthrough", () => {
      const longInput = "Kraków" + "x".repeat(10000);
      const result = resolveDistrict(longInput, SAMPLE_DISTRICTS);
      expect(result).toEqual([longInput]);
    });

    it("allDistricts with 10000 entries does not throw", () => {
      const manyDistricts = Array.from({ length: 10000 }, (_, i) => `District-${i}`);
      expect(() => resolveDistrict("District-5000", manyDistricts)).not.toThrow();
      const result = resolveDistrict("District-5000", manyDistricts);
      expect(result).toEqual(["District-5000"]);
    });
  });

  // ─── 3. Special characters ─────────────────────────────────────────
  describe("special characters", () => {
    it("regex metacharacters do not throw", () => {
      const metachars = ".*+?[]{}()\\^$|";
      expect(() => resolveDistrict(metachars, SAMPLE_DISTRICTS)).not.toThrow();
      const result = resolveDistrict(metachars, SAMPLE_DISTRICTS);
      expect(result).toEqual([metachars]); // passthrough
    });

    it("SQL injection attempt is passthrough", () => {
      const sqli = "'; DROP TABLE districts; --";
      const result = resolveDistrict(sqli, SAMPLE_DISTRICTS);
      expect(result).toEqual([sqli]);
    });

    it("backticks and template literals", () => {
      const input = "`${process.exit()}`";
      expect(() => resolveDistrict(input, SAMPLE_DISTRICTS)).not.toThrow();
      const result = resolveDistrict(input, SAMPLE_DISTRICTS);
      expect(result).toEqual([input]);
    });

    it("null bytes in string", () => {
      const input = "Kraków\0injected";
      expect(() => resolveDistrict(input, SAMPLE_DISTRICTS)).not.toThrow();
    });
  });

  // ─── 4. Unicode edge cases ─────────────────────────────────────────
  describe("unicode edge cases", () => {
    it("Cyrillic homoglyph К does NOT match Latin K in Kraków", () => {
      // Cyrillic К (U+041A) + Latin rest
      const cyrillicK = "Кraków";
      const result = resolveDistrict(cyrillicK, SAMPLE_DISTRICTS);
      // Should NOT resolve to Kraków sub-districts (Cyrillic К ≠ Latin K)
      expect(result).not.toEqual(expect.arrayContaining(["Kraków-Podgórze"]));
    });

    it("full-width characters do NOT match normal Kraków", () => {
      // Full-width Ｋｒａｋów
      const fullWidth = "Ｋｒａｋów";
      const result = resolveDistrict(fullWidth, SAMPLE_DISTRICTS);
      expect(result).not.toEqual(expect.arrayContaining(["Kraków-Podgórze"]));
    });

    it("zero-width joiners between letters do NOT match", () => {
      // K + ZWJ + r + ZWJ + a + k + ó + w
      const zwjInput = "K‍r‍a‍ków";
      const result = resolveDistrict(zwjInput, SAMPLE_DISTRICTS);
      // ZWJ should prevent match since stripDiacritics only removes combining marks
      expect(result).toEqual([zwjInput]);
    });

    it("zero-width non-joiner between letters", () => {
      const zwnjInput = "K‌rakow";
      const result = resolveDistrict(zwnjInput, SAMPLE_DISTRICTS);
      expect(result).toEqual([zwnjInput]);
    });

    it("combining characters stacked heavily", () => {
      // K with multiple combining accents: K + combining acute + combining grave + combining tilde
      const stacked = "Ḱ̀̃rakow";
      const result = resolveDistrict(stacked, SAMPLE_DISTRICTS);
      // After NFD + strip combining marks, this should become "Krakow" → matches "krakow" → Kraków
      expect(result).toEqual(expect.arrayContaining(["Kraków-Podgórze"]));
    });

    it("NFD vs NFC forms resolve identically", () => {
      // NFC: Kraków (ó as single codepoint U+00F3)
      const nfc = "Kraków";
      // NFD: Kraków (o + combining acute U+0301)
      const nfd = "Kraków";

      const resultNfc = resolveDistrict(nfc, SAMPLE_DISTRICTS);
      const resultNfd = resolveDistrict(nfd, SAMPLE_DISTRICTS);

      expect(resultNfc).toEqual(resultNfd);
    });

    it("stripDiacritics handles NFD and NFC consistently", () => {
      const nfc = "Kraków";
      const nfd = "Kraków";
      expect(stripDiacritics(nfc)).toBe(stripDiacritics(nfd));
    });

    it("right-to-left override does not crash", () => {
      const rtl = "‮Kraków";
      expect(() => resolveDistrict(rtl, SAMPLE_DISTRICTS)).not.toThrow();
    });
  });

  // ─── 5. Collision exploitation ─────────────────────────────────────
  describe("collision exploitation", () => {
    it("input normalizing to 'krakow' resolves to city sub-districts", () => {
      // "Krakow" (no accent) should match CITY_SUBDISTRICTS for Kraków
      const result = resolveDistrict("Krakow", SAMPLE_DISTRICTS);
      const expected = CITY_SUBDISTRICTS.get("Kraków")!.slice();
      expect(result).toEqual(expected);
    });

    it("allDistricts with duplicates returns all of them", () => {
      const dupeDistricts = ["Poznań", "Poznań", "Gdańsk"];
      const map = buildNormalizedMap(dupeDistricts);
      const poznans = map.get("poznan");
      expect(poznans).toEqual(["Poznań", "Poznań"]);
    });

    it("district whose normalized form collides with city name", () => {
      // If someone adds a district literally named "krakow" (no diacritics)
      const weirdDistricts = ["krakow", "Poznań"];
      const result = resolveDistrict("krakow", weirdDistricts);
      // CITY_SUBDISTRICTS takes precedence (checked first in the function)
      const expected = CITY_SUBDISTRICTS.get("Kraków")!.slice();
      expect(result).toEqual(expected);
    });
  });

  // ─── 6. CITY_SUBDISTRICTS boundaries ──────────────────────────────
  describe("CITY_SUBDISTRICTS boundaries", () => {
    it("sub-district name directly does NOT expand to full city", () => {
      const result = resolveDistrict("Kraków-Podgórze", SAMPLE_DISTRICTS);
      expect(result).toEqual(["Kraków-Podgórze"]);
    });

    it("city name with trailing space DOES match (trimmed)", () => {
      const result = resolveDistrict("Kraków ", SAMPLE_DISTRICTS);
      expect(result).toHaveLength(5);
      expect(result).toContain("Kraków");
    });

    it("city name with prefix does NOT match", () => {
      const result = resolveDistrict("XXKraków", SAMPLE_DISTRICTS);
      expect(result).toEqual(["XXKraków"]);
    });

    it("city name with suffix does NOT match", () => {
      const result = resolveDistrict("Kraków-extra", SAMPLE_DISTRICTS);
      // Not in CITY_SUBDISTRICTS keys, not in allDistricts → passthrough
      expect(result).not.toEqual(CITY_SUBDISTRICTS.get("Kraków")!.slice());
    });

    it("exact city name expands correctly (Warszawa)", () => {
      const result = resolveDistrict("Warszawa", SAMPLE_DISTRICTS);
      const expected = CITY_SUBDISTRICTS.get("Warszawa")!.slice();
      expect(result).toEqual(expected);
    });

    it("case-insensitive city match works (KRAKÓW → expansion)", () => {
      const result = resolveDistrict("KRAKÓW", SAMPLE_DISTRICTS);
      const expected = CITY_SUBDISTRICTS.get("Kraków")!.slice();
      expect(result).toEqual(expected);
    });

    it("diacritics-insensitive city match works (Lodz → Łódź expansion)", () => {
      const result = resolveDistrict("Lodz", []);
      const expected = CITY_SUBDISTRICTS.get("Łódź")!.slice();
      expect(result).toEqual(expected);
    });
  });

  // ─── 7. Memoization stress ─────────────────────────────────────────
  describe("memoization / cache invalidation", () => {
    it("different allDistricts arrays produce different results", () => {
      const districts1 = ["Poznań", "Wrocław"];
      const districts2 = ["Gdańsk", "Sopot"];

      const result1 = resolveDistrict("Poznań", districts1);
      expect(result1).toEqual(["Poznań"]);

      const result2 = resolveDistrict("Poznań", districts2);
      // Poznań not in districts2 and not a CITY_SUBDISTRICTS key → passthrough
      expect(result2).toEqual(["Poznań"]);
    });

    it("same reference array uses cache (no rebuild)", () => {
      const districts = ["TestDistrict"];
      // Call twice with same reference — should hit cache
      const result1 = resolveDistrict("TestDistrict", districts);
      const result2 = resolveDistrict("TestDistrict", districts);
      expect(result1).toEqual(result2);
      expect(result1).toEqual(["TestDistrict"]);
    });

    it("mutating the array after first call does NOT invalidate cache (reference equality)", () => {
      const districts = ["Alpha", "Beta"];
      resolveDistrict("Alpha", districts);

      // Mutate the array
      districts.push("Gamma");

      // Same reference → cache NOT invalidated → Gamma not found
      const result = resolveDistrict("Gamma", districts);
      expect(result).toEqual(["Gamma"]); // passthrough (not in cached map)
    });

    it("new array with same contents invalidates cache", () => {
      const districts1 = ["Alpha", "Beta"];
      resolveDistrict("Alpha", districts1);

      // New array (different reference) with same contents
      const districts2 = ["Alpha", "Beta"];
      const result = resolveDistrict("Alpha", districts2);
      expect(result).toEqual(["Alpha"]);
    });
  });
});

describe("stripDiacritics — adversarial", () => {
  it("handles empty string", () => {
    expect(stripDiacritics("")).toBe("");
  });

  it("handles ł and Ł", () => {
    expect(stripDiacritics("Łódź")).toBe("Lodz");
  });

  it("handles all Polish diacritics", () => {
    expect(stripDiacritics("ąćęłńóśźż")).toBe("acelnoszz");
    expect(stripDiacritics("ĄĆĘŁŃÓŚŹŻ")).toBe("ACELNOSZZ");
  });

  it("preserves non-diacritic characters", () => {
    expect(stripDiacritics("abc123!@#")).toBe("abc123!@#");
  });

  it("handles string with only combining marks", () => {
    // combining acute + combining grave
    const input = "́̀";
    expect(() => stripDiacritics(input)).not.toThrow();
    expect(stripDiacritics(input)).toBe("");
  });
});

describe("stripDiacritics — regex boundary", () => {
  it("U+036F (last in range) IS stripped", () => {
    // U+036F = COMBINING LATIN SMALL LETTER X
    const input = "Kͯrakow";
    expect(stripDiacritics(input)).toBe("Krakow");
  });

  it("U+0370 (Greek capital letter Heta, just outside range) is NOT stripped", () => {
    // U+0370 is a letter, not a combining mark — should be preserved
    const input = "KͰrakow";
    expect(stripDiacritics(input)).not.toBe("Krakow");
    expect(stripDiacritics(input)).toContain("Ͱ");
  });

  it("combining marks outside U+0300-036F range are NOT stripped (U+0483)", () => {
    // U+0483 = COMBINING CYRILLIC TITLO
    const input = "K҃rakow";
    const result = stripDiacritics(input);
    // The combining mark is preserved because it's outside the regex range
    expect(result).toContain("҃");
    expect(result).not.toBe("Krakow");
  });
});

describe("buildNormalizedMap — adversarial", () => {
  it("empty districts array still has CITY_SUBDISTRICTS entries", () => {
    const map = buildNormalizedMap([]);
    expect(map.has("warszawa")).toBe(true);
    expect(map.has("krakow")).toBe(true);
    expect(map.has("lodz")).toBe(true);
  });

  it("district matching a city name key gets merged", () => {
    const map = buildNormalizedMap(["Kraków"]);
    const entry = map.get("krakow");
    // Should have "Kraków" from the districts array
    expect(entry).toContain("Kraków");
  });

  it("handles districts with identical normalized forms", () => {
    const map = buildNormalizedMap(["Café", "Café"]);
    // Both normalize to "cafe" after NFD + strip
    const entry = map.get("cafe");
    expect(entry).toHaveLength(2);
  });
});
