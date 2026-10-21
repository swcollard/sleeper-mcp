# sleeper-mcp
Typescript MCP Server implementation for Sleeper Fantasy Football API

The same tools can run two ways: as a standalone Node server, or as a Cloudflare Worker. Both serve stateless Streamable HTTP at `/mcp`.

## Running Locally (Node)

1. Clone repo
2. `npm install` for dependencies
3. `npm run build` to build typescript
4. `npm start` to start the MCP server on port 3000 (set `PORT` to change it)

Then point your MCP Client at `http://localhost:3000/mcp` and make requests.

On startup the server loads Sleeper's player list from `/tmp/nfl.json` (or the path in `PLAYER_DATA_FILE`), downloading it if the file is missing or more than a day old, so it needs read/write access to that location. While running, it re-downloads the list in the background once a day, which keeps injury statuses current. If Sleeper is unavailable, it keeps using the old copy.

### Docker

```sh
docker build -t sleeper-mcp .
docker run -p 3000:3000 sleeper-mcp
```

## Cloudflare Worker

The Worker entry point is `src/worker.ts`, configured in `wrangler.jsonc`.

- `npm run worker:dev` runs it locally in the Workers runtime at `http://localhost:8787/mcp`.
- `npm run worker:deploy` deploys it to your Cloudflare account. Run `npx wrangler login` first.

Each Worker isolate downloads the player list the first time a player tool is used. To share it across isolates, cache it in a KV namespace:

1. `npx wrangler kv namespace create PLAYERS_KV`
2. Uncomment `kv_namespaces` in `wrangler.jsonc` and paste in the namespace id.

The cached copy holds only the player fields the tools use, and expires after 24 hours.

Note: the first player lookup in a fresh isolate parses Sleeper's full player list (several MB), which can exceed the Workers Free plan's per-request CPU limit. The Paid plan is recommended; binding KV also helps, since most isolates then read the much smaller cached copy.

## API key

Set `API_KEY` to require clients to send the key with every request, either as an `x-api-key: <key>` header or as `Authorization: Bearer <key>`; others get a `401`. Without it, the server accepts all requests and logs a warning. To rotate keys without downtime, set several comma-separated keys (`API_KEY=new-key,old-key`), update your clients, then remove the old one.

Generate a key with `openssl rand -hex 32`, then set it:

- **Node:** `API_KEY=<key> npm start`
- **Docker:** `docker run -p 3000:3000 -e API_KEY=<key> sleeper-mcp`
- **Cloudflare Worker:** `npx wrangler secret put API_KEY`, or add it as a **Secret** under the Worker's Settings → Variables and Secrets in the Cloudflare dashboard. Secrets persist across deploys. For `npm run worker:dev`, put `API_KEY=<key>` in a `.dev.vars` file (gitignored).

Then configure your MCP client to send the key:

- **claude.ai custom connector:** in **Customize → Connectors → Add custom connector**, choose **No sign-in**, then under **Request headers** pick `x-api-key` and enter just the key. Claude sends header values exactly as entered, so if you use `authorization` instead, enter `Bearer <key>` including the `Bearer ` prefix. Request headers are in beta and not yet available to every account; authentication settings can't be edited later, so to change the key, remove the connector and add it again.
- **Claude Code:**

  ```sh
  claude mcp add --transport http sleeper https://<your-worker>.workers.dev/mcp \
    --header "x-api-key: <key>"
  ```

## Default league

League tools take an optional `league_id`. When it's omitted they use, in order:

1. the `league_id` query parameter on the MCP URL, set per client: `http://localhost:3000/mcp?league_id=<id>`
2. the `DEFAULT_LEAGUE_ID` setting for the whole server

Without either, the model asks the user for their league id. Set `DEFAULT_LEAGUE_ID` like `API_KEY` above: as an environment variable for Node and Docker, or for the Worker as a variable in `wrangler.jsonc` (`"vars": { "DEFAULT_LEAGUE_ID": "<id>" }`) or the Cloudflare dashboard. A shared Worker usually wants the query parameter instead, so each client picks its own league.

## Users and leagues

- `find_user_leagues` takes a Sleeper username (and optionally a season, defaulting to the one leagues are currently played or created for) and lists that user's leagues: id, name, season, status, number of teams and scoring type. Users who don't know their league id can find it this way.
- `get_league` returns a league's settings: lineup slots, scoring (as `ppr`, `half_ppr`, `standard` or `custom (N per reception)`, plus the full points-per-stat table), playoff teams and start week, waiver type and FAAB budget, and trade deadline.

## Transactions and free agents

- `get_league_transactions` lists a week's trades, waiver claims (failed ones included, with their FAAB bids), free agent moves and commissioner moves, newest first, with team and player names. It defaults to the current week and can filter by type.
- `get_trending_players` lists the players most added or dropped across Sleeper over the last 1–168 hours. With a league (the argument or the default league), it also says which team has each player.
- `get_free_agents` computes a league's best available players, since Sleeper has no endpoint for it: active players at positions the league starts, minus everyone on a roster, IR or taxi squad, ranked by Sleeper's overall ranking (not a weekly projection). Players dropped this week are flagged as possibly still on waivers; this is approximate. It needs the player list, so it fails if that can't load.

The logic lives in `src/transactions.ts` and `src/freeAgents.ts`; the tools are in `src/tools/transactions.ts` and `src/tools/market.ts`.

## Players and teams

- `search_players` finds players and team defenses by name: exact names first, then partial names ("mahomes", "pat mah"), then small typos ("mahomse"). Defenses also match their team's nickname or abbreviation ("Chiefs", "KC"). It can filter by position and NFL team (`"FA"` for free agents), and returns up to 50 results (10 by default). The matching is in `src/playerSearch.ts`.
- `get_player_details` returns position, team, injury status, depth chart and more for up to 100 player ids at once, with `as_of` saying when the player data was downloaded. Unknown ids are listed in `not_found`.
- `get_league_teams` returns each team in a league (or one, by `roster_id`) with its owner, record, points, and players by name split into starters, bench, IR and taxi. An empty lineup slot is `null` in `starters`. The join is in `src/teams.ts`, using `src/rosterOwners.ts` (roster id to owner and team name), which the scoreboard, transactions and trending players share.

## Development

- `npm test` runs the unit tests.
- `npm run typecheck` type-checks everything, tests included (`npm run build` leaves tests out).

CI runs both, plus the build and a Worker bundle check (`wrangler deploy --dry-run`), on every pull request.

### Layout

- `src/mcp.ts` creates the MCP server; each module in `src/tools/` registers one group of tools, using the shared helpers in `src/tools/context.ts` (league id and week handling, Sleeper calls, results) and the shared schemas in `src/tools/schemas.ts`.
- `src/sleeper.ts` has types for Sleeper API responses.
- `src/players.ts` builds the player directory (lookups by id and name, and player details) and refreshes it daily; `src/playerFile.ts` is the Node server's file cache of it.
- `src/server.ts` (Node) and `src/worker.ts` (Cloudflare Worker) are the two entry points.
