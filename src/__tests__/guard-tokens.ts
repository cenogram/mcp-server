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
  // Nature layer (forest + protected areas), as stems so inflected forms trip too, in both spellings
  // and in English — the package is English, so an accidental leak most likely arrives translated.
  // Deliberately NO bare three-letter acronym of the forestry data source: it collides with an
  // unrelated public term another layer names legitimately, and a guard that cries wolf gets deleted.
  "Z2Rvcw==",
  "Z2RvxZs=",
  "cmRscA==",
  "bmFkbGVzbmljdHc=",
  "bmFkbGXFm25pY3R3",
  "bGFzeSBwYW5zdHdvdw==",
  "bGFzeSBwYcWEc3R3b3c=",
  "bGFzb3cgcGFuc3R3b3c=",
  "bGFzw7N3IHBhxYRzdHdvdw==",
  "bGFzYWNoIHBhbnN0d293",
  "bGFzYWNoIHBhxYRzdHdvdw==",
  "ZGFueWNoIG8gbGFz",
  "emlwb3A=",
  "c3RhdGUgZm9yZXN0cw==",
  "Zm9yZXN0IGRhdGEgYmFuaw==",
  "Z2VuZXJhbCBkaXJlY3RvcmF0ZSBmb3IgZW52aXJvbm1lbnRhbCBwcm90ZWN0aW9u",
  // The environmental agency's Polish name, as the invariant tail of it: the leading noun inflects
  // ("Generalna/Generalnej Dyrekcja/Dyrekcji") and the regional bodies share the same tail, so one
  // stem covers every form and both national and regional variants.
  "b2Nocm9ueSBzcm9kb3dpc2th",
  "b2Nocm9ueSDFm3JvZG93aXNrYQ==",
  // Subsurface layer (mining terrains + groundwater reservoirs): source-register and
  // publisher acronyms, lowercase — the guard lowercases before matching.
  "bWlkYXM=",
  "Z3p3cA==",
  "Y2JkZw==",
  "cGlnLXBpYg==",
  // …and the full names those acronyms stand for, as stems, the same way the nature layer above
  // does it: an acronym-only list is trivially bypassed by spelling the source out. Stems, because
  // the leading noun inflects while the tail does not, so one stem covers every case form — and the
  // tokens are the tails only, for the reason this whole file is encoded. English variants too:
  // the package is English, so an accidental leak most likely arrives translated.
  //
  // The Polish name of the reservoir dataset is guarded by its own tail, NOT by the English
  // "major groundwater reservoirs": that English phrase is what we deliberately publish (it names
  // the RESULT, not the register), so guarding it would fire on our own tool description.
  // Likewise NOT guarded: the mining-supervision authority. Its name is a field we intentionally
  // return per terrain, so a guard on it would contradict the product decision.
  "aW5zdHl0dXQgZ2VvbG9naWN6bg==",
  "Z2VvbG9naWNhbCBpbnN0aXR1dGU=",
  "ZGFueWNoIGdlb2xvZ2ljem4=",
  "Z2VvbG9naWNhbCBkYXRhYmFzZQ==",
  "d29kIHBvZHppZW1u",
  "d8OzZCBwb2R6aWVtbg==",
  "Ym9nYWN0dyBtaW5lcmFsbg==",
  // Roads layer: the national road-administration authority whose network we read. We publish the
  // measured distance and the road's own class, never who supplied the geometry.
  "Z2Rka2lh",
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
  // The forest inventory's unit of division (stem — it inflects). Not a name, but nobody outside that
  // dataset calls a patch of woodland this, so quoting it back names the source as surely as the source
  // would. Two stems, because the genitive plural swaps the final letter for a diacritic one and the
  // ASCII stem stops matching there.
  "d3lkemllbGVu",
  "d3lkemllbGXFhA==",
  // Roads layer: the source dataset's own layer codes for a carriageway and for a road centreline.
  // Four letters that mean nothing outside that dataset, so quoting one back names the dataset.
  "c2tqeg==",
  "c3Vsbg==",
]);

/** Internal column names and prefixes that would describe our storage layout. */
export const INTERNAL_FIELD_TOKENS = decode([
  "ZmFybWxhbmRfbWtv",
  "cGFyY2VsX3JlZg==",
  "YXJlYV9nZW9tX20y",
  "aHNf",
  // The forest source's own record key, which we store and never surface.
  "YWRyX2Zvcg==",
  // Roads layer: the source dataset's attribute names (management category, road class, carriageway
  // width, lane count) and its record key, plus our own derived per-parcel column. We publish the
  // road class as a value; the column names stay ours. The record key would also trip the source stem
  // in the group above — listed here too, so narrowing that stem cannot silently uncover it.
  "a2F0X3phcnphZHphbmlh",
  "a2xhc2FfZHJvZ2k=",
  "c3plcl9uYXdpZXJ6Y2huaQ==",
  "bF9wYXNvdw==",
  "YmRvdF9pZA==",
  "cGFyY2VsX3JvYWRfYWNjZXNz",
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
