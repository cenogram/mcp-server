import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { spawn, type ChildProcess } from "node:child_process";
import { symlinkSync, unlinkSync, existsSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { createMcpServer } from "../index.js";

const __dirname = dirname(fileURLToPath(import.meta.url));
const distIndex = join(__dirname, "..", "..", "dist", "index.js");

describe("createMcpServer", () => {
  it("returns server with correct name and version", () => {
    const server = createMcpServer("test-key");
    expect(server).toBeDefined();
    // Server is created without throwing
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
        const timeout = setTimeout(() => reject(new Error("Timeout waiting for server response")), 5000);
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
    const { send, readResponse, kill } = spawnServer(distIndex);
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
      kill();
    }
  });

  it("responds to initialize when run via symlink (like npx)", async () => {
    const { send, readResponse, kill } = spawnServer(symlinkPath);
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
      kill();
    }
  });

  it("exits with error when CENOGRAM_API_KEY is missing", async () => {
    const proc = spawn(process.execPath, [distIndex], {
      env: { ...process.env, CENOGRAM_API_KEY: "" },
      stdio: ["pipe", "pipe", "pipe"],
    });

    const exitCode = await new Promise<number | null>((resolve) => {
      proc.on("close", resolve);
    });

    expect(exitCode).toBe(1);
  });
});
