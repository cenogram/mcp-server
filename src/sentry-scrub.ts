const SENSITIVE_HEADERS = new Set([
  "authorization", "cookie", "x-internal-auth", "x-api-key",
]);

const API_KEY_PATTERN = /cngrm_[a-f0-9]+/g;

export function scrubHeaders(headers: Record<string, string>): Record<string, string> {
  const scrubbed: Record<string, string> = {};
  for (const [key, value] of Object.entries(headers)) {
    scrubbed[key] = SENSITIVE_HEADERS.has(key.toLowerCase()) ? "[Filtered]" : value;
  }
  return scrubbed;
}

export function scrubString(s: string): string {
  return s.replace(API_KEY_PATTERN, "[Filtered]");
}
