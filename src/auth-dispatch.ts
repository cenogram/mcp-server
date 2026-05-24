import { validateOAuthJwt, OAuthConfigError, type ValidationReason } from "./oauth-jwt.js";
import { encodeOAuthCtx } from "./api-client.js";

export const RESOURCE_METADATA = "https://mcp.cenogram.pl/.well-known/oauth-protected-resource";

// RFC 6750 § 3 quoted-string alphabet: %x20-21 / %x23-5B / %x5D-7E (ASCII visible without " or \)
const QUOTED_RE = /^[\x20\x21\x23-\x5B\x5D-\x7E]*$/;

// RFC 7235 BWS (bad whitespace): SP / HTAB
const BEARER_RE = /^Bearer[ \t]+(.+)$/i;

// JWT shape: 3 base64url segments separated by dots, starting with eyJ
const JWT_SHAPE_RE = /^eyJ[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+$/;

// Log-unsafe codepoints (log poisoning via multi-byte UTF-8 controls):
//   \x00-\x1F      ASCII C0 controls
//   \x7F-\x9F      DEL + C1 controls (incl. U+0085 NEL = bytes 0xc2 0x85)
//   U+2028, U+2029 Line/Paragraph Separator (NOT escaped by JSON.stringify)
//   U+202A-U+202E  BiDi controls LRE/RLE/PDF/LRO/RLO (Trojan Source attacks)
//   U+2066-U+2069  BiDi isolates LRI/RLI/FSI/PDI
//   U+FEFF         Zero-Width No-Break Space / BOM
// Goal: prevent log injection / terminal RTL render manipulation when user-controlled
// bytes (kid in JWT header, suffix of cngrm_ API key) reach stderr JSON logs.
// eslint-disable-next-line no-control-regex -- control chars in regex are the whole point
const LOG_UNSAFE_RE = /[\x00-\x1F\x7F-\x9F\u2028\u2029\u202A-\u202E\u2066-\u2069\uFEFF]/g;

export function sanitizeForLog(s: string): string {
  return s.replace(LOG_UNSAFE_RE, (c) => `\\u${c.charCodeAt(0).toString(16).padStart(4, "0")}`);
}

// Static descriptions for WWW-Authenticate header - quoted-safe ASCII, no user input echoed.
// Note: unknown_key and invalid intentionally share the same description to avoid leaking
// validation timing/identity info on the wire (security: minimize info oracle).
const REASON_DESC: Record<ValidationReason, string> = {
  expired: "Token expired",
  unknown_key: "Token validation failed",
  invalid: "Token validation failed",
};

export type DispatchResult =
  | {
      kind: "passthrough";
      apiKey: string;
      log: { evt: "auth.passthrough"; mode: "oauth"; grant_id: string } | { evt: "auth.passthrough"; mode: "api_key"; key_prefix: string | null };
    }
  | {
      kind: "401";
      headers: { "Content-Type": string; "WWW-Authenticate": string };
      body: { error: string; error_description: string };
      log: { evt: "auth.rejected"; reason: "missing" | "invalid_format" | "oversized_header" | ValidationReason; kid: string | null };
    }
  | {
      kind: "403";
      headers: { "Content-Type": string; "WWW-Authenticate": string };
      body: { error: string; error_description: string };
      log: { evt: "auth.rejected"; reason: "insufficient_scope" };
    }
  | {
      kind: "500";
      headers: { "Content-Type": string };
      body: { error: string; error_description: string };
      log: { evt: "auth.config_missing" };
    };

function quotedParam(name: string, value: string): string {
  if (!QUOTED_RE.test(value)) {
    throw new Error(`BUG: WWW-Authenticate ${name} contains illegal chars: ${JSON.stringify(value)}`);
  }
  return `${name}="${value}"`;
}

function safeKid(h: unknown): string | null {
  return typeof h === "string" ? sanitizeForLog(h.slice(0, 64)) : null;
}

function build401(opts: {
  errorParam?: "invalid_token";
  description?: string;
  bodyError: string;
  bodyDesc: string;
}): Pick<Extract<DispatchResult, { kind: "401" }>, "headers" | "body"> {
  const parts = ['Bearer realm="cenogram"'];
  if (opts.errorParam) parts.push(`error="${opts.errorParam}"`);
  if (opts.description) parts.push(quotedParam("error_description", opts.description));
  parts.push(quotedParam("resource_metadata", RESOURCE_METADATA));
  return {
    headers: { "Content-Type": "application/json", "WWW-Authenticate": parts.join(", ") },
    body: { error: opts.bodyError, error_description: opts.bodyDesc },
  };
}

function build403(scope: string, description: string): Pick<Extract<DispatchResult, { kind: "403" }>, "headers" | "body"> {
  const parts = [
    'Bearer realm="cenogram"',
    `error="insufficient_scope"`,
    quotedParam("scope", scope),
    quotedParam("error_description", description),
    quotedParam("resource_metadata", RESOURCE_METADATA),
  ];
  return {
    headers: { "Content-Type": "application/json", "WWW-Authenticate": parts.join(", ") },
    body: { error: "insufficient_scope", error_description: description },
  };
}

export type ValidateJwtFn = typeof validateOAuthJwt;

export async function dispatchAuth(
  authHeader: string | undefined,
  validateJwt: ValidateJwtFn = validateOAuthJwt,
): Promise<DispatchResult> {
  // RFC 6750 §3.1: oversized auth attempt → invalid_token (client tried auth, not missing).
  // 8192 B = below Node default http.maxHeaderSize (16KB), accommodates JWT with claims +
  // Bearer prefix (~700-1500 bytes for current claim set: sub, scope, grant_id, client_id).
  // Check before regex match to avoid ReDoS / memory on huge string.
  const MAX_AUTH_HEADER_BYTES = 8192;
  if (authHeader && Buffer.byteLength(authHeader, "utf-8") > MAX_AUTH_HEADER_BYTES) {
    return {
      kind: "401",
      ...build401({
        errorParam: "invalid_token",
        description: "Authorization header too large",
        bodyError: "invalid_token",
        bodyDesc: "Authorization header exceeds maximum size",
      }),
      log: { evt: "auth.rejected", reason: "oversized_header", kid: null },
    };
  }

  // Parse Bearer token (RFC 7235: BWS = SP/HTAB)
  const match = authHeader?.match(BEARER_RE);
  const rawToken = match?.[1]?.trim() ?? "";

  if (!rawToken) {
    return {
      kind: "401",
      ...build401({
        bodyError: "missing_token",
        bodyDesc: "Provide an OAuth access token or API key in Authorization: Bearer header.",
      }),
      log: { evt: "auth.rejected", reason: "missing", kid: null },
    };
  }

  // Fast path: API key (most common). Format validation delegated to upstream API.
  if (rawToken.startsWith("cngrm_")) {
    return {
      kind: "passthrough",
      apiKey: rawToken,
      log: { evt: "auth.passthrough", mode: "api_key", key_prefix: sanitizeForLog(rawToken.slice(0, 10)) },
    };
  }

  // OAuth JWT shape check - reject anything that doesn't look like a JWT before crypto ops
  if (!JWT_SHAPE_RE.test(rawToken)) {
    return {
      kind: "401",
      ...build401({
        errorParam: "invalid_token",
        description: "Token format not recognized",
        bodyError: "invalid_token",
        bodyDesc: "Expected OAuth JWT or Cenogram API key (cngrm_...)",
      }),
      log: { evt: "auth.rejected", reason: "invalid_format", kid: null },
    };
  }

  // Validate JWT
  let result;
  try {
    result = await validateJwt(rawToken);
  } catch (e) {
    if (e instanceof OAuthConfigError) {
      return {
        kind: "500",
        headers: { "Content-Type": "application/json" },
        body: { error: "server_misconfigured", error_description: "OAuth not configured on server" },
        log: { evt: "auth.config_missing" },
      };
    }
    throw e;
  }

  if (!result.ok) {
    // Extract kid from header for logging (best-effort, not on wire)
    let headerKid: string | null = null;
    try {
      const headerJson = JSON.parse(Buffer.from(rawToken.split(".")[0]!, "base64url").toString("utf-8")) as { kid?: unknown };
      headerKid = safeKid(headerJson.kid);
    } catch {
      // ignore - kid logging is best-effort
    }
    return {
      kind: "401",
      ...build401({
        errorParam: "invalid_token",
        description: REASON_DESC[result.reason],
        bodyError: "invalid_token",
        bodyDesc: REASON_DESC[result.reason],
      }),
      log: { evt: "auth.rejected", reason: result.reason, kid: headerKid },
    };
  }

  if (!result.claims.scope.split(" ").includes("mcp")) {
    return {
      kind: "403",
      ...build403("mcp", "Token does not include 'mcp' scope"),
      log: { evt: "auth.rejected", reason: "insufficient_scope" },
    };
  }

  return {
    kind: "passthrough",
    apiKey: encodeOAuthCtx(result.claims.sub, result.claims.grant_id),
    // Sanitize grant_id for log consistency with key_prefix/kid (defense in depth - JWT is signed but spec allows custom claims).
    log: { evt: "auth.passthrough", mode: "oauth", grant_id: sanitizeForLog(result.claims.grant_id) },
  };
}
