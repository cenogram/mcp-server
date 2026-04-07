import { readFileSync, writeFileSync, mkdirSync } from "node:fs";
import { join } from "node:path";
import { homedir } from "node:os";
import { randomUUID } from "node:crypto";

const CONFIG_DIR = join(homedir(), ".config", "cenogram");
const CLIENT_ID_FILE = join(CONFIG_DIR, "client-id");

let cachedId: string | null = null;

export function getClientId(): string {
  if (cachedId) return cachedId;

  // Allow override via env var
  if (process.env.CENOGRAM_CLIENT_ID?.trim()) {
    cachedId = process.env.CENOGRAM_CLIENT_ID.trim();
    return cachedId;
  }

  // Try reading persisted ID
  try {
    const stored = readFileSync(CLIENT_ID_FILE, "utf-8").trim();
    if (/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/.test(stored)) {
      cachedId = stored;
      return stored;
    }
  } catch {
    // File doesn't exist or isn't readable - generate new
  }

  // Generate and persist
  const id = randomUUID();
  try {
    mkdirSync(CONFIG_DIR, { recursive: true });
    writeFileSync(CLIENT_ID_FILE, id + "\n", { mode: 0o600 });
  } catch {
    // Read-only fs (Docker, sandbox) - use ephemeral ID
  }

  cachedId = id;
  return id;
}
