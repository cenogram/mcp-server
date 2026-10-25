import type { LocationItem } from "./api-client.js";

// One rule set for "which TERYT code does this tool accept for this unit", shared by the
// list_locations follow-up calls and by the candidates of a failed location=.
export type TerytTool =
  | "search_transactions"
  | "list_parcels_in_area"
  | "get_demographics"
  | "get_infrastructure_signals"
  | "get_flood_risk"
  | "get_rental_yield"
  | "get_price_spread";

type Unit = Pick<LocationItem, "code" | "level" | "typeName">;

// "skip": a tool that cannot take a precinct code gets no call. "municipality": it gets the first
// 6 digits of the code, i.e. the precinct's own gmina.
export type PrecinctFallback = "skip" | "municipality";

// Tools whose resolver rejects anything shorter than a county code.
const COUNTY_OR_FINER: ReadonlySet<TerytTool> = new Set([
  "get_infrastructure_signals",
  "get_flood_risk",
  "get_rental_yield",
  "get_price_spread",
]);

/** Whether a tool rejects a 2-digit voivodeship code. */
export function requiresCountyCode(tool: TerytTool): boolean {
  return COUNTY_OR_FINER.has(tool);
}

function municipalityPrefix(code: string): string | null {
  const m = /^(\d{6})_/.exec(code);
  return m ? m[1]! : null;
}

/** The value for `teryt=` of `tool` that addresses `unit`, or null when the tool has no such call. */
export function terytArgForTool(tool: TerytTool, unit: Unit, precinct: PrecinctFallback): string | null {
  const { code, level } = unit;
  switch (tool) {
    case "search_transactions":
    case "list_parcels_in_area":
      return code;
    case "get_demographics":
      if (level === "precinct") return precinct === "municipality" ? municipalityPrefix(code) : null;
      return code;
    case "get_infrastructure_signals":
    case "get_flood_risk":
    case "get_rental_yield":
    case "get_price_spread":
      // Yield and spread narrow a gmina code to its county (with a note), as flood risk does.
      if (level === "voivodeship") return null;
      if (level === "precinct") return precinct === "municipality" ? municipalityPrefix(code) : null;
      return code;
  }
}
