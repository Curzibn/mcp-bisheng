import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";
import fs from "fs";
import path from "path";
import { execSync } from "child_process";

//#region src/config.ts
const configSchema = z.object({
	mcpServerName: z.string().default("@curzbin/mcp-bisheng"),
	browserTimeoutMs: z.number().int().positive().default(3e4),
	maxImageResources: z.number().int().positive().default(50)
});
function getConfig() {
	const rawConfig = {
		mcpServerName: process.env.MCP_SERVER_NAME,
		browserTimeoutMs: process.env.BROWSER_TIMEOUT_MS ? Number(process.env.BROWSER_TIMEOUT_MS) : void 0,
		maxImageResources: process.env.MAX_IMAGE_RESOURCES ? Number(process.env.MAX_IMAGE_RESOURCES) : void 0
	};
	return configSchema.parse(rawConfig);
}

//#endregion
//#region src/browser/engine.ts
let browserInstance = null;
function isHttpProtocol(url) {
	return url.startsWith("http://") || url.startsWith("https://");
}
async function configureRoutes(context, options) {
	let imageCount = 0;
	await context.route("**/*", (route) => {
		const request = route.request();
		const resourceType = request.resourceType();
		if (!isHttpProtocol(request.url())) {
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
function createDefaultBrowserInstance() {
	let browserPromise = null;
	const ensureBrowser = async () => {
		if (!browserPromise) {
			const { chromium } = await import("playwright");
			browserPromise = chromium.launch({ headless: true });
		}
		return browserPromise;
	};
	return {
		async createContext(options) {
			const context = await (await ensureBrowser()).newContext();
			context.setDefaultTimeout(options.timeoutMs);
			context.setDefaultNavigationTimeout(options.timeoutMs);
			await configureRoutes(context, options);
			return context;
		},
		async close() {
			if (!browserPromise) return;
			await (await browserPromise).close();
			browserPromise = null;
		}
	};
}
function ensureBrowserInstance() {
	if (!browserInstance) browserInstance = createDefaultBrowserInstance();
	return browserInstance;
}

//#endregion
//#region src/browser/page.ts
function removeHiddenNodesAndGetHTML() {
	const root = document.body;
	const nodeIterator = document.createNodeIterator(root, NodeFilter.SHOW_ELEMENT, (node) => {
		const nodeName = node.nodeName.toLowerCase();
		if (nodeName === "script" || nodeName === "style" || nodeName === "noscript" || nodeName === "math") return NodeFilter.FILTER_REJECT;
		const el = node;
		if (el.offsetParent === void 0) return NodeFilter.FILTER_ACCEPT;
		const style = window.getComputedStyle(el, null);
		if (style.getPropertyValue("visibility") === "hidden" || style.getPropertyValue("display") === "none") return NodeFilter.FILTER_ACCEPT;
		return NodeFilter.FILTER_REJECT;
	});
	const toRemove = [];
	let n;
	while (n = nodeIterator.nextNode()) toRemove.push(n);
	toRemove.forEach((node) => node.parentNode?.removeChild(node));
	if (typeof window.MathJax !== "undefined" && window.MathJax?.startup?.document?.math) {
		const mathArray = window.MathJax.startup.document.math;
		for (const math of mathArray) if (math.typesetRoot) math.typesetRoot.setAttribute("markdownload-latex", math.math);
	}
	document.body?.querySelectorAll("[class*=\"highlight-text\"],[class*=\"highlight-source\"]").forEach((codeSource) => {
		const langMatch = codeSource.className.match(/highlight-(?:text|source)-([a-z0-9]+)/);
		const language = langMatch && langMatch.length > 0 ? langMatch[1] : "";
		if (language && codeSource.firstChild) codeSource.firstChild.id = `code-lang-${language}`;
	});
	document.body?.querySelectorAll("[class*=\"language-\"]").forEach((codeSource) => {
		const langMatch = codeSource.className.match(/language-([a-z0-9]+)/);
		const language = langMatch && langMatch.length > 0 ? langMatch[1] : "";
		if (language) codeSource.id = `code-lang-${language}`;
	});
	document.body?.querySelectorAll("pre br").forEach((br) => {
		br.outerHTML = "<br-keep></br-keep>";
	});
	document.body?.querySelectorAll(".codehilite > pre").forEach((codeSource) => {
		if (codeSource.firstChild && codeSource.firstChild.nodeName !== "CODE" && !codeSource.className.includes("language")) codeSource.id = "code-lang-text";
	});
	document.body?.querySelectorAll("h1, h2, h3, h4, h5, h6").forEach((header) => {
		header.className = "";
		header.outerHTML = header.outerHTML;
	});
	document.body?.querySelectorAll("pre, code").forEach((codeElement) => {
		const walker = document.createTreeWalker(codeElement, NodeFilter.SHOW_TEXT, null);
		let node;
		while (node = walker.nextNode()) if (node.textContent) {
			const cleanedLines = node.textContent.split("\n").map((line) => {
				if (line.trimStart().match(/^(\d+)[\s\t]*(.*)$/)) return line.replace(/^\s*\d+[\s\t]*/, "");
				return line;
			});
			node.textContent = cleanedLines.join("\n");
		}
	});
	if (!document.head.querySelector("title")) {
		const titleEl = document.createElement("title");
		titleEl.innerText = document.title;
		document.head.appendChild(titleEl);
	}
	const baseEls = document.head.getElementsByTagName("base");
	let baseEl;
	if (baseEls.length > 0) baseEl = baseEls[0];
	else {
		baseEl = document.createElement("base");
		document.head.appendChild(baseEl);
	}
	const href = baseEl.getAttribute("href");
	if (!href || !href.startsWith(window.location.origin)) baseEl.setAttribute("href", window.location.href);
	return document.documentElement.outerHTML;
}
function createPageController() {
	return {
		async load(options) {
			const context = await ensureBrowserInstance().createContext({
				timeoutMs: options.timeoutMs,
				maxImageResources: options.maxImageResources
			});
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
		async scanToc(options) {
			const context = await ensureBrowserInstance().createContext({
				timeoutMs: options.timeoutMs,
				maxImageResources: options.maxImageResources
			});
			const page = await context.newPage();
			await page.addInitScript(`
        window.__scanToc = function(maxDepth) {
          function resolveUrl(href) {
            if (!href) return "";
            try {
              if (href.startsWith("#")) {
                return window.location.href.split("#")[0] + href;
              }
              const url = new URL(href, window.location.href);
              if (url.protocol !== "http:" && url.protocol !== "https:") return "";
              if (url.hostname !== window.location.hostname) return "";
              return url.href;
            } catch {
              return "";
            }
          }

          function isValidLink(href) {
            if (!href) return false;
            if (href.startsWith("javascript:")) return false;
            if (href.startsWith("mailto:")) return false;
            if (href.startsWith("#")) {
              const resolved = resolveUrl(href);
              return resolved.length > 0;
            }
            const resolved = resolveUrl(href);
            return resolved.length > 0;
          }

          function extractTocFromList(listElement, depth) {
            if (depth > maxDepth) return [];
            const items = [];
            const listItems = listElement.querySelectorAll(":scope > li");

            for (const li of listItems) {
              let link = li.querySelector(":scope > a");
              if (!link) {
                link = li.querySelector("a");
              }
              if (!link) continue;

              const href = link.href || link.getAttribute("href") || "";
              if (!isValidLink(href)) continue;

              let title = link.textContent ? link.textContent.trim() : "";
              if (!title) {
                title = li.textContent ? li.textContent.trim() : "";
                const linkInTitle = title.match(/^(.+?)(?:\s*\(.*?\))?$/);
                if (linkInTitle) {
                  title = linkInTitle[1].trim();
                }
              }
              if (!title) continue;

              const resolvedUrl = resolveUrl(href);
              if (!resolvedUrl) continue;

              const children = [];
              const nestedList = li.querySelector(":scope > ul, :scope > ol");
              if (nestedList) {
                const nestedItems = extractTocFromList(nestedList, depth + 1);
                children.push(...nestedItems);
              }

              items.push({
                title: title,
                url: resolvedUrl,
                children: children.length > 0 ? children : undefined
              });
            }

            return items;
          }

          function findAllTocContainers() {
            const selectors = [
              "nav",
              "aside",
              ".sidebar",
              ".toc",
              ".table-of-contents",
              ".docs-sidebar",
              ".nav-sidebar",
              ".documentation-sidebar",
              "[role='navigation']",
              "[role='menu']",
              "[class*='sidebar']",
              "[class*='toc']",
              "[class*='nav']",
              "[class*='menu']"
            ];

            const candidates = [];

            for (const selector of selectors) {
              const elements = document.querySelectorAll(selector);
              for (const element of elements) {
                const links = element.querySelectorAll("a[href]");
                let validLinkCount = 0;
                for (const link of links) {
                  const href = link.href || link.getAttribute("href") || "";
                  if (isValidLink(href)) {
                    validLinkCount++;
                  }
                }
                if (validLinkCount >= 3) {
                  candidates.push({ element: element, linkCount: validLinkCount });
                }
              }
            }

            const allLists = document.querySelectorAll("ul, ol");
            for (const list of allLists) {
              const links = list.querySelectorAll("a[href]");
              let validLinkCount = 0;
              for (const link of links) {
                const href = link.href || link.getAttribute("href") || "";
                if (isValidLink(href)) {
                  validLinkCount++;
                }
              }
              if (validLinkCount >= 3) {
                let isContained = false;
                for (const candidate of candidates) {
                  if (candidate.element.contains(list) || list.contains(candidate.element)) {
                    isContained = true;
                    break;
                  }
                }
                if (!isContained) {
                  candidates.push({ element: list, linkCount: validLinkCount });
                }
              }
            }

            const uniqueCandidates = [];
            const seenElements = new Set();
            
            for (const candidate of candidates) {
              let isDuplicate = false;
              for (const seen of seenElements) {
                if (seen.contains(candidate.element) || candidate.element.contains(seen)) {
                  isDuplicate = true;
                  break;
                }
              }
              if (!isDuplicate) {
                uniqueCandidates.push(candidate.element);
                seenElements.add(candidate.element);
              }
            }

            return uniqueCandidates;
          }

          function normalizeTitle(title) {
            return title.trim().toLowerCase().replace(/[^\w\u4e00-\u9fa5]/g, "");
          }

          function extractArticleHeadings() {
            const articleSelectors = [
              "main",
              "article",
              ".content",
              ".main-content",
              ".article-content",
              ".post-content",
              "[role='main']",
              ".documentation-content",
              ".docs-content"
            ];

            let articleContainer = null;
            for (const selector of articleSelectors) {
              const element = document.querySelector(selector);
              if (element) {
                articleContainer = element;
                break;
              }
            }

            if (!articleContainer) {
              articleContainer = document.body;
            }

            const headings = articleContainer.querySelectorAll("h1, h2, h3, h4, h5, h6");
            const headingTexts = [];
            const seen = new Set();

            for (const heading of headings) {
              const text = heading.textContent ? heading.textContent.trim() : "";
              if (text) {
                const normalized = normalizeTitle(text);
                if (normalized && !seen.has(normalized)) {
                  seen.add(normalized);
                  headingTexts.push(text);
                }
              }
            }

            return headingTexts;
          }

          function extractTocTitles(tocContainer) {
            const titles = [];
            const links = tocContainer.querySelectorAll("a[href]");

            for (const link of links) {
              const href = link.href || link.getAttribute("href") || "";
              if (isValidLink(href)) {
                const title = link.textContent ? link.textContent.trim() : "";
                if (title) {
                  titles.push(title);
                }
              }
            }

            return titles;
          }

          function calculateOverlap(tocTitles, articleHeadings) {
            if (tocTitles.length === 0) return 0;

            const normalizedArticleHeadings = new Set();
            for (const heading of articleHeadings) {
              normalizedArticleHeadings.add(normalizeTitle(heading));
            }

            let matchedCount = 0;
            for (const tocTitle of tocTitles) {
              const normalized = normalizeTitle(tocTitle);
              if (normalizedArticleHeadings.has(normalized)) {
                matchedCount++;
              }
            }

            return matchedCount / tocTitles.length;
          }

          function countItems(tocItems) {
            let count = tocItems.length;
            for (const item of tocItems) {
              if (item.children) {
                count += countItems(item.children);
              }
            }
            return count;
          }

          const containers = findAllTocContainers();
          if (containers.length === 0) {
            return { items: [], totalCount: 0, debug: { containersFound: 0, articleHeadings: [], containerInfos: [] } };
          }

          const articleHeadings = extractArticleHeadings();
          const containerInfos = [];

          for (const container of containers) {
            const tocTitles = extractTocTitles(container);
            const overlap = calculateOverlap(tocTitles, articleHeadings);
            const linkCount = tocTitles.length;

            containerInfos.push({
              titles: tocTitles.slice(0, 20),
              titleCount: tocTitles.length,
              overlap: overlap,
              hasOverlap: overlap > 0
            });
          }

          let selectedContainer = null;
          let selectedIndex = 0;

          if (containers.length === 1) {
            selectedContainer = containers[0];
            selectedIndex = 0;
          } else {
            const containerScores = [];

            for (let i = 0; i < containers.length; i++) {
              const container = containers[i];
              const info = containerInfos[i];
              containerScores.push({
                container: container,
                index: i,
                overlap: info.overlap,
                linkCount: info.titleCount,
                hasOverlap: info.hasOverlap
              });
            }

            const containersWithOverlap = containerScores.filter(c => c.hasOverlap);

            if (containersWithOverlap.length === 0) {
              containerScores.sort((a, b) => b.linkCount - a.linkCount);
              selectedContainer = containerScores[0].container;
              selectedIndex = containerScores[0].index;
            } else if (containersWithOverlap.length === 1) {
              const containersWithoutOverlap = containerScores.filter(c => !c.hasOverlap);
              if (containersWithoutOverlap.length > 0) {
                containersWithoutOverlap.sort((a, b) => b.linkCount - a.linkCount);
                selectedContainer = containersWithoutOverlap[0].container;
                selectedIndex = containersWithoutOverlap[0].index;
              } else {
                selectedContainer = containersWithOverlap[0].container;
                selectedIndex = containersWithOverlap[0].index;
              }
            } else {
              containersWithOverlap.sort((a, b) => a.overlap - b.overlap);
              selectedContainer = containersWithOverlap[0].container;
              selectedIndex = containersWithOverlap[0].index;
            }
          }

          let rootList = null;
          if (selectedContainer.tagName.toLowerCase() === "ul" || selectedContainer.tagName.toLowerCase() === "ol") {
            rootList = selectedContainer;
          } else {
            rootList = selectedContainer.querySelector("ul, ol");
          }

          if (!rootList) {
            return { items: [], totalCount: 0 };
          }

          const items = extractTocFromList(rootList, 0);
          const totalCount = countItems(items);

          return {
            items: items,
            totalCount: totalCount,
            debug: {
              containersFound: containers.length,
              selectedIndex: selectedIndex,
              articleHeadings: articleHeadings.slice(0, 20),
              articleHeadingCount: articleHeadings.length,
              containerInfos: containerInfos
            }
          };
        };
      `);
			await page.goto(options.url, {
				waitUntil: "networkidle",
				timeout: options.timeoutMs
			});
			const result = await page.evaluate((maxDepth) => {
				return window.__scanToc(maxDepth);
			}, options.maxDepth || 10);
			await context.close();
			return result;
		},
		async close() {}
	};
}

//#endregion
//#region src/converter/html.ts
function ensureBaseElement(dom, url) {
	const document = dom.window.document;
	const head = document.head ?? document.createElement("head");
	if (!document.head && document.documentElement) document.documentElement.insertBefore(head, document.body ?? null);
	const existingBase = head.querySelector("base");
	if (existingBase && existingBase.getAttribute("href")) return;
	const base = existingBase ?? document.createElement("base");
	base.setAttribute("href", url);
	if (!existingBase) head.insertBefore(base, head.firstChild);
}
async function extractArticleFromHtml(html, url) {
	const [{ JSDOM: JSDOMClass }, { Readability }] = await Promise.all([import("jsdom"), import("@mozilla/readability")]);
	const dom = new JSDOMClass(html, { url });
	ensureBaseElement(dom, url);
	const document = dom.window.document;
	const article = new Readability(document).parse();
	if (!article || !article.content) throw new Error("Failed to extract article content");
	return {
		title: article.title ?? null,
		content: article.content,
		byline: article.byline ?? null,
		excerpt: article.excerpt ?? null,
		url
	};
}

//#endregion
//#region src/converter/markdown.ts
function validateUri(href, baseUri) {
	try {
		new URL(href);
		return href;
	} catch {
		const base = new URL(baseUri);
		if (href.startsWith("/")) return base.origin + href;
		return base.href + (base.href.endsWith("/") ? "" : "/") + href;
	}
}
function cleanAttribute(attr) {
	return attr ? attr.replace(/(\n+\s*)+/g, "\n") : "";
}
function repeat(character, count) {
	return Array(count + 1).join(character);
}
function extractFormattedText(element) {
	let text = element.innerHTML.replace(/<br\s*\/?>/gi, "\n").replace(/<br-keep><\/br-keep>/gi, "\n").replace(/<\/div>/gi, "\n").replace(/<\/p>/gi, "\n").replace(/<\/li>/gi, "\n").replace(/<\/tr>/gi, "\n").replace(/<\/td>/gi, " ").replace(/<\/th>/gi, " ").replace(/<pre[^>]*>/gi, "").replace(/<\/pre>/gi, "").replace(/<code[^>]*>/gi, "").replace(/<\/code>/gi, "").replace(/<span[^>]*class="[^"]*line-number[^"]*"[^>]*>[\d\s]*<\/span>/gi, "").replace(/<span[^>]*class="[^"]*line[^"]*"[^>]*>[\d\s]*<\/span>/gi, "").replace(/<[^>]+>/g, "").replace(/&nbsp;/g, " ").replace(/&lt;/g, "<").replace(/&gt;/g, ">").replace(/&amp;/g, "&").replace(/&quot;/g, "\"").replace(/&#39;/g, "'").replace(/&#x([0-9a-fA-F]+);/g, (_, hex) => String.fromCharCode(parseInt(hex, 16))).replace(/&#(\d+);/g, (_, dec) => String.fromCharCode(parseInt(dec, 10)));
	const textContent = element.textContent || "";
	const removeLineNumbers = (content) => {
		const lines = content.split("\n");
		let hasLineNumbers = false;
		const processedLines = lines.map((line) => {
			const lineNumberMatch = line.trimStart().match(/^(\d+)([\s\t]+|)(.*)$/);
			if (lineNumberMatch && lineNumberMatch[1]) {
				hasLineNumbers = true;
				const codePart = lineNumberMatch[3] || "";
				return (line.match(/^(\s*)/)?.[1] || "") + codePart;
			}
			return line;
		});
		if (hasLineNumbers) return processedLines.join("\n");
		return content;
	};
	if (textContent.includes("\n") && textContent.split("\n").length > 3) return removeLineNumbers(textContent);
	const lines = text.split("\n").map((line) => {
		const lineNumberMatch = line.trimStart().match(/^(\d+)([\s\t]+|)(.*)$/);
		if (lineNumberMatch && lineNumberMatch[1]) {
			const codePart = lineNumberMatch[3] || "";
			return (line.match(/^(\s*)/)?.[1] || "") + codePart.trimEnd();
		}
		return line.trimEnd();
	});
	const formattedLines = [];
	for (let i = 0; i < lines.length; i++) {
		const line = lines[i];
		if (line || i === 0 || i === lines.length - 1) formattedLines.push(line);
		else if (formattedLines.length > 0 && formattedLines[formattedLines.length - 1] !== "") formattedLines.push("");
	}
	let result = formattedLines.join("\n").replace(/\n+$/, "");
	if (!result.includes("\n") && textContent && textContent.length > 50) {
		const matches = Array.from(textContent.matchAll(/(\d+)[\s\t]*([^\d\n]+)/g));
		if (matches.length > 1) result = matches.map((m) => m[2].trimStart()).join("\n");
	}
	result = removeLineNumbers(result);
	return result.split("\n").map((line) => {
		if (line.trimStart().match(/^\d+[\s\t]*/)) return line.replace(/^\s*\d+[\s\t]*/, "");
		return line;
	}).join("\n");
}
function stripSpecialChars(md) {
	return md.replace(/[\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f-\u009f\u00ad\u061c\u200b-\u200f\u2028\u2029\ufeff\ufff9-\ufffc]/g, "");
}
function convertToFencedCodeBlock(node, options) {
	node.innerHTML = node.innerHTML.replace(/<br-keep><\/br-keep>/g, "<br>");
	const langMatch = node.id?.match(/code-lang-(.+)/);
	const language = langMatch && langMatch.length > 0 ? langMatch[1] : "";
	let code = extractFormattedText(node);
	const fenceChar = options.fence.charAt(0);
	let fenceSize = 3;
	const fenceInCodeRegex = new RegExp("^" + fenceChar + "{3,}", "gm");
	let match;
	while (match = fenceInCodeRegex.exec(code)) if (match[0].length >= fenceSize) fenceSize = match[0].length + 1;
	const fence = repeat(fenceChar, fenceSize);
	const cleanedCode = code.split("\n").map((line) => {
		const lineNumberMatch = line.trimStart().match(/^(\d+)([\s\t]*)(.*)$/);
		if (lineNumberMatch && lineNumberMatch[1]) return (line.match(/^(\s*)/)?.[1] || "") + (lineNumberMatch[3] || "");
		return line;
	}).join("\n").replace(/\n+$/, "");
	return "\n\n" + fence + language + "\n" + cleanedCode + "\n" + fence + "\n\n";
}
async function buildTurndownService(baseURI) {
	const [{ default: TurndownServiceClass }, { gfm }] = await Promise.all([import("turndown"), import("turndown-plugin-gfm")]);
	const service = new TurndownServiceClass({
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
	service.keep([
		"iframe",
		"sub",
		"sup",
		"u",
		"ins",
		"del",
		"small",
		"big"
	]);
	service.addRule("images", {
		filter(node) {
			const el = node;
			return el.nodeName === "IMG" && el.getAttribute("src");
		},
		replacement(_content, node) {
			const el = node;
			const resolved = validateUri(el.getAttribute("src") ?? "", baseURI);
			const alt = cleanAttribute(el.getAttribute("alt"));
			const title = cleanAttribute(el.getAttribute("title"));
			const titlePart = title ? ` "${title}"` : "";
			return resolved ? `![${alt}](${resolved}${titlePart})` : "";
		}
	});
	service.addRule("links", {
		filter(node) {
			const el = node;
			if (el.nodeName === "A" && el.getAttribute("href")) el.setAttribute("href", validateUri(el.getAttribute("href"), baseURI));
			return false;
		},
		replacement(content) {
			return content;
		}
	});
	service.addRule("fencedCodeBlock", {
		filter(node, options) {
			const el = node;
			const firstChild = el.firstChild;
			return options.codeBlockStyle === "fenced" && el.nodeName === "PRE" && firstChild !== null && firstChild.nodeType === 1 && firstChild.nodeName === "CODE";
		},
		replacement(_content, node, options) {
			const firstChild = node.firstChild;
			if (!firstChild) return "";
			return convertToFencedCodeBlock(firstChild, options);
		}
	});
	service.addRule("pre", {
		filter(node) {
			const el = node;
			const firstChild = el.firstChild;
			return el.nodeName === "PRE" && (!firstChild || firstChild.nodeType !== 1 || firstChild.nodeName !== "CODE") && !el.querySelector("img");
		},
		replacement(_content, node, options) {
			return convertToFencedCodeBlock(node, options);
		}
	});
	return service;
}
async function convertArticleToMarkdown(article) {
	let body = (await buildTurndownService(article.url)).turndown(article.content);
	body = stripSpecialChars(body);
	return { markdown: `# ${article.title ?? "Untitled"}\n\n${body}`.trim() };
}

//#endregion
//#region src/server/tools.ts
const readUrlInputSchema = z.object({
	url: z.string().url().describe("The web page URL to capture. Only http/https are supported."),
	output_path: z.string().describe("Optional. The path to save the generated Markdown file. Relative paths are resolved from the MCP process working directory; using an absolute path is recommended (for example: d:\\\\Workspace\\\\WizThink\\\\BiSheng\\\\mcp-bisheng\\\\signatureInstance.md).").optional()
});
const installChromiumInputSchema = z.object({ with_deps: z.boolean().optional().default(false) });
const scanDocsTocInputSchema = z.object({
	url: z.string().url().describe("The documentation website URL to scan. Only http/https are supported."),
	max_depth: z.number().int().positive().optional().default(10).describe("Maximum depth to scan the table of contents tree, default is 10.")
});
function isChromiumMissingError(err) {
	const msg = err instanceof Error ? err.message : String(err);
	return msg.includes("Executable doesn't exist") || msg.includes("Executable path does not exist") || msg.includes("browserType.launch") || msg.includes("does not exist at");
}
function isPrivateHost(url) {
	const host = url.hostname;
	if (host === "localhost") return true;
	if (host.startsWith("127.")) return true;
	if (host.startsWith("10.")) return true;
	if (host.startsWith("192.168.")) return true;
	const parts = host.split(".");
	if (parts.length === 4 && parts[0] === "172") {
		const second = Number(parts[1]);
		if (second >= 16 && second <= 31) return true;
	}
	return false;
}
function createTools(server, config) {
	server.registerTool("read_url", {
		description: "Use a headless browser to render a web page and return the main content as Markdown. When output_path is provided, also save the Markdown to that path on disk.",
		inputSchema: readUrlInputSchema
	}, async (args) => {
		const url = new URL(args.url);
		if (url.protocol !== "http:" && url.protocol !== "https:") throw new Error("Only http and https protocols are allowed");
		if (isPrivateHost(url)) throw new Error("Access to private network addresses is not allowed");
		const controller = createPageController();
		let pageContent;
		try {
			pageContent = await controller.load({
				url: args.url,
				timeoutMs: config.browserTimeoutMs,
				maxImageResources: config.maxImageResources
			});
		} catch (err) {
			if (isChromiumMissingError(err)) throw new Error("Chromium is not installed. Please call the install_chromium tool to install Chromium first, then retry read_url.");
			throw err;
		}
		const markdownResult = await convertArticleToMarkdown(await extractArticleFromHtml(pageContent.html, pageContent.url));
		let savedPath;
		if (args.output_path) {
			const out = path.resolve(args.output_path);
			fs.mkdirSync(path.dirname(out), { recursive: true });
			fs.writeFileSync(out, markdownResult.markdown, "utf-8");
			savedPath = out;
		}
		return { content: [{
			type: "text",
			text: `${savedPath ? `Saved to ${savedPath}\n\n` : ""}${markdownResult.markdown}`
		}] };
	});
	server.registerTool("install_chromium", {
		description: "Install Chromium browser for Playwright. Call this when read_url fails with Chromium not found error, then retry read_url.",
		inputSchema: installChromiumInputSchema
	}, async (args) => {
		const cmd = args.with_deps ? "npx playwright install --with-deps chromium" : "npx playwright install chromium";
		try {
			const output = execSync(cmd, {
				encoding: "utf-8",
				stdio: [
					"inherit",
					"pipe",
					"pipe"
				]
			});
			return { content: [{
				type: "text",
				text: output ? `Chromium installed successfully.\n\n${output}` : "Chromium installed successfully."
			}] };
		} catch (err) {
			const stderr = err && typeof err === "object" && "stderr" in err ? String(err.stderr) : "";
			const stdout = err && typeof err === "object" && "stdout" in err ? String(err.stdout) : "";
			return { content: [{
				type: "text",
				text: `Chromium installation failed: ${err instanceof Error ? err.message : String(err)}${stderr ? `\n\nstderr:\n${stderr}` : ""}${stdout ? `\n\nstdout:\n${stdout}` : ""}`
			}] };
		}
	});
	server.registerTool("scan_docs_toc", {
		description: "Scan the table of contents (TOC) structure from a documentation website. Returns a structured tree of all documentation pages with their titles and URLs. AI can use this to download multiple pages and combine them into a complete document.",
		inputSchema: scanDocsTocInputSchema
	}, async (args) => {
		const url = new URL(args.url);
		if (url.protocol !== "http:" && url.protocol !== "https:") throw new Error("Only http and https protocols are allowed");
		if (isPrivateHost(url)) throw new Error("Access to private network addresses is not allowed");
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
			if (isChromiumMissingError(err)) throw new Error("Chromium is not installed. Please call the install_chromium tool to install Chromium first, then retry scan_docs_toc.");
			throw err;
		}
		const resultJson = JSON.stringify(tocResult, null, 2);
		return { content: [{
			type: "text",
			text: `Found ${tocResult.totalCount} documentation pages:\n\n${resultJson}`
		}] };
	});
}

//#endregion
//#region src/index.ts
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

//#endregion
export {  };