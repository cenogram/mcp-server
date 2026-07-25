import { describe, it, expect, beforeAll, afterAll, afterEach, vi } from "vitest";
import { spawn, type ChildProcess } from "node:child_process";
import { symlinkSync, unlinkSync, existsSync, readFileSync, readdirSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { createServer } from "node:net";
import { fetch } from "undici";
import { generateKeyPair, exportSPKI, SignJWT } from "jose";
import type { CryptoKey } from "jose";
import { createMcpServer, serverInstructions } from "../index.js";
import { signupUrl } from "../error-messages.js";
import { startStubApi, type StubApi } from "./fixtures/stub-api.js";

const __dirname = dirname(fileURLToPath(import.meta.url));
const distIndex = join(__dirname, "..", "..", "dist", "index.js");

// Ask the kernel for a genuinely-free port instead of guessing a random one
// (Math.random ranges collided under load → EADDRINUSE). The two HTTP describe
// blocks run sequentially within this single file (vitest doesn't parallelise
// describe blocks in one file, no .concurrent here), so the close→spawn window
// of one never overlaps the other → no TOCTOU within the run.
async function getFreePort(): Promise<number> {
  return new Promise((resolve, reject) => {
    const srv = createServer();
    srv.unref();
    srv.on("error", reject);
    srv.listen(0, "127.0.0.1", () => {
      const addr = srv.address();
      if (addr && typeof addr === "object") {
        const { port } = addr;
        srv.close(() => resolve(port));
      } else {
        srv.close(() => reject(new Error("could not acquire a free port")));
      }
    });
  });
}

// Kill a spawned server and WAIT for the OS to actually reap it, so the kernel
// releases the bound port before the next describe block binds. Guards against a
// process that already exited (exit event would never re-fire → hung promise) and
// caps the wait so a stuck process can't wedge the suite.
async function killAndWait(p: ChildProcess | undefined): Promise<void> {
  if (!p || p.killed || p.exitCode !== null || p.signalCode !== null) return;
  p.kill("SIGTERM");
  await Promise.race([
    new Promise<void>((r) => p.once("exit", () => r())),
    new Promise<void>((r) => setTimeout(r, 5000)),
  ]);
}

describe("createMcpServer", () => {
  it("returns server with correct name and version", () => {
    const server = createMcpServer("test-key");
    expect(server).toBeDefined();
    // Server is created without throwing
  });
});

// Every cenogram.pl link we hand a client carries a `?src=` tag that must match the active
// transport. Both transports serve the same source text, so a tag written as a literal is silently
// wrong for one of them - invisible at runtime, hence asserted here rather than described in a
// comment next to the link.
describe("channel attribution", () => {
  afterEach(() => {
    vi.unstubAllEnvs();
  });

  it("tags links as stdio when no HTTP transport is set", () => {
    expect(serverInstructions()).toContain("?src=mcpstdio");
    expect(signupUrl()).toContain("?src=mcpstdio");
  });

  it("tags links as hosted HTTP, with no stdio tag left behind", () => {
    vi.stubEnv("MCP_TRANSPORT", "http");
    const instructions = serverInstructions();
    expect(instructions).toContain("?src=mcphttp");
    expect(instructions).not.toContain("mcpstdio");
    expect(signupUrl()).toBe("https://cenogram.pl/api?src=mcphttp");
  });

  // The two tests above only cover the links they name, and the first version of this fix tagged
  // exactly those, and four other links to the same page kept going out untagged. So this one asks
  // the opposite question — find every cenogram.pl link in the package and demand a tag — because a
  // test that names the links it checks can only ever confirm the ones somebody already thought of.
  it("every cenogram.pl link handed to a client carries a channel tag", () => {
    // Nothing anyone lands on from a link we emit, so a tag would measure nothing:
    //   /ustawienia - behind a login, only ever shown to someone already registered
    //   apple-touch-icon.png - an asset in OAuth metadata, never navigated to
    // (The bare origin needs no exemption: the pattern below requires a path.)
    const EXEMPT = [/\/ustawienia\b/, /apple-touch-icon/];
    // Every source file, not a list of the ones that have a link today - a new file with a new
    // link is the case this test is for, and it would be the one case a fixed list misses.
    const srcDir = join(__dirname, "..");
    const sources = readdirSync(srcDir).filter((f) => f.endsWith(".ts"));

    const untagged: string[] = [];
    for (const file of sources) {
      const text = readFileSync(join(srcDir, file), "utf8");
      // Stops at whitespace, a quote or a backtick — i.e. at the end of the literal, so a URL
      // built from a `${...}` expression is captured with the expression intact.
      for (const [url] of text.matchAll(/https:\/\/cenogram\.pl\/[^\s"'`,)]+/g)) {
        if (EXEMPT.some((re) => re.test(url))) continue;
        if (!url.includes("src=")) untagged.push(`${file}: ${url}`);
      }
    }
    expect(untagged, `cenogram.pl links with no ?src= tag:\n${untagged.join("\n")}`).toEqual([]);
  });
});

const hasDistBuild = existsSync(distIndex);

describe.skipIf(!hasDistBuild)("stdio server via symlink (npx scenario)", () => {
  const symlinkPath = join(__dirname, "..", "..", ".test-symlink-bin");

  beforeAll(() => {
    if (existsSync(symlinkPath)) unlinkSync(symlinkPath);
    symlinkSync(distIndex, symlinkPath);
  });

  afterAll(() => {
    if (existsSync(symlinkPath)) unlinkSync(symlinkPath);
  });

  function spawnServer(entryPoint: string): {
    proc: ChildProcess;
    send: (msg: object) => void;
    readResponse: () => Promise<object>;
    kill: () => void;
  } {
    const proc = spawn(process.execPath, [entryPoint], {
      env: { ...process.env, CENOGRAM_API_KEY: "cngrm_test_key" },
      stdio: ["pipe", "pipe", "pipe"],
    });

    let buffer = "";

    const send = (msg: object) => {
      proc.stdin!.write(JSON.stringify(msg) + "\n");
    };

    const readResponse = () =>
      new Promise<object>((resolve, reject) => {
        const timeout = setTimeout(() => reject(new Error("Timeout waiting for server response")), 20000);
        proc.stdout!.on("data", (chunk: Buffer) => {
          buffer += chunk.toString();
          // MCP responses are newline-delimited JSON
          const lines = buffer.split("\n");
          for (const line of lines) {
            if (!line.trim()) continue;
            try {
              const parsed = JSON.parse(line) as object;
              clearTimeout(timeout);
              resolve(parsed);
              return;
            } catch { /* incomplete JSON, wait for more */ }
          }
        });
        proc.on("close", () => {
          clearTimeout(timeout);
          reject(new Error("Server exited before responding"));
        });
      });

    const kill = () => {
      proc.kill("SIGTERM");
    };

    return { proc, send, readResponse, kill };
  }

  it("responds to initialize when run directly", async () => {
    const { proc, send, readResponse } = spawnServer(distIndex);
    try {
      send({
        jsonrpc: "2.0",
        id: 1,
        method: "initialize",
        params: {
          protocolVersion: "2024-11-05",
          capabilities: {},
          clientInfo: { name: "test", version: "0.1.0" },
        },
      });
      const response = await readResponse() as Record<string, unknown>;
      const result = response.result as Record<string, unknown>;
      const serverInfo = result.serverInfo as Record<string, string>;
      expect(response.jsonrpc).toBe("2.0");
      expect(response.id).toBe(1);
      expect(serverInfo.name).toBe("cenogram-mcp-server");
    } finally {
      await killAndWait(proc);
    }
    // 30s timeout: spawn (node boot + dist load) under pre-push load (run_all.sh
    // oversubscribes cores with 6+ suites) can exceed the 5s default; must also clear
    // readResponse's internal 20s timeout (above) with a buffer. Mitigation, not a
    // contention fix (serialization = out of scope).
  }, 30000);

  it("responds to initialize when run via symlink (like npx)", async () => {
    const { proc, send, readResponse } = spawnServer(symlinkPath);
    try {
      send({
        jsonrpc: "2.0",
        id: 1,
        method: "initialize",
        params: {
          protocolVersion: "2024-11-05",
          capabilities: {},
          clientInfo: { name: "test", version: "0.1.0" },
        },
      });
      const response = await readResponse() as Record<string, unknown>;
      const result = response.result as Record<string, unknown>;
      const serverInfo = result.serverInfo as Record<string, string>;
      expect(response.jsonrpc).toBe("2.0");
      expect(response.id).toBe(1);
      expect(serverInfo.name).toBe("cenogram-mcp-server");
    } finally {
      await killAndWait(proc);
    }
  }, 30000); // see timeout note above (spawn under pre-push load > 5s, > internal 20s)

  it("exits with error when CENOGRAM_API_KEY is missing", async () => {
    const proc = spawn(process.execPath, [distIndex], {
      env: { ...process.env, CENOGRAM_API_KEY: "" },
      stdio: ["pipe", "pipe", "pipe"],
    });

    const exitCode = await new Promise<number | null>((resolve) => {
      proc.on("close", resolve);
    });

    expect(exitCode).toBe(1);
  }, 30000); // see timeout note above (process spawn under pre-push load > 5s default)
});

describe.skipIf(!hasDistBuild)("HTTP mode auth dispatch (E2E spawn)", () => {
  let proc: ChildProcess;
  let port: number;

  // 20s: node boot under pre-push load (6 suites oversubscribing 8 cores) can exceed
  // the old 5s. The loop polls /health (readiness, not a fixed sleep) so a fast boot
  // still returns immediately; the larger budget only matters when the box is thrashing.
  async function waitForPort(p: number, timeoutMs = 20000): Promise<void> {
    const deadline = Date.now() + timeoutMs;
    while (Date.now() < deadline) {
      try {
        const res = await fetch(`http://127.0.0.1:${p}/health`);
        if (res.ok) return;
      } catch {
        // not ready yet
      }
      await new Promise((r) => setTimeout(r, 50));
    }
    throw new Error(`Port ${p} not responding within ${timeoutMs}ms`);
  }

  beforeAll(async () => {
    port = await getFreePort();
    proc = spawn(process.execPath, [distIndex], {
      env: {
        ...process.env,
        MCP_TRANSPORT: "http",
        MCP_PORT: String(port),
        // Note: NODE_ENV not 'production' so OAUTH_JWT_KID etc. not strictly required.
        // Tests that hit JWT validation path will trigger OAuthConfigError → 500.
      },
      stdio: ["pipe", "pipe", "pipe"],
    });
    await waitForPort(port);
  }, 30_000);

  afterAll(async () => {
    await killAndWait(proc);
  });

  it("/health returns 200 ok", async () => {
    const res = await fetch(`http://127.0.0.1:${port}/health`);
    expect(res.status).toBe(200);
    expect(await res.text()).toBe("ok");
  });

  it("POST /mcp without auth returns 401 with RFC 6750-compliant WWW-Authenticate", async () => {
    const res = await fetch(`http://127.0.0.1:${port}/mcp`, { method: "POST" });
    expect(res.status).toBe(401);
    const wwwAuth = res.headers.get("www-authenticate") ?? "";
    expect(wwwAuth).toMatch(/^Bearer realm="cenogram"/);
    expect(wwwAuth).toContain("resource_metadata=");
    expect(wwwAuth).not.toContain("error="); // RFC 6750 §3.1: omit error= when no auth provided
    const body = await res.json() as { error: string };
    expect(body.error).toBe("missing_token");
  });

  it("POST /mcp with `Bearer foo` returns 401 invalid_token", async () => {
    const res = await fetch(`http://127.0.0.1:${port}/mcp`, {
      method: "POST",
      headers: { Authorization: "Bearer foo" },
    });
    expect(res.status).toBe(401);
    const wwwAuth = res.headers.get("www-authenticate") ?? "";
    expect(wwwAuth).toContain('error="invalid_token"');
    expect(wwwAuth).toContain('error_description="Token format not recognized"');
  });

  it("/.well-known/oauth-protected-resource returns RFC 9728 metadata", async () => {
    const res = await fetch(`http://127.0.0.1:${port}/.well-known/oauth-protected-resource`);
    expect(res.status).toBe(200);
    const body = await res.json() as { authorization_servers: string[]; resource: string };
    expect(body.resource).toBe("https://mcp.cenogram.pl");
    expect(body.authorization_servers).toContain("https://api.cenogram.pl");
  });
});

// ─── HTTP mode E2E with valid JWT + stub upstream API ───

describe.skipIf(!hasDistBuild)("HTTP mode E2E (JWT + stub upstream)", () => {
  let proc: ChildProcess;
  let port: number;
  let stub: StubApi;
  let privateKey: CryptoKey;
  const KID = "test-kid";
  let stderrBuf = "";

  // 20s: see the auth block's waitForPort — boot under pre-push CPU load.
  async function waitForPort(p: number, timeoutMs = 20000): Promise<void> {
    const deadline = Date.now() + timeoutMs;
    while (Date.now() < deadline) {
      try {
        const res = await fetch(`http://127.0.0.1:${p}/health`);
        if (res.ok) return;
      } catch { /* not ready yet */ }
      await new Promise((r) => setTimeout(r, 50));
    }
    throw new Error(`Port ${p} not responding within ${timeoutMs}ms`);
  }

  async function mintJwt(opts: { scope?: string; sub?: string; grant_id?: string } = {}): Promise<string> {
    return new SignJWT({
      scope: opts.scope ?? "mcp",
      grant_id: opts.grant_id ?? "test-grant",
      client_id: "test-client",
    })
      .setProtectedHeader({ alg: "RS256", kid: KID })
      .setSubject(opts.sub ?? "test-user")
      .setIssuer("https://api.cenogram.pl")
      .setAudience("https://mcp.cenogram.pl")
      .setIssuedAt()
      .setExpirationTime("1h")
      .sign(privateKey);
  }

  beforeAll(async () => {
    // 1. Generate ephemeral RSA keypair
    const kp = await generateKeyPair("RS256");
    privateKey = kp.privateKey;
    const pubKeyPem = await exportSPKI(kp.publicKey);

    // 2. Start stub upstream API
    stub = await startStubApi();

    // 3. Spawn MCP HTTP with OAuth + stub URL
    port = await getFreePort();
    proc = spawn(process.execPath, [distIndex], {
      env: {
        ...process.env,
        MCP_TRANSPORT: "http",
        MCP_PORT: String(port),
        OAUTH_JWT_KID: KID,
        OAUTH_JWT_PUBLIC_KEY: pubKeyPem,
        INTERNAL_AUTH_SECRET: "test-internal-secret",
        CENOGRAM_API_URL: `http://127.0.0.1:${stub.port}`,
      },
      stdio: ["pipe", "pipe", "pipe"],
    });
    proc.stderr?.on("data", (chunk: Buffer) => { stderrBuf += chunk.toString("utf-8"); });
    await waitForPort(port);
  }, 30_000);

  afterAll(async () => {
    await killAndWait(proc);
    if (stub) await stub.close();
  });

  // ── K5: happy path JWT initialize ──────────────────────────────

  it("POST /mcp with valid JWT returns 200 on initialize", async () => {
    const jwt = await mintJwt();
    const res = await fetch(`http://127.0.0.1:${port}/mcp`, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${jwt}`,
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
    // SSE response - contains JSON in `data:` line
    expect(text).toContain("cenogram-mcp-server");
  });

  // ── K6: per-context error mapping (it.each) ────────────────────

  type Scenario = {
    name: string;
    setScenario: () => void;
    auth: string | (() => Promise<string>);
    expectInText: string[];
  };

  const scenarios: Scenario[] = [
    {
      name: "402 api_key: balance + query cost EN",
      setScenario: () => stub.setScenarios({
        byBearerToken: { "cngrm_test_402": { status: 402, body: { error: "insufficient_credits", currentBalance: 0, creditsRequired: 10 } } },
      }),
      auth: "Bearer cngrm_test_402",
      expectInText: ["Insufficient credits", "balance: 0", "query cost: 10", "key's account"],
    },
    {
      name: "401 api_key: key rejected EN",
      setScenario: () => stub.setScenarios({
        byBearerToken: { "cngrm_test_401": { status: 401, body: { error: "invalid_api_key" } } },
      }),
      auth: "Bearer cngrm_test_401",
      expectInText: ["API key rejected"],
    },
    {
      name: "401 oauth: connector reconnect EN (matched via X-OAuth-User)",
      setScenario: () => stub.setScenarios({
        byOAuthUser: { "test-user": { status: 401, body: { error: "invalid_token" } } },
      }),
      auth: async () => `Bearer ${await mintJwt({ sub: "test-user" })}`,
      expectInText: ["Connection to Cenogram expired", "Connectors > Cenogram", "disconnect and reconnect"],
    },
    {
      // Body-less 503, so there is nothing to relay and the generic wording applies. It no
      // longer claims "maintenance": a 503 is just as often a disabled feature or a failover.
      name: "503: temporarily unavailable EN",
      setScenario: () => stub.setScenarios({
        byBearerToken: { "cngrm_test_503": { status: 503 } },
      }),
      auth: "Bearer cngrm_test_503",
      expectInText: ["unavailable", "Try again"],
    },
    {
      name: "403 email_not_verified: inbox check EN",
      setScenario: () => stub.setScenarios({
        byBearerToken: { "cngrm_test_403": { status: 403, body: { error: "email_not_verified" } } },
      }),
      auth: "Bearer cngrm_test_403",
      expectInText: ["Account email not verified", "Check your inbox"],
    },
  ];

  it.each(scenarios)("$name", async (scenario) => {
    scenario.setScenario();
    const auth = typeof scenario.auth === "function" ? await scenario.auth() : scenario.auth;
    const res = await fetch(`http://127.0.0.1:${port}/mcp`, {
      method: "POST",
      headers: {
        Authorization: auth,
        "Content-Type": "application/json",
        Accept: "application/json, text/event-stream",
      },
      body: JSON.stringify({
        jsonrpc: "2.0",
        id: 1,
        method: "tools/call",
        params: { name: "get_market_overview", arguments: {} },
      }),
    });
    // MCP transport returns 200 even for tool errors - error info is in body.result.isError
    expect(res.status).toBe(200);
    const text = await res.text();
    // SSE format: lines start with "data: <json>". Extract first data payload to verify isError.
    const dataLine = text.split("\n").find((l) => l.startsWith("data: "));
    expect(dataLine).toBeDefined();
    const payload = JSON.parse(dataLine!.slice(6)) as { result?: { isError?: boolean; content?: { text: string }[] } };
    expect(payload.result?.isError).toBe(true);
    const errorText = payload.result?.content?.[0]?.text ?? "";
    for (const fragment of scenario.expectInText) {
      expect(errorText).toContain(fragment);
    }
  });

  // ── K7: 403 insufficient_scope WWW-Authenticate ─────────────────

  it("POST /mcp with JWT lacking 'mcp' scope returns 403 insufficient_scope", async () => {
    const jwt = await mintJwt({ scope: "other" });
    const res = await fetch(`http://127.0.0.1:${port}/mcp`, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${jwt}`,
        "Content-Type": "application/json",
        Accept: "application/json, text/event-stream",
      },
      body: JSON.stringify({ jsonrpc: "2.0", id: 1, method: "initialize", params: {} }),
    });
    expect(res.status).toBe(403);
    const wwwAuth = res.headers.get("www-authenticate") ?? "";
    expect(wwwAuth).toContain('error="insufficient_scope"');
    expect(wwwAuth).toContain('scope="mcp"');
    const body = await res.json() as { error: string };
    expect(body.error).toBe("insufficient_scope");
  });

  // Using node:http directly because fetch (undici) rejects non-Latin-1 chars in headers.
  // NEL byte (0x85) is in Latin-1 range - represents the single-byte attack vector.

  it("POST /mcp with cngrm_ key containing NEL byte: stderr logs sanitized", async () => {
    const http = await import("node:http");
    stub.setScenarios({
      byBearerToken: { "cngrm_\x85xxz": { status: 200, body: { ok: true } } },
    });
    const offset = stderrBuf.length;
    await new Promise<void>((resolve, reject) => {
      const req = http.request(
        {
          hostname: "127.0.0.1",
          port,
          path: "/mcp",
          method: "POST",
          headers: {
            Authorization: "Bearer cngrm_\x85xxz",
            "Content-Type": "application/json",
            Accept: "application/json, text/event-stream",
          },
        },
        (res) => {
          res.on("data", () => { /* drain body */ });
          res.on("end", () => resolve());
          res.on("error", reject);
        },
      );
      req.on("error", reject);
      req.write(JSON.stringify({ jsonrpc: "2.0", id: 1, method: "initialize", params: {} }));
      req.end();
    });
    await new Promise((r) => setTimeout(r, 200)); // settling time for stderr flush (200ms for CI stability)
    const newLogs = stderrBuf.slice(offset);
    expect(newLogs).toContain("\\u0085");
    // String-level check: U+0085 char must not appear unsanitized (byte-level
    // Buffer.includes(0x85) had false-positive risk on continuation bytes of unrelated codepoints).
    expect(newLogs.includes("\x85")).toBe(false);
  });
});
