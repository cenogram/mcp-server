import { describe, it, expect, vi, beforeEach } from "vitest";

vi.mock("node:fs", () => ({
  readFileSync: vi.fn(),
  writeFileSync: vi.fn(),
  mkdirSync: vi.fn(),
}));

vi.mock("node:crypto", () => ({
  randomUUID: vi.fn(() => "00000000-1111-2222-3333-444444444444"),
}));

describe("getClientId", () => {
  beforeEach(() => {
    vi.resetModules();
    vi.clearAllMocks();
    delete process.env.CENOGRAM_CLIENT_ID;
  });

  it("generates UUID and caches it when no file exists", async () => {
    const { readFileSync } = await import("node:fs");
    (readFileSync as ReturnType<typeof vi.fn>).mockImplementation(() => {
      throw new Error("ENOENT");
    });

    const { getClientId } = await import("../client-id.js");

    const id1 = getClientId();
    expect(id1).toBe("00000000-1111-2222-3333-444444444444");

    // Second call returns cached value (no additional file read)
    const id2 = getClientId();
    expect(id2).toBe(id1);
    expect(readFileSync).toHaveBeenCalledTimes(1);
  });

  it("respects CENOGRAM_CLIENT_ID env var", async () => {
    process.env.CENOGRAM_CLIENT_ID = "env-custom-id";

    const { getClientId } = await import("../client-id.js");
    expect(getClientId()).toBe("env-custom-id");
  });

  it("reads persisted UUID from file", async () => {
    const { readFileSync } = await import("node:fs");
    (readFileSync as ReturnType<typeof vi.fn>).mockReturnValue(
      "aabbccdd-1122-3344-5566-778899aabbcc\n",
    );

    const { getClientId } = await import("../client-id.js");
    expect(getClientId()).toBe("aabbccdd-1122-3344-5566-778899aabbcc");
  });

  it("regenerates if file contains invalid content", async () => {
    const { readFileSync } = await import("node:fs");
    (readFileSync as ReturnType<typeof vi.fn>).mockReturnValue("not-a-uuid");

    const { getClientId } = await import("../client-id.js");
    expect(getClientId()).toBe("00000000-1111-2222-3333-444444444444");
  });
});
