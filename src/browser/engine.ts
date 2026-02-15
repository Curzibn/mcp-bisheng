import type { Browser, BrowserContext, Route } from "playwright";
import { logger } from "../utils/logger";

export type BrowserContextOptions = {
  timeoutMs: number;
  maxImageResources: number;
};

export type BrowserInstance = {
  createContext: (options: BrowserContextOptions) => Promise<BrowserContext>;
  close: () => Promise<void>;
};

let browserInstance: BrowserInstance | null = null;

export function setBrowserInstance(instance: BrowserInstance | null) {
  browserInstance = instance;
}

export function getBrowserInstance(): BrowserInstance {
  if (!browserInstance) {
    throw new Error("Browser instance is not initialized");
  }

  return browserInstance;
}

function isHttpProtocol(url: string): boolean {
  return url.startsWith("http://") || url.startsWith("https://");
}

async function configureRoutes(context: BrowserContext, options: BrowserContextOptions) {
  let imageCount = 0;

  await context.route("**/*", (route: Route) => {
    const request = route.request();
    const resourceType = request.resourceType();
    const url = request.url();

    if (!isHttpProtocol(url)) {
      logger.debug({ url }, "route blocked: non-http protocol");
      route.abort();
      return;
    }

    if (resourceType === "image") {
      if (imageCount >= options.maxImageResources) {
        logger.debug({ url, limit: options.maxImageResources }, "route blocked: image limit reached");
        route.abort();
        return;
      }
      imageCount += 1;
      route.continue();
      return;
    }

    route.continue();
  });
}

function createDefaultBrowserInstance(): BrowserInstance {
  let browserPromise: Promise<Browser> | null = null;

  const ensureBrowser = async (): Promise<Browser> => {
    if (!browserPromise) {
      logger.info("launching chromium browser");
      const { chromium } = await import("playwright");
      browserPromise = chromium.launch({
        headless: true
      });
    }
    return browserPromise;
  };

  return {
    async createContext(options: BrowserContextOptions): Promise<BrowserContext> {
      const browser = await ensureBrowser();
      const context = await browser.newContext();
      context.setDefaultTimeout(options.timeoutMs);
      context.setDefaultNavigationTimeout(options.timeoutMs);
      await configureRoutes(context, options);
      logger.debug({ timeoutMs: options.timeoutMs, maxImageResources: options.maxImageResources }, "browser context created");
      return context;
    },
    async close(): Promise<void> {
      if (!browserPromise) {
        return;
      }
      const browser = await browserPromise;
      await browser.close();
      browserPromise = null;
      logger.info("browser closed");
    }
  };
}

export function ensureBrowserInstance(): BrowserInstance {
  if (!browserInstance) {
    browserInstance = createDefaultBrowserInstance();
  }
  return browserInstance;
}
