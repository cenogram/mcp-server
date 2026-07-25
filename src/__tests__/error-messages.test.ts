import { describe, it, expect } from "vitest";
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
    it("OAuth: account wording, parses balance/required", () => {
      const msg = authErrorMessage(402, "oauth", { currentBalance: 5, creditsRequired: 10 });
      expect(msg).toContain("Insufficient credits");
      expect(msg).toContain("balance: 5");
      expect(msg).toContain("query cost: 10");
      expect(msg).toContain("https://cenogram.pl/api?src=mcpstdio#cennik");
    });
    it("API key: 'key's account' wording, parses balance/required", () => {
      const msg = authErrorMessage(402, "api_key", { currentBalance: 0, creditsRequired: 2 });
      expect(msg).toContain("key's account");
      expect(msg).toContain("balance: 0");
      expect(msg).toContain("query cost: 2");
    });
    it("malformed body: defaults to 0 balance, ? required", () => {
      const msg = authErrorMessage(402, "api_key", {});
      expect(msg).toContain("balance: 0");
      expect(msg).toContain("query cost: ?");
    });

    // An expired trial freezes the balance instead of spending it, so the credits template
    // describes the wrong problem: it would report "balance: 300, query cost: 1" and leave the
    // caller looking for a maths error. The API states the real reason; relay it untouched.
    describe("trial_expired", () => {
      const trialBody = {
        error: "trial_expired",
        message:
          "Your 14-day free API trial has expired, so this request was not charged. Your remaining 300 token(s) are frozen, not lost - they become spendable again once you subscribe to Starter at https://cenogram.pl/api#cennik",
        currentBalance: 300,
        creditsRequired: 1,
        upgrade: "https://cenogram.pl/api#cennik",
      };

      it("relays the API's explanation instead of the credits template", () => {
        const msg = authErrorMessage(402, "api_key", trialBody);
        expect(msg).toBe(trialBody.message);
        expect(msg).not.toContain("Insufficient credits");
        expect(msg).not.toContain("query cost");
      });

      it("appends the upgrade URL when the message does not already carry it", () => {
        const msg = authErrorMessage(402, "oauth", { ...trialBody, message: "Trial over." });
        expect(msg).toBe("Trial over. (https://cenogram.pl/api#cennik)");
      });

      it("falls back to the credits template when the API sent no explanation", () => {
        const msg = authErrorMessage(402, "api_key", { error: "trial_expired", currentBalance: 7, creditsRequired: 2 });
        expect(msg).toContain("balance: 7");
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
    // self-correcting body.error (e.g. "Unknown location: X. ... List covered locations first ...").
    // The MCP layer must surface that specific message verbatim so the model can self-correct,
    // not swallow it behind a generic string.
    it("passes the API's specific error message through verbatim", () => {
      const specific =
        'Unknown location: Sandomierz. Not a covered county for this tool. List covered locations first (the /locations coverage catalog) or pass a 4-digit county TERYT code; districts are supported only for Warszawa (6-digit TERYT).';
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
