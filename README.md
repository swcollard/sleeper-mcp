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

The cached names expire after 24 hours.

Note: the first player lookup in a fresh isolate parses Sleeper's full player list (several MB), which can exceed the Workers Free plan's per-request CPU limit. The Paid plan is recommended; binding KV also helps, since most isolates then read the much smaller cached copy.

## API key

Set `API_KEY` to require clients to send `Authorization: Bearer <key>` with every request; others get a `401`. Without it, the server accepts all requests and logs a warning. To rotate keys without downtime, set several comma-separated keys (`API_KEY=new-key,old-key`), update your clients, then remove the old one.

Generate a key with `openssl rand -hex 32`, then set it:

- **Node:** `API_KEY=<key> npm start`
- **Docker:** `docker run -p 3000:3000 -e API_KEY=<key> sleeper-mcp`
- **Cloudflare Worker:** `npx wrangler secret put API_KEY`, or add it as a **Secret** under the Worker's Settings → Variables and Secrets in the Cloudflare dashboard. Secrets persist across deploys. For `npm run worker:dev`, put `API_KEY=<key>` in a `.dev.vars` file (gitignored).

Then configure your MCP client to send the header. For example, with Claude Code:

```sh
claude mcp add --transport http sleeper https://<your-worker>.workers.dev/mcp \
  --header "Authorization: Bearer <key>"
```

## Development

`npm test` runs the unit tests.
