import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { getConfig } from "./config";
import { createTools } from "./server/tools";
import { logger } from "./utils/logger";

const VERSION = "0.1.3";

async function main() {
  const config = getConfig();
  const transport = new StdioServerTransport();
  const server = new McpServer({
    name: config.mcpServerName,
    version: VERSION
  });

  createTools(server, config);

  await server.connect(transport);
  logger.info({ name: config.mcpServerName, version: VERSION }, "mcp server started");
}

main().catch((error) => {
  logger.fatal({ err: error }, "mcp server failed to start");
  process.exit(1);
});

