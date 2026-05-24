import { describe, it, expect, beforeAll, afterEach, vi } from "vitest";
import { generateKeyPair, exportSPKI, SignJWT } from "jose";
import type { CryptoKey } from "jose";

// ── Module-level mocks (must be at top level for Vitest hoisting) ──

const { mockFetch } = vi.hoisted(() => ({ mockFetch: vi.fn() }));
vi.mock("undici", () => ({ fetch: mockFetch }));
vi.mock("../client-id.js", () => ({ getClientId: () => "test-client-id" }));

// ── Test key setup ─────────────────────────────────────────────────

interface TestKeyPair {
  publicKey: CryptoKey;
  privateKey: CryptoKey;
  publicPem: string;
  kid: string;
}

let keys: TestKeyPair;
let keys2: TestKeyPair;

beforeAll(async () => {
  const kp1 = await generateKeyPair("RS256");
  const kp2 = await generateKeyPair("RS256");
  keys = {
    publicKey: kp1.publicKey,
    privateKey: kp1.privateKey,
    publicPem: await exportSPKI(kp1.publicKey),
    kid: "test-kid-1",
  };
  keys2 = {
    publicKey: kp2.publicKey,
    privateKey: kp2.privateKey,
    publicPem: await exportSPKI(kp2.publicKey),
    kid: "test-kid-2",
  };
});

// ── JWT helper ────────────────────────────────────────────────────

async function makeJwt(opts: {
  privateKey: CryptoKey;
  kid: string;
  sub?: string;
  aud?: string;
  iss?: string;
  scope?: string;
  grant_id?: string;
  client_id?: string;
  expUnix?: number;
}): Promise<string> {
  const jwt = new SignJWT({
    scope: opts.scope ?? "mcp",
    grant_id: opts.grant_id ?? "grant-uuid-1",
    client_id: opts.client_id ?? "client-uuid-1",
  })
    .setProtectedHeader({ alg: "RS256", kid: opts.kid })
    .setSubject(opts.sub ?? "user-uuid-1")
    .setIssuer(opts.iss ?? "https://api.cenogram.pl")
    .setAudience(opts.aud ?? "https://mcp.cenogram.pl")
    .setIssuedAt();

  if (opts.expUnix !== undefined) {
    jwt.setExpirationTime(opts.expUnix);
  } else {
    jwt.setExpirationTime("1h");
  }

  return jwt.sign(opts.privateKey);
}

// ── validateOAuthJwt tests ─────────────────────────────────────────

describe("validateOAuthJwt", () => {
  afterEach(() => {
    vi.unstubAllEnvs();
    vi.resetModules();
  });

  it("returns ok=true with claims for valid JWT", async () => {
    vi.stubEnv("OAUTH_JWT_KID", keys.kid);
    vi.stubEnv("OAUTH_JWT_PUBLIC_KEY", keys.publicPem);

    const { validateOAuthJwt } = await import("../oauth-jwt.js");
    const token = await makeJwt({ privateKey: keys.privateKey, kid: keys.kid });
    const result = await validateOAuthJwt(token);

    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.claims.sub).toBe("user-uuid-1");
      expect(result.claims.scope).toBe("mcp");
      expect(result.claims.grant_id).toBe("grant-uuid-1");
      expect(result.claims.client_id).toBe("client-uuid-1");
    }
  });

  it("returns reason=unknown_key for JWT without kid", async () => {
    vi.stubEnv("OAUTH_JWT_KID", keys.kid);
    vi.stubEnv("OAUTH_JWT_PUBLIC_KEY", keys.publicPem);

    const { validateOAuthJwt } = await import("../oauth-jwt.js");
    const token = await new SignJWT({ scope: "mcp", grant_id: "g1", client_id: "c1" })
      .setProtectedHeader({ alg: "RS256" }) // no kid
      .setSubject("u1")
      .setIssuer("https://api.cenogram.pl")
      .setAudience("https://mcp.cenogram.pl")
      .setIssuedAt()
      .setExpirationTime("1h")
      .sign(keys.privateKey);

    const result = await validateOAuthJwt(token);
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.reason).toBe("unknown_key");
  });

  it("returns reason=unknown_key for JWT with mismatched kid", async () => {
    vi.stubEnv("OAUTH_JWT_KID", keys.kid);
    vi.stubEnv("OAUTH_JWT_PUBLIC_KEY", keys.publicPem);

    const { validateOAuthJwt } = await import("../oauth-jwt.js");
    const token = await makeJwt({ privateKey: keys2.privateKey, kid: keys2.kid });
    const result = await validateOAuthJwt(token);
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.reason).toBe("unknown_key");
  });

  it("returns reason=invalid for JWT with wrong audience", async () => {
    vi.stubEnv("OAUTH_JWT_KID", keys.kid);
    vi.stubEnv("OAUTH_JWT_PUBLIC_KEY", keys.publicPem);

    const { validateOAuthJwt } = await import("../oauth-jwt.js");
    const token = await makeJwt({
      privateKey: keys.privateKey,
      kid: keys.kid,
      aud: "https://api.cenogram.pl",
    });
    const result = await validateOAuthJwt(token);
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.reason).toBe("invalid");
  });

  it("returns reason=invalid for JWT with wrong issuer", async () => {
    vi.stubEnv("OAUTH_JWT_KID", keys.kid);
    vi.stubEnv("OAUTH_JWT_PUBLIC_KEY", keys.publicPem);

    const { validateOAuthJwt } = await import("../oauth-jwt.js");
    const token = await makeJwt({
      privateKey: keys.privateKey,
      kid: keys.kid,
      iss: "https://evil.example.com",
    });
    const result = await validateOAuthJwt(token);
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.reason).toBe("invalid");
  });

  it("returns reason=expired for expired JWT", async () => {
    vi.stubEnv("OAUTH_JWT_KID", keys.kid);
    vi.stubEnv("OAUTH_JWT_PUBLIC_KEY", keys.publicPem);

    const { validateOAuthJwt } = await import("../oauth-jwt.js");
    const expiredAt = Math.floor(Date.now() / 1000) - 10;
    const token = await makeJwt({ privateKey: keys.privateKey, kid: keys.kid, expUnix: expiredAt });
    const result = await validateOAuthJwt(token);
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.reason).toBe("expired");
  });

  it("throws OAuthConfigError when env vars not set", async () => {
    const { validateOAuthJwt, OAuthConfigError } = await import("../oauth-jwt.js");
    const token = await makeJwt({ privateKey: keys.privateKey, kid: keys.kid });
    await expect(validateOAuthJwt(token)).rejects.toBeInstanceOf(OAuthConfigError);
  });

  it("returns reason=invalid for malformed token", async () => {
    vi.stubEnv("OAUTH_JWT_KID", keys.kid);
    vi.stubEnv("OAUTH_JWT_PUBLIC_KEY", keys.publicPem);

    const { validateOAuthJwt } = await import("../oauth-jwt.js");
    const result = await validateOAuthJwt("not.a.jwt");
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.reason).toBe("invalid");
  });
});

// ── encodeOAuthCtx + buildHeaders integration ─────────────────────

describe("encodeOAuthCtx / internal auth headers", () => {
  afterEach(() => {
    mockFetch.mockClear();
    vi.unstubAllEnvs();
  });

  it("sets internal auth headers for oauth context key", async () => {
    vi.stubEnv("INTERNAL_AUTH_SECRET", "test-secret-xyz");

    mockFetch.mockResolvedValueOnce({
      ok: true,
      json: () => Promise.resolve({ counts: {} }),
      headers: { get: () => null },
    });

    const { getStats, encodeOAuthCtx } = await import("../api-client.js");
    const oauthKey = encodeOAuthCtx("user-123", "grant-456");
    await getStats(oauthKey);

    const callHeaders = mockFetch.mock.calls[0]![1]?.headers as Record<string, string>;
    expect(callHeaders["X-Internal-Auth"]).toBe("test-secret-xyz");
    expect(callHeaders["X-OAuth-User"]).toBe("user-123");
    expect(callHeaders["X-OAuth-Grant"]).toBe("grant-456");
    expect(callHeaders["Authorization"]).toBeUndefined();
  });

  it("sets Authorization header for ctx_ key", async () => {
    mockFetch.mockResolvedValueOnce({
      ok: true,
      json: () => Promise.resolve({ counts: {} }),
      headers: { get: () => null },
    });

    const { getStats } = await import("../api-client.js");
    await getStats("ctx_testkey123");

    const callHeaders = mockFetch.mock.calls[0]![1]?.headers as Record<string, string>;
    expect(callHeaders["Authorization"]).toBe("Bearer ctx_testkey123");
    expect(callHeaders["X-Internal-Auth"]).toBeUndefined();
  });

  it("correctly encodes UUID userId containing only hex+hyphens (no colon ambiguity)", async () => {
    vi.stubEnv("INTERNAL_AUTH_SECRET", "sec");

    mockFetch.mockResolvedValueOnce({
      ok: true,
      json: () => Promise.resolve({ counts: {} }),
      headers: { get: () => null },
    });

    const { getStats, encodeOAuthCtx } = await import("../api-client.js");
    const uuid = "550e8400-e29b-41d4-a716-446655440000";
    const oauthKey = encodeOAuthCtx(uuid, "grant-789");
    await getStats(oauthKey);

    const callHeaders = mockFetch.mock.calls[0]![1]?.headers as Record<string, string>;
    expect(callHeaders["X-OAuth-User"]).toBe(uuid);
    expect(callHeaders["X-OAuth-Grant"]).toBe("grant-789");
  });
});
