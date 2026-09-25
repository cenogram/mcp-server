# Changelog

## 0.12.0

### `list_parcels_in_area` finds a building number on an official address point

- When a `buildingNumber` search comes back empty against the sale record, the same street and
  number are now tried against official address points that fall inside the parcel. That match
  ignores case on the number (`12a` finds `12A`) but is still exact — no compound splitting — and
  matches the street by the same whole-word rule as `street=`. Only when both the record and the
  address points miss does the page come back empty (with the tokens refunded and the street's
  recorded numbers listed to retry).

- A row whose number came from an address point is tagged
  `[number from an official address point on this parcel, not from a deed]`, and one from the
  register `[number from a recorded sale deed]`, so a number worked out from address points is
  never read as a deed number. `address_source` gains the value `address_point` alongside `rcn`,
  `approx_high`, `approx_low` and `none`.

### `street=` now matches whole words, not any fragment

- `street=` matches whole words of the name instead of any substring: `Górna` finds
  `ulica Górna` and `Górna 15` but no longer `Podgórna`, and a partial fragment like `Marsza`
  now finds nothing. Pass the whole word. Matching stays case- and accent-insensitive and still does
  not inflect (nominative only).

- The minimum `street=` length rises from 3 to 4 letters or digits. A three-letter fragment is a
  single index gram that matches hundreds of thousands of names; four keeps the lookup fast. A
  three-character query is now refused up front instead of being sent.

- When the street exists in the area but not with the number you gave, the answer says so and drops
  the generic "widen the area" advice, which would have pointed away from the number.

These refine an existing call shape. `buildingNumber` behaviour is additive; the `street=`
whole-word rule and the 3→4 minimum are stricter than before, so a fragment or three-letter query
that used to match may now return an empty page — retry with the whole word.

## 0.11.0

### Accent- and case-tolerant street filter, with suggestions on a miss

- `list_parcels_in_area(street=)` now matches case- and accent-insensitively: `karmelicka` and
  `Karmelicką` both find `Karmelicka`. Matching still does not inflect, so pass the name in the
  nominative — an inflected form like `Karmelickiej` answers with an empty page.

- An empty `street` page now costs nothing: the tokens are refunded, and the answer carries close
  catalogue names to retry (`street=`), rendered as ready follow-up calls. When the street exists
  but the `buildingNumber` you gave is not recorded on it, the page instead lists the numbers held
  on the street (in the compound form the register uses, e.g. `84/92`) to retry.

These are behaviour refinements to an existing call shape; every existing call keeps working.

## 0.10.1

### Clearer parcel-address guidance

- `resolve_parcel` now says plainly that `q` is **not** a street address: it takes a locality name
  plus a parcel number ('Sabnie 342/5'), never a street name plus a building number. For a city
  address (street + building number) the description points callers at
  `list_parcels_in_area(street=, buildingNumber=)` instead.

- A successful `resolve_parcel` now states its cost too ("Query cost: 0 API tokens — resolving a
  parcel is free"), matching how `list_parcels_in_area` prints its query cost. Until now the price
  was only implied on a miss, through the "refunded" wording.

- `list_parcels_in_area` warns that RCN often records a compound building number ('84/92'), so an
  exact match on '84' will not find '84/92' — drop the number and read the street's rows instead.
  The existing note that `street` needs the nominative and Polish diacritics is unchanged.

These are description and output-text refinements only; every existing call shape works unchanged.

## 0.10.0

### `list_locations` gains name search

- `list_locations(search="name")` looks up a place by name across all administrative levels
  (voivodeship, county, municipality, cadastral precinct), case-insensitive and diacritics-insensitive,
  matching on a partial fragment (e.g. `wejher` finds Wejherowo). Each match returns its TERYT code,
  its parent unit, and the exact follow-up calls to make - so a name becomes a code in a single call.

  Pass the returned TERYT code as `teryt=` for administrative filtering that carries no name ambiguity.
  A match flagged as an RCN district additionally accepts its name directly in
  `search_transactions(location=)` and `compare_locations(districts=)`. RCN district names with no
  TERYT code are listed separately, so a name that only the transaction registry knows stays findable.

  `search` and the existing `parent` argument stay separate: `parent` browses the children of a code,
  `search` resolves a name. The server instructions now lead with resolving a name to a code before
  addressing a place, and describe the name as a parallel path rather than a fallback.

- Every row returned by `list_locations` now carries `parent_name`, so an ambiguous name (several
  places called "Osiek") can be told apart by its parent unit without a second call.

## 0.9.0

### New tools

- `get_parcel_land_class` - the official land-use and soil-quality classification recorded for one
  parcel, and what it implies for taking the land out of agricultural use. Until now the classification
  was reachable only as one section of the parcel dossier.

  It is the first tool in the parcel family that answers with a single layer, and it stays a named
  exception rather than the start of a tool per layer: "can this land be taken out of agricultural use"
  is often the only question asked before buying a plot, and answering it needs neither flood risk nor
  heritage nor transport. Everything else about a parcel still belongs to `get_parcel_report` - one
  call at a flat price, carrying this same classification as one of its sections.

  The categories and the grades come back as sets with no area attached to any of them, so the answer
  can never say which category prevails on the parcel and never gives a share. A parcel listing two
  categories has both, in unknown proportion.

  Four states, told apart in words rather than by an empty field: the county publishes the
  classification and the parcel has an entry; it publishes and this parcel has none (a checked
  negative, still billed); it publishes nothing, or we do not hold the parcel (refunded); the lookup
  could not finish in time (refunded, retry). Treat the third state as an ordinary answer rather than
  a failure - the tool description says where the layer answers.

  Costs 4 API tokens, refunded on the last two states. It carries a note on the consequences of
  re-designation with the date the legal state behind it was verified. Not legal advice, and never a
  statement that a parcel can or cannot be built on.

- `list_parcels_in_area` - the cadastral parcels in an area, which until now could only be reached
  one at a time. An area is named in one of five ways (administrative code, county or city name,
  bounding box, circle, drawn polygon) and the answer comes in one of two shapes: a light list of
  identifiers, districts and centre points that pages by cursor, or the full outlines of each parcel.
  `includeGeometry=true` (with a bounding box) or a polygon asks for the outlines; everything else
  gets the light list, which costs less per call.

  It is one tool rather than one per entrance on purpose. The entrances answer the same question and
  differ only in how the area arrives, so splitting them would ask the caller to choose between
  near-identical names - and the choice would go wrong exactly when the area does not fit the tool
  that was picked.

  Two things about the answers are worth reading before acting on them. On the outline calls
  **truncation is the normal case**: an area the size of a city holds far more parcels than one call
  returns, and a truncated answer is an arbitrary subset, not the first, nearest or largest parcels
  in it. And the spatial entrances (box, circle, polygon) answer from the stored outline while the
  code and name entrances do not touch geometry at all - the tool description spells out what that
  means for completeness, and it is worth reading once before you lean on a spatial answer.

  Combinations the service refuses are refused here first, before the call is made - a box together
  with a circle, a polygon alongside another area, a surface filter or a cursor on an outline call.
  The message says what to send instead, and no tokens are spent to read it.

- `search_by_area`, `search_by_polygon` and `search_parcels` now say in their first lines what they
  return and point at the new tool. The first two answer with transactions despite names that read
  like parcels, and that was survivable while nothing else returned parcels in an area.

- `get_transaction_roads` - geometric evidence of road access for every plot behind one transaction:
  the distance to the nearest public road, to a road of any kind and to a motorway or expressway, an
  estimated distance to the carriageway *edge*, the nearest public road's administrative category and
  class, whether it crosses at grade, and a three-state indicator - access likely, uncertain, or
  unlikely - together with the version of the rule that produced it.

  **The indicator is evidence, not a determination, and the distinction matters more here than on any
  other layer.** It is measured from carriageway centrelines in reference road-network data, so it
  says nothing about *legal* access: an easement, a right of way, or a private internal road are
  recorded in the land register, which is not published here. A plot the tool calls "likely" can be
  landlocked in law, and a plot it calls "unlikely" can have a perfectly good servitude. Treat it as a
  reason to check the register, never as an answer that replaces it.

  A null distance means nothing of that kind was found inside the search radius - never a guarantee
  that nothing is there. The radii differ per question and the tool description names each one.

  Costs 4 API tokens. A transaction whose plots carry no assessment answers with an empty result and
  is refunded; an unknown but well-formed id is charged, as everywhere else in this family.

  ⚠ **This tool has been available on the hosted server since 2026-08-26 and is only now reaching a
  released package** - it went in without a version of its own, so anyone pinned to an older release
  of this client had no way to see it existed. It is documented here rather than backdated into a
  version that was never published.

### Pricing

- `get_parcel_report` now costs **45 API tokens, up from 35**. Nothing else about the report changed:
  the same sections, the same shape, the same rules on what a partial answer refunds.

### Tools

- `list_parcels_in_area` now filters by `street` and `buildingNumber`, and every row of the light
  list carries the street address held for that parcel whether or not you asked about one. The
  change is additive: nothing already in the response changed shape or meaning.

  `street` matches the name case-insensitively anywhere inside it and is a NAME, not a pattern - `%`
  and `_` match themselves. It searches both sources at once, and a parcel found in both appears
  once, attributed to the record. `buildingNumber` matches exactly (`12A` does not find `12a`), needs
  `street` alongside it, and because a number is only ever on record, a call carrying one answers
  only with parcels whose street is on record.

  Both need a narrower area alongside them - a bounding box, a circle, a location name, or a code of
  at least four digits - and neither counts as naming the area: a common street name across the
  country is a search of the whole register, not a question. Neither is available on the outline
  calls, and asking for one there is refused rather than dropped silently; a dropped filter would
  answer with every parcel in the shape and read as a street with a great many parcels on it.

  A street we worked out ourselves is marked as such in the rendered row, so an approximated street
  is never quoted back as one on record. A parcel we hold no street for prints no address line
  rather than a line saying "none" - most rural parcels are in that position, and a line on every
  one of them would bury the rows that do carry an address.

  **Treat the address fields as optional permanently.** They are absent from any response an older
  service version produces, so read them defensively rather than assuming they are always present.

- `get_building_breakdown` now carries an optional `age_estimate` for each building, and
  `get_parcel_report` summarises the same dimension for the buildings on a parcel - how many of them
  could be dated at all. The change is additive: nothing that was already in either response changed
  shape or meaning.

  It is an estimate with an interval and a stated basis, never a construction date read off a
  register. The lower edge is the earliest date the works could lawfully have started; the upper edge
  and the single year inside it add a completion offset and are the least certain numbers in the
  object. The interval leads and the point follows it on purpose - a reader who meets the year first
  quotes the year and drops the range. Some building classes have no stable calibration for a point
  at all, and then the interval alone is the answer.

  "Construction year not established" is a first-class answer here, not a gap in the response. Every
  such case is stated as a sentence rather than left out - a reader who sees no age line concludes
  the age was never discussed. A refusal still reports later works on the structure where we know of
  them, because a rebuild or an extension is the most decision-relevant thing we can say about a
  building we could not date.

  The `confidence` grade describes how well the building was tied to a permit record. It grades that
  match, not certainty about the year, and the rendered text now says so in as many words.

  **Treat `age_estimate` as optional permanently.** It is absent from any response an older service
  version produces, so read it defensively rather than assuming it is always present.

## 0.8.0

### New tool

- `get_transaction_subsurface` - what lies under the land behind one transaction, plot by plot, across
  two separate dimensions: mining terrains and major groundwater reservoirs. For each linked plot that
  overlaps either one - the mining-terrain state (active or former) together with the mineral class,
  because a terrain over a gravel pit and a terrain over a coal mine are not the same risk; the
  reservoir state (documented or undocumented); the share of the plot inside each; and the objects by
  name, with the oversight authority and the validity dates.

  A reservoir extent is not a restriction on its own - a restriction comes from an established
  protection zone, which this tool does not carry. The signal is indicative and meant to be checked
  against the competent mining-supervision authority, named per terrain in the result. An empty result
  is never a statement that the ground is clear: the register covers concession areas, and historical
  workings may simply not appear in it.

### Tools

- `get_parcel_report` now carries a twelfth enrichment layer, the same subsurface summary per parcel.

## 0.7.0

### New tool

- `get_transaction_nature` - nature context for the land behind one transaction, plot by plot: the
  nearest forest within 2 km (0 m when the plot overlaps forest, with the overlap share) and any
  overlapping protected natural areas - the sharpest form (national park, nature reserve, Natura 2000,
  landscape park, protected landscape, other), whether the build restriction follows straight from the
  Nature Protection Act or from the act that established the area, the share of the plot under
  protection, and the areas by name.

  It describes the source of a restriction, never the outcome of a permitting case, and an empty result
  is never a statement that building is allowed.

### Tools

- `get_parcel_report` now carries an eleventh enrichment layer, the same nature context for the parcel.
- This is also the first release to include the tenth layer: the official land-use and soil-quality
  classification recorded for the parcel, with what re-designating it would involve, wherever the county
  publishes that record.
- `get_transaction_nature` distinguishes the two kinds of empty answer: plots that were checked and
  carry no forest or protected-area signal, and plots we hold no nature data for yet. The second reads
  as "not checked", never as "there is nothing here". The call is refunded either way.

## 0.6.0

Documentation and protocol-compatibility release - no breaking changes, no new tools.

### OAuth / discovery
- Serve the path-aware `/.well-known/oauth-protected-resource/mcp` document (RFC 9728) in
  addition to the origin-level one, so clients that derive the metadata URL from the endpoint
  they call can complete discovery instead of aborting.
- Add a `/.well-known/glama.json` endpoint for directory ownership verification (served only
  when `GLAMA_MAINTAINER_EMAIL` is set, 404 otherwise).

### Tools
- `search_by_polygon`: maximum `limit` lowered from 5000 to 3000.

### Docs
- README and package description now cover per-parcel context (zoning, flood and landslide
  risk, heritage register, building permits, construction activity, transit access,
  agricultural land and surroundings) alongside transaction prices, and mention more MCP
  clients (ChatGPT, Grok).
- Refreshed the example parcel IDs used in the sample prompts.

## 0.5.0

First release since 0.2.0, so it carries everything published on the hosted server in the
meantime. Versions 0.3.0 and 0.4.0 exist in the source history but were never released to npm.

### New tools (14)

Parcels:
- `resolve_parcel` - resolve a cadastral parcel identifier to its canonical record
- `get_parcel_report` - composite dossier for one parcel: core data, enrichment layers,
  transaction history, local price context and municipal context

Context for a location:
- `get_demographics` - population and demographic context
- `get_infrastructure_signals` - municipal infrastructure signals (tenders, utilities,
  capital spending)
- `estimate_value` - comparable-sales value estimate for a property (Beta)

Context for the property behind a single transaction, each taking a `transaction_id` from a
search result:
- `get_building_breakdown` - per-building footprint, storeys, estimated floor area
- `get_transaction_flood` - flood risk
- `get_transaction_heritage` - heritage-register status
- `get_transaction_landslide` - landslide risk
- `get_transaction_surroundings` - nuisance and land-use context around the property
- `get_transaction_transit` - public transport accessibility
- `get_transaction_permits` - building permits recorded for the property
- `get_transaction_planning` - local zoning and planning status
- `get_transaction_farmland` - agricultural land-use classification

### Changed

- Search filters: floor (for units), ownership type, and an explicit "no data" option where a
  field can be missing.
- Results carry parcel identifiers and coordinates consistently, so a search can be followed by
  a parcel or enrichment lookup without a second search.
- All calls now go to the versioned `/api/v1` endpoints.
- Tool descriptions state how Warsaw and Krakow districts are addressed, and a wrong location
  name now comes back with a usable correction instead of a bare 404.

### Fixed - error messages an AI agent can act on

- `Retry-After` was read as days instead of seconds, so a five-second rate limit was reported as
  "resets in 1 day". It now reports seconds, minutes or hours, and says nothing about time at
  all when the server did not send a usable value.
- Every payment-required response was reported as "insufficient credits (balance: 0)" even when
  the account had a full balance and the real cause was an expired trial. The server's own
  explanation is now relayed.
- Running without an API key was reported as an internal error with an invitation to file a bug,
  and pointed at a page behind a login. It now says a key is missing and where to get one.
- 403, 503 and 410 responses relayed no detail. They now carry the server's explanation, and 410
  states that the endpoint is gone for good rather than suggesting a retry.

## 0.2.0

- Authentication header fix, English error messages.
