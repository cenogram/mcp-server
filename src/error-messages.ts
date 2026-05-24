// SOH char (\x01) - must match OAUTH_CTX_PREFIX in api-client.ts
const OAUTH_CTX_PREFIX = "\x01";

export type AuthMode = "oauth" | "api_key" | "stdio_env" | "none";

export function getAuthMode(apiKey?: string): AuthMode {
  if (!apiKey) return "none";
  if (apiKey.startsWith(OAUTH_CTX_PREFIX)) return "oauth";
  if (apiKey.startsWith("cngrm_")) return "api_key";
  return "stdio_env";
}

export interface ErrorBody {
  error?: string;
  currentBalance?: number;
  creditsRequired?: number;
}

export function authErrorMessage(status: number, mode: AuthMode, body: ErrorBody = {}): string {
  switch (status) {
    case 401:
      if (mode === "oauth") {
        return "Connection to Cenogram expired or was revoked. In Claude open: Settings > Connectors > Cenogram, disconnect and reconnect.";
      }
      return "API key rejected. Check https://cenogram.pl/api/keys if it's still active.";

    case 402: {
      const balance = body.currentBalance ?? 0;
      const required = body.creditsRequired ?? "?";
      if (mode === "oauth") {
        return `Insufficient credits (balance: ${balance}, query cost: ${required}). Top up: https://cenogram.pl/api#cennik`;
      }
      return `Insufficient credits for key's account (balance: ${balance}, query cost: ${required}). Top up: https://cenogram.pl/api#cennik`;
    }

    case 403:
      if (body.error === "email_not_verified") {
        return "Account email not verified. Check your inbox, click the activation link, then retry.";
      }
      return `Access denied (HTTP 403).`;

    case 503:
      return "Cenogram temporarily unavailable (maintenance mode). Try again shortly.";

    default:
      return `Cenogram API unavailable (HTTP ${status}). Try again shortly.`;
  }
}
