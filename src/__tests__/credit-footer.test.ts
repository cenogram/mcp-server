import { describe, it, expect, afterEach } from "vitest";
import { formatCreditFooter } from "../credit-footer.js";
import { freeToolNames, experimentalToolsEnabled } from "../free-tools.js";

describe("formatCreditFooter", () => {
  it("formats a single call", () => {
    expect(formatCreditFooter({ balance: 98, cost: 2 })).toBe("\n---\nAPI tokens: 98 remaining as of this call (query cost: 2)");
  });

  it("sums the cost of several calls", () => {
    const footer = formatCreditFooter({ balance: 98, cost: 2 }, { balance: 97, cost: 1 });
    expect(footer).toContain("(query cost: 3)");
  });

  it("reports the lowest balance whatever the argument order", () => {
    const a = { balance: 98, cost: 2 };
    const b = { balance: 97, cost: 1 };
    expect(formatCreditFooter(a, b)).toBe(formatCreditFooter(b, a));
    expect(formatCreditFooter(a, b)).toContain("97 remaining");
  });

  it("skips null entries and returns an empty string when all are null", () => {
    expect(formatCreditFooter(null)).toBe("");
    expect(formatCreditFooter(null, null)).toBe("");
    expect(formatCreditFooter()).toBe("");
    expect(formatCreditFooter(null, { balance: 97, cost: 1 })).toBe(formatCreditFooter({ balance: 97, cost: 1 }));
  });

  it("counts a refund against the cost and mentions it", () => {
    expect(formatCreditFooter({ balance: 100, cost: 2, refunded: 2 })).toBe(
      "\n---\nAPI tokens: 100 remaining as of this call (query cost: 0, 2 refunded)",
    );
  });

  it("nets the refund per call when charges and a refund interleave", () => {
    const footer = formatCreditFooter(
      { balance: 100, cost: 2, refunded: 2 },
      { balance: 99, cost: 1 },
      { balance: 94, cost: 5, refunded: 3 },
    );
    expect(footer).toContain("API tokens: 94 remaining as of this call (query cost: 3, 5 refunded)");
  });

  it("never lets a refund larger than the charge push the cost below zero", () => {
    expect(formatCreditFooter({ balance: 100, cost: 1, refunded: 4 })).toContain("(query cost: 0, 1 refunded)");
  });

  describe("low-balance warning", () => {
    it("warns at 44 tokens and names the free tools", () => {
      const footer = formatCreditFooter({ balance: 44, cost: 1 });
      expect(footer).toContain(
        "\nLow balance: 44 tokens left - a parcel report costs 45; free tools: list_locations, search_parcels, resolve_parcel",
      );
    });

    it("uses the singular for a balance of 1 token", () => {
      expect(formatCreditFooter({ balance: 1, cost: 1 })).toContain("Low balance: 1 token left - ");
      expect(formatCreditFooter({ balance: 44, cost: 1 })).toContain("Low balance: 44 tokens left - ");
    });

    it("stays silent at 45 tokens", () => {
      expect(formatCreditFooter({ balance: 45, cost: 1 })).not.toContain("Low balance");
    });

    it("warns on the lowest balance when calls disagree", () => {
      expect(formatCreditFooter({ balance: 46, cost: 1 }, { balance: 45, cost: 1 })).not.toContain("Low balance");
      expect(formatCreditFooter({ balance: 46, cost: 1 }, { balance: 44, cost: 1 })).toContain("Low balance: 44 tokens left");
    });
  });
});

describe("freeToolNames", () => {
  const prev = process.env.CENOGRAM_EXPERIMENTAL_TOOLS;
  afterEach(() => {
    if (prev === undefined) delete process.env.CENOGRAM_EXPERIMENTAL_TOOLS;
    else process.env.CENOGRAM_EXPERIMENTAL_TOOLS = prev;
  });

  it("lists only the default zero-cost tools when optional tools are off", () => {
    delete process.env.CENOGRAM_EXPERIMENTAL_TOOLS;
    expect(experimentalToolsEnabled()).toBe(false);
    expect(freeToolNames()).toEqual(["list_locations", "search_parcels", "resolve_parcel"]);
  });

  it("adds the three catalog tools when optional tools are on", () => {
    process.env.CENOGRAM_EXPERIMENTAL_TOOLS = "1";
    expect(freeToolNames()).toEqual([
      "list_locations",
      "search_parcels",
      "resolve_parcel",
      "list_rental_yield_locations",
      "list_price_spread_locations",
      "list_flood_risk_locations",
    ]);
  });

  it("returns a fresh array each call", () => {
    delete process.env.CENOGRAM_EXPERIMENTAL_TOOLS;
    freeToolNames().push("x");
    expect(freeToolNames()).toHaveLength(3);
  });
});
