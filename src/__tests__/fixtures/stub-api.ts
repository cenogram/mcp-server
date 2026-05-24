// Stub upstream API for E2E tests of MCP HTTP transport.
//
// Matching strategy:
// - byBearerToken: exact match on token (after "Bearer " prefix). Key = full token string.
// - byOAuthUser: match on X-OAuth-User header (OAuth path uses X-OAuth-User + X-Internal-Auth,
//   NOT Authorization - see api-client.ts:118-126).
// - default: fallback when no match. Loud failure body to surface test misconfig.
import { createServer, type Server } from "node:http";

export interface StubScenario {
  status: number;
  body?: unknown;
}

export interface ScenarioMap {
  byBearerToken?: Record<string, StubScenario>;
  byOAuthUser?: Record<string, StubScenario>;
  default?: StubScenario;
}

export interface StubApi {
  port: number;
  setScenarios(scenarios: ScenarioMap): void;
  close(): Promise<void>;
}

export function startStubApi(initial: ScenarioMap = {}): Promise<StubApi> {
  return new Promise((resolve) => {
    let scenarios: ScenarioMap = initial;
    const server: Server = createServer((req, res) => {
      const auth = req.headers.authorization || "";
      const token = auth.startsWith("Bearer ") ? auth.slice(7) : null;
      const oauthUser = (req.headers["x-oauth-user"] as string | undefined) ?? null;

      let scenario: StubScenario | undefined;
      if (token && scenarios.byBearerToken && scenarios.byBearerToken[token]) {
        scenario = scenarios.byBearerToken[token];
      } else if (oauthUser && scenarios.byOAuthUser && scenarios.byOAuthUser[oauthUser]) {
        scenario = scenarios.byOAuthUser[oauthUser];
      }
      scenario ??= scenarios.default ?? {
        status: 500,
        body: { error: "TEST_BUG_NO_SCENARIO_SET", path: req.url, auth: auth.slice(0, 20), oauthUser },
      };

      res.writeHead(scenario.status, { "Content-Type": "application/json" });
      res.end(JSON.stringify(scenario.body ?? { error: "stub" }));
    });
    server.listen(0, "127.0.0.1", () => {
      const addr = server.address();
      const port = typeof addr === "object" && addr ? addr.port : 0;
      resolve({
        port,
        setScenarios: (s) => { scenarios = s; },
        close: () => new Promise<void>((r) => {
          server.closeAllConnections(); // force-close keep-alive (undici default) - prevents test timeout
          server.close(() => r());
        }),
      });
    });
  });
}
