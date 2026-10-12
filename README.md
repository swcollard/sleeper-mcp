# sleeper-mcp
Typescript MCP Server implementation for Sleeper Fantasy Football API

The same tools can run two ways: as a standalone Node server, or as a Cloudflare Worker. Both serve stateless Streamable HTTP at `/mcp`.

## Running Locally (Node)

1. Clone repo
2. `npm install` for dependencies
3. `npm run build` to build typescript
4. `npm start` to start the MCP server on port 3000 (set `PORT` to change it)

Then point your MCP Client at `http://localhost:3000/mcp` and make requests.

On startup the server downloads Sleeper's player list to `/tmp/nfl.json` (or the path in `PLAYER_DATA_FILE`), so it needs read/write access to that location. Delete the file to pick up new players.

## Cloudflare Worker

The Worker entry point is `src/worker.ts`, configured in `wrangler.jsonc`.

- `npm run worker:dev` runs it locally in the Workers runtime at `http://localhost:8787/mcp`.
- `npm run worker:deploy` deploys it to your Cloudflare account. Run `npx wrangler login` first.

Each Worker isolate downloads the player list the first time a player tool is used. To share it across isolates, cache it in a KV namespace:

1. `npx wrangler kv namespace create PLAYERS_KV`
2. Uncomment `kv_namespaces` in `wrangler.jsonc` and paste in the namespace id.

The cached names expire after 24 hours.

Note: the first player lookup in a fresh isolate parses Sleeper's full player list (several MB), which can exceed the Workers Free plan's per-request CPU limit. The Paid plan is recommended; binding KV also helps, since most isolates then read the much smaller cached copy.

## Development

`npm test` runs the unit tests.
