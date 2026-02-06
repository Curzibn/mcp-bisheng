import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { getConfig } from "./config";
import { createTools } from "./server/tools";

async function main() {
  const config = getConfig();
  const transport = new StdioServerTransport();
  const server = new McpServer({
    name: config.mcpServerName,
    version: "0.1.3"
  });

  createTools(server, config);

  await server.connect(transport);
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});

