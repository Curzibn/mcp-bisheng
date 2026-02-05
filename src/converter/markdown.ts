import TurndownService from "turndown";
import { gfm } from "turndown-plugin-gfm";
import { HtmlArticle } from "./html";

export type MarkdownResult = {
  markdown: string;
};

function validateUri(href: string, baseUri: string): string {
  try {
    new URL(href);
    return href;
  } catch {
    const base = new URL(baseUri);
    if (href.startsWith("/")) {
      return base.origin + href;
    }
    return base.href + (base.href.endsWith("/") ? "" : "/") + href;
  }
}

function cleanAttribute(attr: string | null): string {
  return attr ? attr.replace(/(\n+\s*)+/g, "\n") : "";
}

function repeat(character: string, count: number): string {
  return Array(count + 1).join(character);
}

function extractFormattedText(element: HTMLElement): string {
  const html = element.innerHTML;

  let text = html
    .replace(/<br\s*\/?>/gi, "\n")
    .replace(/<br-keep><\/br-keep>/gi, "\n")
    .replace(/<\/div>/gi, "\n")
    .replace(/<\/p>/gi, "\n")
    .replace(/<\/li>/gi, "\n")
    .replace(/<\/tr>/gi, "\n")
    .replace(/<\/td>/gi, " ")
    .replace(/<\/th>/gi, " ")
    .replace(/<pre[^>]*>/gi, "")
    .replace(/<\/pre>/gi, "")
    .replace(/<code[^>]*>/gi, "")
    .replace(/<\/code>/gi, "")
    .replace(/<span[^>]*class="[^"]*line-number[^"]*"[^>]*>[\d\s]*<\/span>/gi, "")
    .replace(/<span[^>]*class="[^"]*line[^"]*"[^>]*>[\d\s]*<\/span>/gi, "")
    .replace(/<[^>]+>/g, "")
    .replace(/&nbsp;/g, " ")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&amp;/g, "&")
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    .replace(/&#x([0-9a-fA-F]+);/g, (_, hex) => String.fromCharCode(parseInt(hex, 16)))
    .replace(/&#(\d+);/g, (_, dec) => String.fromCharCode(parseInt(dec, 10)));

  const textContent = element.textContent || "";

  const removeLineNumbers = (content: string): string => {
    const lines = content.split("\n");
    let hasLineNumbers = false;
    const processedLines = lines.map((line) => {
      const trimmedLine = line.trimStart();
      const lineNumberMatch = trimmedLine.match(/^(\d+)([\s\t]+|)(.*)$/);
      if (lineNumberMatch && lineNumberMatch[1]) {
        hasLineNumbers = true;
        const codePart = lineNumberMatch[3] || "";
        const originalIndent = line.match(/^(\s*)/)?.[1] || "";
        return originalIndent + codePart;
      }
      return line;
    });

    if (hasLineNumbers) {
      return processedLines.join("\n");
    }
    return content;
  };

  if (textContent.includes("\n") && textContent.split("\n").length > 3) {
    return removeLineNumbers(textContent);
  }

  const lines = text.split("\n").map((line) => {
    const trimmedLine = line.trimStart();
    const lineNumberMatch = trimmedLine.match(/^(\d+)([\s\t]+|)(.*)$/);
    if (lineNumberMatch && lineNumberMatch[1]) {
      const codePart = lineNumberMatch[3] || "";
      const originalIndent = line.match(/^(\s*)/)?.[1] || "";
      return originalIndent + codePart.trimEnd();
    }
    return line.trimEnd();
  });

  const formattedLines: string[] = [];

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];
    if (line || i === 0 || i === lines.length - 1) {
      formattedLines.push(line);
    } else if (formattedLines.length > 0 && formattedLines[formattedLines.length - 1] !== "") {
      formattedLines.push("");
    }
  }

  let result = formattedLines.join("\n").replace(/\n+$/, "");

  if (!result.includes("\n") && textContent && textContent.length > 50) {
    const numberedPattern = /(\d+)[\s\t]*([^\d\n]+)/g;
    const matches = Array.from(textContent.matchAll(numberedPattern));
    if (matches.length > 1) {
      result = matches.map((m) => m[2].trimStart()).join("\n");
    }
  }

  result = removeLineNumbers(result);

  const finalLines = result.split("\n");
  const cleanedFinalLines = finalLines.map((line) => {
    const trimmed = line.trimStart();
    if (trimmed.match(/^\d+[\s\t]*/)) {
      return line.replace(/^\s*\d+[\s\t]*/, "");
    }
    return line;
  });

  return cleanedFinalLines.join("\n");
}

function stripSpecialChars(md: string): string {
  return md.replace(
    /[\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f-\u009f\u00ad\u061c\u200b-\u200f\u2028\u2029\ufeff\ufff9-\ufffc]/g,
    ""
  );
}

function convertToFencedCodeBlock(node: Element, options: { fence: string }): string {
  const html = (node as HTMLElement).innerHTML.replace(/<br-keep><\/br-keep>/g, "<br>");
  (node as HTMLElement).innerHTML = html;

  const langMatch = node.id?.match(/code-lang-(.+)/);
  const language = langMatch && langMatch.length > 0 ? langMatch[1] : "";

  let code = extractFormattedText(node as HTMLElement);

  const fenceChar = options.fence.charAt(0);
  let fenceSize = 3;
  const fenceInCodeRegex = new RegExp("^" + fenceChar + "{3,}", "gm");

  let match: RegExpExecArray | null;
  while ((match = fenceInCodeRegex.exec(code))) {
    if (match[0].length >= fenceSize) {
      fenceSize = match[0].length + 1;
    }
  }

  const fence = repeat(fenceChar, fenceSize);

  const cleanedCode = code
    .split("\n")
    .map((line) => {
      const trimmed = line.trimStart();
      const lineNumberMatch = trimmed.match(/^(\d+)([\s\t]*)(.*)$/);
      if (lineNumberMatch && lineNumberMatch[1]) {
        const originalIndent = line.match(/^(\s*)/)?.[1] || "";
        return originalIndent + (lineNumberMatch[3] || "");
      }
      return line;
    })
    .join("\n")
    .replace(/\n+$/, "");

  return (
    "\n\n" +
    fence +
    language +
    "\n" +
    cleanedCode +
    "\n" +
    fence +
    "\n\n"
  );
}

function buildTurndownService(baseURI: string): TurndownService {
  const service = new TurndownService({
    headingStyle: "atx",
    bulletListMarker: "-",
    codeBlockStyle: "fenced",
    fence: "```",
    emDelimiter: "_",
    strongDelimiter: "**",
    linkStyle: "inlined",
    imageStyle: "markdown"
  });

  service.use(gfm);
  service.keep(["iframe", "sub", "sup", "u", "ins", "del", "small", "big"]);

  service.addRule("images", {
    filter(node: Node) {
      const el = node as Element;
      return el.nodeName === "IMG" && el.getAttribute("src");
    },
    replacement(_content: string, node: Node) {
      const el = node as Element;
      const src = el.getAttribute("src") ?? "";
      const resolved = validateUri(src, baseURI);
      const alt = cleanAttribute(el.getAttribute("alt"));
      const title = cleanAttribute(el.getAttribute("title"));
      const titlePart = title ? ` "${title}"` : "";
      return resolved ? `![${alt}](${resolved}${titlePart})` : "";
    }
  });

  service.addRule("links", {
    filter(node: Node) {
      const el = node as Element;
      if (el.nodeName === "A" && el.getAttribute("href")) {
        el.setAttribute("href", validateUri(el.getAttribute("href") as string, baseURI));
      }
      return false;
    },
    replacement(content: string) {
      return content;
    }
  });

  service.addRule("fencedCodeBlock", {
    filter(node: Node, options: { codeBlockStyle: string }) {
      const el = node as HTMLElement;
      const firstChild = el.firstChild as HTMLElement | null;
      return (
        options.codeBlockStyle === "fenced" &&
        el.nodeName === "PRE" &&
        firstChild !== null &&
        firstChild.nodeType === 1 &&
        firstChild.nodeName === "CODE"
      );
    },
    replacement(_content: string, node: Node, options: { fence: string }) {
      const el = node as HTMLElement;
      const firstChild = el.firstChild as HTMLElement | null;
      if (!firstChild) {
        return "";
      }
      return convertToFencedCodeBlock(firstChild, options);
    }
  });

  service.addRule("pre", {
    filter(node: Node) {
      const el = node as HTMLElement;
      const firstChild = el.firstChild as HTMLElement | null;
      return (
        el.nodeName === "PRE" &&
        (!firstChild || firstChild.nodeType !== 1 || firstChild.nodeName !== "CODE") &&
        !el.querySelector("img")
      );
    },
    replacement(_content: string, node: Node, options: { fence: string }) {
      return convertToFencedCodeBlock(node as Element, options);
    }
  });

  return service;
}

export function convertArticleToMarkdown(article: HtmlArticle): MarkdownResult {
  const service = buildTurndownService(article.url);
  let body = service.turndown(article.content);
  body = stripSpecialChars(body);

  const title = article.title ?? "Untitled";
  const markdown = `# ${title}\n\n${body}`.trim();

  return {
    markdown
  };
}

