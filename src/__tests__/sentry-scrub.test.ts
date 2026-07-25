import { describe, it, expect } from "vitest";
import { scrubHeaders, scrubString } from "../sentry-scrub.js";

describe("scrubHeaders", () => {
  it("filters sensitive headers", () => {
    const result = scrubHeaders({
      "authorization": "Bearer eyJhbG...",
      "cookie": "session=abc123",
      "x-internal-auth": "secret",
      "x-api-key": "cngrm_abc123",
      "content-type": "application/json",
      "user-agent": "claude-desktop/1.0",
    });
    expect(result.authorization).toBe("[Filtered]");
    expect(result.cookie).toBe("[Filtered]");
    expect(result["x-internal-auth"]).toBe("[Filtered]");
    expect(result["x-api-key"]).toBe("[Filtered]");
    expect(result["content-type"]).toBe("application/json");
    expect(result["user-agent"]).toBe("claude-desktop/1.0");
  });

  it("is case-insensitive", () => {
    const result = scrubHeaders({
      "Authorization": "Bearer token",
      "X-Internal-Auth": "secret",
    });
    expect(result.Authorization).toBe("[Filtered]");
    expect(result["X-Internal-Auth"]).toBe("[Filtered]");
  });
});

describe("scrubString", () => {
  it("replaces cngrm_ API key patterns", () => {
    expect(scrubString("https://cenogram.pl/api?key=cngrm_c4678d5d80203972a43fa721b770a44b"))
      .toBe("https://cenogram.pl/api?key=[Filtered]");
  });

  it("replaces keys in error messages", () => {
    expect(scrubString("fetch failed for cngrm_aaa111bbb222"))
      .toBe("fetch failed for [Filtered]");
  });

  it("replaces multiple keys", () => {
    expect(scrubString("cngrm_aaa111 and cngrm_bbb222"))
      .toBe("[Filtered] and [Filtered]");
  });

  it("leaves non-matching strings unchanged", () => {
    expect(scrubString("Internal server error")).toBe("Internal server error");
  });
});
