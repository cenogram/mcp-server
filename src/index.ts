#!/usr/bin/env node
import { Sentry } from "./sentry.js";
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";
import { readFileSync, realpathSync } from "node:fs";
import { fetch } from "undici";
import { registerTools, experimentalToolsEnabled } from "./tools.js";
import { dispatchAuth, sanitizeForLog } from "./auth-dispatch.js";
import { requestContext } from "./request-context.js";
import { signupUrl } from "./error-messages.js";
import { channelSrc, isHttpMode } from "./transport-mode.js";
import { FAVICON_ICO, FAVICON_SVG } from "./favicon.js";

function logAuth(payload: Record<string, unknown>, level: "info" | "warn" | "error"): void {
  process.stderr.write(JSON.stringify({ level, ...payload }) + "\n");
}

// ── Node version check ─────────────────────────────────────────────

const [nodeMajor] = process.versions.node.split(".").map(Number);
if (nodeMajor != null && nodeMajor < 18) {
  process.stderr.write(
    `Warning: @cenogram/mcp-server recommends Node.js >= 18 (current: ${process.version}). ` +
    "The server will try to run, but some features may not work.\n",
  );
}

// ── Version ────────────────────────────────────────────────────────

const __dirname = dirname(fileURLToPath(import.meta.url));
let PKG_VERSION = "0.1.0";
try {
  PKG_VERSION = (JSON.parse(readFileSync(join(__dirname, "..", "package.json"), "utf-8")) as { version: string }).version;
} catch { /* fallback to hardcoded if dist/ used standalone */ }

// ── Server factory ──────────────────────────────────────────────────

/**
 * What every client is told before it calls a tool.
 *
 * Built per call rather than held in a constant, because the `?src=` tags below follow the
 * transport. Exported so a test can read the text back — both transports share every line of it
 * except those tags, so a tag written as a literal is silently wrong for one of them.
 */
export function serverInstructions(): string {
  return [
    "Cenogram MCP Server - 8M+ verified real estate transactions from Poland's official RCN registry (Rejestr Cen Nieruchomości). Prices from notarial deeds - NOT asking/listing prices. Data from 2003 to present, 380 counties, refreshed every ~2 weeks.",
    "",
    "CRITICAL - Addressing a place (resolve the name to a code first):",
    "- list_locations(search=\"name\") returns a TERYT code for every match; pass it as search_transactions(teryt=code) - no name ambiguity. To browse instead, use list_locations(parent=code).",
    "- A match the result flags as an RCN district (and any match with no TERYT code) also accepts its name as search_transactions(location=name). Use location= only for a name a result handed you, never one you guessed.",
    "- 'Warszawa' auto-includes all 18 districts, 'Kraków'/'Łódź' all sub-districts (or name one: Mokotów, Kraków-Podgórze); most other cities need just the city name.",
    "- Neighborhoods/osiedla (Nowy Dwór, Oliwa, Jeżyce) are usually NOT TERYT districts: (a) an administrative unit or cadastral precinct → list_locations(search=name) returns its teryt; (b) a precinct name PLUS a parcel number → resolve_parcel(q=\"name number\") - it does not resolve a bare neighbourhood name; (c) a true neighbourhood outside TERYT → coordinates FROM THE USER (never invent them) → search_by_area (radiusKm 0.5-1.0), then refine with search_by_polygon.",
    "- Use location for quick city searches, teryt when exact administrative boundaries matter. A name that is unknown or shared by several units returns an error listing candidate units with their codes - pick one and pass it as teryt.",
    "",
    "Workflows:",
    "- Market analysis: get_market_overview → get_price_statistics(location) → search_transactions",
    // Only documented when those tools are actually registered.
    ...(experimentalToolsEnabled()
      ? [
          "- Rental yield: (experimental) list_rental_yield_locations → get_rental_yield(location|teryt) - gross yield from asking rent vs RCN prices. County level or a Warszawa district (6-digit teryt); a gmina name resolves to its county (shown in the answer), a name shared by gminas in several counties returns candidates.",
          "- Price spread: (experimental) list_price_spread_locations → get_price_spread(location|teryt) - asking-vs-transaction spread %; same coverage and name rule.",
          "- Flood exposure: (experimental) list_flood_risk_locations → get_flood_risk(location|teryt) - share of a county's transactions in a mapped flood zone, by severity. Absence of a zone is never 'safe'. Catalog first, or a county teryt.",
        ]
      : []),
    "- Compare locations: list_locations → compare_locations (2-5 districts, needs at least one filter e.g. propertyType); includeDemographics=true adds a GUS BDL block per district.",
    "- Local stats: get_demographics(location|teryt) - GUS BDL indicators (county level for city/county names, gmina level for gmina names or a 6/7-digit teryt).",
    "- Parcels: search_parcels(q, min 3 chars) / resolve_parcel(parcelId | q | lat+lng) / list_parcels_in_area (area: teryt, location, bbox, circle or polygon; street narrows it) → get_parcel_report(parcelId) for everything on the parcel, get_parcel_land_class for its soil class, or search_transactions(parcelId) for its sale history.",
    "- Value estimate: estimate_value (apartment) / estimate_land_value (building plot or farmland) at a point (lat+lng or parcelId) - an orientation estimate, not a certified appraisal.",
    "- Developer neighbourhood: resolve a point (resolve_parcel / search_parcels, or coordinates from the user, never guessed) → get_permits_in_area(lat, lng, radiusKm up to 2); issued decisions only, so a short or empty list is never proof that nothing is being built.",
    "- Per-transaction detail: search_transactions → get_building_breakdown or any get_transaction_* layer tool, with the transaction_id. Empty or null = nothing found in the reference data, never a guarantee.",
    "- Address search: search_transactions(location, street, buildingNumber). Radius: search_by_area. Polygon: search_by_polygon.",
    "",
    "Data notes:",
    "- Price aggregates are market-based: fractional shares (share_basis=\"fraction\") and non-market deeds (tenders, foreclosures, privileged/subsidized sales) are excluded; counts and coverage stay full. Search results flag fractional-share rows.",
    "- price_per_m2 is only meaningful for apartments (propertyType=\"unit\").",
    "- Field provenance (search tools): values are from the notarial deed (RCN) unless an inline [...] note flags a computed value or approximated street. A field absent from a result does NOT mean the deed omitted it: the county may not report it.",
    "- `rooms` counts RCN izby (a kitchen is one), so it runs higher than portal \"pokoje\"; `floor` is the unit's floor, NOT building storeys. Both: units only.",
    "- Rate limit: requests are limited per API key per minute, so parallel agents sharing one key share the same limit. On a \"Too many requests\" response, wait the number of seconds it gives and retry sequentially.",
    `- For a §79-compliant export table or interactive map, direct the user to https://cenogram.pl/ceny-transakcyjne?src=${channelSrc()}. Deep link to one transaction: the Permalink recipe in the search tool descriptions.`,
  ].join("\n");
}

export function createMcpServer(apiKey?: string): McpServer {
  const server = new McpServer(
    { name: "cenogram-mcp-server", version: PKG_VERSION },
    { instructions: serverInstructions() },
  );
  registerTools(server, apiKey);
  return server;
}

// ── HTTP request handler ────────────────────────────────────────────

/**
 * Single entry point for the hosted HTTP transport. Lives at module scope (rather than as a
 * closure inside main()) so it can be exercised directly by a test without spawning a process.
 */
export async function handleHttpRequest(req: import("node:http").IncomingMessage, res: import("node:http").ServerResponse) {
  try {
    const pathname = req.url?.split("?")[0];
    if (pathname === "/mcp") {
      const dispatch = await dispatchAuth(req.headers.authorization);

      if (dispatch.kind === "passthrough") {
        logAuth(dispatch.log, "info");
      } else if (dispatch.kind === "500") {
        logAuth(dispatch.log, "error");
        res.writeHead(500, dispatch.headers).end(JSON.stringify(dispatch.body));
        return;
      } else {
        const level = dispatch.kind === "401" && dispatch.log.reason === "missing" ? "info" : "warn";
        const clientIp = (req.headers["cf-connecting-ip"] ?? req.headers["x-forwarded-for"] ?? req.socket.remoteAddress ?? "") as string;
        logAuth({
          ...dispatch.log,
          method: req.method,
          ua: sanitizeForLog((req.headers["user-agent"] ?? "").slice(0, 128)),
          ip: sanitizeForLog(clientIp.split(",")[0]!.trim().slice(0, 45)),
        }, level);
        const status = dispatch.kind === "401" ? 401 : 403;
        res.writeHead(status, dispatch.headers).end(JSON.stringify(dispatch.body));
        return;
      }

      // Authenticated GET on /mcp asks for the standalone server-to-client SSE stream. This
      // server runs stateless (no session id, no event store) and never sends server-initiated
      // notifications, so that stream has nothing to emit: it would just park a connection that
      // an upstream edge eventually severs. The MCP spec allows a server that offers no
      // server-to-client stream to answer GET with 405, so reject here before building any
      // McpServer or transport. The body is deliberately kept identical to the SDK's
      // handleUnsupportedRequest (JSON-RPC error, code -32000, id null) so a future reader does
      // not "fix" it into a different shape. Allow lists every method this endpoint still serves
      // (RFC 9110 section 15.5.6): POST carries every call, and DELETE stays with the transport.
      if (req.method === "GET") {
        res.writeHead(405, { Allow: "POST, DELETE", "Content-Type": "application/json" }).end(
          JSON.stringify({ jsonrpc: "2.0", error: { code: -32000, message: "Method not allowed." }, id: null }),
        );
        return;
      }

      const { StreamableHTTPServerTransport } = await import("@modelcontextprotocol/sdk/server/streamableHttp.js");
      const clientUA = ((req.headers["user-agent"] ?? "") as string).slice(0, 512) || undefined;
      await requestContext.run({ clientUserAgent: clientUA }, async () => {
        const transport = new StreamableHTTPServerTransport({ sessionIdGenerator: undefined });
        const mcpServer = createMcpServer(dispatch.apiKey);
        try {
          await mcpServer.connect(transport);
          await transport.handleRequest(req, res);
        } finally {
          await transport.close();
          await mcpServer.close();
        }
      });
    } else if (pathname === "/.well-known/oauth-protected-resource" || pathname === "/.well-known/oauth-protected-resource/mcp") {
      // RFC 9728 defines BOTH shapes: the bare document for a resource whose identifier is the
      // origin, and the path-aware one derived from an identifier that carries a path. Clients
      // that skip WWW-Authenticate and guess the URL from the endpoint they are calling look for
      // the second one. Each document echoes the identifier its own URL was derived from - a
      // client verifies that field against the resource it thinks it is talking to, so serving
      // the origin under the path-aware URL would make strict clients abort instead of fall back.
      // Both identifiers land on the same audience: /oauth/authorize canonicalizes `resource`
      // down to the origin, so the issued token's `aud` is the origin either way.
      const resource = pathname.endsWith("/mcp") ? "https://mcp.cenogram.pl/mcp" : "https://mcp.cenogram.pl";
      res.writeHead(200, { "Content-Type": "application/json", "Cache-Control": "public, max-age=3600" }).end(
        JSON.stringify({
          resource,
          authorization_servers: ["https://api.cenogram.pl"],
          scopes_supported: ["mcp"],
          bearer_methods_supported: ["header"],
        }),
      );
    } else if (pathname === "/.well-known/glama.json") {
      // Directory ownership proof: the file must live on the server's own domain, so it cannot
      // ship in the repo like the sibling server-level claim. The address comes from the
      // environment because this file is published verbatim to npm and a public repo - no
      // personal address in public source. Unset (stdio users, dev) → 404, not an empty claim.
      const maintainer = process.env.GLAMA_MAINTAINER_EMAIL;
      if (!maintainer) {
        res.writeHead(404, { "Content-Type": "application/json" }).end(JSON.stringify({ error: "not_found" }));
      } else {
        res.writeHead(200, { "Content-Type": "application/json", "Cache-Control": "public, max-age=3600" }).end(
          JSON.stringify({
            $schema: "https://glama.ai/mcp/schemas/connector.json",
            maintainers: [{ email: maintainer }],
          }),
        );
      }
    } else if (pathname === "/.well-known/mcp.json") {
      res.writeHead(200, { "Content-Type": "application/json", "Access-Control-Allow-Origin": "*", "Cache-Control": "public, max-age=3600" }).end(
        JSON.stringify({
          name: "Cenogram",
          description: "8M+ verified real estate transactions from Poland's official RCN registry. Transaction prices from notarial deeds, 380 counties, data from 2003.",
          icon: "https://cenogram.pl/apple-touch-icon.png",
          endpoint: "https://mcp.cenogram.pl/mcp",
        }),
      );
    } else if (pathname === "/health") {
      res.writeHead(200, { "Content-Type": "text/plain" }).end("ok");
    } else if (pathname === "/health/deep") {
      const apiUrl = process.env.CENOGRAM_API_URL || "https://cenogram.pl";
      const controller = new AbortController();
      const timeout = setTimeout(() => controller.abort(), 3_000);
      let apiStatus: "ok" | "fail" = "fail";
      let apiError: string | undefined;
      try {
        const apiRes = await fetch(`${apiUrl}/api/health`, { signal: controller.signal });
        if (apiRes.ok) {
          apiStatus = "ok";
        } else {
          apiError = `HTTP ${apiRes.status}`;
        }
      } catch (err) {
        apiError = err instanceof Error ? err.message : String(err);
      } finally {
        clearTimeout(timeout);
      }
      const code = apiStatus === "ok" ? 200 : 503;
      res.writeHead(code, { "Content-Type": "application/json" }).end(
        JSON.stringify({
          status: apiStatus === "ok" ? "ok" : "degraded",
          dependencies: { api: apiStatus, ...(apiError ? { apiError } : {}) },
          apiUrl,
        }),
      );
    } else if (pathname === "/favicon.ico") {
      res.writeHead(200, { "Content-Type": "image/x-icon", "Cache-Control": "public, max-age=86400" }).end(FAVICON_ICO);
    } else if (pathname === "/favicon.svg") {
      res.writeHead(200, { "Content-Type": "image/svg+xml", "Cache-Control": "public, max-age=86400" }).end(FAVICON_SVG);
    } else if (pathname === "/robots.txt") {
      res.writeHead(200, { "Content-Type": "text/plain", "Cache-Control": "public, max-age=86400" }).end(
        "User-agent: *\nDisallow: /\n",
      );
    } else {
      res.writeHead(404).end();
    }
  } catch (err) {
    Sentry.captureException(err, { tags: { error_layer: "http_handler" } });
    process.stderr.write(`HTTP error: ${String(err)}\n`);
    if (!res.headersSent) {
      res.writeHead(500, { "Content-Type": "application/json" }).end(
        JSON.stringify({ jsonrpc: "2.0", error: { code: -32603, message: "Internal server error" }, id: null }),
      );
    }
  }
}

// ── Start ───────────────────────────────────────────────────────────

async function main() {
  const mode = isHttpMode() ? "http" : "stdio";

  if (mode === "http") {
    const { createServer } = await import("node:http");

    if (process.env.NODE_ENV === "production") {
      if (!process.env.OAUTH_JWT_KID) throw new Error("OAUTH_JWT_KID required in production");
      if (!process.env.OAUTH_JWT_PUBLIC_KEY) throw new Error("OAUTH_JWT_PUBLIC_KEY required in production");
      if (!process.env.INTERNAL_AUTH_SECRET) throw new Error("INTERNAL_AUTH_SECRET required in production");
    }

    const port = parseInt(process.env.MCP_PORT || "3002", 10);
    createServer((req, res) => {
      handleHttpRequest(req, res).catch((err) => {
        process.stderr.write(`Unhandled HTTP error: ${String(err)}\n`);
      });
    }).listen(port, "0.0.0.0", () => {
      process.stderr.write(`MCP HTTP server on http://0.0.0.0:${port}/mcp\n`);
    });
  } else {
    if (!process.env.CENOGRAM_API_KEY) {
      process.stderr.write(
        "Error: CENOGRAM_API_KEY is required.\n" +
        `Get your free API key at ${signupUrl()}\n` +
        "Then add it to your MCP config:\n" +
        '  "env": { "CENOGRAM_API_KEY": "cngrm_..." }\n',
      );
      process.exit(1);
    }
    const mcpServer = createMcpServer(process.env.CENOGRAM_API_KEY);
    await mcpServer.connect(new StdioServerTransport());
  }
}

if (process.argv[1] && realpathSync(process.argv[1]) === fileURLToPath(import.meta.url)) {
  process.on("SIGTERM", () => {
    void Sentry.flush(2000).then(() => process.exit(0));
  });

  main().catch(async (err) => {
    Sentry.captureException(err, { tags: { error_layer: "fatal" } });
    await Sentry.flush(2000);
    process.stderr.write(`Fatal: ${String(err)}\n`);
    process.exit(1);
  });
}
