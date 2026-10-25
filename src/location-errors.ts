import { ApiHttpError, type LocationItem } from "./api-client.js";
import { requiresCountyCode, terytArgForTool, type TerytTool } from "./teryt-calls.js";

// The API words a failed location= neutrally and points at REST paths this channel does not have.
// Here those paths become tool calls, and the units the API names get ready-to-run calls.

export type LocationErrorTool = Exclude<TerytTool, "search_transactions"> | "resolve_parcel";

export interface LocationErrorQuery {
  location?: string | undefined;
}

type FailedCall = Pick<ApiHttpError, "status" | "detail" | "hint" | "candidates">;

const LOOKUP_PATH_RE = /\/api(?:\/v1)?\/locations\?search=<fragment>/g;
const PARCELS_PATH_RE = /(?:GET )?\/api(?:\/v1)?\/parcels\?([^\s)]+)/g;
const UNKNOWN_LOCATION_RE = /^Unknown location: (.+?)(?:\. Look up .*)?$/s;

const CATALOG_TOOL: Partial<Record<LocationErrorTool, string>> = {
  get_rental_yield: "list_rental_yield_locations",
  get_price_spread: "list_price_spread_locations",
};

function sentence(text: string): string {
  return /[.!?]$/.test(text) ? text : `${text}.`;
}

function unknownName(detail: string, query: LocationErrorQuery): string | undefined {
  return UNKNOWN_LOCATION_RE.exec(detail)?.[1] ?? (query.location?.trim() || undefined);
}

function translatePaths(text: string, name: string | undefined): string {
  return text
    .replace(LOOKUP_PATH_RE, `list_locations(search=${name !== undefined ? JSON.stringify(name) : '"<name>"'})`)
    .replace(PARCELS_PATH_RE, (_m, qs: string) => {
      const args = qs.split("&").map((pair) => {
        const eq = pair.indexOf("=");
        return eq < 0 ? pair : `${pair.slice(0, eq)}="${pair.slice(eq + 1)}"`;
      });
      return `list_parcels_in_area(${args.join(", ")})`;
    });
}

function candidateLines(tool: LocationErrorTool, candidates: LocationItem[]): string[] {
  const lines: string[] = [];
  for (const c of candidates) {
    const typeSuffix = c.typeName ? ` (${c.typeName})` : "";
    const parentSuffix = c.parent_name ? `, ${c.parent_name}` : "";
    lines.push(`  ${c.code} - ${c.name}${typeSuffix}${parentSuffix}`);
    if (tool === "resolve_parcel") continue;
    const arg = terytArgForTool(tool, c, "municipality");
    if (arg) lines.push(`      ${tool}(teryt="${arg}")`);
  }
  return lines;
}

/** Tool-channel wording of a failed location= (400/404); null when the API's text needs no
 * rewriting and the caller keeps the message it has. */
export function formatLocationError(tool: LocationErrorTool, query: LocationErrorQuery, err: FailedCall): string | null {
  if ((err.status !== 400 && err.status !== 404) || !err.detail) return null;

  const terytTool = tool === "resolve_parcel" ? undefined : tool;
  const received = terytTool ? (err.candidates ?? []) : [];
  // A voivodeship code is no use to a tool that starts at county level.
  const usable = received.filter((c) => !(c.level === "voivodeship" && terytTool && requiresCountyCode(terytTool)));
  const name = unknownName(err.detail, query);
  const base = translatePaths(err.detail, name);
  // With candidates the generic "pass the code" hint is superseded by the ready calls below.
  const translatedHint = received.length === 0 && err.hint ? translatePaths(err.hint, name) : undefined;
  const hint = translatedHint && !base.includes(translatedHint) ? translatedHint : undefined;

  const rewritten = base !== err.detail || usable.length > 0 || (hint !== undefined && hint !== err.hint);
  if (!rewritten) return null;

  const first = err.status === 400 ? `Invalid request: ${base}` : base;
  const lines = [hint ? `${sentence(first)} ${hint}` : first];
  if (usable.length > 0) lines.push("Closest matches by name:", ...candidateLines(tool, usable));

  // Only an unknown name (404) needs the catalog; a 400 is an ambiguous name and the candidates are the way out.
  const catalog = CATALOG_TOOL[tool];
  if (catalog && err.status === 404) {
    const search = JSON.stringify(name ?? "<name>");
    lines.push(`${catalog}(search=${search}) lists the cities with data; a county or gmina teryt= also works.`);
  }
  return lines.join("\n");
}

/** Runs one API call and, on a 400/404 about the location, rethrows it worded for tool callers. */
export async function withLocationErrors<T>(
  tool: LocationErrorTool,
  query: LocationErrorQuery,
  fn: () => Promise<T>,
): Promise<T> {
  try {
    return await fn();
  } catch (error) {
    if (error instanceof ApiHttpError) {
      const text = formatLocationError(tool, query, error);
      if (text) {
        throw new ApiHttpError(text, {
          status: error.status,
          code: error.code,
          authMode: error.authMode,
          retryAfterSeconds: error.retryAfterSeconds,
          mode: error.mode,
          detail: error.detail,
          hint: error.hint,
          candidates: error.candidates,
        });
      }
    }
    throw error;
  }
}
