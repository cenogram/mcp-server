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
    it("API key: prompts user to check api/keys", () => {
      const msg = authErrorMessage(401, "api_key");
      expect(msg).toContain("API key rejected");
      expect(msg).toContain("https://cenogram.pl/api/keys");
    });
    it("stdio_env (no oauth): API key wording", () => {
      const msg = authErrorMessage(401, "stdio_env");
      expect(msg).toContain("API key rejected");
    });
    it("none: API key wording (default fallback)", () => {
      const msg = authErrorMessage(401, "none");
      expect(msg).toContain("API key rejected");
    });
  });

  describe("402", () => {
    it("OAuth: account wording, parses balance/required", () => {
      const msg = authErrorMessage(402, "oauth", { currentBalance: 5, creditsRequired: 10 });
      expect(msg).toContain("Insufficient credits");
      expect(msg).toContain("balance: 5");
      expect(msg).toContain("query cost: 10");
      expect(msg).toContain("https://cenogram.pl/api#cennik");
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
  });

  describe("403", () => {
    it("email_not_verified: prompts inbox check", () => {
      const msg = authErrorMessage(403, "oauth", { error: "email_not_verified" });
      expect(msg).toContain("not verified");
      expect(msg).toContain("Check your inbox");
    });
    it("generic 403: HTTP 403 mention", () => {
      const msg = authErrorMessage(403, "oauth", { error: "something_else" });
      expect(msg).toContain("HTTP 403");
    });
  });

  describe("503", () => {
    it("temporary unavailability wording with retry hint", () => {
      const msg = authErrorMessage(503, "api_key");
      expect(msg).toContain("unavailable");
      expect(msg).toContain("maintenance");
      expect(msg).toContain("Try again");
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
