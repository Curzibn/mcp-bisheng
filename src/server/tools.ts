import fs from "fs";
import path from "path";
import { execSync } from "child_process";
import { z } from "zod";
import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { AppConfig } from "../config";
import { createPageController } from "../browser/page";
import { extractArticleFromHtml } from "../converter/html";
import { convertArticleToMarkdown } from "../converter/markdown";

const readUrlInputSchema = z.object({
  url: z
    .string()
    .url()
    .describe("The web page URL to capture. Only http/https are supported."),
  output_path: z
    .string()
    .describe(
      "Optional. The path to save the generated Markdown file. Relative paths are resolved from the MCP process working directory; using an absolute path is recommended (for example: d:\\\\Workspace\\\\WizThink\\\\BiSheng\\\\mcp-bisheng\\\\signatureInstance.md)."
    )
    .optional()
});

const installChromiumInputSchema = z.object({
  with_deps: z.boolean().optional().default(false)
});

const scanDocsTocInputSchema = z.object({
  url: z
    .string()
    .url()
    .describe("The documentation website URL to scan. Only http/https are supported."),
  max_depth: z
    .number()
    .int()
    .positive()
    .optional()
    .default(10)
    .describe("Maximum depth to scan the table of contents tree, default is 10.")
});

function isChromiumMissingError(err: unknown): boolean {
  const msg = err instanceof Error ? err.message : String(err);
  return (
    msg.includes("Executable doesn't exist") ||
    msg.includes("Executable path does not exist") ||
    msg.includes("browserType.launch") ||
    msg.includes("does not exist at")
  );
}

function isPrivateHost(url: URL): boolean {
  const host = url.hostname;
  if (host === "localhost") {
    return true;
  }
  if (host.startsWith("127.")) {
    return true;
  }
  if (host.startsWith("10.")) {
    return true;
  }
  if (host.startsWith("192.168.")) {
    return true;
  }
  const parts = host.split(".");
  if (parts.length === 4 && parts[0] === "172") {
    const second = Number(parts[1]);
    if (second >= 16 && second <= 31) {
      return true;
    }
  }
  return false;
}

export function createTools(server: McpServer, config: AppConfig): void {
  server.registerTool(
    "read_url",
    {
      description:
        "Use a headless browser to render a web page and return the main content as Markdown. When output_path is provided, also save the Markdown to that path on disk.",
      inputSchema: readUrlInputSchema
    },
    async (args) => {
      const url = new URL(args.url);

      if (url.protocol !== "http:" && url.protocol !== "https:") {
        throw new Error("Only http and https protocols are allowed");
      }

      if (isPrivateHost(url)) {
        throw new Error("Access to private network addresses is not allowed");
      }

      const controller = createPageController();
      let pageContent;
      try {
        pageContent = await controller.load({
          url: args.url,
          timeoutMs: config.browserTimeoutMs,
          maxImageResources: config.maxImageResources
        });
      } catch (err) {
        if (isChromiumMissingError(err)) {
          throw new Error(
            "Chromium is not installed. Please call the install_chromium tool to install Chromium first, then retry read_url."
          );
        }
        throw err;
      }

      const article = await extractArticleFromHtml(pageContent.html, pageContent.url);
      const markdownResult = await convertArticleToMarkdown(article);

      let savedPath: string | undefined;

      if (args.output_path) {
        const out = path.resolve(args.output_path);
        fs.mkdirSync(path.dirname(out), { recursive: true });
        fs.writeFileSync(out, markdownResult.markdown, "utf-8");
        savedPath = out;
      }

      const header = savedPath ? `Saved to ${savedPath}\n\n` : "";
      const text = `${header}${markdownResult.markdown}`;

      return {
        content: [
          {
            type: "text",
            text
          }
        ]
      };
    }
  );

  server.registerTool(
    "install_chromium",
    {
      description:
        "Install Chromium browser for Playwright. Call this when read_url fails with Chromium not found error, then retry read_url.",
      inputSchema: installChromiumInputSchema
    },
    async (args) => {
      const cmd = args.with_deps ? "npx playwright install --with-deps chromium" : "npx playwright install chromium";
      try {
        const output = execSync(cmd, {
          encoding: "utf-8",
          stdio: ["inherit", "pipe", "pipe"]
        });
        const text = output ? `Chromium installed successfully.\n\n${output}` : "Chromium installed successfully.";
        return {
          content: [{ type: "text" as const, text }]
        };
      } catch (err: unknown) {
        const stderr = err && typeof err === "object" && "stderr" in err ? String((err as { stderr?: unknown }).stderr) : "";
        const stdout = err && typeof err === "object" && "stdout" in err ? String((err as { stdout?: unknown }).stdout) : "";
        const msg = err instanceof Error ? err.message : String(err);
        const text = `Chromium installation failed: ${msg}${stderr ? `\n\nstderr:\n${stderr}` : ""}${stdout ? `\n\nstdout:\n${stdout}` : ""}`;
        return {
          content: [{ type: "text" as const, text }]
        };
      }
    }
  );

  server.registerTool(
    "scan_docs_toc",
    {
      description:
        "Scan the table of contents (TOC) structure from a documentation website. Returns a structured tree of all documentation pages with their titles and URLs. AI can use this to download multiple pages and combine them into a complete document.",
      inputSchema: scanDocsTocInputSchema
    },
    async (args) => {
      const url = new URL(args.url);

      if (url.protocol !== "http:" && url.protocol !== "https:") {
        throw new Error("Only http and https protocols are allowed");
      }

      if (isPrivateHost(url)) {
        throw new Error("Access to private network addresses is not allowed");
      }

      const controller = createPageController();
      let tocResult;
      try {
        tocResult = await controller.scanToc({
          url: args.url,
          timeoutMs: config.browserTimeoutMs,
          maxImageResources: config.maxImageResources,
          maxDepth: args.max_depth
        });
      } catch (err) {
        if (isChromiumMissingError(err)) {
          throw new Error(
            "Chromium is not installed. Please call the install_chromium tool to install Chromium first, then retry scan_docs_toc."
          );
        }
        throw err;
      }

      const resultJson = JSON.stringify(tocResult, null, 2);
      const text = `Found ${tocResult.totalCount} documentation pages:\n\n${resultJson}`;

      return {
        content: [
          {
            type: "text",
            text
          }
        ]
      };
    }
  );
}

