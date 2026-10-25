// Optional-tools flag and the tools that stay usable at an empty balance. Lives apart from tools.ts so
// error messages and the credit footer can name the same set without importing the tool registry.

/** Whether tools outside the default set are registered. Read once, at registration time. */
export function experimentalToolsEnabled(): boolean {
  return process.env.CENOGRAM_EXPERIMENTAL_TOOLS === "1";
}

const BASE_FREE_TOOLS = ["list_locations", "search_parcels", "resolve_parcel"];
const EXPERIMENTAL_FREE_TOOLS = ["list_rental_yield_locations", "list_price_spread_locations", "list_flood_risk_locations"];

// Each of these calls a discovery route the server prices at 0, so an empty balance does not stop it.
// Add a tool here only after checking its route's price; the list is shown to users who ran out of tokens.
export function freeToolNames(): string[] {
  return experimentalToolsEnabled() ? [...BASE_FREE_TOOLS, ...EXPERIMENTAL_FREE_TOOLS] : [...BASE_FREE_TOOLS];
}
