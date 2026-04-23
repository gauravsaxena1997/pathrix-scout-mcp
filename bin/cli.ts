import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { registerScoutTools } from "../src/index.js";

const server = new McpServer({
  name: "pathrix-scout",
  version: "1.0.0",
});

registerScoutTools(server);

const transport = new StdioServerTransport();
await server.connect(transport);
