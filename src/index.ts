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
    "Cenogram MCP Server - 8M+ verified real estate transactions from Poland's official RCN registry (Rejestr Cen Nieruchomości). Transaction prices from notarial deeds - NOT asking/listing prices. Data from 2003 to present, 380 counties, refreshed every ~2 weeks.",
    "",
    "CRITICAL - District names (ALWAYS verify first):",
    "- NEVER guess district names. Call list_locations(search=\"city\") first.",
    "- Warsaw: 'Warszawa' auto-includes all 18 districts. Or use specific: Mokotów, Wola, Śródmieście",
    "- Kraków/Łódź: 'Kraków'/'Łódź' auto-include all sub-districts. Or use specific: Kraków-Podgórze, etc.",
    "- Most cities (Gdańsk, Gdynia, Sopot, Poznań, Wrocław): just the city name, no sub-districts",
    "- Neighborhoods/osiedla (Nowy Dwór, Oliwa, Jeżyce) are NOT TERYT districts. Start with search_by_area (radiusKm 0.5-1.0), then refine with search_by_polygon if needed.",
    "- TERYT hierarchy: For precise administrative filtering (avoids name ambiguity), use list_locations(parent) to browse TERYT codes, then search_transactions(teryt=code).",
    "- Use 'location' for quick city searches, 'teryt' when you need exact administrative boundaries.",
    "",
    "Workflows:",
    "- Market analysis: get_market_overview → get_price_statistics(location) → search_transactions",
    // Only documented when those tools are actually registered.
    ...(experimentalToolsEnabled()
      ? [
          "- Rental yield: (experimental - may change/withdraw) list_rental_yield_locations (catalog of covered cities) → get_rental_yield(location|teryt) - indicative gross yield from asking rent vs RCN transaction prices. County level only (miasta na prawach powiatu), or Warszawa district via 6-digit teryt. For any name that is not a major city you know is covered, call the catalog FIRST or pass a county teryt - towns inside a larger powiat and non-Warszawa districts 404.",
          "- Price spread: (experimental - may change/withdraw) list_price_spread_locations (catalog of covered cities) → get_price_spread(location|teryt) - asking-vs-transaction price spread %, marketType all|secondary|primary. County level only (miasta na prawach powiatu), or Warszawa district via 6-digit teryt. For any name that is not a major city you know is covered, call the catalog FIRST or pass a county teryt - towns inside a larger powiat and non-Warszawa districts 404.",
        ]
      : []),
    "- Compare locations: list_locations → compare_locations (2-5 districts, requires at least one filter e.g. propertyType). Add includeDemographics=true for a GUS BDL block per district.",
    "- Demographics & local stats: get_demographics(location|teryt) — GUS BDL indicators (population, economy, housing, planning, safety, education, prices). A city name resolves to county level; pass a 6/7-digit teryt for gmina-level detail.",
    "- Parcel lookup: search_parcels(q, min 3 chars) → search_by_area (use returned lat/lng)",
    "- Parcel resolve: resolve_parcel(parcelId | q | lat+lng) — turn a full parcel id, a UUID, a 'locality name + parcel number', or a coordinate into a concrete parcel; feed the returned id to search_transactions(parcelId) for its sale history.",
    "- Per-building detail: search_transactions → get_building_breakdown(transaction_id) — footprint, storeys, est. total floor area per building (searches return per-transaction sums inline)",
    "- Surroundings (nearby nuisances): search_transactions → get_transaction_surroundings(transaction_id) — per-plot distance to the nearest cemetery, landfill, sewage treatment plant, industrial/storage area, large industrial plant, and intensive livestock farm. A null distance = nothing within the search radius in reference data, never a guarantee.",
    "- Address search: search_transactions(location, street, buildingNumber)",
    "- Radius search: search_by_area(lat, lng, radiusKm) - for geographic proximity",
    "- Polygon search: search_by_polygon - coordinates are [longitude, latitude], first=last point, max 500 vertices",
    "- TERYT drill-down: list_locations() → list_locations(parent=voivodeshipCode) → list_locations(parent=countyCode) → search_transactions(teryt=municipalityCode)",
    "",
    "Data notes:",
    "- Median/average prices are market-based: fractional ownership shares (share_basis=\"fraction\") and non-market deeds (public tenders, foreclosures, privileged/subsidized sales) are excluded from price aggregates. Transaction counts and coverage stay full. search_transactions/search_by_area flag fractional-share rows so you can spot which comparables are partial.",
    "- price_per_m2 only meaningful for apartments (propertyType=\"unit\")",
    "- Field provenance (search_transactions/search_by_area/search_by_polygon): per-record values are from the notarial deed (RCN) by default and carry no marker. Values we computed (parcel area summed across plots or converted from hectares; an inferred or reclassified property type) and approximated streets are flagged inline with a neutral [...] note — mirroring the \"Z RCN / Obliczone / Uzupełnione\" tiers on cenogram.pl. A field being absent from a result does NOT mean the deed omitted it: the county may simply not report that field.",
    "- Rooms (izby) filter: search_transactions/search_by_area/search_by_polygon/compare_locations accept `rooms` (array, e.g. [\"2\",\"3\"]; \"8plus\" = 8 or more). Units only (propertyType=\"unit\"); rows with no room count are excluded. NOTE: RCN counts izby (chambers - a kitchen counts as one izba), so values run higher than portal \"pokoje\" listings.",
    "- Floor (piętro) filter: the same tools accept `floor` (array, e.g. [\"0\",\"1\",\"2\"]; \"0\" = ground/parter, negatives = basement, \"10plus\" = 10 or more, \"0plus\" = ground and above, \"unknown\" = no floor recorded). Units only; this is the unit's floor, NOT the number of building storeys. Rows with no floor are excluded unless \"unknown\" is included.",
    "- Results paginated (default 10-20). Use page parameter for more.",
    `- For §79-compliant export table or interactive map - direct user to https://cenogram.pl/ceny-transakcyjne?src=${channelSrc()}`,
    `- Deep link / permalink to the map: from a transaction's \`id\` and its \`Location: <A>°N, <B>°E\` line, build https://cenogram.pl/ceny-transakcyjne?src=${channelSrc()}#v=1&lat=<A>&lng=<B>&z=16&tx=<id> (drop the °N/°E; lat = the °N number, lng = the °E number) — opens that exact transaction on the map. Omit &tx=<id> for a link centered on the area without a specific row open.`,
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

// ── Start ───────────────────────────────────────────────────────────

async function main() {
  const mode = isHttpMode() ? "http" : "stdio";

  if (mode === "http") {
    const { createServer } = await import("node:http");
    const { StreamableHTTPServerTransport } = await import("@modelcontextprotocol/sdk/server/streamableHttp.js");

    if (process.env.NODE_ENV === "production") {
      if (!process.env.OAUTH_JWT_KID) throw new Error("OAUTH_JWT_KID required in production");
      if (!process.env.OAUTH_JWT_PUBLIC_KEY) throw new Error("OAUTH_JWT_PUBLIC_KEY required in production");
      if (!process.env.INTERNAL_AUTH_SECRET) throw new Error("INTERNAL_AUTH_SECRET required in production");
    }

    const port = parseInt(process.env.MCP_PORT || "3002", 10);
    const handleHttpRequest = async (req: import("node:http").IncomingMessage, res: import("node:http").ServerResponse) => {
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
    };

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
