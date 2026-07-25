import { decodeProtectedHeader, importSPKI, jwtVerify, errors as joseErrors } from "jose";
import type { CryptoKey } from "jose";

export const MCP_AUDIENCE = "https://mcp.cenogram.pl";
const ISSUER = "https://api.cenogram.pl";

export interface OAuthJwtClaims {
  sub: string;
  scope: string;
  grant_id: string;
  client_id: string;
}

export type ValidationReason = "expired" | "unknown_key" | "invalid";

export type ValidationResult =
  | { ok: true; claims: OAuthJwtClaims }
  | { ok: false; reason: ValidationReason };

export class OAuthConfigError extends Error {
  constructor(message = "OAuth not configured: OAUTH_JWT_KID and OAUTH_JWT_PUBLIC_KEY required") {
    super(message);
    this.name = "OAuthConfigError";
  }
}

let cachedKey: CryptoKey | null = null;
let cachedKid: string | undefined;

async function getKeyPair(): Promise<{ key: CryptoKey; kid: string }> {
  const kid = process.env.OAUTH_JWT_KID;
  const pem = (process.env.OAUTH_JWT_PUBLIC_KEY ?? "").replace(/\\+n/g, "\n");
  if (!kid || !pem) throw new OAuthConfigError();
  if (cachedKey && cachedKid === kid) return { key: cachedKey, kid };
  cachedKey = await importSPKI(pem, "RS256");
  cachedKid = kid;
  return { key: cachedKey, kid };
}

// kid check BEFORE signature verify - rejects unknown kid without expensive crypto op
export async function validateOAuthJwt(token: string): Promise<ValidationResult> {
  // Config errors propagate (caller maps to 500). Token errors return reason.
  const pair = await getKeyPair();

  let header;
  try {
    header = decodeProtectedHeader(token);
  } catch {
    return { ok: false, reason: "invalid" };
  }

  if (!header.kid || header.kid !== pair.kid) {
    return { ok: false, reason: "unknown_key" };
  }

  let payload;
  try {
    ({ payload } = await jwtVerify(token, pair.key, {
      algorithms: ["RS256"],
      issuer: ISSUER,
      audience: MCP_AUDIENCE,
    }));
  } catch (e) {
    if (e instanceof joseErrors.JWTExpired) return { ok: false, reason: "expired" };
    return { ok: false, reason: "invalid" };
  }

  if (
    typeof payload.sub !== "string" ||
    typeof payload.scope !== "string" ||
    typeof payload.grant_id !== "string" ||
    typeof payload.client_id !== "string"
  ) {
    return { ok: false, reason: "invalid" };
  }

  return {
    ok: true,
    claims: {
      sub: payload.sub,
      scope: payload.scope,
      grant_id: payload.grant_id,
      client_id: payload.client_id,
    },
  };
}
