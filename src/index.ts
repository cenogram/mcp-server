#!/usr/bin/env node
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";
import { readFileSync, realpathSync } from "node:fs";
import { fetch } from "undici";
import { registerTools } from "./tools.js";
import { dispatchAuth, sanitizeForLog } from "./auth-dispatch.js";
import { requestContext } from "./request-context.js";

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

export function createMcpServer(apiKey?: string): McpServer {
  const server = new McpServer(
    { name: "cenogram-mcp-server", version: PKG_VERSION },
    {
      instructions: [
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
        "- Compare locations: list_locations → compare_locations (2-5 districts, requires at least one filter e.g. propertyType)",
        "- Parcel lookup: search_parcels(q, min 3 chars) → search_by_area (use returned lat/lng)",
        "- Address search: search_transactions(location, street, buildingNumber)",
        "- Radius search: search_by_area(lat, lng, radiusKm) - for geographic proximity",
        "- Polygon search: search_by_polygon - coordinates are [longitude, latitude], first=last point, max 500 vertices",
        "- TERYT drill-down: list_locations() → list_locations(parent=voivodeshipCode) → list_locations(parent=countyCode) → search_transactions(teryt=municipalityCode)",
        "",
        "Data notes:",
        "- price_per_m2 only meaningful for apartments (propertyType=\"unit\")",
        "- API has no rooms filter - use area as proxy (1-room: 20-35m², 2: 35-55m², 3: 55-90m², 4+: 80-130m²), then post-filter by rooms field in results",
        "- Results paginated (default 10-20). Use page parameter for more.",
        "- For §79-compliant export table or interactive map - direct user to cenogram.pl",
      ].join("\n"),
    },
  );
  registerTools(server, apiKey);
  return server;
}

// ── Start ───────────────────────────────────────────────────────────

async function main() {
  const mode = process.argv.includes("--http") || process.env.MCP_TRANSPORT === "http" ? "http" : "stdio";

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
        } else if (pathname === "/.well-known/oauth-protected-resource") {
          res.writeHead(200, { "Content-Type": "application/json", "Cache-Control": "public, max-age=3600" }).end(
            JSON.stringify({
              resource: "https://mcp.cenogram.pl",
              authorization_servers: ["https://api.cenogram.pl"],
              scopes_supported: ["mcp"],
              bearer_methods_supported: ["header"],
            }),
          );
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
        "Get your free API key at https://cenogram.pl/api\n" +
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
  main().catch((err) => {
    process.stderr.write(`Fatal: ${String(err)}\n`);
    process.exit(1);
  });
}
