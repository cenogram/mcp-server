import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { createServer, type Server } from "node:http";
import type { AddressInfo } from "node:net";
import { fetch } from "undici";
import { handleHttpRequest } from "../index.js";

// Drives the exported handler through a real in-process HTTP server (real request/response
// streams, no child process, no dist build) so the streamable transport path is exercised the
// same way it is in production. An API key (cngrm_) passes auth without any OAuth env.
let server: Server;
let baseUrl: string;
const API_KEY = `cngrm_${"a".repeat(32)}`;

beforeAll(async () => {
  server = createServer((req, res) => {
    handleHttpRequest(req, res).catch((err) => {
      process.stderr.write(`test handler error: ${String(err)}\n`);
    });
  });
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  const { port } = server.address() as AddressInfo;
  baseUrl = `http://127.0.0.1:${port}`;
});

afterAll(async () => {
  await new Promise<void>((resolve) => server.close(() => resolve()));
});

describe("handleHttpRequest /mcp GET guard", () => {
  it("returns 405 listing the served methods in Allow, with a JSON-RPC body and no SSE stream", async () => {
    const res = await fetch(`${baseUrl}/mcp`, {
      method: "GET",
      headers: { Authorization: `Bearer ${API_KEY}`, Accept: "text/event-stream" },
    });
    expect(res.status).toBe(405);
    expect(res.headers.get("allow")).toBe("POST, DELETE");
    const contentType = res.headers.get("content-type") ?? "";
    expect(contentType).toContain("application/json");
    // No standalone stream was opened: the response is a plain JSON body, not an SSE stream.
    expect(contentType).not.toContain("text/event-stream");
    const body = (await res.json()) as { jsonrpc: string; id: unknown; error: { code: number } };
    expect(body.jsonrpc).toBe("2.0");
    expect(body.id).toBeNull();
    expect(body.error.code).toBe(-32000);
  });

  it("still returns 401 for GET without a bearer token (auth not relaxed)", async () => {
    const res = await fetch(`${baseUrl}/mcp`, { method: "GET" });
    expect(res.status).toBe(401);
    const wwwAuth = res.headers.get("www-authenticate") ?? "";
    expect(wwwAuth).toMatch(/^Bearer realm="cenogram"/);
    const body = (await res.json()) as { error: string };
    expect(body.error).toBe("missing_token");
  });
});

describe("handleHttpRequest /mcp POST", () => {
  it("still reaches the transport path (initialize returns a JSON-RPC response)", async () => {
    const res = await fetch(`${baseUrl}/mcp`, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${API_KEY}`,
        "Content-Type": "application/json",
        Accept: "application/json, text/event-stream",
      },
      body: JSON.stringify({
        jsonrpc: "2.0",
        id: 1,
        method: "initialize",
        params: {
          protocolVersion: "2024-11-05",
          capabilities: {},
          clientInfo: { name: "test", version: "0.1.0" },
        },
      }),
    });
    expect(res.status).toBe(200);
    const text = await res.text();
    expect(text).toContain("cenogram-mcp-server");
  });
});

describe("handleHttpRequest untouched routes", () => {
  it("/health and /.well-known/oauth-protected-resource still answer as before", async () => {
    const health = await fetch(`${baseUrl}/health`);
    expect(health.status).toBe(200);
    expect(await health.text()).toBe("ok");

    const wellKnown = await fetch(`${baseUrl}/.well-known/oauth-protected-resource`);
    expect(wellKnown.status).toBe(200);
    const body = (await wellKnown.json()) as { resource: string; authorization_servers: string[] };
    expect(body.resource).toBe("https://mcp.cenogram.pl");
    expect(body.authorization_servers).toContain("https://api.cenogram.pl");
  });
});
