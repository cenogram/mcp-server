import { describe, it, expect, beforeAll, afterEach, vi } from "vitest";
import { generateKeyPair, exportSPKI, SignJWT } from "jose";
import type { CryptoKey } from "jose";
import { sanitizeForLog } from "../auth-dispatch.js";

// ── Test key setup ─────────────────────────────────────────────────

let pubKeyPem: string;
let privateKey: CryptoKey;
const KID = "test-kid-1";

beforeAll(async () => {
  const kp = await generateKeyPair("RS256");
  privateKey = kp.privateKey;
  pubKeyPem = await exportSPKI(kp.publicKey);
});

async function makeJwt(opts: {
  scope?: string;
  expUnix?: number;
  kid?: string;
  iss?: string;
  aud?: string;
  privateKey?: CryptoKey;
} = {}): Promise<string> {
  const jwt = new SignJWT({
    scope: opts.scope ?? "mcp",
    grant_id: "grant-uuid",
    client_id: "client-uuid",
  })
    .setProtectedHeader({ alg: "RS256", kid: opts.kid ?? KID })
    .setSubject("user-uuid")
    .setIssuer(opts.iss ?? "https://api.cenogram.pl")
    .setAudience(opts.aud ?? "https://mcp.cenogram.pl")
    .setIssuedAt();
  if (opts.expUnix !== undefined) jwt.setExpirationTime(opts.expUnix);
  else jwt.setExpirationTime("1h");
  return jwt.sign(opts.privateKey ?? privateKey);
}

const RESOURCE_METADATA_VAL = `resource_metadata="https://mcp.cenogram.pl/.well-known/oauth-protected-resource"`;

// ── sanitizeForLog (log poisoning via multi-byte UTF-8 controls) ─────

describe("sanitizeForLog", () => {
  it("passes through safe ASCII unchanged", () => {
    expect(sanitizeForLog("abc123-_.")).toBe("abc123-_.");
    expect(sanitizeForLog("")).toBe("");
  });

  it("escapes ASCII C0 controls (\\x00-\\x1F)", () => {
    expect(sanitizeForLog("a\x00b")).toBe("a\\u0000b");
    expect(sanitizeForLog("a\nb")).toBe("a\\u000ab");
    expect(sanitizeForLog("a\rb")).toBe("a\\u000db");
    expect(sanitizeForLog("a\x1fb")).toBe("a\\u001fb");
  });

  it("escapes DEL + C1 controls (\\x7F-\\x9F including NEL U+0085)", () => {
    expect(sanitizeForLog("a\x7fb")).toBe("a\\u007fb");
    expect(sanitizeForLog("ab")).toBe("a\\u0085b"); // NEL - bytes 0xc2 0x85 in UTF-8
    expect(sanitizeForLog("ab")).toBe("a\\u009fb");
  });

  it("escapes LSEP/PSEP (U+2028/U+2029 - NOT escaped by JSON.stringify)", () => {
    expect(sanitizeForLog("a b")).toBe("a\\u2028b");
    expect(sanitizeForLog("a b")).toBe("a\\u2029b");
  });

  it("escapes BiDi controls U+202A-U+202E (Trojan Source)", () => {
    expect(sanitizeForLog("a‪b")).toBe("a\\u202ab"); // LRE
    expect(sanitizeForLog("a‮b")).toBe("a\\u202eb"); // RLO
  });

  it("escapes BiDi isolates U+2066-U+2069", () => {
    expect(sanitizeForLog("a⁦b")).toBe("a\\u2066b"); // LRI
    expect(sanitizeForLog("a⁩b")).toBe("a\\u2069b"); // PDI
  });

  it("escapes BOM (U+FEFF)", () => {
    expect(sanitizeForLog("a﻿b")).toBe("a\\ufeffb");
  });

  it("escapes multiple unsafe chars in single string", () => {
    expect(sanitizeForLog("a\x00‮b c")).toBe("a\\u0000\\u202eb\\u2028c");
  });

  it("output never contains raw unsafe bytes (regression sanity)", () => {
    const inputs = ["\x00", "", " ", " ", "‮", "⁦", "﻿"];
    for (const input of inputs) {
      const out = sanitizeForLog(input);
      // Verify output is pure ASCII - no raw multibyte sequences survived
      expect(/^[\x20-\x7E\\]*$/.test(out)).toBe(true);
    }
  });
});

describe("dispatchAuth", () => {
  afterEach(() => {
    vi.unstubAllEnvs();
    vi.resetModules();
  });

  function setupEnv() {
    vi.stubEnv("OAUTH_JWT_KID", KID);
    vi.stubEnv("OAUTH_JWT_PUBLIC_KEY", pubKeyPem);
  }

  // ── Missing token ────────────────────────────────────────────────

  it("returns 401 missing_token for absent Authorization header", async () => {
    setupEnv();
    const { dispatchAuth } = await import("../auth-dispatch.js");
    const r = await dispatchAuth(undefined);
    expect(r.kind).toBe("401");
    if (r.kind !== "401") return;
    expect(r.body.error).toBe("missing_token");
    expect(r.headers["WWW-Authenticate"]).toMatch(/^Bearer realm="cenogram", resource_metadata="https:\/\//);
    expect(r.headers["WWW-Authenticate"]).not.toMatch(/error=/);
    expect(r.log).toMatchObject({ evt: "auth.rejected", reason: "missing" });
  });

  it("returns 401 missing_token for `Bearer ` (empty after BWS)", async () => {
    setupEnv();
    const { dispatchAuth } = await import("../auth-dispatch.js");
    const r = await dispatchAuth("Bearer ");
    expect(r.kind).toBe("401");
    if (r.kind !== "401") return;
    expect(r.body.error).toBe("missing_token");
  });

  it("returns 401 missing_token for `Bearer\\t \\t` (whitespace only)", async () => {
    setupEnv();
    const { dispatchAuth } = await import("../auth-dispatch.js");
    const r = await dispatchAuth("Bearer\t \t");
    expect(r.kind).toBe("401");
    if (r.kind !== "401") return;
    expect(r.body.error).toBe("missing_token");
  });

  // ── Invalid format ───────────────────────────────────────────────

  it("returns 401 invalid_token for `Bearer foobar` (not JWT, not cngrm_)", async () => {
    setupEnv();
    const { dispatchAuth } = await import("../auth-dispatch.js");
    const r = await dispatchAuth("Bearer foobar");
    expect(r.kind).toBe("401");
    if (r.kind !== "401") return;
    expect(r.body.error).toBe("invalid_token");
    expect(r.headers["WWW-Authenticate"]).toContain('error="invalid_token"');
    expect(r.headers["WWW-Authenticate"]).toContain('error_description="Token format not recognized"');
    expect(r.log).toMatchObject({ evt: "auth.rejected", reason: "invalid_format" });
  });

  it("returns 401 for `Bearer eyJ.invalid` (2 segments - not JWT shape)", async () => {
    setupEnv();
    const { dispatchAuth } = await import("../auth-dispatch.js");
    const r = await dispatchAuth("Bearer eyJ.invalid");
    expect(r.kind).toBe("401");
    if (r.kind !== "401") return;
    expect(r.headers["WWW-Authenticate"]).toContain('error_description="Token format not recognized"');
  });

  it("rejects uppercase Cngrm_ prefix (case-sensitive - not API key, not JWT shape)", async () => {
    setupEnv();
    const { dispatchAuth } = await import("../auth-dispatch.js");
    const r = await dispatchAuth(`Bearer Cngrm_${"a".repeat(32)}`);
    expect(r.kind).toBe("401");
    if (r.kind !== "401") return;
    expect(r.body.error).toBe("invalid_token");
  });

  // ── Oversized header ────────────────────────────────────────────

  it("returns 401 invalid_token for oversized Authorization header (>8192 B)", async () => {
    setupEnv();
    const { dispatchAuth } = await import("../auth-dispatch.js");
    // 9000 chars > 8192 B limit
    const r = await dispatchAuth(`Bearer ${"x".repeat(9000)}`);
    expect(r.kind).toBe("401");
    if (r.kind !== "401") return;
    expect(r.body.error).toBe("invalid_token");
    expect(r.body.error_description).toBe("Authorization header exceeds maximum size");
    expect(r.headers["WWW-Authenticate"]).toContain('error="invalid_token"');
    expect(r.headers["WWW-Authenticate"]).toContain('error_description="Authorization header too large"');
    expect(r.log).toMatchObject({ evt: "auth.rejected", reason: "oversized_header", kid: null });
  });

  it("rejects header at 8193 B (1 byte over limit, strict greater-than boundary)", async () => {
    setupEnv();
    const { dispatchAuth } = await import("../auth-dispatch.js");
    // "Bearer " (7) + 8186 chars = 8193 B = MAX_AUTH_HEADER_BYTES + 1
    const r = await dispatchAuth(`Bearer ${"x".repeat(8186)}`);
    expect(r.kind).toBe("401");
    if (r.kind !== "401") return;
    expect(r.body.error).toBe("invalid_token");
    expect(r.log).toMatchObject({ reason: "oversized_header" });
  });

  it("accepts header just under 8192 B limit (boundary)", async () => {
    setupEnv();
    const { dispatchAuth } = await import("../auth-dispatch.js");
    // "Bearer " (7) + 8000 chars = 8007 B, well under limit
    const r = await dispatchAuth(`Bearer ${"x".repeat(8000)}`);
    // Will fail invalid_format (not JWT shape, not cngrm_), NOT oversized
    expect(r.kind).toBe("401");
    if (r.kind !== "401") return;
    expect(r.body.error_description).toBe("Expected OAuth JWT or Cenogram API key (cngrm_...)");
  });

  it("does not crash on undefined authHeader (size check guards)", async () => {
    setupEnv();
    const { dispatchAuth } = await import("../auth-dispatch.js");
    const r = await dispatchAuth(undefined);
    // Goes to missing_token path (size check skips for undefined)
    expect(r.kind).toBe("401");
    if (r.kind !== "401") return;
    expect(r.body.error).toBe("missing_token");
  });

  // ── BWS handling ─────────────────────────────────────────────────

  it("accepts lowercase `bearer` (case-insensitive prefix per RFC)", async () => {
    setupEnv();
    const { dispatchAuth } = await import("../auth-dispatch.js");
    const r = await dispatchAuth(`bearer cngrm_${"a".repeat(32)}`);
    expect(r.kind).toBe("passthrough");
  });

  it("accepts TAB whitespace between Bearer and token (RFC 7235 BWS)", async () => {
    setupEnv();
    const { dispatchAuth } = await import("../auth-dispatch.js");
    const r = await dispatchAuth(`Bearer\tcngrm_${"a".repeat(32)}`);
    expect(r.kind).toBe("passthrough");
  });

  // ── JWT validation reasons ───────────────────────────────────────

  it("returns 401 for expired JWT (description: Token expired)", async () => {
    setupEnv();
    const { dispatchAuth } = await import("../auth-dispatch.js");
    const expiredAt = Math.floor(Date.now() / 1000) - 10;
    const token = await makeJwt({ expUnix: expiredAt });
    const r = await dispatchAuth(`Bearer ${token}`);
    expect(r.kind).toBe("401");
    if (r.kind !== "401") return;
    expect(r.headers["WWW-Authenticate"]).toContain('error_description="Token expired"');
    expect(r.body.error_description).toBe("Token expired");
    expect(r.log).toMatchObject({ evt: "auth.rejected", reason: "expired" });
  });

  it("returns 401 with generic 'Token validation failed' for unknown_key (no leak)", async () => {
    setupEnv();
    const otherKp = await generateKeyPair("RS256");
    const { dispatchAuth } = await import("../auth-dispatch.js");
    const token = await makeJwt({ kid: "other-kid", privateKey: otherKp.privateKey });
    const r = await dispatchAuth(`Bearer ${token}`);
    expect(r.kind).toBe("401");
    if (r.kind !== "401") return;
    expect(r.headers["WWW-Authenticate"]).toContain('error_description="Token validation failed"');
    // Critical: no kid leakage on wire
    expect(r.headers["WWW-Authenticate"]).not.toContain("kid");
    expect(r.body.error_description).not.toMatch(/kid|key/i);
    expect(r.log).toMatchObject({ evt: "auth.rejected", reason: "unknown_key", kid: "other-kid" });
  });

  it("returns 401 with generic 'Token validation failed' for invalid (wrong audience)", async () => {
    setupEnv();
    const { dispatchAuth } = await import("../auth-dispatch.js");
    const token = await makeJwt({ aud: "https://wrong.example.com" });
    const r = await dispatchAuth(`Bearer ${token}`);
    expect(r.kind).toBe("401");
    if (r.kind !== "401") return;
    expect(r.headers["WWW-Authenticate"]).toContain('error_description="Token validation failed"');
    expect(r.log).toMatchObject({ evt: "auth.rejected", reason: "invalid" });
  });

  // ── Insufficient scope ───────────────────────────────────────────

  it("returns 403 insufficient_scope when scope missing 'mcp'", async () => {
    setupEnv();
    const { dispatchAuth } = await import("../auth-dispatch.js");
    const token = await makeJwt({ scope: "read write" });
    const r = await dispatchAuth(`Bearer ${token}`);
    expect(r.kind).toBe("403");
    if (r.kind !== "403") return;
    expect(r.body.error).toBe("insufficient_scope");
    expect(r.headers["WWW-Authenticate"]).toMatch(/^Bearer realm="cenogram"/);
    expect(r.headers["WWW-Authenticate"]).toContain('error="insufficient_scope"');
    expect(r.headers["WWW-Authenticate"]).toContain('scope="mcp"');
    expect(r.headers["WWW-Authenticate"]).toContain(RESOURCE_METADATA_VAL);
    expect(r.log).toMatchObject({ evt: "auth.rejected", reason: "insufficient_scope" });
  });

  // ── Server config error ──────────────────────────────────────────

  it("returns 500 server_misconfigured when OAuth env vars missing for JWT input", async () => {
    // No env stubbed → OAuthConfigError thrown by validateOAuthJwt
    const { dispatchAuth } = await import("../auth-dispatch.js");
    const otherKp = await generateKeyPair("RS256");
    const token = await new SignJWT({ scope: "mcp" })
      .setProtectedHeader({ alg: "RS256", kid: "any" })
      .setSubject("u")
      .setIssuer("https://api.cenogram.pl")
      .setAudience("https://mcp.cenogram.pl")
      .setIssuedAt()
      .setExpirationTime("1h")
      .sign(otherKp.privateKey);
    const r = await dispatchAuth(`Bearer ${token}`);
    expect(r.kind).toBe("500");
    if (r.kind !== "500") return;
    expect(r.body.error).toBe("server_misconfigured");
    expect(r.log).toMatchObject({ evt: "auth.config_missing" });
  });

  // ── Passthrough ──────────────────────────────────────────────────

  it("returns passthrough with raw token for cngrm_ prefix (any chars)", async () => {
    setupEnv();
    const { dispatchAuth } = await import("../auth-dispatch.js");
    const token = `cngrm_${"a".repeat(32)}`;
    const r = await dispatchAuth(`Bearer ${token}`);
    expect(r.kind).toBe("passthrough");
    if (r.kind !== "passthrough") return;
    expect(r.apiKey).toBe(token);
    expect(r.log).toMatchObject({ evt: "auth.passthrough", mode: "api_key", key_prefix: "cngrm_aaaa" });
  });

  it("returns passthrough with encoded oauth ctx for valid JWT with mcp scope", async () => {
    setupEnv();
    const { dispatchAuth } = await import("../auth-dispatch.js");
    const token = await makeJwt({ scope: "mcp" });
    const r = await dispatchAuth(`Bearer ${token}`);
    expect(r.kind).toBe("passthrough");
    if (r.kind !== "passthrough") return;
    // \x01user-uuid\x01grant-uuid
    expect(r.apiKey).toBe("\x01user-uuid\x01grant-uuid");
    expect(r.log).toMatchObject({ evt: "auth.passthrough", mode: "oauth", grant_id: "grant-uuid" });
  });

  // ── Log sanitization regression (key_prefix + kid) ─────────────

  it("sanitizes key_prefix when cngrm_ key contains BiDi RLO byte", async () => {
    setupEnv();
    const { dispatchAuth } = await import("../auth-dispatch.js");
    // RLO at position 7 (within slice(0,10) of "cngrm_<RLO>xxz")
    const token = `cngrm_‮xxz${"a".repeat(28)}`;
    const r = await dispatchAuth(`Bearer ${token}`);
    expect(r.kind).toBe("passthrough");
    if (r.kind !== "passthrough" || r.log.mode !== "api_key") return;
    // key_prefix must contain escape, NOT raw RLO
    expect(r.log.key_prefix).toBe("cngrm_\\u202exxz");
    // Verify no raw multi-byte UTF-8 sequence survives in serialized log
    const serialized = JSON.stringify(r.log);
    // eslint-disable-next-line no-control-regex
    expect(/^[\x00-\x7F]*$/.test(serialized)).toBe(true); // ASCII-only - no raw multibyte UTF-8
  });

  it("sanitizes key_prefix when cngrm_ key contains NEL byte", async () => {
    setupEnv();
    const { dispatchAuth } = await import("../auth-dispatch.js");
    // NEL (U+0085 = 0xc2 0x85 in UTF-8) at position 6 (right after cngrm_)
    const token = `cngrm_\x85xxz${"a".repeat(28)}`;
    const r = await dispatchAuth(`Bearer ${token}`);
    expect(r.kind).toBe("passthrough");
    if (r.kind !== "passthrough" || r.log.mode !== "api_key") return;
    expect(r.log.key_prefix).toBe("cngrm_\\u0085xxz");
    const serialized = JSON.stringify(r.log);
    // eslint-disable-next-line no-control-regex
    expect(/^[\x00-\x7F]*$/.test(serialized)).toBe(true); // ASCII-only - no raw multibyte UTF-8
  });

  it("sanitizes kid in log when JWT header contains BiDi RLO", async () => {
    setupEnv();
    const otherKp = await generateKeyPair("RS256"); // unknown_key path triggers kid logging
    const { dispatchAuth } = await import("../auth-dispatch.js");
    const token = await makeJwt({ kid: "‮test", privateKey: otherKp.privateKey });
    const r = await dispatchAuth(`Bearer ${token}`);
    expect(r.kind).toBe("401");
    if (r.kind !== "401" || r.log.evt !== "auth.rejected") return;
    expect(r.log.kid).toBe("\\u202etest");
    const serialized = JSON.stringify(r.log);
    // eslint-disable-next-line no-control-regex
    expect(/^[\x00-\x7F]*$/.test(serialized)).toBe(true); // ASCII-only - no raw multibyte UTF-8
  });

  it("sanitizes kid in log when JWT header contains NEL byte", async () => {
    setupEnv();
    const otherKp = await generateKeyPair("RS256");
    const { dispatchAuth } = await import("../auth-dispatch.js");
    const token = await makeJwt({ kid: "test\x85kid", privateKey: otherKp.privateKey });
    const r = await dispatchAuth(`Bearer ${token}`);
    expect(r.kind).toBe("401");
    if (r.kind !== "401" || r.log.evt !== "auth.rejected") return;
    expect(r.log.kid).toBe("test\\u0085kid");
    const serialized = JSON.stringify(r.log);
    // eslint-disable-next-line no-control-regex
    expect(/^[\x00-\x7F]*$/.test(serialized)).toBe(true); // ASCII-only - no raw multibyte UTF-8
  });

  // ── Header injection enforcement ─────────────────────────────────

  it("quotedParam throws on values containing illegal chars", async () => {
    // Re-import to access internal - but quotedParam isn't exported.
    // We verify via behavior: feed bad description through internal path is impossible
    // (REASON_DESC values are static ASCII). Instead, verify the output never contains
    // CRLF or unescaped quotes for any input, including pathological tokens.
    setupEnv();
    const { dispatchAuth } = await import("../auth-dispatch.js");
    const pathological = [
      `Bearer foo"bar\r\nInjected: header`,
      `Bearer foo\\back\\slash`,
      `Bearer ${"x".repeat(10000)}`, // very long token
    ];
    for (const auth of pathological) {
      const r = await dispatchAuth(auth);
      if (r.kind === "401" || r.kind === "403") {
        const wwwAuth = r.headers["WWW-Authenticate"];
        // No CR or LF anywhere
        expect(wwwAuth).not.toMatch(/[\r\n]/);
        // ASCII visible only
        expect(wwwAuth).toMatch(/^[\x20-\x7E]*$/);
      }
    }
  });

  // ── Header-level invariants ──────────────────────────────────────

  it("WWW-Authenticate ASCII-only and quoted-string-safe for all rejection paths", async () => {
    setupEnv();
    const { dispatchAuth } = await import("../auth-dispatch.js");
    const cases = [
      undefined,
      "Bearer foobar",
      "Bearer eyJ.invalid",
    ];
    for (const auth of cases) {
      const r = await dispatchAuth(auth);
      if (r.kind === "401" || r.kind === "403") {
        const wwwAuth = r.headers["WWW-Authenticate"];
        // Validate quoted values: no naked " or \ inside the values
        // Coarse check: header is ASCII visible-only
        expect(wwwAuth).toMatch(/^[\x20-\x7E]*$/);
        expect(wwwAuth).toMatch(/^Bearer realm="cenogram"/);
        expect(wwwAuth).toContain(RESOURCE_METADATA_VAL);
      }
    }
  });
});
