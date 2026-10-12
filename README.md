# sleeper-mcp
Typescript MCP Server implementation for Sleeper Fantasy Football API

## Running Locally

1. Clone repo
2. `npm install` for dependencies
3. `npm run build` to build typescript
4. `npm start` to start the MCP server on port 3000 (set `PORT` to change it)

Then point your MCP Client at `http://localhost:3000/mcp` and make requests.

On startup the server downloads Sleeper's player list to `/tmp/nfl.json` (or the path in `PLAYER_DATA_FILE`), so it needs read/write access to that location. Delete the file to pick up new players.
