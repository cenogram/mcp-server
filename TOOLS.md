# Cenogram MCP Server — Tool Reference

> Auto-generated from the server's tool definitions by `npm run docs:generate`. Do not edit by hand.

8M+ verified real estate transactions from Poland's official RCN registry (Rejestr Cen
Nieruchomości) — transaction prices from notarial deeds, not asking prices. Data from 2003,
380 counties, refreshed roughly every two weeks.

This reference lists the **30** tools available by default. Additional
experimental tools may be enabled server-side and are intentionally not documented here.

---
### 1. `search_transactions`
**Search Real Estate Transactions**

Find individual Polish real-estate transactions from the national RCN registry (8M+ notarial deeds, not asking prices) by place, property type, price, area, date or street. Returns address, date, price, area, price/m² and property type.
Resolve the place first: list_locations(search=...), then pass its TERYT code as teryt= (exact match). Use location= only for a name that result flags as an RCN district (rcn_district) - other names silently return zero rows. Neighborhoods (osiedla) are not TERYT districts: use search_by_area.
Data notes: marketType is NULL for ~55% of records (filtering by it drops them); ~1.7% have no transaction_date.
Permalink to a result: https://cenogram.pl/ceny-transakcyjne?src=mcpstdio#v=1&lat=<A>&lng=<B>&z=16&tx=<id> (<id> from the "id:" line, <A>/<B> from "Location: <A>°N, <B>°E"; omit &tx=<id> for the area only).
Inline [...] notes flag computed values (summed or converted parcel area, inferred property type) and approximated streets; all else is as recorded in the deed.

**Parameters:**

- `location` (string, optional) — City (e.g. 'Warszawa') or RCN district (e.g. 'Mokotów', 'Kraków-Podgórze'); 'Warszawa', 'Kraków', 'Łódź' expand to all sub-districts. Prefer teryt=; confirm a name with list_locations(search=...) (valid ones are flagged rcn_district).
- `teryt` (string, optional) — TERYT code(s), comma-separated, max 10: 2-digit (voivodeship), 4 (county), 6 (municipality) or a precinct code (e.g. '321705_2.0054'). Find codes with list_locations. Exact - avoids name ambiguity.
- `propertyType` (enum: land | building | developed_land | unit, optional) — Property type filter
- `marketType` (enum: primary | secondary, optional) — primary (developer) or secondary (resale); the ~55% of records with no market type drop out when this is set.
- `unitFunction` (enum: residential | commercial | office | production | garage | other | unknown, optional) — Unit function; 'unknown' = none recorded (NULL), any other value excludes such rows. Garages only via 'garage'.
- `buildingType` (enum: residential | commercial | industrial | transport | office | warehouse | education_sports | farm_utility | hospital | other_nonresidential | unknown, optional) — Building type (PKOB); 'unknown' = none recorded (NULL, ~39% of buildings), any other value excludes such rows.
- `ownershipType` (array of enum: land_ownership | perpetual_usufruct | cooperative_ownership | unit_sale | ownership | unit_ownership_with_appurtenant_right | building_ownership_with_appurtenant_right | unknown, optional) — Legal-right type (rodzaj prawa), multi-select; perpetual_usufruct = użytkowanie wieczyste; 'unknown' = none recorded.
- `mpzpDesignation` (string, optional) — MPZP zoning designation, exact token match; comma-separated = OR (e.g. 'MN,MW'). 'unknown' = none recorded (NULL), distinct from the code 'brakMPZPLubWZ' (no plan/WZ). Known codes: budownictwoMieszkanioweJednorodzinne, brakMPZPLubWZ, terenRolniczy, innyNiewymieniony, terenZabudowyUslugowej, terenDrogWewnetrznych, terenDrogPublicznych, terenZabudowyZagrodowejGospodarstwRolnych, budownictwoMieszkanioweWielorodzinne, las, terenObiektowProdukcyjnychSkladowIMagazynow, terenSportuIRekreacji, decyzjaWarunkiZabudowy, terenZieleniUrzadzonej, terenZieleniObjetyFormaOchronyPrzyrody, terenWodPowierzchniowychSrodladowych, obszarITerenGorniczy, terenObslugiProdukcjiWGospodarstwachRolnych, terenInfrastrukturyTechnicznej, terenOgrodowDzialkowych, terenRozmieszczeniaDuzcychObiektowHandlowych, cmentarz, terenKomunikacjiWodnejSzlakWodny, terenWodPowierzchniowychMorskich, MN, BP, KD, U, INN, MW, KDW, R, ZP, P, WZ, ZN, WS, UC, ZL, ZD, US, TIT. An unrecognised value is still sent, with a warning.
- `transactionType` (array of enum: free_market | auction | non_auction | subsidized | public_purpose | foreclosure | unknown, optional) — Multi-select. For market analysis ALWAYS set it to exclude non-market deeds (subsidized, foreclosure, public_purpose); no-type rows (~2%) drop out unless 'unknown' is listed.
- `rooms` (array of enum: 1 | 2 | 3 | 4 | 5 | 6 | 7 | 8plus | unknown, optional) — Rooms (izby), residential units only; multi-select ('8plus' = 8 or more). Rows with no count drop out unless 'unknown' is listed.
- `floor` (array of string, optional) — Unit floor, multi-select: integers ('0' = parter, negatives = basement), 'Nplus' ('0plus' = ground and above), 'unknown' (none recorded). Not building storeys; rows with no floor drop out unless 'unknown' is listed.
- `floodRisk` (array of enum: low | medium | high, optional) — Flood-hazard zone, multi-select: high ~1-in-10-year, medium ~1-in-100, low ~1-in-500. Mapped zones only; absence of a zone is never 'safe'.
- `heritageStatus` (array of enum: listed | zone, optional) — Heritage listing, multi-select: listed = protected monument on the land; zone = protected urban layout or monument surroundings. Detected listings only; absence of a detection is never 'not listed'.
- `landslideRisk` (array of enum: landslide | threatened, optional) — Landslide hazard, multi-select: landslide = mapped landslide area; threatened = area threatened by mass movements. Mapped areas only; absence of a zone is never 'safe'.
- `minPrice` (number, optional) — Minimum price in PLN
- `maxPrice` (number, optional) — Maximum price in PLN
- `dateFrom` (string, optional) — Start date (YYYY-MM-DD)
- `dateTo` (string, optional) — End date (YYYY-MM-DD)
- `street` (string, optional) — Street name, matched anywhere inside the name. Give the NOMINATIVE with Polish diacritics - matching is literal ('Karmelickiej' does not find 'Karmelicka'); a miss looks exactly like 'no such transactions'.
- `buildingNumber` (string, optional) — Building/house number (e.g. '30', '12A'). Requires location or street.
- `parcelId` (string, optional) — Exact parcel ID, copied from a search result's parcel_id field (e.g. '146518_8.0108.27').
- `minArea` (number, optional) — Minimum area in m²
- `maxArea` (number, optional) — Maximum area in m²
- `landUse` (array of enum: gruntyZabudowaneIZurbanizowane | gruntyRolne | gruntyLesne | terenyKomunikacyjne | inne | unknown, optional) — Land-use category, multi-select, case-sensitive (gruntyZabudowaneIZurbanizowane = built-up, gruntyRolne = agricultural, gruntyLesne = forest, terenyKomunikacyjne = transport); 'unknown' = none recorded (NULL), not 'no use'.
- `buildingStoreys` (array of string, optional) — Above-ground storeys, multi-select: integers, 'Nplus' ('3plus' = 3+), 'unknown' (no count). Single-building deeds only, so 'unknown' also covers multi-building deeds. Not the unit floor; rows with no count drop out unless 'unknown' is listed.
- `minFootprintArea` (number, optional) — Minimum building footprint in m², summed over the transaction's buildings; measured rows only (absence = 'not measured', not 'no building'). Not usable area.
- `maxFootprintArea` (number, optional) — Maximum building footprint in m², summed over the transaction's buildings; measured rows only (absence = 'not measured', not 'no building'). Not usable area.
- `excludeFractionalShares` (boolean, optional, default: false) — true = clean land prices: drops fractional ownership shares, whose price reflects the whole deed. Default false.
- `limit` (number, optional, default: 10) — Number of results (1-50, default 10)
- `sort` (enum: price | date | area | pricePerM2 | district | rooms | floor, optional, default: "date") — Sort by field (default: date)
- `order` (enum: asc | desc, optional, default: "desc") — Sort order (default: desc)
- `page` (number, optional, default: 1) — Page number for pagination (default: 1)
- `summaryOnly` (boolean, optional) — Return only aggregate stats (total, median price/m² with its sample size, period) and no rows. Costs only the summary call; limit/sort/page are ignored.

---

### 2. `get_price_statistics`
**Price per m² Statistics**

Price per m² statistics for residential apartments (lokale mieszkalne) by location; for other property types use search_transactions.
Default window: last 24 months (same as the search_transactions median); period="all" for full history. The response states the period used.
'Warszawa'/'Kraków'/'Łódź' auto-expand to all sub-districts; other names use partial match. Based on notarial-deed prices, not asking prices; coverage varies by county (some have data gaps of 5+ years).

**Parameters:**

- `location` (string, optional) — Location name; 'Warszawa'/'Kraków'/'Łódź' expand to all sub-districts, other names use case-insensitive partial match (e.g. 'Wrocł' matches 'Wrocław'). Omit for all Poland.
- `period` (enum: 24m | all, optional) — Window: "24m" (default) = last 24 months, "all" = full history. Ignored when dateFrom or dateTo is set.
- `dateFrom` (string, optional) — Custom window start, YYYY-MM-DD. Overrides period.
- `dateTo` (string, optional) — Custom window end, YYYY-MM-DD, inclusive (default today). Overrides period.

---

### 3. `get_price_distribution`
**Price Distribution Histogram**

National histogram (all Poland) of transactions per price range - use it for the overall price structure of the market. No location filter (location/teryt are ignored); for one place use get_price_statistics or search_transactions.

**Parameters:**

- `bins` (number, optional, default: 20) — Number of price bins (5-50, default 20)
- `maxPrice` (number, optional, default: 3000000) — Maximum price to include (default 3,000,000 PLN)
- `location` (string, optional) — Ignored: histogram is national.
- `teryt` (string, optional) — Ignored: histogram is national.

---

### 4. `search_by_area`
**Search Transactions by Radius**

Find transactions within a radius of a point - the tool for neighborhoods/osiedla (not TERYT districts) and street-level searches. Returns TRANSACTIONS (deeds and prices), despite the name; for the land plots themselves in an area use list_parcels_in_area.
Radius: 0.3-0.5 km for a street, 0.5-1 km for a neighborhood, 2-5 km for a city area; the area is a bounding box around the radius, so corners extend beyond radiusKm. Take coordinates from the user, never invent them. minArea/maxArea work for every propertyType. Costs 3 API tokens (1 with summaryOnly).
Permalink to a result: https://cenogram.pl/ceny-transakcyjne?src=mcpstdio#v=1&lat=<A>&lng=<B>&z=16&tx=<id> (<id> from the "id:" line, <A>/<B> from "Location: <A>°N, <B>°E"; omit &tx=<id> for the area only).

**Parameters:**

- `latitude` (number, required) — Latitude (Poland range: 49-55)
- `longitude` (number, required) — Longitude (Poland range: 14-25)
- `radiusKm` (number, optional, default: 2) — Search radius in km (0.1-50, default 2).
- `propertyType` (enum: land | building | developed_land | unit, optional) — Property type filter
- `marketType` (enum: primary | secondary, optional) — primary (developer) or secondary (resale); the ~55% of records with no market type drop out when this is set.
- `unitFunction` (enum: residential | commercial | office | production | garage | other | unknown, optional) — Unit function; 'unknown' = none recorded (NULL), any other value excludes such rows. Garages only via 'garage'.
- `buildingType` (enum: residential | commercial | industrial | transport | office | warehouse | education_sports | farm_utility | hospital | other_nonresidential | unknown, optional) — Building type (PKOB); 'unknown' = none recorded (NULL, ~39% of buildings), any other value excludes such rows.
- `ownershipType` (array of enum: land_ownership | perpetual_usufruct | cooperative_ownership | unit_sale | ownership | unit_ownership_with_appurtenant_right | building_ownership_with_appurtenant_right | unknown, optional) — Legal-right type (rodzaj prawa), multi-select; perpetual_usufruct = użytkowanie wieczyste; 'unknown' = none recorded.
- `mpzpDesignation` (string, optional) — MPZP zoning designation, exact token match; comma-separated = OR; 'unknown' = none recorded. Same codes as search_transactions mpzpDesignation.
- `minPrice` (number, optional) — Minimum price in PLN
- `maxPrice` (number, optional) — Maximum price in PLN
- `minArea` (number, optional) — Minimum area in m² (usable area for units, parcel area for land)
- `maxArea` (number, optional) — Maximum area in m²
- `dateFrom` (string, optional) — Start date (YYYY-MM-DD)
- `dateTo` (string, optional) — End date (YYYY-MM-DD)
- `transactionType` (array of enum: free_market | auction | non_auction | subsidized | public_purpose | foreclosure | unknown, optional) — Multi-select. For market analysis ALWAYS set it to exclude non-market deeds (subsidized, foreclosure, public_purpose); no-type rows (~2%) drop out unless 'unknown' is listed.
- `rooms` (array of enum: 1 | 2 | 3 | 4 | 5 | 6 | 7 | 8plus | unknown, optional) — Rooms (izby), residential units only; multi-select ('8plus' = 8 or more). Rows with no count drop out unless 'unknown' is listed.
- `floor` (array of string, optional) — Unit floor, multi-select: integers ('0' = parter, negatives = basement), 'Nplus' ('0plus' = ground and above), 'unknown' (none recorded). Not building storeys; rows with no floor drop out unless 'unknown' is listed.
- `floodRisk` (array of enum: low | medium | high, optional) — Flood-hazard zone, multi-select: high ~1-in-10-year, medium ~1-in-100, low ~1-in-500. Mapped zones only; absence of a zone is never 'safe'.
- `heritageStatus` (array of enum: listed | zone, optional) — Heritage listing, multi-select: listed = protected monument on the land; zone = protected urban layout or monument surroundings. Detected listings only; absence of a detection is never 'not listed'.
- `landslideRisk` (array of enum: landslide | threatened, optional) — Landslide hazard, multi-select: landslide = mapped landslide area; threatened = area threatened by mass movements. Mapped areas only; absence of a zone is never 'safe'.
- `landUse` (array of enum: gruntyZabudowaneIZurbanizowane | gruntyRolne | gruntyLesne | terenyKomunikacyjne | inne | unknown, optional) — Land-use category, multi-select, case-sensitive (gruntyZabudowaneIZurbanizowane = built-up, gruntyRolne = agricultural, gruntyLesne = forest, terenyKomunikacyjne = transport); 'unknown' = none recorded (NULL), not 'no use'.
- `buildingStoreys` (array of string, optional) — Above-ground storeys, multi-select: integers, 'Nplus' ('3plus' = 3+), 'unknown' (no count). Single-building deeds only, so 'unknown' also covers multi-building deeds. Not the unit floor; rows with no count drop out unless 'unknown' is listed.
- `minFootprintArea` (number, optional) — Minimum building footprint in m², summed over the transaction's buildings; measured rows only (absence = 'not measured', not 'no building'). Not usable area.
- `maxFootprintArea` (number, optional) — Maximum building footprint in m², summed over the transaction's buildings; measured rows only (absence = 'not measured', not 'no building'). Not usable area.
- `excludeFractionalShares` (boolean, optional, default: false) — true = clean land prices: drops fractional ownership shares, whose price reflects the whole deed. Default false.
- `limit` (number, optional, default: 20) — Number of results (1-50, default 20)
- `page` (number, optional) — Page 1-10 (50 rows).
- `summaryOnly` (boolean, optional) — Return only aggregate stats (total, median price/m² with its sample size, period) and no rows. Costs only the summary call; limit/sort/page are ignored.

---

### 5. `get_market_overview`
**Market Overview**

Start here for the shape of the whole Polish transaction database (not one place; for a place use get_price_statistics or search_transactions): total count, date range, breakdown by property and market type, top locations, price statistics. marketType is unknown for ~55% of records, transaction_date missing for ~1.7%.

_No parameters._

---

### 6. `list_locations`
**List Locations & TERYT Codes**

Resolve a place name to TERYT codes, or browse the TERYT hierarchy - the first step before search_transactions (pass the returned code as teryt=).
- search (a name): looks it up across all levels (voivodeship, county, municipality, precinct); each match carries its TERYT code, parent unit and the exact follow-up calls; exact and prefix matches come first under 'Best matches'. Rows flagged rcn_district also accept the name in search_transactions(location=) and compare_locations; RCN district names with no TERYT code are listed separately. RCN district matches also show their transaction count and date range, with a warning when the label covers only part of a gmina.
- parent (a code): browse children - no parent = 16 voivodeships, 2-digit = counties, 4-digit = municipalities, 6-digit = precincts. parent wins when both are given.
Returns administrative units, never streets: for parcels on a street pass the name to list_parcels_in_area as street=. Prefer teryt where a name is ambiguous ('Wałcz' is both a county and a municipality).

**Parameters:**

- `parent` (string, optional) — TERYT parent code to browse children: 2-digit (voivodeship → counties), 4-digit (county → municipalities), 6-digit (municipality → precincts). Omit for all voivodeships.
- `search` (string, optional) — Place name, case- and diacritics-insensitive partial match (e.g. 'wejher' for Wejherowo). Returns TERYT codes plus, where applicable, RCN district names. Ignored when parent is set.

---

### 7. `search_parcels`
**Search Land Parcels**

Autocomplete land parcels by cadastral ID PREFIX only, never by area: for the parcels in a place or shape use list_parcels_in_area; to turn a coordinate or 'locality + number' into one parcel use resolve_parcel (a street address: list_parcels_in_area). Returns matching parcels with district, area and GPS coordinates (e.g. prefix '146518_8.01').
Coverage: the cadastral register we hold is near-complete but not live, so an empty result more likely means a recent change or a mistyped prefix than that no such parcel exists - never report it as "this parcel does not exist" (resolve_parcel with the FULL id can still confirm and add one).
Free: costs no API tokens.

**Parameters:**

- `q` (string, required) — Parcel ID prefix (min 3 chars), e.g. '146518_8.01'
- `limit` (number, optional, default: 10) — Max results (1-10, default 10)

---

### 8. `resolve_parcel`
**Resolve Land Parcel**

Resolve a land parcel to its cadastral identity using exactly ONE of:
- parcelId: a full cadastral id ('142907_2.0014.342/5' or the '-' form) or internal UUID.
- q: a full id, a UUID, or 'locality name + parcel number' (e.g. 'Sabnie 342/5'): the name is a gmina or cadastral precinct (obręb), matched exactly, case-insensitively; a gmina name plus a number also works for a gmina made of several precincts (e.g. 'Ełk 461/3'). An ambiguous name returns several candidates, not a guess. NOT a street address: for a city address use list_parcels_in_area(street=, buildingNumber=).
- lat & lng: a WGS84 point inside the parcel (a road parcel is flagged: the point probably fell on the street).
Returns matching parcels with district, area and coordinates; 'truncated' when capped.
not_covered: for a FULL id it means we could not confirm the parcel live; in the DISCOVERY modes (name + number, coordinate) only "not among the parcels we hold" (near-complete, not live) - a fresh change or an unusual spelling is likelier than a missing parcel, so never report "no such parcel". not_computed = the lookup could not finish, also not a finding. corpus_coverage says how much of the register was searched.
Then feed the id to search_transactions(parcelId) for its sale history. Free.

**Parameters:**

- `q` (string, optional) — Full cadastral id, UUID, or 'locality name + parcel number' (e.g. 'Sabnie 342/5'); not a street address. Exclusive with parcelId and lat/lng.
- `parcelId` (string, optional) — Full cadastral id (slash or dash form) or internal UUID. Exclusive with q and lat/lng.
- `lat` (number, optional) — Latitude WGS84; pair with lng. Exclusive with q and parcelId.
- `lng` (number, optional) — Longitude WGS84; pair with lat. Exclusive with q and parcelId.

---

### 9. `get_parcel_report`
**Get Parcel Report**

The whole dossier for one land parcel in one call - prefer it over the per-layer parcel tools. Contains the parcel core (location, area, land use, plan designation); thirteen layers (flood, heritage, landslide, subsurface, nuisance surroundings, transit, general-plan zoning, buildings, building activity, agricultural eligibility, land-use and soil classification, nature, road access); the parcel's transactions (newest first, up to 20); local price context (county and gmina median zł/m², last 12 months); municipal context (demographics, infrastructure signals); and a parcel-shape section (outline geometry only).
For a coordinate or 'locality + number' use resolve_parcel first; for a street address use list_parcels_in_area.
Every section has its own state: covered; covered_no_data (checked, nothing found; billed); not_covered (outside our data; refunded); not_computed (did not finish in time; refunded - the report can be partial). Context sections use full / low_sample / suppressed / no_data (shape: full / no_data). Long lists are capped with a count of the rest.
Reading it: the nearby designation signal comes from RCN deeds of neighbouring land, not from the planning register - it describes the neighbourhood, not this parcel; confirm with the local plan (MPZP) or a zoning decision. Neither it nor the shape section (geometry only) says whether a parcel can be built on or divided. Construction age is an ESTIMATE with an interval (permit records start in 2016), often "not established".
Costs 45 API tokens, billed by outcome: an unresolvable parcel is refunded in full; a resolved parcel with no layer data pays only the 1-token core floor; with at least one covered layer, in full.
Requests are rate-limited per API key per minute, so parallel agents sharing one key share the same limit. On a "Too many requests" response, wait the given seconds and retry sequentially.

**Parameters:**

- `parcelId` (string, required) — Full cadastral id ('142907_2.0014.342/5' or the '-' form) or internal UUID.

---

### 10. `get_parcel_land_class`
**Get Parcel Land Classification**

The official land-use and soil-quality classification of one land parcel and what it implies for taking the land out of agricultural use. Use it only for that question; for anything else about the parcel (prices, flood, zoning, buildings, permits, surroundings, transport) call get_parcel_report (one flat-price call, includes this classification).
Returns the land-use categories and soil grades entered for the parcel, whether any grade is in the protected I-III range, whether the parcel is inside a city boundary (changes the rule), and a re-designation note with the date the legal state was verified. They come back as SETS: the source records no area for any of them, so the answer can never say which category prevails or give a share.
Answers only where the county publishes the classification; many counties, including several large cities, do not. States: covered; covered_no_data (published, this parcel has none; billed); not_covered (county does not publish it, or we do not hold the parcel; refunded); not_computed (did not finish in time; refunded, retry).
Costs 4 API tokens, refunded on not_covered and not_computed. Not legal advice, and never a statement that a parcel can or cannot be built on.

**Parameters:**

- `parcelId` (string, required) — Full cadastral id ('142907_2.0014.342/5' or the '-' form) or internal UUID.

---

### 11. `list_parcels_in_area`
**List Parcels in an Area**

List cadastral parcels in an area - the land plots themselves, NOT transactions (for deeds and prices use search_by_area or search_by_polygon). For an id prefix use search_parcels; for a coordinate or 'locality + number' use resolve_parcel (a street address goes here, via street= and buildingNumber=); for everything about one parcel use get_parcel_report.

Name the area (at least one): teryt (codes from list_locations); location (county, city or gmina NAME; a name shared by several units is an error listing the candidates, never a guess); bbox; lat + lng + radiusKm (a circle; not together with a bbox); polygon (on its own).

Two answer shapes, priced differently: the default LIGHT list (parcel id, district, centre point, held street address; 2 API tokens; cursor paging) and OUTLINES, with includeGeometry=true (needs a bbox) or a polygon (GeoJSON polygon per parcel; 5 API tokens; max 100 parcels, 50 by default; no paging). An outline answer marked TRUNCATED is an arbitrary subset (not the first, nearest or largest): never report it as the area's parcel list, ask for a smaller area.

Light-list filters (not on outline calls) need a narrow scope - a bbox, a circle, a location name, or a teryt of at least 4 digits (county) - and do not count as naming the area. minArea / maxArea (m²) = the registered parcel surface.
- street: whole-word, case- and accent-insensitive ('Górna' does not find 'Podgórna'; a fragment finds nothing). Not inflected: pass the NOMINATIVE ('Karmelickiej' answers empty). An empty page is free and carries close-name suggestions - read them before concluding anything.
- buildingNumber (needs street): exact ('12A' does not find '12a'); RCN often records compound numbers ('84/92'), so '84' will not find '84/92'. If empty, official address points are tried (still exact); if both miss, the page is empty (free) and lists the numbers held on the street.
Most rural parcels have no street: outside towns use resolve_parcel with the precinct name and parcel number; an empty street search in the countryside says nothing about the parcel. parcel_id is returned only to API-token / OAuth callers and paid or trial accounts.

Coverage has two gaps. (1) The cadastral data we hold is near-complete but not live (measured per county; fresh splits, merges or renumbering may be missing), for EVERY entrance: a short list or no truncation marker never means you have every parcel. Each answer has a corpus_coverage block (figures for teryt/location, null for bbox/circle/polygon). (2) bbox, circle and polygon miss the few held parcels whose outline is in an unreadable coordinate system; teryt/location list those with no location. A returned parcel is real; never read an empty or short answer as proof the land is not there.
Limits: an area over 500 km², a radius over 12.6 km or a polygon over 500 vertices is refused.

**Parameters:**

- `teryt` (string, optional) — TERYT code prefix (2/4/6 digits or finer), comma-separated for several. Wins over location.
- `location` (string, optional) — County, city, gmina or district name, resolved to its TERYT code ('Mokotów' = that Warszawa district; 'Kraków-Podgórze' = its parent county; a gmina name answers at municipality level).
- `bbox` (string, optional) — Bounding box "minLng,minLat,maxLng,maxLat" (WGS84), at most 500 km². Required for includeGeometry=true.
- `lat` (number, optional) — Circle centre latitude (WGS84). Needs lng and radiusKm.
- `lng` (number, optional) — Circle centre longitude (WGS84). Needs lat and radiusKm.
- `radiusKm` (number, optional) — Circle radius in km (max 12.6, the radius covering 500 km²). Needs lat and lng.
- `polygon` (effects, optional) — GeoJSON Polygon: [longitude, latitude] pairs, first and last point identical, max 500 vertices. Always returns outlines. Pass it instead of the other area parameters.
- `minArea` (number, optional) — Minimum parcel surface in m². Needs a narrow scope; not with includeGeometry or a polygon.
- `maxArea` (number, optional) — Maximum parcel surface in m². Same scope requirement as minArea.
- `street` (string, optional) — Street name in the NOMINATIVE (min 4 letters or digits). Needs a bbox, a circle, a location name, or a teryt of at least 4 digits; not with includeGeometry or a polygon.
- `buildingNumber` (string, optional) — Building number, exact; needs street, same scope requirement. If nothing is found, drop the number and read the numbers off the street's rows.
- `includeGeometry` (boolean, optional) — Return full outlines instead of the light row (5 tokens instead of 2). Requires a bbox; with a polygon outlines come back anyway.
- `limit` (number, optional) — Max parcels. Light list: up to 1000, default 250. Outlines: up to 100, default 50.
- `cursor` (string, optional) — Opaque cursor from the previous light-list answer, for the next page; pass it back unchanged. Not available on outline calls.

---

### 12. `search_by_polygon`
**Search Transactions by Polygon**

Find transactions inside a GeoJSON Polygon - for precise neighborhood/osiedla boundaries; for a quick look start with search_by_area (its results can help estimate coordinates). Returns TRANSACTIONS (deeds and prices) with coordinates, despite the name; for the land plots inside a drawn shape pass the same polygon to list_parcels_in_area. Costs 5 API tokens.
Permalink to a result: https://cenogram.pl/ceny-transakcyjne?src=mcpstdio#v=1&lat=<A>&lng=<B>&z=16&tx=<id> (<id> from the "id:" line, <A>/<B> from "Location: <A>°N, <B>°E"; omit &tx=<id> for the area only).

**Parameters:**

- `polygon` (effects, required) — GeoJSON Polygon: [longitude, latitude] pairs, first and last point identical, max 500 vertices total.
- `propertyType` (enum: land | building | developed_land | unit, optional) — Property type filter
- `marketType` (enum: primary | secondary, optional) — primary (developer) or secondary (resale); the ~55% of records with no market type drop out when this is set.
- `unitFunction` (enum: residential | commercial | office | production | garage | other | unknown, optional) — Unit function; 'unknown' = none recorded (NULL), any other value excludes such rows. Garages only via 'garage'.
- `buildingType` (enum: residential | commercial | industrial | transport | office | warehouse | education_sports | farm_utility | hospital | other_nonresidential | unknown, optional) — Building type (PKOB); 'unknown' = none recorded (NULL, ~39% of buildings), any other value excludes such rows.
- `ownershipType` (array of enum: land_ownership | perpetual_usufruct | cooperative_ownership | unit_sale | ownership | unit_ownership_with_appurtenant_right | building_ownership_with_appurtenant_right | unknown, optional) — Legal-right type (rodzaj prawa), multi-select; perpetual_usufruct = użytkowanie wieczyste; 'unknown' = none recorded.
- `mpzpDesignation` (string, optional) — MPZP zoning designation, exact token match; comma-separated = OR; 'unknown' = none recorded. Same codes as search_transactions mpzpDesignation.
- `transactionType` (array of enum: free_market | auction | non_auction | subsidized | public_purpose | foreclosure | unknown, optional) — Multi-select. For market analysis ALWAYS set it to exclude non-market deeds (subsidized, foreclosure, public_purpose); no-type rows (~2%) drop out unless 'unknown' is listed.
- `rooms` (array of enum: 1 | 2 | 3 | 4 | 5 | 6 | 7 | 8plus | unknown, optional) — Rooms (izby), residential units only; multi-select ('8plus' = 8 or more). Rows with no count drop out unless 'unknown' is listed.
- `floor` (array of string, optional) — Unit floor, multi-select: integers ('0' = parter, negatives = basement), 'Nplus' ('0plus' = ground and above), 'unknown' (none recorded). Not building storeys; rows with no floor drop out unless 'unknown' is listed.
- `minPrice` (number, optional) — Minimum price in PLN
- `maxPrice` (number, optional) — Maximum price in PLN
- `dateFrom` (string, optional) — Start date (YYYY-MM-DD)
- `dateTo` (string, optional) — End date (YYYY-MM-DD)
- `minArea` (number, optional) — Minimum area in m²
- `maxArea` (number, optional) — Maximum area in m²
- `district` (string, optional) — District name filter
- `street` (string, optional) — Street name filter (partial match)
- `landUse` (array of enum: gruntyZabudowaneIZurbanizowane | gruntyRolne | gruntyLesne | terenyKomunikacyjne | inne | unknown, optional) — Land-use category, multi-select, case-sensitive (gruntyZabudowaneIZurbanizowane = built-up, gruntyRolne = agricultural, gruntyLesne = forest, terenyKomunikacyjne = transport); 'unknown' = none recorded (NULL), not 'no use'.
- `buildingStoreys` (array of string, optional) — Above-ground storeys, multi-select: integers, 'Nplus' ('3plus' = 3+), 'unknown' (no count). Single-building deeds only, so 'unknown' also covers multi-building deeds. Not the unit floor; rows with no count drop out unless 'unknown' is listed.
- `minFootprintArea` (number, optional) — Minimum building footprint in m², summed over the transaction's buildings; measured rows only (absence = 'not measured', not 'no building'). Not usable area.
- `maxFootprintArea` (number, optional) — Maximum building footprint in m², summed over the transaction's buildings; measured rows only (absence = 'not measured', not 'no building'). Not usable area.
- `excludeFractionalShares` (boolean, optional, default: false) — true = clean land prices: drops fractional ownership shares, whose price reflects the whole deed. Default false.
- `limit` (number, optional, default: 100) — Max results (1-3000); 50 shown.
- `page` (number, optional) — Page 1-20 (50 rows).

---

### 13. `compare_locations`
**Compare Locations**

Compare 2-5 districts side-by-side: median price/m², average area and transaction counts.
Matches names only: call list_locations(search=...) first and use names it flags as RCN districts (rcn_district) - other names (most TERYT unit names) silently return no data. Needs at least one filter besides districts (e.g. propertyType).

**Parameters:**

- `districts` (effects, required) — Comma-separated district names (2-5, unique), e.g. 'Mokotów,Wola,Ursynów'
- `propertyType` (enum: land | building | developed_land | unit, optional) — Property type filter (recommended - API requires at least one filter)
- `marketType` (enum: primary | secondary, optional) — primary (developer) or secondary (resale); the ~55% of records with no market type drop out when this is set.
- `unitFunction` (enum: residential | commercial | office | production | garage | other | unknown, optional) — Unit function; 'unknown' = none recorded (NULL), any other value excludes such rows. Garages only via 'garage'.
- `buildingType` (enum: residential | commercial | industrial | transport | office | warehouse | education_sports | farm_utility | hospital | other_nonresidential | unknown, optional) — Building type (PKOB); 'unknown' = none recorded (NULL, ~39% of buildings), any other value excludes such rows.
- `ownershipType` (array of enum: land_ownership | perpetual_usufruct | cooperative_ownership | unit_sale | ownership | unit_ownership_with_appurtenant_right | building_ownership_with_appurtenant_right | unknown, optional) — Legal-right type (rodzaj prawa), multi-select; perpetual_usufruct = użytkowanie wieczyste; 'unknown' = none recorded.
- `mpzpDesignation` (string, optional) — MPZP zoning designation, exact token match; comma-separated = OR; 'unknown' = none recorded. Same codes as search_transactions mpzpDesignation.
- `transactionType` (array of enum: free_market | auction | non_auction | subsidized | public_purpose | foreclosure | unknown, optional) — Multi-select. For market analysis ALWAYS set it to exclude non-market deeds (subsidized, foreclosure, public_purpose); no-type rows (~2%) drop out unless 'unknown' is listed.
- `minPrice` (number, optional) — Minimum price in PLN
- `maxPrice` (number, optional) — Maximum price in PLN
- `dateFrom` (string, optional) — Start date (YYYY-MM-DD)
- `dateTo` (string, optional) — End date (YYYY-MM-DD)
- `minArea` (number, optional) — Minimum area in m²
- `maxArea` (number, optional) — Maximum area in m²
- `street` (string, optional) — Street name filter
- `rooms` (array of enum: 1 | 2 | 3 | 4 | 5 | 6 | 7 | 8plus | unknown, optional) — Rooms (izby), residential units only; multi-select ('8plus' = 8 or more). Rows with no count drop out unless 'unknown' is listed.
- `floor` (array of string, optional) — Unit floor, multi-select: integers ('0' = parter, negatives = basement), 'Nplus' ('0plus' = ground and above), 'unknown' (none recorded). Not building storeys; rows with no floor drop out unless 'unknown' is listed.
- `includeDemographics` (boolean, optional) — Add a GUS BDL demographics block per district (county-level: density, wages, unemployment, median age, price-to-income). Districts that do not resolve to a county are omitted from it.

---

### 14. `get_demographics`
**Demographics & Local Statistics**

Local statistics for a Polish location from GUS BDL (Poland's Central Statistical Office): ~50 indicators across 11 categories (population, economy, housing, planning, infrastructure, environment, safety, education, prices) plus a few derived metrics.
Address by location (city, county or gmina name; a city or county resolves to county level) OR teryt (codes from list_locations). Neighborhoods/osiedla are NOT addressable.
Returns the requested level PLUS all parent levels. Optional year, or yearFrom+yearTo for a time series, and category. Cost: 1 token.

**Parameters:**

- `location` (string, optional) — City, county, gmina or district name (e.g. 'Warszawa', 'Wieliczka'): city/county → county level, gmina → that gmina, a Warszawa district ('Mokotów') → that district, another city's delegatura ('Kraków-Podgórze') → its parent county. Shared name → candidates; pass one as teryt. Use this OR teryt.
- `teryt` (string, optional) — TERYT: 2-digit voivodeship (14), 4 county (1465), 6 or 7 gmina (1465011). 7th digit: 3 = urban-rural gmina overall, 4/5 = urban/rural part only, 8 = Warszawa district (1465108 = Śródmieście). Wins over location.
- `year` (number, optional) — Single year (2003-present); exclusive with yearFrom/yearTo. Omit for the latest year per indicator.
- `yearFrom` (number, optional) — Start year for a time series (min 2003).
- `yearTo` (number, optional) — End year for a time series (max current year + 1).
- `category` (array of enum: demographics | economy | economy_macro | housing | planning | infrastructure | environment | safety | re_market | education | prices, optional) — Categories to return; omit for all.

---

### 15. `get_infrastructure_signals`
**Infrastructure Signals**

Signals that a Polish municipality is about to build infrastructure, from three public sources: tenders in the national procurement bulletin (rolling 12 months), membership in an agglomeration of the national urban waste-water programme, and the municipality's planned capital expenditure from its multi-year forecast.
Address by location (city/county name → every municipality in the county) OR teryt (codes from list_locations; wins when both are given).
State these limits when reporting: the bulletin has only contracts BELOW EU thresholds (from 2021), so the largest investments are invisible; a tender is attributed to the contracting authority's SEAT, not the works location, so the counters include municipal authorities only while the notice list shows every authority with a flag. Absence of tenders is NOT evidence that a municipality is not investing. Cost: 1 token.

**Parameters:**

- `location` (string, optional) — City, county, gmina or district name (e.g. 'Warszawa', 'Krotoszyn'): city/county → every municipality in the county, gmina → that gmina alone, a Warszawa district ('Mokotów') → that gmina, another city's delegatura ('Kraków-Podgórze') → its parent county. Shared name → candidates; pass one as teryt. Use this OR teryt.
- `teryt` (string, optional) — TERYT code: 6 or 7 digits = one municipality (e.g. 146501), 4 digits = a county aggregate (e.g. 1465). Wins over location.

---

### 16. `estimate_value`
**[Beta] Apartment Value Estimate**

[Beta] Estimate an apartment's market value from comparable registered transaction prices near a point. An orientation estimate, NOT a certified appraisal (operat szacunkowy): it ignores condition, finish standard and floor.
Address by lat + lng OR parcelId (the parcel centroid is used) - exactly one. area (usable m², 10–250) is REQUIRED. Optional: rooms (1–10) and market (primary/secondary) narrow the comparables; includeComps (default true) echoes them.
Returns the point estimate, a likely and a wide range, a confidence band, the comparable count and an as_of date; as_of lags by county, so estimates are NOT comparable across cities with different as_of.
Apartments only; for a building plot or farmland use estimate_land_value. Too few comparables → no estimate. Costs 5 API tokens, refunded when no estimate is produced. Aggregates exclude fractional shares and non-market deeds.

**Parameters:**

- `lat` (number, optional) — Latitude of the apartment (WGS84, Poland); pair with lng. Use this OR parcelId.
- `lng` (number, optional) — Longitude of the apartment (WGS84, Poland); pair with lat. Use this OR parcelId.
- `parcelId` (string, optional) — Full cadastral id (slash or dash form) or internal UUID; the parcel centroid is used. Instead of lat/lng.
- `area` (number, required) — Apartment usable area in m² (REQUIRED, 10–250).
- `rooms` (number, optional) — Room count (1–10); narrows comparables to ±1 room.
- `market` (enum: primary | secondary, optional) — Restrict comparables to the primary (new-build) or secondary market.
- `includeComps` (boolean, optional) — Echo the comparables weighed (default true); false = estimate only.

---

### 17. `estimate_land_value`
**[Beta] Land Value Estimate**

[Beta] Estimate an undeveloped plot's market value from comparable registered transaction prices near a point. An orientation estimate, NOT a certified appraisal (operat szacunkowy).
Address by lat + lng OR parcelId (the parcel centroid is used) - exactly one. area (m², 100–1000000) is REQUIRED with lat/lng; with parcelId it defaults to the cadastre area. landType: plot (building plot, default) or agricultural (farmland) - the caller chooses. Optional mpzpDesignation narrows the comparables; includeComps (default true) echoes them.
Returns the estimate per m² and per hectare, a likely and a wide range, a confidence band, the comparable count and an as_of date (as_of lags by county: estimates are NOT comparable across areas with different as_of).
Comparables are chosen by the designation recorded in the transaction register (not a local zoning plan), so this does not assert the plot is buildable. Undeveloped land only. Too few comparables, or an area that cannot be determined → no estimate. Costs 5 API tokens, refunded when no estimate is produced. It can be switched off for maintenance (a plain "temporarily unavailable" reply). Aggregates exclude fractional shares and non-market deeds.

**Parameters:**

- `lat` (number, optional) — Latitude of the plot (WGS84, Poland); pair with lng. Use this OR parcelId (area is then required).
- `lng` (number, optional) — Longitude of the plot (WGS84, Poland); pair with lat. Use this OR parcelId (area is then required).
- `parcelId` (string, optional) — Full cadastral id or internal UUID; the parcel centroid is used. Instead of lat/lng.
- `area` (number, optional) — Plot area in m² (100–1000000). REQUIRED with lat/lng; with parcelId read from the cadastre when omitted.
- `landType` (enum: plot | agricultural, optional) — Comparable segment: plot (building plot, default) or agricultural (farmland); the caller chooses.
- `mpzpDesignation` (string, optional) — Narrow comparables to a recorded land-designation token (e.g. 'budownictwoMieszkanioweJednorodzinne'); 'unknown' = none recorded.
- `includeComps` (boolean, optional) — Echo the comparables weighed (default true); false = estimate only.

---

### 18. `get_building_breakdown`
**Building-by-Building Breakdown**

Building-by-building breakdown for one transaction: footprint area, storeys and estimated total floor area (footprint × storeys) of each building on the property. Use it after a search whose result has building data (searches return per-transaction building SUMS inline) - e.g. a developed-land deed covering several buildings.
Each building carries a construction-age ESTIMATE with an interval, derived from building-permit records: never a registry construction date, and the records only start in 2016, so "construction year not established" is the usual honest answer.
Cost: 4 tokens. Returns nothing for a transaction with no buildings.

**Parameters:**

- `transaction_id` (string, optional) — Transaction id (UUID) from a search result that carries building data. This or transactionId is required.
- `transactionId` (string, optional)

---

### 19. `get_transaction_flood`
**Transaction Flood-Hazard Breakdown**

Parcel-by-parcel flood-hazard breakdown for one transaction: per linked plot in a mapped flood zone - the worst hazard category (high/medium/low, ~1-in-10-year to ~1-in-500-year), hazard type (river/coastal/infrastructure), the share of the plot inside the zone and the per-scenario list with return periods.
Use it after a search whose result shows flood_risk (search_transactions and search_by_area surface it inline; search_by_polygon does not). For a parcel with no transaction, get_parcel_report lists the same scenarios.
Land in no mapped zone returns nothing - absence of a zone is never asserted as "safe". Cost: 4 tokens (refunded when there is no flood data).

**Parameters:**

- `transaction_id` (string, optional) — Transaction id (UUID) from a search result. This or transactionId is required.
- `transactionId` (string, optional)

---

### 20. `get_transaction_heritage`
**Transaction Heritage-Listing Breakdown**

Parcel-by-parcel heritage-listing breakdown for one transaction: per linked plot with a detected listing - the status (listed = a protected monument on/at the plot; zone = within a protected urban layout or the designated surroundings of a monument), the share of the plot inside the protected area (when measurable) and the entries (category, name, function, period, entry date).
Use it after a search whose result shows a heritage listing (search_transactions and search_by_area surface heritage_status inline; search_by_polygon does not). For a parcel with no transaction, get_parcel_report lists the same entries.
No detected listing returns nothing - absence of a detection is never "not listed". Indicative data: the regional heritage conservator makes the binding determination. Cost: 4 tokens (refunded when there is no heritage data).

**Parameters:**

- `transaction_id` (string, optional) — Transaction id (UUID) from a search result. This or transactionId is required.
- `transactionId` (string, optional)

---

### 21. `get_transaction_landslide`
**Transaction Landslide-Hazard Breakdown**

Parcel-by-parcel landslide-hazard breakdown for one transaction, from official landslide-hazard maps (1:10,000): per linked plot intersecting a mapped hazard area - the worst category ('landslide' = a mapped landslide area, 'threatened' = an area threatened by mass movements), the share of the plot inside the zones, and the per-zone list (with source_version_date, the source-record version date, not an observation date). At this scale an intersection means overlap with a mapped area, not that the parcel itself is a landslide.
Use it after a search whose result shows landslide_risk (inline in search_transactions and search_by_area, not search_by_polygon). For a parcel with no transaction, get_parcel_report gives the share and zone kinds.
Land in no mapped zone returns nothing - absence of data is never an assertion of safety. Cost: 4 tokens (refunded when there is no landslide data).

**Parameters:**

- `transaction_id` (string, optional) — Transaction id (UUID) from a search result. This or transactionId is required.
- `transactionId` (string, optional)

---

### 22. `get_transaction_subsurface`
**Transaction Subsurface Breakdown**

Use it to see whether one transaction's land overlaps a mining terrain or a major groundwater reservoir: per linked plot overlapping either - the mining-terrain status ('active' | 'former') with mineral class ('subsidence' = extraction with surface deformation, the actual mining-damage risk; 'surface' = open-pit, mostly local impact; 'fluid' = borehole extraction; 'other'), the reservoir status ('documented' | 'undocumented'), the share of the plot inside each, and per-object details.
A mining terrain is a legally defined zone of anticipated mining influence with an approximate mapped location: an intersection is an advisory signal to verify with the competent mining-supervision authority, not a legal determination. A reservoir's extent alone imposes NO restriction; one would come only from a protection zone, which is not published here.
For a parcel with no transaction, get_parcel_report lists the same objects. Land overlapping neither layer returns nothing - absence of data is never an assertion of safety. Cost: 4 tokens (refunded when there is no subsurface data).

**Parameters:**

- `transaction_id` (string, optional) — Transaction id (UUID) from a search result. This or transactionId is required.
- `transactionId` (string, optional)

---

### 23. `get_transaction_roads`
**Transaction Road Access**

Plot-by-plot road-access evidence for one transaction, to judge how its land sits relative to the road network: per linked plot, the distance in meters to the nearest public road (500 m), the nearest road of any kind (500 m) and the nearest motorway/expressway/dual-carriageway (3 km; a traffic-nuisance proxy, not access) - plus, for the nearest public road, the estimated distance to its carriageway EDGE (null when the source has no width), its management category and functional class, and whether it runs at ground level (false = viaduct or tunnel). Each plot carries access_indicator (likely / uncertain / unlikely) and its rule version.
access_indicator is GEOMETRIC EVIDENCE from carriageway centrelines in reference road data. It does NOT determine legal access or say anything about easements and rights of way (land register, not published here) - a lead to verify, never a conclusion.
A null distance means no such road within the radius in the reference data - NEVER a guarantee none exists; assessed=false = not evaluated yet. For a parcel with no transaction, get_parcel_report has a one-line road-access summary. Cost: 4 tokens (refunded when there is no informative data).

**Parameters:**

- `transaction_id` (string, optional) — Transaction id (UUID) from a search result. This or transactionId is required.
- `transactionId` (string, optional)

---

### 24. `get_transaction_surroundings`
**Transaction Surroundings Breakdown**

Plot-by-plot surroundings profile for one transaction, for due diligence on nearby nuisances: per linked plot, the distance in meters to the nearest cemetery (1 km radius), landfill (3 km), sewage treatment plant (2 km), industrial/storage area (1 km), large industrial plant (3 km), intensive livestock farm (3 km), high-voltage overhead power line (1 km) and extra-high-voltage overhead power line (1 km).
Distances are approximate, from the plot boundary; 0 = the plot touches or overlaps. Only overhead high- and extra-high-voltage lines are covered (medium and low voltage are ubiquitous). For a parcel with no transaction, get_parcel_report lists the same distances.
A null distance means no such object within the radius in the reference data - NEVER a guarantee none exists; assessed=false = not evaluated yet. Cost: 4 tokens (refunded when there is no informative data).

**Parameters:**

- `transaction_id` (string, optional) — Transaction id (UUID) from a search result. This or transactionId is required.
- `transactionId` (string, optional)

---

### 25. `get_transaction_transit`
**Transaction Public Transport Access Breakdown**

Use it to check public-transport access to one transaction's land: for each linked plot, the nearest stop distance by mode (rail/metro within 3000 m, tram 1500 m, bus 1000 m) from open GTFS data, plus the nearest stop's name per mode present.
No stop within its cap in any mode returns nothing - absence of a row is never "no transit access" (open feeds cover cities and national rail, not every rural area). Cost: 4 tokens (refunded when there is no transit data).

**Parameters:**

- `transaction_id` (string, optional) — Transaction id (UUID) from a search result. This or transactionId is required.
- `transactionId` (string, optional)

---

### 26. `get_transaction_permits`
**Transaction Building-Permit History**

Building-permit history for one transaction's parcels, from the national registry of building permits and works notifications (records since 2016): per case - kind (permit / notification), works type, object category, authority, date, address, volume. Use it after a search to screen what was built or approved on the land.
Match is by the parcel's current identifier, so splits/merges break the link. Permits are held once a decision is issued (its outcome, granted or refused, is not held); notifications only where accepted without objection; pending cases not at all.
For a parcel with no transaction, get_parcel_report lists the cases in its building-activity section. For what is being built around a point, use get_permits_in_area.
Three coverage states: covered (at least one registered case), covered_no_data (the transaction exists, its parcels have no case), not_covered (no transaction with this id). An empty result never confirms that nothing was planned. Cost: 4 tokens (refunded when there is no record or no such transaction).

**Parameters:**

- `transaction_id` (string, optional) — Transaction id (UUID) from a search result. This or transactionId is required.
- `transactionId` (string, optional)

---

### 27. `get_permits_in_area`
**Building Permits Within a Radius**

List the building permits and works notifications registered since 2016 within a radius of a point - issued decisions only, matched through the parcel geometry we hold, which is near-complete but not the whole cadastre - to see what is being built nearby.
Returns cases newest first, NOT nearest first (a permit and a notification for one investment are two cases), plus an aggregate by year and statutory object category over ALL matched cases (do not add it up across pages) with the permit/notification split and building volume. truncated = more cases than the limit: pass the returned cursor back as cursor with the same filters.
Examples: apartment blocks → categories=[XIII]; drop utility-network noise (XXVI can be most of a list) → excludeCategories=[XXVI]; utility works as a sign that land is being serviced for development → categories=[XXVI]. For "how many / how much" pass aggregateOnly=true (same price). The list is ordered by date: for what is closest use a smaller radiusKm (e.g. 0.3) instead of paging; radiusKm is 0.1–2 (default 2), for a wider area make several calls for neighbouring centres.
Reading it: decision outcomes (granted or refused) are not held; notifications only where accepted without objection; pending cases not at all. Matching uses the parcel's current identifier and geometry, so cases filed before a split or merge may be missed, parcels without geometry are not searched and a parcel number with a sheet segment may be matched less exactly. The answer states how many parcels we hold in the circle (0 = no data for the area) and the date of the last refresh: loaded periodically, not live. A volume marked suspect stays in the sums. A short or empty list is never a statement that nothing is being built. A query over the time limit returns an error asking for a smaller radius.
Coordinates: for a parcel take them from resolve_parcel (or search_parcels); for a street use list_parcels_in_area(location, street) and the centre point of a returned row; otherwise from the user - never guess them.
Cost: 5 API tokens per call, also for an empty list; each page is a separate call. It can be switched off for maintenance (a plain "temporarily unavailable" reply).

**Parameters:**

- `lat` (number, required) — Circle centre latitude (WGS84, Poland), from resolve_parcel / list_parcels_in_area or the user; never guessed.
- `lng` (number, required) — Circle centre longitude (WGS84, Poland), from resolve_parcel / list_parcels_in_area or the user; never guessed.
- `radiusKm` (number, optional) — Radius in km, 0.1–2 (default 2).
- `dateFrom` (string, optional) — Window start, YYYY-MM-DD (decision date; intake date for notifications). Default two years back; earlier than 2016-01-01 counts as 2016-01-01.
- `dateTo` (string, optional) — Window end, YYYY-MM-DD, inclusive, not before dateFrom. When older than two years, pass dateFrom as well.
- `intent` (enum: multi_family | single_family | all, optional) — multi_family = categories [XIII], single_family = [I] (incl. semi-detached and terraced), all = no filter (default). Not with categories.
- `categories` (array of enum: I | II | III | IV | V | VI | VII | VIII | IX | X | XI | XII | XIII | XIV | XV | XVI | XVII | XVIII | XIX | XX | XXI | XXII | XXIII | XXIV | XXV | XXVI | XXVII | XXVIII | XXIX | XXX, optional) — Keep only these object categories (Roman numerals I–XXX). Not with intent other than all; must not overlap excludeCategories.
- `excludeCategories` (array of enum: I | II | III | IV | V | VI | VII | VIII | IX | X | XI | XII | XIII | XIV | XV | XVI | XVII | XVIII | XIX | XX | XXI | XXII | XXIII | XXIV | XXV | XXVI | XXVII | XXVIII | XXIX | XXX, optional) — Drop these object categories (cases without a category stay). Must not overlap categories.
- `worksType` (enum: new_construction | all, optional) — new_construction (default) or all (adds extensions, demolitions and other works).
- `limit` (number, optional) — Cases in the list, 1–200 (default 50). The aggregate counts all matched cases.
- `cursor` (string, optional) — Cursor from the previous answer, for the next page; pass it back unchanged with the same filters. Not with aggregateOnly.
- `aggregateOnly` (boolean, optional) — true = only the aggregate (year × category counts, split, volumes), no case list. Same price; not with cursor.

---

### 28. `get_transaction_planning`
**Transaction General-Plan Zoning**

General-plan (plan ogólny, POG) zoning for one transaction's land: per linked plot, the zones covering it - symbol, name, share of the plot, the building parameters the plan sets (max height, max development intensity, max built-up coverage, min biologically active area) - plus overlay areas (infill development area / obszar uzupełnienia zabudowy, central development area). Use it for feasibility and permitted-use questions on a plot.
Coverage is THREE-STATE: 'covered' returns zone data; 'covered_no_data' = the municipality has an adopted general plan but no zone data covers these plots yet; 'not_covered' = no published general-plan data for the municipality yet - NEVER a claim that it has no plan (general plans are still being adopted). Cost: 4 tokens (refunded for covered_no_data and not_covered).

**Parameters:**

- `transaction_id` (string, optional) — Transaction id (UUID) from a search result. This or transactionId is required.
- `transactionId` (string, optional)

---

### 29. `get_transaction_farmland`
**Transaction Agricultural Land-Eligibility Breakdown**

Parcel-by-parcel agricultural land-eligibility breakdown for one transaction, from official nationwide eligibility data (updated weekly): per linked parcel with a matched eligible area - the area in m², its share of the parcel (when the measured area is known) and the number of source features; also how many linked parcels carry a match and the snapshot date. Useful for due diligence on land actually eligible/maintained as agricultural, beyond the paper classification.
A parcel with no match returns nothing - absence is NEVER a statement that the property is non-agricultural (small plots not actively farmed are absent, the layer has its own update cadence, older transactions can reference renumbered parcels). Cost: 4 tokens (refunded when there is no eligible area).

**Parameters:**

- `transaction_id` (string, optional) — Transaction id (UUID) from a search result. This or transactionId is required.
- `transactionId` (string, optional)

---

### 30. `get_transaction_nature`
**Transaction Nature (Forest & Protected Areas) Breakdown**

Parcel-by-parcel nature breakdown for one transaction: per linked plot with a nature signal - the nearest forest within 2 km (forest_distance_m, 0 = the plot overlaps forest, with the overlap share) and any overlapping protected areas: the sharpest form (protection_rank 1 = national park, 2 = nature reserve, 3 = Natura 2000, 4 = landscape park, 5 = protected landscape, 6 = other), building_restriction ('statutory_ban' = a ban following from the Nature Protection Act for parks and reserves, 'conditional' = depends on the establishing act), the share of the plot under protection and names.
Search results carry no nature signal: call this directly on a transaction id when forest proximity or protected-area build limits matter. For a parcel with no transaction, get_parcel_report names the protected areas. It describes the SOURCE of a restriction, not a permitting outcome; not legal advice.
An empty result is NEVER a statement that building is allowed (local plans and permit decisions are not covered). A buffer zone around a park or reserve is reported as 'buffer_zone' at rank 6, never as a statutory ban. An empty result says which kind it is: plots checked with no signal, or no nature data held yet - the second is never a finding of no forest or protected area. Cost: 4 tokens (refunded on any empty result).

**Parameters:**

- `transaction_id` (string, optional) — Transaction id (UUID) from a search result. This or transactionId is required.
- `transactionId` (string, optional)

