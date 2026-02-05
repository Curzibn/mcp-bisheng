import { z } from "zod";

const configSchema = z.object({
  mcpServerName: z.string().default("@curzbin/mcp-bisheng"),
  browserTimeoutMs: z.number().int().positive().default(30000),
  maxImageResources: z.number().int().positive().default(50)
});

export type AppConfig = z.infer<typeof configSchema>;

export function getConfig(): AppConfig {
  const rawConfig = {
    mcpServerName: process.env.MCP_SERVER_NAME,
    browserTimeoutMs: process.env.BROWSER_TIMEOUT_MS ? Number(process.env.BROWSER_TIMEOUT_MS) : undefined,
    maxImageResources: process.env.MAX_IMAGE_RESOURCES ? Number(process.env.MAX_IMAGE_RESOURCES) : undefined
  };

  return configSchema.parse(rawConfig);
}

