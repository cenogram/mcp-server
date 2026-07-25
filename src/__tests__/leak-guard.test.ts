import { describe, it, expect } from "vitest";
import { readdirSync, readFileSync, existsSync, statSync } from "node:fs";
import { execFileSync } from "node:child_process";
import { dirname, join, relative } from "node:path";
import { fileURLToPath } from "node:url";
import { GUARD_PATTERN, findGuardToken } from "./guard-tokens.js";

// Filesystem leak-guard: this whole directory is copied verbatim to the public repository, and the
// build keeps whatever the sources say, so a guarded term in a comment, string or description ships.
//
// The scan covers everything, tests included. Earlier versions skipped __tests__/ on the belief that
// the public copy excluded it. It does not — the public repository tracks the tests, so guards that
// spell out what they forbid publish the very index they exist to prevent. That is why the terms
// live encoded in ./guard-tokens.ts and why nothing here is exempt from the sweep.

const here = dirname(fileURLToPath(import.meta.url)); // .../mcp-server/src/__tests__
const rootDir = join(here, "..", "..");               // .../mcp-server

// No file exemptions. The lockfile used to be skipped because its base64 integrity hashes collided
// with short tokens by chance — but that was only true of unbounded matching, and the boundary
// rules in ./guard-tokens.ts removed the collisions. The lockfile travels to the public repository
// like everything else, and a linked dependency can write an absolute path into it, so it is
// scanned. An exemption here needs the same treatment SKIP_DIRS gets below: a rule, not a rationale.

// Generated or never-copied. Each one must ALSO be ignored by this directory's own .gitignore —
// otherwise skipping it here would hide a directory that really does travel to the public
// repository, which is the failure this whole file exists to prevent. The test below enforces
// that; do not add an entry without adding the matching rule.
const SKIP_DIRS = new Set(["node_modules", ".git", "dist", "coverage", ".turbo"]);

function collectFiles(dir: string, skip: Set<string> = new Set()): string[] {
  const out: string[] = [];
  for (const entry of readdirSync(dir)) {
    if (skip.has(entry)) continue;
    const full = join(dir, entry);
    if (statSync(full).isDirectory()) out.push(...collectFiles(full, skip));
    else out.push(full);
  }
  return out;
}

/**
 * Paths this directory's OWN .gitignore files suppress.
 *
 * The distinction matters and is easy to get wrong. Asking git plainly whether a path is ignored
 * answers it in the context of the repository we develop in — whose root .gitignore does NOT travel
 * when this directory is copied out. A file hidden only by that outer rule looks safe here and is
 * committed for real over there. `check-ignore -v` names the rule's source file, so we can keep the
 * rules that travel and disregard the ones that do not.
 */
function locallyIgnored(files: string[]): Set<string> {
  // "" when this directory is the repository root, as it is in the public copy.
  const prefix = execFileSync("git", ["rev-parse", "--show-prefix"], {
    cwd: rootDir,
    encoding: "utf8",
  }).trim();

  let out: string;
  try {
    out = execFileSync("git", ["check-ignore", "-v", "-z", "--stdin"], {
      cwd: rootDir,
      encoding: "utf8",
      input: files.map((f) => relative(rootDir, f)).join("\0"),
    });
  } catch (err) {
    // Exit code 1 means "nothing matched" and comes with empty output — not an error for us.
    const e = err as { status?: number; stdout?: string };
    if (e.status !== 1) throw err;
    out = e.stdout ?? "";
  }

  const ignored = new Set<string>();
  const fields = out.split("\0");
  // Records are (source, linenum, pattern, pathname); the trailing element after the last NUL is "".
  for (let i = 0; i + 3 < fields.length; i += 4) {
    const source = fields[i] ?? "";
    const pathname = fields[i + 3] ?? "";
    if (source.startsWith(prefix)) ignored.add(join(rootDir, pathname));
  }
  return ignored;
}

/**
 * Every file that travels when this directory is copied to the public repository, whether or not
 * it is tracked here yet: a stray file git would happily commit is exactly what we need to see.
 */
function publishedFiles(): string[] {
  const onDisk = collectFiles(rootDir, SKIP_DIRS);
  const ignored = locallyIgnored(onDisk);
  return onDisk.filter((f) => !ignored.has(f));
}

const offendersIn = (files: string[]): string[] =>
  files
    .filter((f) => GUARD_PATTERN.test(readFileSync(f, "utf8")))
    .map((f) => `${relative(rootDir, f)} (${findGuardToken(readFileSync(f, "utf8"))})`);

describe("leak-guard (published surface)", () => {
  it("no guarded term appears in any file that would reach the public repository", () => {
    // Not an allowlist of files we remembered to list: everything a reader of the public
    // repository can open, including configs, scripts and the tests themselves.
    const files = publishedFiles();
    expect(files.length, "git listed no files — the scan would pass vacuously").toBeGreaterThan(20);
    const offenders = offendersIn(files);
    expect(offenders, `guarded term found in: ${offenders.join(", ")}`).toEqual([]);
  });

  it("every skipped directory is one this directory's own .gitignore suppresses", () => {
    // Guards the assumption SKIP_DIRS rests on. A skipped directory that nothing ignores is a
    // directory git would commit to the public repository while the sweep above looks away —
    // and the mistake reads as a passing test, which is why it needs to be asserted, not commented.
    const dirs = [...SKIP_DIRS].filter((d) => d !== ".git"); // git ignores .git itself, no rule needed
    const probes = dirs.map((d) => join(rootDir, d, "probe.txt"));
    const ignored = locallyIgnored(probes);
    const unguarded = dirs.filter((d) => !ignored.has(join(rootDir, d, "probe.txt")));
    expect(
      unguarded,
      `skipped but not ignored by mcp-server/.gitignore: ${unguarded.join(", ")}`,
    ).toEqual([]);
  });

  it("no guarded term reaches dist/ when built", () => {
    const distDir = join(rootDir, "dist");
    if (!existsSync(distDir)) return; // dist is only present after a build; skip when absent
    const offenders = offendersIn(collectFiles(distDir));
    expect(offenders, `guarded term found in: ${offenders.join(", ")}`).toEqual([]);
  });
});
