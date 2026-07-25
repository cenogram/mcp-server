/**
 * Which transport this process was started on. Single source of truth: the entry point picks
 * the transport from it, and the tool layer uses it to tell "you have not configured a key"
 * (stdio, an ordinary state) apart from "we lost the auth context" (HTTP, our bug).
 */
export function isHttpMode(): boolean {
  return process.argv.includes("--http") || process.env.MCP_TRANSPORT === "http";
}

/**
 * The `src` tag appended to cenogram.pl links handed to a client: `mcphttp` in HTTP mode,
 * `mcpstdio` otherwise. A function rather than a constant so the value follows the active
 * transport at call time — both transports serve the same source text, so a tag written as a
 * literal is silently wrong for one of them.
 */
export function channelSrc(): string {
  return isHttpMode() ? "mcphttp" : "mcpstdio";
}
