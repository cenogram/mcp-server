import { channelSrc } from "./transport-mode.js";

// SOH char (\x01) - must match OAUTH_CTX_PREFIX in api-client.ts
const OAUTH_CTX_PREFIX = "\x01";

export type AuthMode = "oauth" | "api_key" | "stdio_env" | "none";

export function getAuthMode(apiKey?: string): AuthMode {
  if (!apiKey) return "none";
  if (apiKey.startsWith(OAUTH_CTX_PREFIX)) return "oauth";
  if (apiKey.startsWith("cngrm_")) return "api_key";
  return "stdio_env";
}

// Public page that hands out an API key - reachable without an account, unlike /ustawienia.
// The `src` tag is built here rather than taken from the API's own signup_url, which carries a tag
// of its own. A function rather than a constant so the tag follows the active transport at call
// time instead of being pinned at import.
export function signupUrl(): string {
  return `https://cenogram.pl/api?src=${channelSrc()}`;
}

export interface ErrorBody {
  error?: string;
  message?: string;  // Fastify AJV validation errors: { statusCode, error: "Bad Request", message: "..." }
  currentBalance?: number;
  creditsRequired?: number;
  upgrade?: string;   // 402 trial_expired: where the caller's owner can lift the block
  successor?: string; // 410: path that replaced the retired one
}

/**
 * The API's own wording for this failure, when it has one.
 *
 * Convention across the API: `message` is human-readable, `error` is a code or category, so
 * `message` wins and `error` is the fallback. Three body shapes reach us:
 *   1. Custom reply.send: { error: "Maximum 5 districts allowed" } - only `error`
 *   2. Thrown plain obj via the global handler: { statusCode, message: "..." } - only `message`
 *   3. Fastify AJV: { statusCode, error: "FastifyError", message: "body/x ..." } - `error` is a class name
 * Anything longer than 500 chars is dropped rather than truncated - a half-sentence misleads.
 * Empty string means "the API said nothing usable", which every branch below treats as its cue
 * to fall back to its own text.
 */
function specificMessage(body: ErrorBody): string {
  const rawError = typeof body.error === "string" ? body.error.trim() : "";
  const rawMessage = typeof body.message === "string" ? body.message.trim() : "";
  const candidate = rawMessage || rawError;
  return candidate.length > 0 && candidate.length <= 500 ? candidate : "";
}

/** Lets a relayed sentence sit in front of another one without running into it. */
function sentence(text: string): string {
  return /[.!?]$/.test(text) ? text : `${text}.`;
}

/** Same guard as above for the auxiliary URL/path fields. */
function specificField(value: unknown): string {
  if (typeof value !== "string") return "";
  const trimmed = value.trim();
  return trimmed.length > 0 && trimmed.length <= 500 ? trimmed : "";
}

export function authErrorMessage(status: number, mode: AuthMode, body: ErrorBody = {}): string {
  const specific = specificMessage(body);

  switch (status) {
    case 401:
      if (mode === "oauth") {
        return "Connection to Cenogram expired or was revoked. In Claude open: Settings > Connectors > Cenogram, disconnect and reconnect.";
      }
      if (mode === "none") {
        // No key was configured at all, so this is not a broken account - it is a caller who has
        // not got one yet. Sending them to /ustawienia (behind a login) would be a dead end.
        return (
          `No Cenogram API key configured. Get a free key at ${signupUrl()}, ` +
          "then set it as the CENOGRAM_API_KEY environment variable of this MCP server."
        );
      }
      return "API key rejected. Check https://cenogram.pl/ustawienia#api-keys if it's still active.";

    case 402: {
      // The trial gate freezes an account rather than emptying it, so "insufficient credits"
      // (balance vs cost) describes the wrong problem - a balance of 300 with a cost of 1 still
      // fails. The API states that case itself; relay it instead of doing arithmetic on it.
      // Only `message` will do here: `specific` falls back to `error`, which in this branch is
      // the bare code "trial_expired" - relaying that would be worse than the wrong template.
      const explanation = specificField(body.message);
      if (body.error === "trial_expired" && explanation) {
        const upgrade = specificField(body.upgrade);
        return upgrade && !explanation.includes(upgrade) ? `${sentence(explanation)} (${upgrade})` : explanation;
      }
      const balance = body.currentBalance ?? 0;
      const required = body.creditsRequired ?? "?";
      if (mode === "oauth") {
        return `Insufficient credits (balance: ${balance}, query cost: ${required}). Top up: https://cenogram.pl/api?src=${channelSrc()}#cennik`;
      }
      return `Insufficient credits for key's account (balance: ${balance}, query cost: ${required}). Top up: https://cenogram.pl/api?src=${channelSrc()}#cennik`;
    }

    case 403:
      if (body.error === "email_not_verified") {
        return "Account email not verified. Check your inbox, click the activation link, then retry.";
      }
      // 403 covers unrelated causes - a rate-limit ban, the demo cap, a plan restriction - and
      // each of them ships its own explanation. Swallowing them left the caller guessing.
      return specific ? `Access denied: ${specific}` : "Access denied (HTTP 403).";

    case 503: {
      // Not always maintenance: also a disabled feature, a read-only failover, an unavailable
      // dataset. Keep the English frame (the API's own text may be Polish) but relay the reason.
      if (!specific) return "Cenogram temporarily unavailable. Try again shortly.";
      // Several of these bodies already end with their own "try again in a few minutes", in
      // Polish or English. Adding ours on top would put two retry hints in one sentence.
      const saysRetry = /try again|retry|spr[oó]buj ponownie/i.test(specific);
      return `Cenogram temporarily unavailable: ${sentence(specific)}${saysRetry ? "" : " Try again shortly."}`;
    }

    case 410: {
      // Permanent by definition - the one status where "try again shortly" is actively harmful,
      // because a retry loop can never succeed. Reaching it means this package is calling an
      // endpoint that no longer exists, so the fix is an upgrade, not a retry.
      const successor = specificField(body.successor);
      const reason = sentence(specific || "This endpoint has been retired.");
      const where = successor ? ` It was replaced by ${successor}.` : "";
      return `${reason}${where} This is permanent - retrying will not help. Update @cenogram/mcp-server to the latest version.`;
    }

    case 404:
      // 404 from this API is always an unknown resource (e.g. a location/county code that
      // does not exist), never a transient outage — so frame it as a client error the caller
      // should correct, not a "retry later". The API's message echoes only the caller's own
      // input, e.g. "Unknown location: X".
      return specific || "Not found (HTTP 404). Check the location name or TERYT code.";

    case 400:
    case 422:
      return specific ? `Invalid request: ${specific}` : `Invalid request (HTTP ${status}). Check parameters.`;

    default:
      return `Cenogram API unavailable (HTTP ${status}). Try again shortly.`;
  }
}
