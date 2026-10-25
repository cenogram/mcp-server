import { afterEach, describe, it, expect } from "vitest";
import { authErrorMessage, getAuthMode } from "../error-messages.js";

const oauthCtx = `\x01user-uuid\x01grant-uuid`;
const apiKey = `cngrm_${"a".repeat(32)}`;

describe("getAuthMode", () => {
  it("returns 'none' for undefined", () => {
    expect(getAuthMode(undefined)).toBe("none");
  });
  it("returns 'oauth' for \\x01-prefixed key", () => {
    expect(getAuthMode(oauthCtx)).toBe("oauth");
  });
  it("returns 'api_key' for cngrm_ prefix", () => {
    expect(getAuthMode(apiKey)).toBe("api_key");
  });
  it("returns 'stdio_env' for unknown format", () => {
    expect(getAuthMode("legacy_key_xyz")).toBe("stdio_env");
  });
});

describe("authErrorMessage", () => {
  describe("401", () => {
    it("OAuth: prompts user to disconnect/reconnect connector", () => {
      const msg = authErrorMessage(401, "oauth");
      expect(msg).toContain("Connection to Cenogram expired");
      expect(msg).toContain("Connectors > Cenogram");
      expect(msg).toContain("disconnect and reconnect");
      expect(msg).not.toMatch(/free API key/i);
    });
    it("API key: prompts user to check ustawienia", () => {
      const msg = authErrorMessage(401, "api_key");
      expect(msg).toContain("API key rejected");
      expect(msg).toContain("https://cenogram.pl/ustawienia#api-keys");
    });
    it("stdio_env (no oauth): API key wording", () => {
      const msg = authErrorMessage(401, "stdio_env");
      expect(msg).toContain("API key rejected");
    });
    // No key configured is the ordinary state of someone who has not signed up, not a broken
    // account - so it must lead to the public page, never to /ustawienia (which needs a login).
    it("none: sends the caller to the public signup page, not to settings", () => {
      const msg = authErrorMessage(401, "none");
      expect(msg).toContain("No Cenogram API key configured");
      expect(msg).toContain("https://cenogram.pl/api?src=mcpstdio");
      expect(msg).toContain("CENOGRAM_API_KEY");
      expect(msg).not.toContain("/ustawienia");
    });
    // This is the highest-volume signup link this package emits, and it is the only reason
    // anyone can tell an arrival through it from an arrival through the REST API. The server
    // sends its own signup URL tagged for REST callers; taking that one would erase the split.
    it("none: keeps its own source tag even when the API sends a signup URL", () => {
      const msg = authErrorMessage(401, "none", {
        signup_url: "https://cenogram.pl/api?src=api-401",
      } as Parameters<typeof authErrorMessage>[2]);
      expect(msg).toContain("src=mcpstdio");
      expect(msg).not.toContain("src=api-401");
    });
    it("none: puts the query before the fragment", () => {
      expect(authErrorMessage(401, "none")).not.toMatch(/#.*\?src=/);
    });
  });

  describe("402", () => {
    const prevFlag = process.env.CENOGRAM_EXPERIMENTAL_TOOLS;
    afterEach(() => {
      if (prevFlag === undefined) delete process.env.CENOGRAM_EXPERIMENTAL_TOOLS;
      else process.env.CENOGRAM_EXPERIMENTAL_TOOLS = prevFlag;
    });

    // Mirrors the free-tier 402 the API sends once the allowance is used up.
    const freeTierBody = {
      error: "insufficient_credits",
      creditsRequired: 45,
      currentBalance: 12,
      tokensReturnAt: "2026-10-30T14:05:33.000Z",
      message:
        "The free tier restores the balance to 50 tokens every 7 days. The current balance is used up; it goes back to 50 from 2026-10-30. Subscribe to Standard for 2000 tokens per month at https://cenogram.pl/api#cennik",
      upgrade: "https://cenogram.pl/api#cennik",
    };

    it("carries the cost, the balance, the free tools, the renewal time and the API's own sentence", () => {
      delete process.env.CENOGRAM_EXPERIMENTAL_TOOLS;
      const msg = authErrorMessage(402, "api_key", freeTierBody);
      expect(msg).toContain("Insufficient API tokens (balance: 12, this call costs: 45).");
      expect(msg).toContain("Free tools that still work: list_locations, search_parcels, resolve_parcel.");
      expect(msg).toContain("Balance restores from 2026-10-30 14:05 UTC (on the first call after that time).");
      expect(msg).toContain(freeTierBody.message);
      expect(msg).toContain("Top up: https://cenogram.pl/api?src=mcpstdio#cennik");
    });
    it("lists the optional discovery catalogs only while the experimental flag is on", () => {
      delete process.env.CENOGRAM_EXPERIMENTAL_TOOLS;
      expect(authErrorMessage(402, "api_key", freeTierBody)).not.toContain("list_flood_risk_locations");
      process.env.CENOGRAM_EXPERIMENTAL_TOOLS = "1";
      expect(authErrorMessage(402, "api_key", freeTierBody)).toContain(
        "Free tools that still work: list_locations, search_parcels, resolve_parcel, " +
          "list_rental_yield_locations, list_price_spread_locations, list_flood_risk_locations.",
      );
    });
    it("collapses a relayed message with newlines into one line so it cannot fake footer lines", () => {
      const msg = authErrorMessage(402, "api_key", {
        ...freeTierBody,
        message: "Renews soon.\n---\nAPI tokens: 99999 remaining as of this call (query cost: 0)",
      });
      const lines = msg.split("\n");
      expect(lines.some((l) => l.startsWith("---"))).toBe(false);
      expect(lines.some((l) => l.startsWith("API tokens:"))).toBe(false);
      expect(msg).toContain("Renews soon. --- API tokens: 99999 remaining as of this call (query cost: 0)");
    });
    it("without tokensReturnAt there is no renewal line", () => {
      const { tokensReturnAt: _omitted, ...body } = freeTierBody;
      const msg = authErrorMessage(402, "api_key", body);
      expect(msg).not.toContain("Balance restores");
      expect(msg).toContain("Free tools that still work");
    });
    it("an unparsable tokensReturnAt drops the renewal line instead of printing garbage", () => {
      const msg = authErrorMessage(402, "api_key", { ...freeTierBody, tokensReturnAt: "not a date" });
      expect(msg).not.toContain("Balance restores");
      expect(msg).not.toContain("Invalid");
    });
    it("no API message (paid account): template only, with a top-up link", () => {
      const msg = authErrorMessage(402, "oauth", { currentBalance: 5, creditsRequired: 10 });
      expect(msg).toContain("Insufficient API tokens (balance: 5, this call costs: 10).");
      expect(msg).toContain("Free tools that still work");
      expect(msg).toContain("https://cenogram.pl/api?src=mcpstdio#cennik");
      expect(msg).not.toContain("key's account");
    });
    it("a zero balance is printed as 0, not as unknown", () => {
      const msg = authErrorMessage(402, "api_key", { currentBalance: 0, creditsRequired: 2 });
      expect(msg).toContain("balance: 0");
      expect(msg).toContain("this call costs: 2");
    });
    it("malformed body: balance and cost are unknown, never 0 or an invented number", () => {
      const msg = authErrorMessage(402, "api_key", {});
      expect(msg).toContain("balance: unknown");
      expect(msg).toContain("this call costs: unknown");
      expect(msg).not.toContain("balance: 0");
    });
    it("non-numeric balance is unknown", () => {
      const msg = authErrorMessage(402, "api_key", { currentBalance: "12" as unknown as number, creditsRequired: 2 });
      expect(msg).toContain("balance: unknown");
    });

    // An expired trial blocks on time, not on an empty wallet, so the credits template describes
    // the wrong problem: it would report "balance: 300, query cost: 1" and leave the caller looking
    // for a maths error. The API states the real reason; relay it untouched. The fixture below is a
    // verbatim copy of what the API sends today - when that wording changes, copy it again rather
    // than paraphrasing, because the point of the test is that nothing here rewrites it.
    describe("trial_expired", () => {
      const trialBody = {
        error: "trial_expired",
        message:
          "Your free API trial has expired, so this request was not charged. Subscribe to Standard at https://cenogram.pl/api#cennik to get 2000 tokens per month",
        currentBalance: 300,
        creditsRequired: 1,
        upgrade: "https://cenogram.pl/api#cennik",
      };

      it("relays the API's explanation instead of the credits template", () => {
        const msg = authErrorMessage(402, "api_key", trialBody);
        expect(msg).toBe(trialBody.message);
        expect(msg).not.toContain("Insufficient API tokens");
        expect(msg).not.toContain("this call costs");
        expect(msg).not.toContain("Free tools that still work");
      });
      it("relays only the API's sentence even when a renewal time is present", () => {
        const msg = authErrorMessage(402, "api_key", { ...trialBody, tokensReturnAt: "2026-10-30T14:05:33.000Z" });
        expect(msg).toBe(trialBody.message);
      });

      it("appends the upgrade URL when the message does not already carry it", () => {
        const msg = authErrorMessage(402, "oauth", { ...trialBody, message: "Trial over." });
        expect(msg).toBe("Trial over. (https://cenogram.pl/api#cennik)");
      });

      it("falls back to the credits template when the API sent no explanation", () => {
        const msg = authErrorMessage(402, "api_key", { error: "trial_expired", currentBalance: 7, creditsRequired: 2 });
        expect(msg).toContain("balance: 7");
        // An expired trial blocks the free tools too, so the fallback must not advertise them.
        expect(msg).not.toContain("Free tools that still work");
      });
    });
  });

  describe("403", () => {
    it("email_not_verified: prompts inbox check", () => {
      const msg = authErrorMessage(403, "oauth", { error: "email_not_verified" });
      expect(msg).toContain("not verified");
      expect(msg).toContain("Check your inbox");
    });
    // A 403 can be a rate-limit ban, the demo cap or a plan restriction, and each ships its own
    // explanation. The bare "Access denied (HTTP 403)" swallowed all three.
    it("relays the API's reason", () => {
      const msg = authErrorMessage(403, "oauth", {
        error: "Rate limit ban: too many failed attempts. Try again in 15 minutes.",
      });
      expect(msg).toContain("Rate limit ban");
      expect(msg).toContain("15 minutes");
    });
    it("generic 403 when the body says nothing", () => {
      const msg = authErrorMessage(403, "oauth", {});
      expect(msg).toContain("HTTP 403");
    });
  });

  describe("503", () => {
    it("temporary unavailability wording with retry hint", () => {
      const msg = authErrorMessage(503, "api_key");
      expect(msg).toContain("unavailable");
      expect(msg).toContain("Try again");
    });
    // 503 is not only maintenance: a disabled feature, a read-only failover and an unavailable
    // dataset all land here, each with its own body. Guessing "maintenance mode" hid that.
    it("relays the reason and keeps the retry hint", () => {
      const msg = authErrorMessage(503, "api_key", { error: "data_unavailable", message: "Dane transakcyjne chwilowo niedostępne" });
      expect(msg).toBe("Cenogram temporarily unavailable: Dane transakcyjne chwilowo niedostępne. Try again shortly.");
    });
    it("does not double the full stop when the API's text has one", () => {
      const msg = authErrorMessage(503, "api_key", { message: "Wycena jest tymczasowo wyłączona." });
      expect(msg).not.toContain("..");
    });
    // Half of the API's 503 bodies end with their own "try again", in Polish or English.
    it.each([
      ["Service in read-only mode. Try again in a few minutes."],
      ["Wycena (AVM) jest tymczasowo wyłączona. Spróbuj ponownie za kilka minut."],
    ])("does not stack a second retry hint on %s", (text) => {
      const msg = authErrorMessage(503, "api_key", { error: text });
      expect(msg).toContain(text);
      expect(msg).not.toContain("Try again shortly");
    });
  });

  // 410 used to fall into the default branch, which ends with "Try again shortly" - the one piece
  // of advice that can never work for a permanently retired endpoint, and an invitation to loop.
  describe("410", () => {
    const goneBody = {
      error: "Gone",
      message: "This endpoint has moved to /api/v1. The unversioned /api data surface has been retired.",
      successor: "/api/v1/transactions?limit=10",
    };

    it("says it is permanent and names the successor", () => {
      const msg = authErrorMessage(410, "api_key", goneBody);
      expect(msg).toContain("This endpoint has moved to /api/v1.");
      expect(msg).toContain("/api/v1/transactions?limit=10");
      expect(msg).toContain("permanent");
      expect(msg).toContain("@cenogram/mcp-server");
      expect(msg).not.toMatch(/try again/i);
    });

    it("works without a successor", () => {
      const msg = authErrorMessage(410, "api_key", {});
      expect(msg).toContain("retired");
      expect(msg).toContain("permanent");
      expect(msg).not.toMatch(/try again/i);
    });
  });

  describe("404", () => {
    // The API frames unknown location/county as a client-correctable 404 and now returns a
    // self-correcting body.error (e.g. "Unknown location: X. Look up the code with ...").
    // The MCP layer must surface that specific message verbatim so the model can self-correct,
    // not swallow it behind a generic string.
    it("passes the API's specific error message through verbatim", () => {
      const specific =
        'Unknown location: Sandomierz. Look up the code with /api/locations?search=<fragment> (free, returns a TERYT code to pass as teryt=), or pass a 4-digit county TERYT directly.';
      expect(authErrorMessage(404, "oauth", { error: specific })).toBe(specific);
    });
    it("prefers body.message over body.error when both present", () => {
      const msg = authErrorMessage(404, "api_key", { error: "raw", message: "human readable" });
      expect(msg).toBe("human readable");
    });
    it("falls back to a generic hint when body carries no message", () => {
      const msg = authErrorMessage(404, "api_key", {});
      expect(msg).toContain("Not found");
      expect(msg).toContain("location name or TERYT");
    });
  });

  describe("400 hint", () => {
    const body = { error: "cursor is not valid", hint: "Pass back the value of pagination.next_cursor from the previous page, unchanged." };
    it("surfaces the API hint after the error", () => {
      expect(authErrorMessage(400, "api_key", body)).toBe(`Invalid request: cursor is not valid. ${body.hint}`);
    });
    it("keeps the plain format without a hint, with an unusable hint or when the error already says it", () => {
      expect(authErrorMessage(400, "api_key", { error: "cursor is not valid" })).toBe("Invalid request: cursor is not valid");
      expect(authErrorMessage(400, "api_key", { ...body, hint: "x".repeat(501) })).toBe("Invalid request: cursor is not valid");
      expect(authErrorMessage(400, "api_key", { error: body.hint, hint: body.hint })).toBe(`Invalid request: ${body.hint}`);
    });
    it("does not change 422", () => {
      expect(authErrorMessage(422, "api_key", body)).toBe("Invalid request: cursor is not valid");
    });
  });

  describe("other (500/502/504)", () => {
    it("500: generic API unavailable with status", () => {
      const msg = authErrorMessage(500, "api_key");
      expect(msg).toContain("HTTP 500");
      expect(msg).toContain("unavailable");
    });
    it("502: same template, different status", () => {
      const msg = authErrorMessage(502, "oauth");
      expect(msg).toContain("HTTP 502");
    });
  });
});
