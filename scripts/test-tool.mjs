#!/usr/bin/env node
// Driver: spawns local MCP server over stdio and calls a tool.
// Usage:
//   CENOGRAM_API_KEY=cngrm_xxx node scripts/test-tool.mjs <toolName> '<jsonArgs>'
//
// Optional:
//   CENOGRAM_API_URL=http://localhost:3001  (default https://cenogram.pl)
//   CENOGRAM_API_KEY=invalid_key            (to test 401 path)
//
// Prints JSON-RPC result (or error) to stdout, exits 0 on transport success
// (tool errors arrive as { isError: true, content: [...] } per MCP spec).

import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StdioClientTransport } from "@modelcontextprotocol/sdk/client/stdio.js";
import { fileURLToPath } from "node:url";
import { dirname, resolve } from "node:path";

const __dirname = dirname(fileURLToPath(import.meta.url));
const serverPath = resolve(__dirname, "..", "dist", "index.js");

const [toolName, argsJson] = process.argv.slice(2);
if (!toolName) {
  console.error("Usage: node scripts/test-tool.mjs <toolName> '<jsonArgs>'");
  process.exit(2);
}

let args = {};
if (argsJson) {
  try {
    args = JSON.parse(argsJson);
  } catch (e) {
    console.error("Bad JSON args:", e.message);
    process.exit(2);
  }
}

const transport = new StdioClientTransport({
  command: "node",
  args: [serverPath],
  env: { ...process.env },
});

const client = new Client(
  { name: "test-driver", version: "1.0.0" },
  { capabilities: {} },
);

try {
  await client.connect(transport);
  const result = await client.callTool({ name: toolName, arguments: args });
  console.log(JSON.stringify(result, null, 2));
  await client.close();
  process.exit(0);
} catch (err) {
  console.log(
    JSON.stringify(
      {
        _transportError: true,
        name: err?.name,
        message: err?.message,
        code: err?.code,
        data: err?.data,
      },
      null,
      2,
    ),
  );
  try {
    await client.close();
  } catch {}
  process.exit(0);
}
