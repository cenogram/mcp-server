# Cenogram MCP Server — Tool Reference

> Auto-generated from the server's tool definitions by `npm run docs:generate`. Do not edit by hand.

8M+ verified real estate transactions from Poland's official RCN registry (Rejestr Cen
Nieruchomości) — transaction prices from notarial deeds, not asking prices. Data from 2003,
380 counties, refreshed roughly every two weeks.

This reference lists the **28** tools available by default. Additional
experimental tools may be enabled server-side and are intentionally not documented here.

---
### 1. `search_transactions`
**Search Real Estate Transactions**

Search Polish real estate transactions from the national RCN registry (8M+ records).
Returns transaction details: address, date, price, area, price/m², property type.
Call list_locations(search=...) first to resolve a place: prefer the returned TERYT code as teryt= (exact administrative match). Pass a name to location= only when the result flags it as an RCN district (rcn_district) — most TERYT names are not valid location= values and silently return zero rows.
Example: search for apartments in Mokotów sold in 2024 above 500,000 PLN.
Data notes: marketType is NULL for ~55% of records (notary didn't classify) - filtering by marketType excludes them. ~1.7% of records have no transaction_date.
Permalink: every result is shareable on the map. From a result's "id:" line and its "Location: <A>°N, <B>°E" line, build https://cenogram.pl/ceny-transakcyjne?src=mcpstdio#v=1&lat=<A>&lng=<B>&z=16&tx=<id> (drop the °N/°E; lat = the °N number, lng = the °E number) — opens that exact transaction on the map. Omit &tx=<id> for the area only.
Field provenance: values are from the notarial deed (RCN) by default; computed values (parcel area summed across plots or converted from hectares, an inferred/reclassified property type) and approximated streets are flagged inline with a neutral [...] note.
Location matches TERYT districts only - for neighborhoods (osiedla), use search_by_area instead.

**Parameters:**

- `location` (string, optional) — Location name - city (e.g. 'Warszawa', 'Kraków', 'Gdańsk') or district (e.g. 'Mokotów', 'Kraków-Podgórze'). 'Warszawa', 'Kraków', 'Łódź' auto-expand to all sub-districts. Prefer teryt= for exact matches; call list_locations(search=...) to confirm a name is valid here — it flags valid ones as rcn_district.
- `teryt` (string, optional) — TERYT administrative code(s) for precise area filtering. Comma-separated, max 10. 2-digit (voivodeship), 4-digit (county), 6-digit (municipality), or full precinct code (e.g. '321705_2.0054'). Use list_locations to find codes. More precise than 'location' - avoids name ambiguity.
- `propertyType` (enum: land | building | developed_land | unit, optional) — Property type filter
- `marketType` (enum: primary | secondary, optional) — Market type: primary (developer) or secondary (resale). ~55% of records have unknown market type and will be excluded when this filter is used.
- `unitFunction` (enum: residential | commercial | office | production | garage | other | unknown, optional) — Unit/apartment function filter. 'unknown' = no function recorded (NULL); without it such rows are excluded. Garages appear only when 'garage' is selected, not via 'unknown'.
- `buildingType` (enum: residential | commercial | industrial | transport | office | warehouse | education_sports | farm_utility | hospital | other_nonresidential | unknown, optional) — Building type filter (PKOB classification). 'unknown' = no type recorded (NULL); without it such rows are excluded (~39% of buildings have no type).
- `ownershipType` (array of enum: land_ownership | perpetual_usufruct | cooperative_ownership | unit_sale | ownership | unit_ownership_with_appurtenant_right | building_ownership_with_appurtenant_right | unknown, optional) — Ownership / legal-right type filter (rodzaj prawa do nieruchomości). land_ownership; perpetual_usufruct (użytkowanie wieczyste — covers both registry codes for this right); cooperative_ownership; unit_sale; ownership; unit_ownership_with_appurtenant_right; building_ownership_with_appurtenant_right. 'unknown' = no right recorded (NULL). Multi-select; e.g. ['land_ownership','perpetual_usufruct'] to compare ownership vs perpetual usufruct on undeveloped land.
- `mpzpDesignation` (string, optional) — MPZP zoning designation filter (exact match, e.g. 'budownictwoMieszkanioweWielorodzinne', 'terenObiektowProdukcyjnychSkladowIMagazynow'). Use 'unknown' for rows with no designation recorded (NULL); distinct from the registry code 'brakMPZPLubWZ' (= 'no plan/WZ' recorded as data).
- `transactionType` (array of enum: free_market | auction | non_auction | subsidized | public_purpose | foreclosure | unknown, optional) — Transaction type filter. For market analysis, ALWAYS specify transactionType to exclude non-market transactions (subsidized, foreclosure, public purpose). ~2% of transactions have unknown type (NULL) and are excluded when this filter is used unless 'unknown' is included.
- `rooms` (array of enum: 1 | 2 | 3 | 4 | 5 | 6 | 7 | 8plus | unknown, optional) — Number of rooms (izby) filter, residential units only. Multi-select; '8plus' means 8 or more, 'unknown' = no room count recorded (NULL). E.g. ['2','3'] for 2-3 izby flats. Without 'unknown', rows with no room count are excluded.
- `floor` (array of string, optional) — Floor of the unit (piętro lokalu, residential). Multi-select buckets: exact integers incl. '0' (parter) and negatives e.g. '-1' (basement), 'Nplus' e.g. '10plus' = 10 or more, '0plus' = ground and above, 'unknown' = no floor recorded (NULL). E.g. ['0','1','2'] for ground-to-2nd floor. Building storeys are a different attribute. Without 'unknown', rows with no floor are excluded.
- `floodRisk` (array of enum: low | medium | high, optional) — Flood-hazard filter. high = most frequent flooding (~1-in-10-year), medium (~1-in-100-year), low = rarest (~1-in-500-year). Selects ONLY transactions whose land sits in a mapped flood zone; absence of a zone is never asserted as 'safe'. Multi-select; e.g. ['medium','high'] = at least medium risk.
- `heritageStatus` (array of enum: listed | zone, optional) — Heritage-listing filter. listed = a protected monument on/at the property's land; zone = the land lies within a protected urban layout or the designated surroundings of a monument. Selects ONLY transactions where a listing was detected; absence of a detection is never asserted as 'not listed'. Multi-select; e.g. ['listed'] = individually listed properties only.
- `landslideRisk` (array of enum: landslide | threatened, optional) — Landslide-hazard filter, from official landslide-hazard maps (1:10,000 scale). 'landslide' = the land intersects a mapped landslide area; 'threatened' = an area threatened by mass movements. Selects ONLY transactions whose land intersects a mapped hazard area — an intersection means overlap with a mapped area, not that the parcel itself is a landslide; absence of a zone is never asserted as 'safe'. Multi-select; e.g. ['landslide','threatened'] = any mapped hazard.
- `minPrice` (number, optional) — Minimum price in PLN
- `maxPrice` (number, optional) — Maximum price in PLN
- `dateFrom` (string, optional) — Start date (YYYY-MM-DD)
- `dateTo` (string, optional) — End date (YYYY-MM-DD)
- `street` (string, optional) — Street name filter, matched anywhere inside the name (e.g. 'Puławska', 'Aleja Waszyngtona'). Give it in the NOMINATIVE and with its Polish diacritics — matching is literal, so 'Karmelickiej' does not find 'Karmelicka' and 'Marszalkowska' does not find 'Marszałkowska'. Either mistake answers with nothing, which reads exactly like 'no such transactions'.
- `buildingNumber` (string, optional) — Building/house number (e.g. '30', '12A'). Requires location or street to be set.
- `parcelId` (string, optional) — Exact parcel ID as returned in search results (e.g. '146518_8.0108.27'). Must match exactly - copy from a previous search result's parcel_id field.
- `minArea` (number, optional) — Minimum area in m²
- `maxArea` (number, optional) — Maximum area in m²
- `landUse` (array of enum: gruntyZabudowaneIZurbanizowane | gruntyRolne | gruntyLesne | terenyKomunikacyjne | inne | unknown, optional) — Recorded land-use category of the transaction's land. Multi-select from: gruntyZabudowaneIZurbanizowane (built-up and urbanised), gruntyRolne (agricultural), gruntyLesne (forest), terenyKomunikacyjne (transport), inne (other). 'unknown' = no category recorded for the land (NULL) — a legitimate bucket, never a claim that the land has no use. Values are case-sensitive. E.g. ['gruntyRolne'] for farmland, or ['gruntyZabudowaneIZurbanizowane','gruntyRolne'] to compare developed vs farmland.
- `buildingStoreys` (array of string, optional) — Number of above-ground storeys of the building. Multi-select buckets: exact non-negative integers (e.g. '1','2'), 'Nplus' e.g. '3plus' = 3 or more, 'unknown' = no storey count recorded (NULL). Recorded ONLY for single-building transactions, so 'unknown' covers BOTH a deed with several buildings (no single storey count exists) and a single building with missing data — never read it as 'a building with no storeys'. This is NOT the floor of a unit (see floor). Without 'unknown', rows with no storey count are excluded.
- `minFootprintArea` (number, optional) — Minimum building footprint (ground-plan) area in m², summed over all buildings of the transaction. Distinct from minArea, which measures usable floor area (units) or land/parcel area. Set only where every linked building has footprint data, so this bound selects only measured rows — absence means 'not measured', not 'no building'.
- `maxFootprintArea` (number, optional) — Maximum building footprint (ground-plan) area in m², summed over all buildings of the transaction. Distinct from maxArea, which measures usable floor area (units) or land/parcel area. Set only where every linked building has footprint data, so this bound selects only measured rows — absence means 'not measured', not 'no building'.
- `limit` (number, optional, default: 10) — Number of results (1-50, default 10)
- `sort` (enum: price | date | area | pricePerM2 | district | rooms | floor, optional, default: "date") — Sort by field (default: date)
- `order` (enum: asc | desc, optional, default: "desc") — Sort order (default: desc)
- `page` (number, optional, default: 1) — Page number for pagination (default: 1)

---

### 2. `get_price_statistics`
**Price per m² Statistics**

Get price per m² statistics by location for residential apartments in Poland.
Note: only covers residential units (lokale mieszkalne). For other property types, use search_transactions.
'Warszawa'/'Kraków'/'Łódź' auto-expand to all sub-districts (Warszawa=19, Kraków=5, Łódź=6). Other names use partial match.
Data quality: based on transaction prices from notarial deeds, not asking/listing prices. Coverage varies by county (some have data gaps of 5+ years).
Note: median/average prices are market-based — fractional ownership shares and non-market deeds (public tenders, foreclosures, privileged/subsidized sales) are excluded from price aggregates. Transaction counts and coverage stay complete.

**Parameters:**

- `location` (string, optional) — Filter by location name. 'Warszawa'/'Kraków'/'Łódź' auto-expand to all sub-districts. Other names use case-insensitive partial match (e.g. 'Wrocł' matches 'Wrocław'). Omit for all Poland.

---

### 3. `get_price_distribution`
**Price Distribution Histogram**

Get price distribution histogram showing how many transactions fall into each price range.
Useful for understanding the overall market price structure in Poland.
Note: median/average prices are market-based — fractional ownership shares and non-market deeds (public tenders, foreclosures, privileged/subsidized sales) are excluded from price aggregates. Transaction counts and coverage stay complete.

**Parameters:**

- `bins` (number, optional, default: 20) — Number of price bins (5-50, default 20)
- `maxPrice` (number, optional, default: 3000000) — Maximum price to include (default 3,000,000 PLN)

---

### 4. `search_by_area`
**Search Transactions by Radius**

Search real estate transactions within a geographic radius.
Returns TRANSACTIONS — deeds and prices — despite the name. For the land plots themselves in an area, use list_parcels_in_area.
Best tool for neighborhood/osiedle searches (neighborhoods are not TERYT districts).
Radius guide: 0.3-0.5 km for a street, 0.5-1 km for a neighborhood, 2-5 km for a city area.
Example: apartments in Wrocław's Nowy Dwór (lat 51.143, lng 16.993, radiusKm=0.7).
Area filters (minArea/maxArea) work for all propertyType values.
Permalink: every result is shareable on the map. From a result's "id:" line and its "Location: <A>°N, <B>°E" line, build https://cenogram.pl/ceny-transakcyjne?src=mcpstdio#v=1&lat=<A>&lng=<B>&z=16&tx=<id> (drop the °N/°E; lat = the °N number, lng = the °E number) — opens that exact transaction on the map. Omit &tx=<id> for the area only.
Field provenance: values are from the notarial deed (RCN) by default; computed values (parcel area summed across plots or converted from hectares, an inferred/reclassified property type) and approximated streets are flagged inline with a neutral [...] note.

**Parameters:**

- `latitude` (number, required) — Latitude (Poland range: 49-55)
- `longitude` (number, required) — Longitude (Poland range: 14-25)
- `radiusKm` (number, optional, default: 2) — Search radius in km (0.1-50, default 2). Use 0.5-1 for neighborhoods, 0.3-0.5 for streets.
- `propertyType` (enum: land | building | developed_land | unit, optional) — Property type filter
- `marketType` (enum: primary | secondary, optional) — Market type: primary (developer) or secondary (resale). ~55% of records have unknown market type and will be excluded when this filter is used.
- `unitFunction` (enum: residential | commercial | office | production | garage | other | unknown, optional) — Unit/apartment function filter. 'unknown' = no function recorded (NULL); without it such rows are excluded. Garages appear only when 'garage' is selected, not via 'unknown'.
- `buildingType` (enum: residential | commercial | industrial | transport | office | warehouse | education_sports | farm_utility | hospital | other_nonresidential | unknown, optional) — Building type filter (PKOB classification). 'unknown' = no type recorded (NULL); without it such rows are excluded (~39% of buildings have no type).
- `ownershipType` (array of enum: land_ownership | perpetual_usufruct | cooperative_ownership | unit_sale | ownership | unit_ownership_with_appurtenant_right | building_ownership_with_appurtenant_right | unknown, optional) — Ownership / legal-right type filter (rodzaj prawa do nieruchomości). land_ownership; perpetual_usufruct (użytkowanie wieczyste — covers both registry codes for this right); cooperative_ownership; unit_sale; ownership; unit_ownership_with_appurtenant_right; building_ownership_with_appurtenant_right. 'unknown' = no right recorded (NULL). Multi-select; e.g. ['land_ownership','perpetual_usufruct'] to compare ownership vs perpetual usufruct on undeveloped land.
- `minPrice` (number, optional) — Minimum price in PLN
- `maxPrice` (number, optional) — Maximum price in PLN
- `minArea` (number, optional) — Minimum area in m² (usable_area_m2 for units, parcel_area for land)
- `maxArea` (number, optional) — Maximum area in m²
- `dateFrom` (string, optional) — Start date (YYYY-MM-DD)
- `dateTo` (string, optional) — End date (YYYY-MM-DD)
- `transactionType` (array of enum: free_market | auction | non_auction | subsidized | public_purpose | foreclosure | unknown, optional) — Transaction type filter. For market analysis, ALWAYS specify to exclude non-market transactions.
- `rooms` (array of enum: 1 | 2 | 3 | 4 | 5 | 6 | 7 | 8plus | unknown, optional) — Number of rooms (izby) filter, residential units only. Multi-select; '8plus' means 8 or more, 'unknown' = no room count recorded (NULL). E.g. ['2','3'] for 2-3 izby flats. Without 'unknown', rows with no room count are excluded.
- `floor` (array of string, optional) — Floor of the unit (piętro lokalu, residential). Multi-select buckets: exact integers incl. '0' (parter) and negatives e.g. '-1' (basement), 'Nplus' e.g. '10plus' = 10 or more, '0plus' = ground and above, 'unknown' = no floor recorded (NULL). E.g. ['0','1','2'] for ground-to-2nd floor. Building storeys are a different attribute. Without 'unknown', rows with no floor are excluded.
- `floodRisk` (array of enum: low | medium | high, optional) — Flood-hazard filter. high = most frequent flooding (~1-in-10-year), medium (~1-in-100-year), low = rarest (~1-in-500-year). Selects ONLY transactions whose land sits in a mapped flood zone; absence of a zone is never asserted as 'safe'. Multi-select; e.g. ['medium','high'] = at least medium risk.
- `heritageStatus` (array of enum: listed | zone, optional) — Heritage-listing filter. listed = a protected monument on/at the property's land; zone = the land lies within a protected urban layout or the designated surroundings of a monument. Selects ONLY transactions where a listing was detected; absence of a detection is never asserted as 'not listed'. Multi-select; e.g. ['listed'] = individually listed properties only.
- `landslideRisk` (array of enum: landslide | threatened, optional) — Landslide-hazard filter, from official landslide-hazard maps (1:10,000 scale). 'landslide' = the land intersects a mapped landslide area; 'threatened' = an area threatened by mass movements. Selects ONLY transactions whose land intersects a mapped hazard area — an intersection means overlap with a mapped area, not that the parcel itself is a landslide; absence of a zone is never asserted as 'safe'. Multi-select; e.g. ['landslide','threatened'] = any mapped hazard.
- `landUse` (array of enum: gruntyZabudowaneIZurbanizowane | gruntyRolne | gruntyLesne | terenyKomunikacyjne | inne | unknown, optional) — Recorded land-use category of the transaction's land. Multi-select from: gruntyZabudowaneIZurbanizowane (built-up and urbanised), gruntyRolne (agricultural), gruntyLesne (forest), terenyKomunikacyjne (transport), inne (other). 'unknown' = no category recorded for the land (NULL) — a legitimate bucket, never a claim that the land has no use. Values are case-sensitive. E.g. ['gruntyRolne'] for farmland, or ['gruntyZabudowaneIZurbanizowane','gruntyRolne'] to compare developed vs farmland.
- `buildingStoreys` (array of string, optional) — Number of above-ground storeys of the building. Multi-select buckets: exact non-negative integers (e.g. '1','2'), 'Nplus' e.g. '3plus' = 3 or more, 'unknown' = no storey count recorded (NULL). Recorded ONLY for single-building transactions, so 'unknown' covers BOTH a deed with several buildings (no single storey count exists) and a single building with missing data — never read it as 'a building with no storeys'. This is NOT the floor of a unit (see floor). Without 'unknown', rows with no storey count are excluded.
- `minFootprintArea` (number, optional) — Minimum building footprint (ground-plan) area in m², summed over all buildings of the transaction. Distinct from minArea, which measures usable floor area (units) or land/parcel area. Set only where every linked building has footprint data, so this bound selects only measured rows — absence means 'not measured', not 'no building'.
- `maxFootprintArea` (number, optional) — Maximum building footprint (ground-plan) area in m², summed over all buildings of the transaction. Distinct from maxArea, which measures usable floor area (units) or land/parcel area. Set only where every linked building has footprint data, so this bound selects only measured rows — absence means 'not measured', not 'no building'.
- `limit` (number, optional, default: 20) — Number of results (1-50, default 20)

---

### 5. `get_market_overview`
**Market Overview**

Get a comprehensive overview of the Polish real estate transaction database.
Returns: total transaction count, date range, breakdown by property type and market type, top locations, price statistics.
Note: data quality varies by field - marketType is unknown for ~55% of records, transaction_date missing for ~1.7%.
Note: median/average prices are market-based — fractional ownership shares and non-market deeds (public tenders, foreclosures, privileged/subsidized sales) are excluded from price aggregates. Transaction counts and coverage stay complete.

_No parameters._

---

### 6. `list_locations`
**List Locations & TERYT Codes**

Browse locations in two modes:
1. TERYT hierarchy (parent param): Navigate voivodeship → county → municipality → precinct. Returns TERYT codes for use in search_transactions(teryt=...).
   - No parent: 16 voivodeships (2-digit codes)
   - 2-digit: counties (4-digit), 4-digit: municipalities (6-digit), 6-digit: precincts
2. Name search (search param): Look up a place by name across all levels (voivodeship, county, municipality, precinct). Each match comes with its TERYT code, its parent unit, and the exact follow-up calls to make — use teryt= for precise administrative filtering. Rows also flagged as RCN districts additionally accept the name in search_transactions(location=)/compare_locations. RCN district names that have no TERYT code are listed separately.
If both provided, parent takes precedence.
Returns administrative units — never streets. A street is not a level of this hierarchy and has no code of its own; to search for parcels on one, pass the name straight to list_parcels_in_area as street=.
Use 'location' for quick city searches, 'teryt' for precise administrative filtering (avoids name ambiguity, e.g. 'Wałcz' is both a county and a municipality).

**Parameters:**

- `parent` (string, optional) — TERYT parent code to browse children. 2-digit (voivodeship → counties), 4-digit (county → municipalities), 6-digit (municipality → precincts). Omit for all voivodeships.
- `search` (string, optional) — Look up a place by name (case-insensitive, diacritics-insensitive partial match, e.g. 'wejher' for Wejherowo). Returns TERYT codes plus, where applicable, RCN district names. Ignored when parent is set.

---

### 7. `search_parcels`
**Search Land Parcels**

Search for land parcels by parcel ID prefix (autocomplete).
Matches on the ID PREFIX only, never on an area: to list the parcels in a place or a shape use list_parcels_in_area, and to turn an address, a coordinate or 'locality + number' into one parcel use resolve_parcel.
Returns matching parcels with their district, area, and GPS coordinates.
Useful for finding exact parcel IDs, then searching transactions nearby.
Example: search for parcels starting with '146518_8.01'.
Coverage: this searches the cadastral register we hold — near-complete national coverage, though not the whole of it and not live — so an empty result more likely means a recent change or a mistyped prefix than that no such parcel exists. Do not report a missing match as "this parcel does not exist". The answer carries a corpus_coverage block with the measured figures for the county the prefix names, and resolve_parcel with the FULL id can still confirm and add a parcel we do not yet hold.
Free: searching for parcels costs no API tokens.

**Parameters:**

- `q` (string, required) — Parcel ID prefix to search for (min 3 chars). E.g. '146518_8.01'
- `limit` (number, optional, default: 10) — Max results (1-10, default 10)

---

### 8. `resolve_parcel`
**Resolve Land Parcel**

Resolve a land parcel to its cadastral identity using exactly ONE of:
- parcelId: a full cadastral id, either raw '/' form ('142907_2.0014.342/5') or URL-safe '-' form ('142907_2.0014.342-5'), or the internal UUID from search results.
- q: a full cadastral id, a UUID, OR free-text 'locality name + parcel number' (e.g. 'Sabnie 342/5'). The name may be a gmina name or a cadastral precinct (obręb) name; matching is exact and case-insensitive, so an unusual spelling may miss. A precinct name is not unique nationwide, so an ambiguous name comes back as several candidates rather than a guess. This is NOT a street address: it is a locality name plus a PARCEL number, never a street name plus a building number. For a city address (street + building number) use list_parcels_in_area(street=, buildingNumber=) instead — resolve_parcel will not turn 'Marszałkowska 12' into a parcel.
- lat & lng: a WGS84 point inside the parcel (returns the parcel(s) containing that point).
Returns a list of matching parcels with district, area, and coordinates; 'truncated' when the name+number match was capped. When nothing matches, coverage is not_covered — and what that means depends on the mode. With a FULL cadastral id we confirm the parcel live and add it if it exists, so not_covered there really does mean we could not confirm one. With the DISCOVERY modes (locality name + number, or a coordinate) we only look at the register we hold — near-complete national coverage, though not the whole of it and not live — so not_covered means "not among the parcels we hold", which is a weaker statement, and a fresh change or an unusual spelling is a likelier cause than the parcel not existing. Never report it as "no such parcel". The corpus_coverage block in each answer says how much of the register was actually searched. When the lookup could not be completed at all — a live confirmation that failed, or a name carried by more precincts than one search covers and nothing found among them — coverage is not_computed instead: that is not a statement that the parcel does not exist. Matches found before such a search ran out are returned normally, with 'truncated'.
Use this to turn an address point, a coordinate, or a locality+number into a concrete parcel id — then feed that id to search_transactions (parcelId) to see its sale history.
Free: resolving a parcel costs no API tokens.

**Parameters:**

- `q` (string, optional) — Full cadastral id, a UUID, or 'locality name + parcel number' (e.g. 'Sabnie 342/5') — the name may be a gmina or a cadastral precinct (obręb). NOT a street address: for a street + building number use list_parcels_in_area instead. Mutually exclusive with parcelId and lat/lng.
- `parcelId` (string, optional) — Full cadastral id (slash or dash form) or internal UUID. Mutually exclusive with q and lat/lng.
- `lat` (number, optional) — Latitude WGS84. Must be paired with lng. Mutually exclusive with q and parcelId.
- `lng` (number, optional) — Longitude WGS84. Must be paired with lat. Mutually exclusive with q and parcelId.

---

### 9. `get_parcel_report`
**Get Parcel Report**

The whole dossier for one land parcel in a single call: the parcel core (location, area, land use, plan designation), all thirteen enrichment layers (flood risk, heritage listing, landslide risk, subsurface: mining terrains and major groundwater reservoirs, nuisance surroundings, public-transport access, general-plan zoning, buildings on the parcel, recent building activity, agricultural-land eligibility, official land-use & soil-quality classification with its re-designation consequences where the county publishes it, nature: nearby forest and protected areas, roads: geometric road-access evidence measured from carriageway centrelines, which is not a determination of legal access), the parcel's transaction history (newest first, up to 20), a local price context (median zł/m² for the county and the locality over the last 12 months) and a municipal context (a headline demographic/economic subset plus upcoming-infrastructure signals for the gmina).
Address it by a full cadastral id in the natural '/' form ('142907_2.0014.342/5'), the URL-safe '-' form, or the internal UUID from a search or resolve result.
Each section carries its own state, shown explicitly: covered = a definitive result; covered_no_data = the parcel was checked and nothing was found (still billed); not_covered = outside our data (refunded); not_computed = a live computation could not finish in time (refunded — the rest of the report still returns, so a report can be partial). The two context sections instead use full / low_sample / suppressed / no_data.
The buildings section additionally reports how many of the buildings could be given a construction-age estimate from building-permit records. That is an ESTIMATE with an interval, never a registry construction date, and the records only start in 2016, so for most buildings the answer is that the year could not be established — which is stated rather than omitted.
Prefer this over calling the per-layer parcel tools one by one — it is one call at a flat price and never costs more than the sum of its parts. Use resolve_parcel first when you only have an address, a coordinate, or a 'locality + number'.
Costs 45 API tokens. Billing is by outcome (see the billing line on the response): a parcel that cannot be resolved is fully refunded; a resolved parcel where no layer had data is billed only the core floor (1 token) with the rest refunded; a resolved parcel with at least one covered layer is billed in full.

**Parameters:**

- `parcelId` (string, required) — Full cadastral id ('142907_2.0014.342/5' or the '-' form) or the internal UUID from a search/resolve result.

---

### 10. `get_parcel_land_class`
**Get Parcel Land Classification**

The official land-use and soil-quality classification recorded for one land parcel, and what it implies for taking the land out of agricultural use. Returns the land-use categories and the soil-quality grades entered for the parcel, whether any of those grades is in the protected I-III range, whether the parcel lies inside a city's administrative boundary (which changes the rule that applies), and a note on the re-designation consequences with the date the legal state behind it was verified.
Use it when the question is specifically about the classification or about re-designating farmland. For anything else about the parcel — price history, flood risk, zoning, buildings, permits, surroundings, transport — call get_parcel_report instead: it is one call at a flat price and includes this same classification as one of its sections.
Address it by a full cadastral id in the natural '/' form ('142907_2.0014.342/5'), the URL-safe '-' form, or the internal UUID from a search or resolve result.
The categories and grades come back as SETS. The source records no area for any of them, so the answer can never say which category prevails on the parcel or give a share — a parcel listing two categories has both, in unknown proportion.
This layer answers only where the county publishes the classification; many counties, including several large cities, do not. Four states, told apart explicitly: covered = the county publishes it and the parcel has an entry; covered_no_data = the county publishes it and this parcel has none (a checked negative — still billed); not_covered = the county does not publish it, or we do not hold the parcel (refunded); not_computed = the lookup could not finish in time (refunded — retry).
Costs 4 API tokens, refunded on not_covered and not_computed. Not legal advice, and never a statement that a parcel can or cannot be built on.

**Parameters:**

- `parcelId` (string, required) — Full cadastral id ('142907_2.0014.342/5' or the '-' form) or the internal UUID from a search/resolve result.

---

### 11. `list_parcels_in_area`
**List Parcels in an Area**

List cadastral parcels in an area — the land plots themselves, NOT transactions.
For deeds and prices in an area use search_by_area or search_by_polygon instead. To look up a parcel by an id prefix use search_parcels; to turn one address, coordinate or 'locality + number' into a parcel use resolve_parcel; for everything known about a single parcel use get_parcel_report.

Name the area in one of five ways — at least one is required:
- teryt: administrative code prefix at any level (2 digits = voivodeship, 4 = county, 6 = municipality, finer allowed); comma-separate several. Browse codes with list_locations.
- location: a county or city NAME, resolved to its code. A name shared by two counties comes back as an error listing both, never as a guess.
- bbox: "minLng,minLat,maxLng,maxLat" in WGS84.
- lat + lng + radiusKm: a circle (all three together).
- polygon: a GeoJSON Polygon, for a drawn shape. Pass it on its own.
A bbox and a circle cannot be combined — together they would mean the overlap of a rectangle and a circle, which is rarely the question.

Two shapes of answer, priced differently:
- Default: the LIGHT list — parcel id, district and centre point per row, with no outline and no surface. 2 API tokens. Pages by cursor: when more parcels match, the answer hands you an opaque cursor to pass back as cursor=.
- includeGeometry=true (needs a bbox), or a polygon: OUTLINES — the full GeoJSON polygon of each parcel. 5 API tokens, at most 100 parcels per call (50 by default), no paging.

Truncation is the normal case on outlines, not an edge case. An area the size of a city holds far more parcels than one call returns, so an outline answer is usually marked TRUNCATED and the parcels in it are an arbitrary subset — not the first, nearest or largest. Never report a truncated answer as the parcel list of an area; ask for a smaller area instead.

minArea / maxArea (m²) filter on the registered parcel surface without returning it. They need a narrow scope — a bbox, a circle, a location name, or a teryt of at least 4 digits (county level) — and are refused elsewhere with a message saying what to add. They are not available on the outline calls.

Every row of the light list carries the street address held for that parcel, whether or not you asked about one, and says where it came from: a street on record, one we worked out for a parcel the record left without a street (shown with a note saying so), or — only when a buildingNumber search on the record came back empty — one read off an official address point that falls inside the parcel (also noted). A building number is only ever on record or from that address point, so a worked-out street never carries one. When a page comes back with a requested buildingNumber, it also carries a note on which of the two the number came from. If the street exists in the area but not with that number, the answer says so instead of the generic "no such street". Most rural parcels have no street at all — for those the way in is resolve_parcel with the precinct name and the parcel number, not a street.
- street: matches whole words of the name, case- and accent-insensitively — 4 letters or digits minimum, 200 characters maximum. It is a NAME, not a pattern: % and _ match themselves. 'Górna' finds 'ulica Górna' and 'Górna 15' but not 'Podgórna', and a fragment like 'Marsza' finds nothing. Both sources are searched at once and a parcel found in both appears once, attributed to the record. Matching folds accents, so 'karmelicka' finds 'Karmelicka' — but it does NOT inflect: pass the name in the NOMINATIVE, because an inflected form like 'Karmelickiej' answers with an empty list. That empty page costs nothing (the tokens are refunded) and carries a suggestions block with close names to retry, so read the suggestions before you conclude anything about the data.
- buildingNumber: needs street alongside it. Against the record the match is EXACT ('12A' does not find '12a'); RCN often records a compound or split number ('84/92'), so an exact '84' will not find '84/92'. When that comes back empty, the same street+number is tried against official address points instead — that match ignores case ('12a' finds '12A') but is still exact on the number, no compound splitting, and it matches the street by the same whole-word rule as above, not a fragment ('Waszyngtona' finds 'Aleja Waszyngtona', 'szyng' does not). Only when BOTH miss does the page come back empty (the tokens are refunded), listing the numbers held on the street as suggestions to retry.
Both need a narrow scope for the same reason minArea does — a bbox, a circle, a teryt of at least 4 digits, or a location name — and neither counts as naming the area: a common street name across the country is a national search, not a question. Neither is available on the outline calls.

Parcel identity is gated: parcel_id comes back for API-token / OAuth callers and for paid or active-trial accounts, and is withheld for everyone else while the location and the outline still come back.

Coverage, so you can allow for it — TWO SEPARATE GAPS:
1. We hold near-complete coverage of the cadastral register, though not the whole of it and not live: what we hold was measured county by county on a fixed date, so a freshly split, merged or renumbered parcel may not be in yet. This applies to EVERY entrance here, teryt and location included. A short list, and the absence of a truncation marker, mean only that nothing further matched what we hold as of that measurement — never that you have every parcel in the area. Each answer carries a corpus_coverage block: for teryt and location it gives the measured parcels-held and parcels-in-register figures for the counties you asked about; for bbox, circle and polygon those figures are null, because sizing an arbitrary shape needs county boundaries we do not have — the measurement still applies, we just cannot put a number on it for that shape.
2. Separately, the spatial entrances (bbox, circle, polygon) work off the stored outline, and a small share of the parcels we DO hold keep theirs in a coordinate system those queries cannot read — those are missing from spatial answers specifically. The teryt and location entrances never touch geometry and are unaffected BY THAT SECOND GAP; a parcel whose outline we do not hold shows up there with no location.
Neither gap is a reason to distrust what comes back: a returned parcel is a real parcel. They are a reason never to read an empty or short answer as evidence that the land is not there.

Limits: an area over 500 km², a radius over 12.6 km (the same ground) or a polygon over 500 vertices is refused rather than scanned, and a query that outruns its time limit answers with an error asking you to narrow it.

**Parameters:**

- `teryt` (string, optional) — TERYT administrative code prefix (2/4/6 digits or finer), comma-separated for several. Wins over location when both are given.
- `location` (string, optional) — County, city, or district name, resolved to its TERYT code. A Warszawa district name (e.g. 'Mokotów') narrows to that district; another city's delegatura (e.g. 'Kraków-Podgórze') resolves to its parent county. An ambiguous name is an error listing the candidates.
- `bbox` (string, optional) — Bounding box in WGS84 as "minLng,minLat,maxLng,maxLat", covering at most 500 km². Required for includeGeometry=true.
- `lat` (number, optional) — Latitude of the circle centre (WGS84). Requires lng and radiusKm.
- `lng` (number, optional) — Longitude of the circle centre (WGS84). Requires lat and radiusKm.
- `radiusKm` (number, optional) — Circle radius in km (max 12.6 — the radius covering the 500 km² ceiling). Requires lat and lng.
- `polygon` (effects, optional) — GeoJSON Polygon geometry. Coordinates: [longitude, latitude] pairs, first and last point identical, at most 500 vertices. Always returns outlines. Pass it instead of the other area parameters, not alongside them.
- `minArea` (number, optional) — Minimum parcel surface in m². Needs a bbox, a circle, a location name, or a teryt of at least 4 digits. Not available with includeGeometry or a polygon.
- `maxArea` (number, optional) — Maximum parcel surface in m². Same scope requirement as minArea.
- `street` (string, optional) — Street name, matched by whole words within the name, case- and accent-insensitively (min 4 letters or digits): 'Górna' finds 'ulica Górna' and 'Górna 15' but not 'Podgórna', and a fragment like 'Marsza' finds nothing. NOMINATIVE: 'Karmelickiej' does not fold to 'Karmelicka' and answers empty. Needs a bbox, a circle, a location name, or a teryt of at least 4 digits. Not available with includeGeometry or a polygon.
- `buildingNumber` (string, optional) — Building number. Against the record the match is exact ('12A' does not find '12a') and RCN numbering is often compound ('84/92'), so an exact '84' misses '84/92'. When that comes back empty, the same number is tried against official address points instead, case-insensitively ('12a' finds '12A') but still exact, matching the street by the same whole-word rule as street, not a fragment — if that also misses, drop the number and read the numbers off the street's rows. Requires street. Same scope requirement as street.
- `includeGeometry` (boolean, optional) — Return each parcel's full outline instead of the light row (5 tokens instead of 2, at most 100 parcels, no paging). Requires a bbox; with a polygon the outlines come back anyway.
- `limit` (number, optional) — Max parcels returned. Light list: up to 1000, default 250. Outlines: up to 100, default 50 — a larger value is clamped there.
- `cursor` (string, optional) — Opaque cursor from the previous light-list answer, to get the next page. Pass it back unchanged; it is not available on outline calls.

---

### 12. `search_by_polygon`
**Search Transactions by Polygon**

Search real estate transactions within a geographic polygon.
Returns TRANSACTIONS — deeds and prices — despite the name. For the land plots themselves inside a drawn shape, pass the same polygon to list_parcels_in_area.
Provide a GeoJSON Polygon geometry to search within a custom area.
Returns transactions found inside the polygon with coordinates.
Use for precise neighborhood/osiedle boundaries. Can estimate coordinates from search_by_area results. For quick searches, start with search_by_area instead.
Coordinates are [longitude, latitude]. First and last point must be identical.
Permalink: every result is shareable on the map. From a result's "id:" line and its "Location: <A>°N, <B>°E" line, build https://cenogram.pl/ceny-transakcyjne?src=mcpstdio#v=1&lat=<A>&lng=<B>&z=16&tx=<id> (drop the °N/°E; lat = the °N number, lng = the °E number) — opens that exact transaction on the map. Omit &tx=<id> for the area only.
Field provenance: values are from the notarial deed (RCN) by default; computed values (parcel area summed across plots or converted from hectares, an inferred/reclassified property type) and approximated streets are flagged inline with a neutral [...] note.
Example: {"type":"Polygon","coordinates":[[[21.0,52.2],[21.01,52.2],[21.01,52.21],[21.0,52.21],[21.0,52.2]]]}

**Parameters:**

- `polygon` (effects, required) — GeoJSON Polygon geometry. Coordinates: [longitude, latitude] pairs. First and last point must be identical. Max 500 vertices total.
- `propertyType` (enum: land | building | developed_land | unit, optional) — Property type filter
- `marketType` (enum: primary | secondary, optional) — Market type filter
- `unitFunction` (enum: residential | commercial | office | production | garage | other | unknown, optional) — Unit/apartment function filter. 'unknown' = no function recorded (NULL); without it such rows are excluded. Garages appear only when 'garage' is selected, not via 'unknown'.
- `buildingType` (enum: residential | commercial | industrial | transport | office | warehouse | education_sports | farm_utility | hospital | other_nonresidential | unknown, optional) — Building type filter (PKOB classification). 'unknown' = no type recorded (NULL); without it such rows are excluded (~39% of buildings have no type).
- `ownershipType` (array of enum: land_ownership | perpetual_usufruct | cooperative_ownership | unit_sale | ownership | unit_ownership_with_appurtenant_right | building_ownership_with_appurtenant_right | unknown, optional) — Ownership / legal-right type filter (rodzaj prawa do nieruchomości). land_ownership; perpetual_usufruct (użytkowanie wieczyste — covers both registry codes for this right); cooperative_ownership; unit_sale; ownership; unit_ownership_with_appurtenant_right; building_ownership_with_appurtenant_right. 'unknown' = no right recorded (NULL). Multi-select; e.g. ['land_ownership','perpetual_usufruct'] to compare ownership vs perpetual usufruct on undeveloped land.
- `mpzpDesignation` (string, optional) — MPZP zoning designation filter (exact match). Use 'unknown' for rows with no designation recorded (NULL); distinct from the registry code 'brakMPZPLubWZ'.
- `transactionType` (array of enum: free_market | auction | non_auction | subsidized | public_purpose | foreclosure | unknown, optional) — Transaction type filter. For market analysis, ALWAYS specify to exclude non-market transactions.
- `rooms` (array of enum: 1 | 2 | 3 | 4 | 5 | 6 | 7 | 8plus | unknown, optional) — Number of rooms (izby) filter, residential units only. Multi-select; '8plus' means 8 or more, 'unknown' = no room count recorded (NULL). E.g. ['2','3'] for 2-3 izby flats. Without 'unknown', rows with no room count are excluded.
- `floor` (array of string, optional) — Floor of the unit (piętro lokalu, residential). Multi-select buckets: exact integers incl. '0' (parter) and negatives e.g. '-1' (basement), 'Nplus' e.g. '10plus' = 10 or more, '0plus' = ground and above, 'unknown' = no floor recorded (NULL). E.g. ['0','1','2'] for ground-to-2nd floor. Building storeys are a different attribute. Without 'unknown', rows with no floor are excluded.
- `minPrice` (number, optional) — Minimum price in PLN
- `maxPrice` (number, optional) — Maximum price in PLN
- `dateFrom` (string, optional) — Start date (YYYY-MM-DD)
- `dateTo` (string, optional) — End date (YYYY-MM-DD)
- `minArea` (number, optional) — Minimum area in m²
- `maxArea` (number, optional) — Maximum area in m²
- `district` (string, optional) — District name filter
- `street` (string, optional) — Street name filter (partial match)
- `landUse` (array of enum: gruntyZabudowaneIZurbanizowane | gruntyRolne | gruntyLesne | terenyKomunikacyjne | inne | unknown, optional) — Recorded land-use category of the transaction's land. Multi-select from: gruntyZabudowaneIZurbanizowane (built-up and urbanised), gruntyRolne (agricultural), gruntyLesne (forest), terenyKomunikacyjne (transport), inne (other). 'unknown' = no category recorded for the land (NULL) — a legitimate bucket, never a claim that the land has no use. Values are case-sensitive. E.g. ['gruntyRolne'] for farmland, or ['gruntyZabudowaneIZurbanizowane','gruntyRolne'] to compare developed vs farmland.
- `buildingStoreys` (array of string, optional) — Number of above-ground storeys of the building. Multi-select buckets: exact non-negative integers (e.g. '1','2'), 'Nplus' e.g. '3plus' = 3 or more, 'unknown' = no storey count recorded (NULL). Recorded ONLY for single-building transactions, so 'unknown' covers BOTH a deed with several buildings (no single storey count exists) and a single building with missing data — never read it as 'a building with no storeys'. This is NOT the floor of a unit (see floor). Without 'unknown', rows with no storey count are excluded.
- `minFootprintArea` (number, optional) — Minimum building footprint (ground-plan) area in m², summed over all buildings of the transaction. Distinct from minArea, which measures usable floor area (units) or land/parcel area. Set only where every linked building has footprint data, so this bound selects only measured rows — absence means 'not measured', not 'no building'.
- `maxFootprintArea` (number, optional) — Maximum building footprint (ground-plan) area in m², summed over all buildings of the transaction. Distinct from maxArea, which measures usable floor area (units) or land/parcel area. Set only where every linked building has footprint data, so this bound selects only measured rows — absence means 'not measured', not 'no building'.
- `limit` (number, optional, default: 100) — Max results (1-3000, default 100). MCP displays up to 50 transactions.

---

### 13. `compare_locations`
**Compare Locations**

Compare real estate statistics across multiple locations side-by-side.
Provide 2-5 district names to compare median price/m², average area, and transaction counts.
This tool matches on name only. Call list_locations(search=...) first: use names it flags as RCN districts (rcn_district) — other names (most TERYT unit names) silently return no data here.
Requires at least one filter besides districts (e.g., propertyType).
Example: compare Mokotów, Wola, Ursynów for apartments.
Note: median/average prices are market-based — fractional ownership shares and non-market deeds (public tenders, foreclosures, privileged/subsidized sales) are excluded from price aggregates. Transaction counts and coverage stay complete.

**Parameters:**

- `districts` (effects, required) — Comma-separated district names to compare (2-5, must be unique). E.g. 'Mokotów,Wola,Ursynów'
- `propertyType` (enum: land | building | developed_land | unit, optional) — Property type filter (recommended - API requires at least one filter)
- `marketType` (enum: primary | secondary, optional) — Market type filter
- `unitFunction` (enum: residential | commercial | office | production | garage | other | unknown, optional) — Unit/apartment function filter. 'unknown' = no function recorded (NULL); without it such rows are excluded. Garages appear only when 'garage' is selected, not via 'unknown'.
- `buildingType` (enum: residential | commercial | industrial | transport | office | warehouse | education_sports | farm_utility | hospital | other_nonresidential | unknown, optional) — Building type filter (PKOB classification). 'unknown' = no type recorded (NULL); without it such rows are excluded (~39% of buildings have no type).
- `ownershipType` (array of enum: land_ownership | perpetual_usufruct | cooperative_ownership | unit_sale | ownership | unit_ownership_with_appurtenant_right | building_ownership_with_appurtenant_right | unknown, optional) — Ownership / legal-right type filter (rodzaj prawa do nieruchomości). land_ownership; perpetual_usufruct (użytkowanie wieczyste — covers both registry codes for this right); cooperative_ownership; unit_sale; ownership; unit_ownership_with_appurtenant_right; building_ownership_with_appurtenant_right. 'unknown' = no right recorded (NULL). Multi-select; e.g. ['land_ownership','perpetual_usufruct'] to compare ownership vs perpetual usufruct on undeveloped land.
- `mpzpDesignation` (string, optional) — MPZP zoning designation prefix filter (e.g. 'terenRolniczy', 'budownictwoMieszkanioweJednorodzinne', 'budownictwoMieszkanioweWielorodzinne'). Use 'unknown' for rows with no designation recorded (NULL); distinct from the registry code 'brakMPZPLubWZ'.
- `transactionType` (array of enum: free_market | auction | non_auction | subsidized | public_purpose | foreclosure | unknown, optional) — Transaction type filter. For market analysis, ALWAYS specify to exclude non-market transactions.
- `minPrice` (number, optional) — Minimum price in PLN
- `maxPrice` (number, optional) — Maximum price in PLN
- `dateFrom` (string, optional) — Start date (YYYY-MM-DD)
- `dateTo` (string, optional) — End date (YYYY-MM-DD)
- `minArea` (number, optional) — Minimum area in m²
- `maxArea` (number, optional) — Maximum area in m²
- `street` (string, optional) — Street name filter
- `rooms` (array of enum: 1 | 2 | 3 | 4 | 5 | 6 | 7 | 8plus | unknown, optional) — Number of rooms (izby) filter, residential units only. Multi-select; '8plus' means 8 or more, 'unknown' = no room count recorded (NULL). E.g. ['2','3'] for 2-3 izby flats. Without 'unknown', rows with no room count are excluded.
- `floor` (array of string, optional) — Floor of the unit (piętro lokalu, residential). Multi-select buckets: exact integers incl. '0' (parter) and negatives e.g. '-1' (basement), 'Nplus' e.g. '10plus' = 10 or more, '0plus' = ground and above, 'unknown' = no floor recorded (NULL). E.g. ['0','1','2'] for ground-to-2nd floor. Building storeys are a different attribute. Without 'unknown', rows with no floor are excluded.
- `includeDemographics` (boolean, optional) — Add a GUS BDL demographics block per district (county-level: population density, wages, unemployment, median age, plus a few cross-source ratios like price-to-income). Districts that don't resolve to a county are omitted from the demographics section.

---

### 14. `get_demographics`
**Demographics & Local Statistics**

Demographic, economic, housing and other local statistics for a Polish location, from GUS BDL (Bank Danych Lokalnych) — Poland's public Central Statistical Office open-data bank. ~50 indicators across 11 categories (population, economy, housing, spatial planning, infrastructure, environment, safety, education, prices) plus a few derived metrics.
Address by location (city/county name) OR teryt. A name resolves to county/powiat (4-digit) level; for richer gmina/district-level data (L6) pass a 6 or 7-digit teryt. teryt wins when both are given. Use list_locations to find TERYT codes — neighborhoods/osiedla are NOT addressable here.
A query returns the requested level PLUS all parent levels (a gmina query also yields powiat, NUTS3 region and voivodeship indicators). Optional year, or yearFrom+yearTo for a time series, and category to filter. Cost: 1 token.

**Parameters:**

- `location` (string, optional) — City, county, or district name (e.g. 'Warszawa', 'Kraków'). A city/county name resolves to county/powiat level; a Warszawa district name (e.g. 'Mokotów') resolves to that district, another city's delegatura (e.g. 'Kraków-Podgórze') to its parent county. Use this OR teryt. For gmina-level data on other units pass a 6/7-digit teryt instead.
- `teryt` (string, optional) — TERYT code: 2-digit (voivodeship, e.g. 14), 4-digit (county, e.g. 1465), 6 or 7-digit (gmina, e.g. 1465011). The 7th digit selects the unit type: 3 = urban-rural gmina overall, 4/5 = urban/rural part only, 8 = Warszawa district (1465011 = all of Warszawa, 1465108 = Śródmieście). Wins over location. Use list_locations to find codes.
- `year` (number, optional) — Single year (2003-present). Mutually exclusive with yearFrom/yearTo. Omit for the latest available year per indicator.
- `yearFrom` (number, optional) — Start year for a time series (min 2003).
- `yearTo` (number, optional) — End year for a time series (max current year + 1).
- `category` (array of enum: demographics | economy | economy_macro | housing | planning | infrastructure | environment | safety | re_market | education | prices, optional) — Filter to these categories. Omit to return all available.

---

### 15. `get_infrastructure_signals`
**Infrastructure Signals**

Signals that a Polish municipality is about to build infrastructure — sewerage, water supply, roads, street lighting, gas network or cycling infrastructure. Three independent public sources: tenders published in the national public procurement bulletin (rolling 12-month window), membership in an agglomeration of the national urban waste-water treatment programme (where collective sewerage exists or is planned), and the municipality's own planned capital expenditure from its multi-year financial forecast.
Address by location (city/county name → aggregates every municipality in that county) OR teryt (6-7 digits = one municipality, 4 digits = a county aggregate). teryt wins when both are given. Use list_locations to find codes.
Known limits, state them when you report results: the bulletin carries only contracts BELOW the EU procurement thresholds (from 2021), so the largest investments are not visible here. A tender is attributed to the SEAT of the contracting authority, not to the works location — county and national authorities tender works in other municipalities. The category counters therefore include municipal authorities only, while the recent-notice list shows every authority with a flag. Absence of tenders is NOT evidence that a municipality is not investing.
Cost: 1 token.

**Parameters:**

- `location` (string, optional) — City, county, or district name (e.g. 'Warszawa', 'Krotoszyn'). A city/county name aggregates every municipality in the county; a Warszawa district name (e.g. 'Mokotów') narrows to that gmina, another city's delegatura (e.g. 'Kraków-Podgórze') resolves to its parent county. Use this OR teryt.
- `teryt` (string, optional) — TERYT code: 6 or 7 digits = one municipality (e.g. 146501), 4 digits = a county aggregate (e.g. 1465). Wins over location.

---

### 16. `estimate_value`
**[Beta] Apartment Value Estimate**

[Beta] Estimate the market value of an apartment from comparable registered transaction prices near a point. An orientation estimate, NOT a certified appraisal (operat szacunkowy) — it does not account for the unit's condition, finish standard or floor, and does not replace a surveyor's valuation.
Address by lat + lng (a point on the map) OR parcelId (a full cadastral id or internal UUID; the parcel centroid is used) — exactly one. area (usable area in m², 10–250) is REQUIRED: there is no per-address floor-area source in Poland, so the caller supplies it.
Optional: rooms (1–10) and market (primary/secondary) narrow the comparables; includeComps (default true) echoes the nearest comparables it weighed.
Returns the point estimate, a likely and a wide value range, a confidence band, the comparable count, and an as_of date. as_of reflects transaction-data freshness, which lags by county — estimates are NOT directly comparable across cities with different as_of.
Apartments only (v1), 10–250 m². Too few comparables near the point → no estimate (the credit is refunded). Costs 5 API tokens, refunded when no estimate is produced. Note: median/average prices are market-based — fractional ownership shares and non-market deeds (public tenders, foreclosures, privileged/subsidized sales) are excluded from price aggregates. Transaction counts and coverage stay complete.

**Parameters:**

- `lat` (number, optional) — Latitude of the apartment (WGS84, Poland). Must be paired with lng. Use this OR parcelId.
- `lng` (number, optional) — Longitude of the apartment (WGS84, Poland). Must be paired with lat. Use this OR parcelId.
- `parcelId` (string, optional) — Full cadastral id (slash or dash form) or internal UUID; the parcel centroid is used. Use instead of lat/lng.
- `area` (number, required) — Apartment usable area in m² (REQUIRED, 10–250). Estimates for 300+ m² are unreliable and rejected.
- `rooms` (number, optional) — Room count (1–10, optional) — narrows the comparables to ±1 room.
- `market` (enum: primary | secondary, optional) — Restrict comparables to the primary (new-build) or secondary market (optional).
- `includeComps` (boolean, optional) — Echo the nearest comparables the estimate weighed (default true). Set false for the estimate only.

---

### 17. `get_building_breakdown`
**Building-by-Building Breakdown**

Get the building-by-building breakdown for one transaction: footprint area, number of storeys, and estimated total floor area (footprint × storeys) for each building on the property.
search_transactions / search_by_area / search_by_polygon return per-transaction building SUMS inline; this tool splits them into individual buildings. Use it after a search when a result has building data and you need the detail (e.g. a developed-land deed covering several buildings).
Each building also carries a construction-age estimate derived from building-permit records. It is an ESTIMATE with an interval, never a registry construction date, and the records only start in 2016 — so for most buildings the honest answer is "construction year not established", which is stated explicitly rather than left out.
The transaction_id is the id shown on a search result that has building data. Cost: 4 tokens. Returns nothing for a transaction with no buildings.

**Parameters:**

- `transaction_id` (string, required) — Transaction id (UUID) from a search_transactions / search_by_area / search_by_polygon result that carries building data.

---

### 18. `get_transaction_flood`
**Transaction Flood-Hazard Breakdown**

Get the parcel-by-parcel flood-hazard breakdown for one transaction: for each linked plot that sits in a mapped flood zone — the worst hazard category (high/medium/low, i.e. ~1-in-10-year to ~1-in-500-year), the hazard type (river/coastal/infrastructure), the share of the plot inside the zone, and the full per-scenario list (each with its return period).
search_transactions (and search_by_area) surface a per-transaction worst-case flood_risk inline; this tool splits that into the individual parcels and scenarios behind it. Use it after a search when a result shows flood_risk. (search_by_polygon does not include flood inline.)
TWO-STATE: a transaction whose land is in no mapped zone returns nothing — absence of a zone is never asserted as "safe". Cost: 4 tokens (refunded when there is no flood data).

**Parameters:**

- `transaction_id` (string, required) — Transaction id (UUID) from a search_transactions / search_by_area / search_by_polygon result.

---

### 19. `get_transaction_heritage`
**Transaction Heritage-Listing Breakdown**

Get the parcel-by-parcel heritage-listing breakdown for one transaction: for each linked plot with a detected heritage listing — the status (listed = a protected monument on/at the plot; zone = the plot lies within a protected urban layout or the designated surroundings of a monument), the share of the plot inside the protected area (when measurable), and the individual entries (category, name, function, period, entry date).
search_transactions (and search_by_area) surface a per-transaction heritage_status inline; this tool splits that into the individual parcels and entries behind it. Use it after a search when a result shows a heritage listing. (search_by_polygon does not include heritage inline.)
TWO-STATE: a transaction with no detected listing returns nothing — absence of a detection is never asserted as "not listed". Indicative data — the regional heritage conservator makes the final, binding determination. Cost: 4 tokens (refunded when there is no heritage data).

**Parameters:**

- `transaction_id` (string, required) — Transaction id (UUID) from a search_transactions / search_by_area / search_by_polygon result.

---

### 20. `get_transaction_landslide`
**Transaction Landslide-Hazard Breakdown**

Get the parcel-by-parcel landslide-hazard breakdown for one transaction, based on official landslide-hazard maps (1:10,000 scale): for each linked plot that intersects a mapped hazard area — the worst category ('landslide' = a mapped landslide area, 'threatened' = an area threatened by mass movements), the share of the plot inside the mapped zones, and the per-zone list (each with its source_version_date — the source-record version date, not a survey/observation date).
An intersection at this scale means the parcel overlaps a mapped hazard area, not that the parcel itself is a landslide.
search_transactions (and search_by_area) surface a per-transaction worst-case landslide_risk inline; this tool splits that into the individual parcels and zones behind it. Use it after a search when a result shows a landslide risk. (search_by_polygon does not include landslide inline.)
TWO-STATE: a transaction whose land is in no mapped zone returns nothing — absence of data is never an assertion of safety. Cost: 4 tokens (refunded when there is no landslide data).

**Parameters:**

- `transaction_id` (string, required) — Transaction id (UUID) from a search_transactions / search_by_area / search_by_polygon result.

---

### 21. `get_transaction_subsurface`
**Transaction Subsurface Breakdown**

Get the parcel-by-parcel subsurface breakdown for one transaction across two dimensions: mining terrains and major groundwater reservoirs. For each linked plot that overlaps either — the mining-terrain status ('active' | 'former') with its mineral class ('subsidence' = extraction with surface deformation, the actual mining-damage risk; 'surface' = open-pit working, mostly local impact; 'fluid' = borehole extraction; 'other'), the groundwater-reservoir status ('documented' | 'undocumented'), the share of the plot inside each, and the per-object lists (mining terrain: name, oversight authority, validity dates; reservoir: number, name, documentation).
A mining terrain is a legally defined zone of anticipated mining influence; its mapped location is approximate — an intersection is an advisory signal to verify with the competent mining-supervision authority, not a legal determination. A groundwater reservoir's extent alone imposes NO restriction; a restriction would come only from an established protection zone, which is not published here.
Use it for a specific transaction to see whether its land overlaps a mining terrain or a major groundwater reservoir, and the per-object detail. get_parcel_report includes a one-line subsurface summary per parcel.
TWO-STATE: a transaction whose land overlaps neither layer returns nothing — absence of data is never an assertion of safety. Cost: 4 tokens (refunded when there is no subsurface data).

**Parameters:**

- `transaction_id` (string, required) — Transaction id (UUID) from a search_transactions / search_by_area / search_by_polygon result.

---

### 22. `get_transaction_roads`
**Transaction Road Access**

Get the plot-by-plot road-access evidence for one transaction: for each linked plot, the distance in meters to the nearest public road, to the nearest road of any kind, and to the nearest motorway/expressway/dual-carriageway — plus, for the nearest public road, the estimated distance to the EDGE of its carriageway, its management category ('national' | 'voivodeship' | 'county' | 'municipal'), its functional class ('motorway' | 'expressway' | 'main_accelerated' | 'main' | 'collector' | 'local' | 'access' | 'other') and whether it runs at ground level (false = it crosses on a viaduct or in a tunnel, so it passes the plot over or under it). Each plot also carries access_indicator ('likely' | 'uncertain' | 'unlikely') and the version of the rule that produced it.
access_indicator is GEOMETRIC EVIDENCE measured from carriageway centrelines in reference road-network data. It does NOT determine legal access and says nothing about easements or rights of way, which are recorded in the land register and are not published here — treat it as a lead to verify, never as a conclusion. That is why it has three states and is never a yes/no.
Each measurement has a fixed radius: public road 500 m, road of any kind 500 m, motorway/expressway/dual-carriageway 3 km (that last one is a traffic-nuisance proxy, not an access signal). public_road_edge_distance_m is null when the source carries no carriageway width — no median is substituted.
Use it for a specific transaction to judge how its land sits relative to the road network. get_parcel_report includes a one-line road-access summary per parcel.
TWO-STATE: a null/absent distance means no such road within the search radius in the reference data — it is NEVER a guarantee that none exists. assessed=false means the plot has not been evaluated yet (no statement either way). Cost: 4 tokens (refunded when there is no informative data — no linked plots, or none evaluated yet).

**Parameters:**

- `transaction_id` (string, required) — Transaction id (UUID) from a search_transactions / search_by_area / search_by_polygon result.

---

### 23. `get_transaction_surroundings`
**Transaction Surroundings Breakdown**

Get the plot-by-plot surroundings profile for one transaction: for each linked plot, the distance in meters to the nearest cemetery, landfill (waste disposal site), sewage treatment plant, industrial/storage area, large industrial plant, intensive livestock farm, high-voltage overhead power line and extra-high-voltage overhead power line, from reference land-use and environmental-registry data. Useful for due-diligence on nearby nuisances.
Distances are approximate and measured from the plot boundary; 0 means the plot touches or overlaps such an area. Each category is searched within a fixed radius only: cemetery 1 km, landfill 3 km, sewage treatment 2 km, industrial/storage 1 km, large industrial plant 3 km, intensive livestock farm 3 km, high-voltage overhead power line 1 km, extra-high-voltage overhead power line 1 km. Only overhead high- and extra-high-voltage lines are covered — medium- and low-voltage lines are ubiquitous and carry no signal, and no easement corridor width or substation is published here.
TWO-STATE: a null/absent distance means no such object within the search radius in the reference data — it is NEVER a guarantee that none exists. assessed=false means the plot has not been evaluated yet (no statement either way). Cost: 4 tokens (refunded when there is no informative data — no linked plots, or none evaluated yet).

**Parameters:**

- `transaction_id` (string, required) — Transaction id (UUID) from a search_transactions / search_by_area / search_by_polygon result.

---

### 24. `get_transaction_transit`
**Transaction Public Transport Access Breakdown**

Get the parcel-by-parcel public transport access breakdown for one transaction: for each linked plot, the nearest public transport stop distances per transaction parcel, by mode (rail/metro/tram/bus), from open GTFS data — plus the nearest stop's name for each mode present.
A mode is present only when a stop of that mode is within its cap (rail/metro 3000 m, tram 1500 m, bus 1000 m).
TWO-STATE: a transaction whose land has no stop within cap in any mode returns nothing — absence of a row is never asserted as "no transit access" (open feeds cover cities and national rail, not every rural area). Cost: 4 tokens (refunded when there is no transit data).

**Parameters:**

- `transaction_id` (string, required) — Transaction id (UUID) from a search_transactions / search_by_area / search_by_polygon result.

---

### 25. `get_transaction_permits`
**Transaction Building-Permit History**

Get the building-permit history for one transaction's parcels, from the official national registry of building permits and works notifications (records since 2016): for each case — its kind (permit / notification), the building intent and works type, the statutory object category, the deciding authority, the decision or intake date, the investment address, and the volume.
Use it after a search to screen what has been built or approved on the transaction's land — a leading indicator of development activity. Match is by the parcel's current identifier, so splits/merges break the link. Permits are held once a decision has been issued; the outcome of that decision, granted or refused, is not part of the data held here. Notifications are held only where they were accepted without objection. Cases still pending are not held at all.
TWO-STATE: a transaction whose parcels have no registered case returns nothing — an empty result is never a confirmation that nothing was ever planned. Cost: 4 tokens (refunded when there is no record).

**Parameters:**

- `transaction_id` (string, required) — Transaction id (UUID) from a search_transactions / search_by_area / search_by_polygon result.

---

### 26. `get_transaction_planning`
**Transaction General-Plan Zoning**

Get the general-plan (plan ogólny, POG) zoning for one transaction's land: for each linked plot, the planning zones that cover it — zone symbol and name, the share of the plot each zone covers, and the building parameters the plan sets (max building height, max development intensity, max built-up coverage, min biologically active area) — plus any overlay areas (infill development area / obszar uzupełnienia zabudowy, central development area) that sit on top.
Coverage is honest and THREE-STATE: 'covered' returns zone data; 'covered_no_data' means the municipality has an adopted general plan but no zone data covers these plots in the data yet; 'not_covered' means no published general-plan data for this municipality yet — this is NEVER a claim that the municipality has no plan. General plans are still being adopted across Poland, so coverage grows over time.
Use it for feasibility and permitted-use questions on a plot. Cost: 4 tokens (refunded when there is no zone data for the transaction — 'covered_no_data' or 'not_covered').

**Parameters:**

- `transaction_id` (string, required) — Transaction id (UUID) from a search_transactions / search_by_area / search_by_polygon result.

---

### 27. `get_transaction_farmland`
**Transaction Agricultural Land-Eligibility Breakdown**

Get the parcel-by-parcel agricultural land-eligibility breakdown for one transaction, from official nationwide agricultural land-eligibility data (updated weekly): for each linked parcel with a matched eligible agricultural area — the eligible area in square metres, its share of the parcel (when the parcel's measured area is known), and how many source features compose it. The response also reports how many of the transaction's linked parcels carry a match and the source snapshot date. Useful for due-diligence on land that is actually eligible/maintained as agricultural (beyond what a registry classification says on paper).
TWO-STATE: a parcel with no matched eligible area returns nothing — absence of a match is NEVER a statement that the property is non-agricultural (small plots that are not actively farmed are simply absent, the reference layer has its own update cadence, and older transactions can reference renumbered parcels). Cost: 4 tokens (refunded when there is no eligible agricultural area for the linked parcels).

**Parameters:**

- `transaction_id` (string, required) — Transaction id (UUID) from a search_transactions / search_by_area / search_by_polygon result.

---

### 28. `get_transaction_nature`
**Transaction Nature (Forest & Protected Areas) Breakdown**

Get the parcel-by-parcel nature breakdown for one transaction: for each linked plot with a nature signal — the nearest forest within 2 km (forest_distance_m in metres, 0 = the plot overlaps forest, with its overlap share) and any overlapping protected natural areas: the sharpest form (protection_rank 1 = national park, 2 = nature reserve, 3 = Natura 2000, 4 = landscape park, 5 = protected landscape, 6 = other), building_restriction ('statutory_ban' = a build ban that follows directly from the Nature Protection Act for national parks and reserves, 'conditional' = restrictions depend on the act that established the area), the share of the plot under protection, and the named areas.
This describes the SOURCE of a restriction (statute vs the establishing act), never the outcome of a specific permitting case, and is not legal advice. Forest is an amenity signal (proximity), protected areas a due-diligence one (build limits).
Search results do not carry a nature signal, so call this tool directly on a transaction id whenever forest proximity or protected-area build limits matter. Use it after a search on land plots.
An empty result is NEVER a statement that building is allowed — this layer does not cover local zoning plans, planning-permission decisions or areas under designation. A buffer zone around a park or reserve IS reported, as form 'buffer_zone' at rank 6, and never as a statutory ban. An empty result also says which kind of empty it is: either the plots were checked and carry no signal, or no nature reference data is held for them yet and nothing was checked — the second is never a finding that there is no forest or protected area. Cost: 4 tokens (refunded on any empty result).

**Parameters:**

- `transaction_id` (string, required) — Transaction id (UUID) from a search_transactions / search_by_area / search_by_polygon result.

