import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { fetch } from "undici";
import { startStubApi, type StubApi } from "./stub-api.js";

describe("stub-api fixture", () => {
  let stub: StubApi;

  beforeAll(async () => {
    stub = await startStubApi({
      byBearerToken: {
        "test-key-402": { status: 402, body: { error: "insufficient_credits", currentBalance: 0 } },
        "test-key-503": { status: 503 },
      },
      byOAuthUser: {
        "user-uuid": { status: 401, body: { error: "invalid_token" } },
      },
    });
  });

  afterAll(async () => {
    await stub.close();
  });

  it("matches byBearerToken on exact token (after Bearer prefix)", async () => {
    const res = await fetch(`http://127.0.0.1:${stub.port}/api/test`, {
      headers: { Authorization: "Bearer test-key-402" },
    });
    expect(res.status).toBe(402);
    const body = await res.json() as { error: string; currentBalance: number };
    expect(body.error).toBe("insufficient_credits");
    expect(body.currentBalance).toBe(0);
  });

  it("matches byOAuthUser on X-OAuth-User header", async () => {
    const res = await fetch(`http://127.0.0.1:${stub.port}/api/test`, {
      headers: { "X-OAuth-User": "user-uuid", "X-Internal-Auth": "secret" },
    });
    expect(res.status).toBe(401);
    const body = await res.json() as { error: string };
    expect(body.error).toBe("invalid_token");
  });

  it("falls through to TEST_BUG_NO_SCENARIO_SET when no match", async () => {
    const res = await fetch(`http://127.0.0.1:${stub.port}/api/test`, {
      headers: { Authorization: "Bearer unknown-token" },
    });
    expect(res.status).toBe(500);
    const body = await res.json() as { error: string };
    expect(body.error).toBe("TEST_BUG_NO_SCENARIO_SET");
  });

  it("setScenarios mutates dynamically", async () => {
    stub.setScenarios({
      byBearerToken: { "new-token": { status: 200, body: { ok: true } } },
    });
    const res = await fetch(`http://127.0.0.1:${stub.port}/api/test`, {
      headers: { Authorization: "Bearer new-token" },
    });
    expect(res.status).toBe(200);
    const body = await res.json() as { ok: boolean };
    expect(body.ok).toBe(true);

    // Old scenario no longer matches
    const res2 = await fetch(`http://127.0.0.1:${stub.port}/api/test`, {
      headers: { Authorization: "Bearer test-key-402" },
    });
    expect(res2.status).toBe(500);
  });

  it("uses default scenario when set and no specific match", async () => {
    stub.setScenarios({
      default: { status: 418, body: { error: "teapot" } },
    });
    const res = await fetch(`http://127.0.0.1:${stub.port}/api/test`);
    expect(res.status).toBe(418);
    const body = await res.json() as { error: string };
    expect(body.error).toBe("teapot");
  });
});
