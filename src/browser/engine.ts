import { chromium, type Browser, type BrowserContext, type Route } from "playwright";

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
      route.abort();
      return;
    }

    if (resourceType === "image") {
      if (imageCount >= options.maxImageResources) {
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
      return context;
    },
    async close(): Promise<void> {
      if (!browserPromise) {
        return;
      }
      const browser = await browserPromise;
      await browser.close();
      browserPromise = null;
    }
  };
}

export function ensureBrowserInstance(): BrowserInstance {
  if (!browserInstance) {
    browserInstance = createDefaultBrowserInstance();
  }
  return browserInstance;
}
