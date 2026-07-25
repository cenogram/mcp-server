/**
 * Terms that must never reach the published artifact: the registers and platforms behind our
 * data, and a few internal field names.
 *
 * They are stored encoded on purpose. This repository is public, and the guards that assert
 * "the output must not contain X" are themselves a place where X is written down — a plaintext
 * list here would hand a reader the very index the guards exist to prevent. Encoding costs one
 * decode per test run and keeps the guards load-bearing.
 *
 * Adding a term: `printf '%s' "<term>" | base64` and append it, lowercase, to the right group.
 */

const decode = (values: readonly string[]): string[] =>
  values.map((v) => Buffer.from(v, "base64").toString("utf8"));

/** Commercial platforms whose data or name must not surface. */
export const PLATFORM_TOKENS = decode([
  "aG9tZXNjYW4=",
  "b3RvZG9t",
]);

/** Public registers and agencies we read from. Describe the result, never the source. */
export const SOURCE_TOKENS = decode([
  "Z3VnaWs=",
  "bmlk",
  "YmRvdA==",
  "ZWdpYg==",
  "YnViZA==",
  "Z3VuYg==",
  "cndkeg==",
  "YXJpbXI=",
  "bHBpcw==",
  "bWtv",
  "anBv",
  "dWxkaw==",
  "ZXppdWRw",
  "aWdlb21hcA==",
  "Z2VvLXN5c3RlbQ==",
  "bmJw",
  "Z2VvcG9ydGFs",
  "dG9wb2dyYWY=",
  "emFieXRlaw==",
  "d3Vveg==",
  "bWt1cmFu",
  "cG9saXNoX3RyYWlucw==",
  "enRt",
  "cGtw",
  "Z3pt",
]);

/**
 * Notation and category labels peculiar to a source dataset. Not names, but a fingerprint: quote
 * them back and a reader knows which dataset we read, which is the thing we do not say.
 */
export const NOTATION_TOKENS = decode([
  "Zmx1dmlhbA==",
  "c2Vhd2F0ZXI=",
  "c2NlbmFyaXVzeg==",
  "cTEw",
  "cTEl",
  "cSAx",
  "cTAuMg==",
  "d3lzenVraXdhcmth",
  "cHJhd28gYnVkb3dsYW5l",
  "aW5zcGlyZQ==",
  "d2Zz",
]);

/** Internal column names and prefixes that would describe our storage layout. */
export const INTERNAL_FIELD_TOKENS = decode([
  "ZmFybWxhbmRfbWtv",
  "cGFyY2VsX3JlZg==",
  "YXJlYV9nZW9tX20y",
  "aHNf",
]);

export const ALL_GUARD_TOKENS = [
  ...PLATFORM_TOKENS,
  ...SOURCE_TOKENS,
  ...NOTATION_TOKENS,
  ...INTERNAL_FIELD_TOKENS,
];

/**
 * Markers of the private repository this package is developed in: internal document sections,
 * the monorepo directory, plan paths, deployment host names. Encoded for the same reason as the
 * rest — spelled out here, the list would name our hosts and internal layout in a public file.
 */
export const INTERNAL_MARKERS = decode([
  "Y29udmVudGlvbnMgwqc=",
  "bmllcnVjaG9tb3NjaV9jbGF1ZGU=",
  "cGxhbnMvYWN0aXZl",
  "cGxhbnMvYXJjaGl2ZQ==",
  "Y3g0Mw==",
  "Y2F4MTE=",
]);

const escape = (t: string): string => t.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");

// Most tokens are matched as substrings, so inflected and suffixed forms still trip the guard.
// Short all-letter tokens need a boundary — matched loosely, a three-letter acronym fires on
// ordinary identifiers (one of them is a substring of "transactionId"), and a guard that cries
// wolf is a guard someone eventually deletes.
//
// A leading boundary is enough, and only a leading one is safe. \b will not do: it counts "_" as a
// word character, so \b...\b lets the acronym through as the head of a snake_case field name —
// exactly a thing we guard against. A trailing (?![a-z]) is worse than useless here: under the /i
// flag [a-z] matches uppercase too, so the "C" of a camelCase suffix suppresses the match, and
// camelCase is the dominant identifier shape in this package. So: a preceding letter or digit means
// the hit is incidental and we ignore it; anything that follows is fair game.
//
// If this ever fires on an innocent word — a place name sharing a token's first three letters is
// the likely one — narrow that token or add the specific word as an exception. Do NOT restore a
// trailing (?![a-z]): it looks like the fix and silently reopens every camelCase form.
const asPattern = (t: string): string =>
  t.length <= 3 && /^[a-z]+$/.test(t) ? `(?<![a-z0-9])${escape(t)}` : escape(t);

export const GUARD_PATTERN = new RegExp(
  `(${[...ALL_GUARD_TOKENS, ...INTERNAL_MARKERS].map(asPattern).join("|")})`,
  "i",
);

/** The first guarded term in `text`, or null. Use over a substring loop: it honours boundaries. */
export const findGuardToken = (text: string): string | null =>
  text.match(GUARD_PATTERN)?.[0] ?? null;
