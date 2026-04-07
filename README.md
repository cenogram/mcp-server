# Cenogram MCP Server

[![npm version](https://img.shields.io/npm/v/@cenogram/mcp-server)](https://www.npmjs.com/package/@cenogram/mcp-server)
[![Node.js](https://img.shields.io/badge/node-%3E%3D18-brightgreen)](https://nodejs.org)
[![License: MIT](https://img.shields.io/badge/License-MIT-blue.svg)](LICENSE)

**Polish Real Estate Transaction Data for AI**

MCP server for Polish real estate data. Access 7M+ real estate transactions from the national Registry of Prices and Values (Rejestr Cen Nieruchomosci, RCN) directly from Claude, Cursor, or any MCP-compatible AI assistant.

Data source: Polish national RCN registry (Rejestr Cen Nieruchomosci) | Platform: [cenogram.pl](https://cenogram.pl)

## Get your API key

1. Go to [cenogram.pl/api](https://cenogram.pl/api)
2. Enter your email
3. You'll receive your `cngrm_...` API key by email

Manage your keys at [cenogram.pl/ustawienia](https://cenogram.pl/ustawienia).

## Installation

Pick your client. All options below use the hosted server — no local install needed (except npx/stdio).

<details open>
<summary><strong>Claude Code</strong></summary>

One command — zero config files:

```bash
claude mcp add cenogram https://mcp.cenogram.pl/mcp \
  -t http -H "Authorization: Bearer YOUR_API_KEY"
```

</details>

<details>
<summary><strong>Cursor</strong></summary>

Add to `.cursor/mcp.json` in your project:

```json
{
  "mcpServers": {
    "cenogram": {
      "type": "http",
      "url": "https://mcp.cenogram.pl/mcp",
      "headers": {
        "Authorization": "Bearer YOUR_API_KEY"
      }
    }
  }
}
```

</details>

<details>
<summary><strong>Claude Desktop</strong></summary>

Add to your config file:
- macOS: `~/Library/Application Support/Claude/claude_desktop_config.json`
- Windows: `%APPDATA%\Claude\claude_desktop_config.json`

**HTTP remote** (Claude Desktop 0.9+):
```json
{
  "mcpServers": {
    "cenogram": {
      "type": "http",
      "url": "https://mcp.cenogram.pl/mcp",
      "headers": {
        "Authorization": "Bearer YOUR_API_KEY"
      }
    }
  }
}
```

**Stdio fallback** (older versions — requires Node.js >= 18):
```json
{
  "mcpServers": {
    "cenogram": {
      "command": "npx",
      "args": ["-y", "@cenogram/mcp-server@latest"],
      "env": {
        "CENOGRAM_API_KEY": "YOUR_API_KEY"
      }
    }
  }
}
```

</details>

<details>
<summary><strong>VS Code / GitHub Copilot</strong></summary>

Add to `.vscode/mcp.json` in your workspace:

```json
{
  "servers": {
    "cenogram": {
      "type": "http",
      "url": "https://mcp.cenogram.pl/mcp",
      "headers": {
        "Authorization": "Bearer YOUR_API_KEY"
      }
    }
  }
}
```

</details>

<details>
<summary><strong>Windsurf</strong></summary>

Add to `~/.codeium/windsurf/mcp_config.json`:

**HTTP remote:**
```json
{
  "mcpServers": {
    "cenogram": {
      "type": "http",
      "url": "https://mcp.cenogram.pl/mcp",
      "headers": {
        "Authorization": "Bearer YOUR_API_KEY"
      }
    }
  }
}
```

If HTTP doesn't work, use the **npx (stdio)** option below instead.

</details>

<details>
<summary><strong>Cline</strong></summary>

In VS Code: Settings > Cline > MCP Servers. Add:

```json
{
  "cenogram": {
    "type": "http",
    "url": "https://mcp.cenogram.pl/mcp",
    "headers": {
      "Authorization": "Bearer YOUR_API_KEY"
    }
  }
}
```

</details>

<details>
<summary><strong>npx (stdio) — local/offline</strong></summary>

Requires **Node.js >= 18**. Use this if you want to run the server locally instead of connecting to the hosted one.

```json
{
  "mcpServers": {
    "cenogram": {
      "command": "npx",
      "args": ["-y", "@cenogram/mcp-server@latest"],
      "env": {
        "CENOGRAM_API_KEY": "YOUR_API_KEY"
      }
    }
  }
}
```

| Client | Config file |
|---|---|
| Cursor | `.cursor/mcp.json` |
| Claude Code | `.mcp.json` in your project |
| Claude Desktop | `~/Library/Application Support/Claude/claude_desktop_config.json` |
| Windsurf | `~/.codeium/windsurf/mcp_config.json` |
| Cline | VS Code settings > Cline > MCP Servers |

</details>

## Configuration

| Env Variable | Required | Default | Description |
|---|---|---|---|
| `CENOGRAM_API_KEY` | **Yes** (stdio) | — | API key from [cenogram.pl/api](https://cenogram.pl/api) |
| `CENOGRAM_API_URL` | No | `https://cenogram.pl` | API base URL |
| `MCP_TRANSPORT` | No | `stdio` | Set to `http` for Streamable HTTP mode |
| `MCP_PORT` | No | `3002` | HTTP server port (HTTP mode only) |
| `CENOGRAM_CLIENT_ID` | No | auto-generated | Persistent client identifier |

You can also use the `--http` CLI flag instead of `MCP_TRANSPORT=http`.

## Example Prompts

**Polish:**
- "Jaka jest mediana cen mieszkan w Krakowie w 2025?"
- "Pokaz transakcje z ulicy Pulawskiej 15 na Mokotowie"
- "Znajdz transakcje na dzialce 146518_8.0108.27"
- "Znajdz transakcje gruntow w promieniu 5km od centrum Wroclawia powyzej 500 000 PLN"
- "Porownaj ceny mieszkan na Mokotowie i Woli"
- "Pokaz rozklad cen nieruchomosci w Polsce"

**English:**
- "What's the median apartment price in Krakow in 2025?"
- "Show transactions at Pulawska 15 in Mokotow"
- "Find all transactions on parcel 146502_8.0901.12 and then search nearby"
- "Find land transactions within 5km of Wroclaw center above 500,000 PLN"
- "Compare apartment prices in Mokotow and Wola districts"
- "Show the price distribution of real estate in Poland"

## Tools

| Tool | Description | Key Parameters |
|---|---|---|
| `search_transactions` | Search transactions with filters | location, street, buildingNumber, parcelId, propertyType, marketType, price/date/area range |
| `get_price_statistics` | Price/m2 stats by location (residential only) | location (optional) |
| `get_price_distribution` | Price histogram | bins, maxPrice |
| `search_by_area` | Search by geographic radius | latitude, longitude, radiusKm |
| `get_market_overview` | Database overview and stats | (none) |
| `list_locations` | List available locations | search (optional) |
| `search_parcels` | Search parcels by cadastral ID prefix | q (parcel ID prefix, min 3 chars) |
| `search_by_polygon` | Search within a GeoJSON polygon | polygon, propertyType, dateFrom/dateTo |
| `compare_locations` | Compare stats across 2-5 districts | districts (comma-separated), propertyType |

### Location naming

- Most cities: use the city name directly (e.g., "Gdansk", "Lublin")
- Warsaw: use district names ("Mokotow", "Srodmiescie", "Wola") -- "Warszawa" won't match
- Krakow: use sub-districts ("Krakow-Podgorze", "Krakow-Srodmiescie") — plain "Krakow" won't match
- Use `list_locations` to find valid names

### Property types

| Value | Polish | English |
|---|---|---|
| `land` | Grunt | Land plot |
| `building` | Budynek | Building |
| `developed_land` | Grunt zabudowany | Developed land |
| `unit` | Lokal | Apartment/unit |

### Workflows

Results include parcel IDs and GPS coordinates, enabling multi-step research:

```
1. Search by address    -> search_transactions(location="Mokotow", street="Pulawska", buildingNumber="15")
2. Note parcel_id and coordinates from results
3. Search nearby        -> search_by_area(lat=52.19, lng=21.01, radiusKm=2, propertyType="unit")
4. Compare prices       -> get_price_statistics(location="Mokotow")
```

This mimics how a property appraiser finds comparable transactions for valuation reports.

## Data

- **7M+ transactions** from all of Poland (380+ counties)
- **Date range:** 2003 - present
- **Source:** Polish national RCN registry (Rejestr Cen Nieruchomosci)
- **Refresh:** periodic updates from RCN

## Troubleshooting

**"Error: CENOGRAM_API_KEY is required"** — This only applies to stdio mode. Make sure `CENOGRAM_API_KEY` is set in the `env` block of your MCP config. For HTTP remote, the key goes in the `Authorization` header instead.

**npx hangs or fails** — Check your Node.js version with `node -v`. The stdio mode requires Node.js >= 18. If you're on an older version, use the HTTP remote option instead (no Node.js needed).

**"Warszawa" returns 0 results** — Warsaw uses district names (Mokotow, Wola, Srodmiescie, Bemowo, etc.). Use `list_locations(search="warsz")` to find valid names. Same applies to Krakow (use "Krakow-Podgorze", "Krakow-Srodmiescie", etc.).

**401 Unauthorized (HTTP mode)** — The `Authorization` header must be `Bearer cngrm_...` (with the `Bearer` prefix). Double-check that the full API key is included, not just the prefix.

## Development

```bash
git clone https://github.com/cenogram/mcp-server.git
cd mcp-server
npm install
npm test
npm run build
```

## License

MIT
