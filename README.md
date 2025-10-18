# sleeper-mcp
Typescript MCP Server implementation for Sleeper Fantasy Football API

## Running Locally

1. Clone repo
2. `npm install` for dependencies
3. `npm run build` to build typescript
4. `npm start` to start the MCP server on port 3000

Then point your MCP Client at the server and make requests. Note: this server downloads a file to `/tmp/nfl.json` so it requires read/write access to the directory.