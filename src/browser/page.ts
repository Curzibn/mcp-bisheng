import type { BrowserContext } from "playwright";
import { ensureBrowserInstance } from "./engine";

export type PageLoadOptions = {
  url: string;
  timeoutMs: number;
  maxImageResources: number;
};

export type PageContent = {
  url: string;
  html: string;
};

export type PageController = {
  load: (options: PageLoadOptions) => Promise<PageContent>;
  close: () => Promise<void>;
};

function removeHiddenNodesAndGetHTML(): string {
  const root = document.body;
  const nodeIterator = document.createNodeIterator(
    root,
    NodeFilter.SHOW_ELEMENT,
    (node: Node) => {
      const nodeName = (node as Element).nodeName.toLowerCase();
      if (
        nodeName === "script" ||
        nodeName === "style" ||
        nodeName === "noscript" ||
        nodeName === "math"
      ) {
        return NodeFilter.FILTER_REJECT;
      }
      const el = node as HTMLElement;
      if (el.offsetParent === undefined) return NodeFilter.FILTER_ACCEPT;
      const style = window.getComputedStyle(el, null);
      if (
        style.getPropertyValue("visibility") === "hidden" ||
        style.getPropertyValue("display") === "none"
      ) {
        return NodeFilter.FILTER_ACCEPT;
      }
      return NodeFilter.FILTER_REJECT;
    }
  );
  const toRemove: Node[] = [];
  let n: Node | null;
  while ((n = nodeIterator.nextNode())) toRemove.push(n);
  toRemove.forEach((node) => node.parentNode?.removeChild(node));

  if (
    typeof (window as any).MathJax !== "undefined" &&
    (window as any).MathJax?.startup?.document?.math
  ) {
    const mathArray = (window as any).MathJax.startup.document.math;
    for (const math of mathArray) {
      if (math.typesetRoot) {
        math.typesetRoot.setAttribute("markdownload-latex", math.math);
      }
    }
  }

  document.body
    ?.querySelectorAll('[class*="highlight-text"],[class*="highlight-source"]')
    .forEach((codeSource: Element) => {
      const className = codeSource.className;
      const langMatch = className.match(/highlight-(?:text|source)-([a-z0-9]+)/);
      const language = langMatch && langMatch.length > 0 ? langMatch[1] : "";
      if (language && codeSource.firstChild) {
        (codeSource.firstChild as Element).id = `code-lang-${language}`;
      }
    });

  document.body
    ?.querySelectorAll('[class*="language-"]')
    .forEach((codeSource: Element) => {
      const className = codeSource.className;
      const langMatch = className.match(/language-([a-z0-9]+)/);
      const language = langMatch && langMatch.length > 0 ? langMatch[1] : "";
      if (language) {
        codeSource.id = `code-lang-${language}`;
      }
    });

  document.body?.querySelectorAll("pre br").forEach((br: Element) => {
    br.outerHTML = "<br-keep></br-keep>";
  });

  document.body?.querySelectorAll(".codehilite > pre").forEach((codeSource: Element) => {
    if (
      codeSource.firstChild &&
      (codeSource.firstChild as Element).nodeName !== "CODE" &&
      !codeSource.className.includes("language")
    ) {
      codeSource.id = "code-lang-text";
    }
  });

  document.body?.querySelectorAll("h1, h2, h3, h4, h5, h6").forEach((header: Element) => {
    header.className = "";
    header.outerHTML = header.outerHTML;
  });

  document.body?.querySelectorAll("pre, code").forEach((codeElement: Element) => {
    const walker = document.createTreeWalker(codeElement, NodeFilter.SHOW_TEXT, null);
    let node: Node | null;
    while ((node = walker.nextNode())) {
      if (node.textContent) {
        const text = node.textContent;
        const lines = text.split("\n");
        const cleanedLines = lines.map((line) => {
          const trimmed = line.trimStart();
          const match = trimmed.match(/^(\d+)[\s\t]*(.*)$/);
          if (match) {
            return line.replace(/^\s*\d+[\s\t]*/, "");
          }
          return line;
        });
        node.textContent = cleanedLines.join("\n");
      }
    }
  });

  if (!document.head.querySelector("title")) {
    const titleEl = document.createElement("title");
    titleEl.innerText = document.title;
    document.head.appendChild(titleEl);
  }

  const baseEls = document.head.getElementsByTagName("base");
  let baseEl: HTMLBaseElement;
  if (baseEls.length > 0) {
    baseEl = baseEls[0];
  } else {
    baseEl = document.createElement("base");
    document.head.appendChild(baseEl);
  }
  const href = baseEl.getAttribute("href");
  if (!href || !href.startsWith(window.location.origin)) {
    baseEl.setAttribute("href", window.location.href);
  }

  return document.documentElement.outerHTML;
}

export function createPageController(): PageController {
  return {
    async load(options: PageLoadOptions): Promise<PageContent> {
      const browserInstance = ensureBrowserInstance();
      const context = (await browserInstance.createContext({
        timeoutMs: options.timeoutMs,
        maxImageResources: options.maxImageResources
      })) as BrowserContext;
      const page = await context.newPage();

      await page.goto(options.url, {
        waitUntil: "networkidle",
        timeout: options.timeoutMs
      });

      const html = await page.evaluate(removeHiddenNodesAndGetHTML);
      const finalUrl = page.url();

      await context.close();

      return {
        url: finalUrl,
        html
      };
    },
    async close(): Promise<void> {
    }
  };
}

