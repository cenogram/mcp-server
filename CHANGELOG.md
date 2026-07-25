# Changelog

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
