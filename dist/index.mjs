import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";
import fs from "fs";
import path from "path";
import { execSync } from "child_process";
import pino from "pino";

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
//#region src/utils/logger.ts
const level = process.env.LOG_LEVEL ?? "info";
const logger = pino({ level }, pino.destination(2));

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
		const url = request.url();
		if (!isHttpProtocol(url)) {
			logger.debug({ url }, "route blocked: non-http protocol");
			route.abort();
			return;
		}
		if (resourceType === "image") {
			if (imageCount >= options.maxImageResources) {
				logger.debug({
					url,
					limit: options.maxImageResources
				}, "route blocked: image limit reached");
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
			logger.info("launching chromium browser");
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
			logger.debug({
				timeoutMs: options.timeoutMs,
				maxImageResources: options.maxImageResources
			}, "browser context created");
			return context;
		},
		async close() {
			if (!browserPromise) return;
			await (await browserPromise).close();
			browserPromise = null;
			logger.info("browser closed");
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
		codeElement.querySelectorAll("[class*=\"line-number\"], [class*=\"linenumber\"], [class*=\"line-num\"], [class*=\"lineNum\"], [class*=\"lineNo\"], [class*=\"line-no\"], [data-line-number]").forEach((el) => el.remove());
		const walker = document.createTreeWalker(codeElement, NodeFilter.SHOW_TEXT, null);
		let node;
		while (node = walker.nextNode()) if (node.textContent) {
			const cleanedLines = node.textContent.split("\n").map((line) => {
				const match = line.trimStart().match(/^(\d+)(\t| {2,})(.+)$/);
				if (match) return (line.match(/^(\s*)/)?.[1] || "") + match[3];
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
	const sidebarVw = window.innerWidth;
	const sidebarVh = window.innerHeight;
	const sidebarSelectors = [
		"nav",
		"aside",
		"[role=\"navigation\"]",
		"[role=\"menu\"]",
		"[role=\"menubar\"]",
		"[class*=\"sidebar\"]",
		"[class*=\"sidenav\"]",
		"[class*=\"side-nav\"]",
		"[class*=\"side_nav\"]",
		"[class*=\"sideNav\"]",
		"[class*=\"menu\"]",
		"[class*=\"toc\"]",
		"[class*=\"catalog\"]"
	];
	const sidebarSeen = /* @__PURE__ */ new Set();
	sidebarSelectors.forEach((sel) => {
		try {
			document.querySelectorAll(sel).forEach((el) => {
				if (sidebarSeen.has(el)) return;
				sidebarSeen.add(el);
				const rect = el.getBoundingClientRect();
				if (!rect || rect.width === 0 || rect.height === 0) return;
				const isTall = rect.height > sidebarVh * .3;
				const isNarrow = rect.width < sidebarVw * .4;
				const centerX = rect.left + rect.width / 2;
				const isOnSide = centerX < sidebarVw * .3 || centerX > sidebarVw * .7;
				if (isTall && isNarrow && isOnSide) el.remove();
			});
		} catch {}
	});
	[
		"[role=\"breadcrumb\"]",
		"[aria-label*=\"breadcrumb\"]",
		"[class*=\"breadcrumb\"]",
		"nav[class*=\"crumb\"]"
	].forEach((sel) => {
		try {
			document.querySelectorAll(sel).forEach((el) => el.remove());
		} catch {}
	});
	document.querySelectorAll("[rel=\"prev\"], [rel=\"next\"], [class*=\"prev-next\"], [class*=\"pagination\"]").forEach((el) => el.remove());
	return document.documentElement.outerHTML;
}
const TOC_SCAN_SCRIPT = `
window.__scanToc = async function(maxDepth, maxExpandRounds) {
  var vw = window.innerWidth;
  var vh = window.innerHeight;

  function resolveUrl(href) {
    if (!href) return "";
    try {
      if (href.startsWith("#")) return window.location.href.split("#")[0] + href;
      var url = new URL(href, window.location.href);
      if (url.protocol !== "http:" && url.protocol !== "https:") return "";
      if (url.hostname !== window.location.hostname) return "";
      return url.href;
    } catch (e) { return ""; }
  }

  function isValidLink(href) {
    if (!href || href.startsWith("javascript:") || href.startsWith("mailto:")) return false;
    return resolveUrl(href).length > 0;
  }

  function isHashOnlyLink(rawHref) {
    if (!rawHref) return false;
    if (rawHref.startsWith("#")) {
      return !rawHref.startsWith("#/") && !rawHref.startsWith("#!/");
    }
    try {
      var resolved = new URL(rawHref, window.location.href);
      var current = new URL(window.location.href);
      if (resolved.pathname === current.pathname && resolved.hash) {
        return !resolved.hash.startsWith("#/") && !resolved.hash.startsWith("#!/");
      }
      return false;
    } catch (e) { return false; }
  }

  function normalizeText(text) {
    return (text || "").replace(/\\s+/g, " ").trim();
  }

  function analyzeElement(el) {
    var rect = el.getBoundingClientRect();
    if (!rect || rect.width < 50 || rect.height < 80) return null;
    var links = el.querySelectorAll("a[href]");
    var validCount = 0;
    var hashOnlyCount = 0;
    for (var i = 0; i < links.length; i++) {
      var rawHref = links[i].getAttribute("href") || "";
      if (isValidLink(links[i].href || rawHref)) {
        validCount++;
        if (isHashOnlyLink(rawHref)) hashOnlyCount++;
      }
    }
    var spaMenuItemCount = 0;
    if (validCount < 2) {
      var listItems = el.querySelectorAll("li");
      for (var li = 0; li < listItems.length; li++) {
        var text = normalizeText(listItems[li].textContent);
        if (text && text.length > 0 && text.length < 200 && !listItems[li].querySelector("ul, ol")) {
          spaMenuItemCount++;
        }
      }
      if (spaMenuItemCount < 5) return null;
      validCount = spaMenuItemCount;
    }
    return {
      element: el,
      left: rect.left, top: rect.top,
      width: rect.width, height: rect.height,
      centerX: rect.left + rect.width / 2,
      validLinkCount: validCount,
      hashOnlyCount: hashOnlyCount,
      hashRatio: validCount > 0 ? hashOnlyCount / validCount : 0,
      isSpaMenu: spaMenuItemCount > 0
    };
  }

  var SIDEBAR_SELECTORS = [
    "nav", "aside",
    "[role='navigation']", "[role='menu']", "[role='menubar']",
    "[class*='sidebar']", "[class*='sidenav']", "[class*='side-nav']",
    "[class*='side_nav']", "[class*='sideNav']",
    "[class*='nav-']", "[class*='menu']",
    "[class*='toc']", "[class*='catalog']",
    "[class*='tree']", "[class*='directory']",
    "[class*='panel']", "[class*='drawer']",
    "[id*='sidebar']", "[id*='sidenav']",
    "[id*='nav']", "[id*='menu']", "[id*='toc']"
  ];

  var seen = new Set();
  var candidates = [];

  for (var s = 0; s < SIDEBAR_SELECTORS.length; s++) {
    try {
      var elements = document.querySelectorAll(SIDEBAR_SELECTORS[s]);
      for (var e = 0; e < elements.length; e++) {
        if (seen.has(elements[e])) continue;
        seen.add(elements[e]);
        var info = analyzeElement(elements[e]);
        if (info) candidates.push(info);
      }
    } catch (ex) {}
  }

  var leftGroup = [];
  var rightGroup = [];
  var otherGroup = [];

  for (var ci = 0; ci < candidates.length; ci++) {
    var c = candidates[ci];
    if (!c) continue;
    if (c.centerX < vw * 0.35 && c.height > vh * 0.3) {
      leftGroup.push(c);
    } else if (c.centerX > vw * 0.65) {
      rightGroup.push(c);
    } else {
      otherGroup.push(c);
    }
  }

  if (leftGroup.length === 0) {
    var broadEls = document.querySelectorAll("div, section, ul, ol, nav");
    for (var bi = 0; bi < broadEls.length; bi++) {
      var bel = broadEls[bi];
      if (seen.has(bel)) continue;
      var brect = bel.getBoundingClientRect();
      if (brect.left > 50 || brect.width < 100 || brect.width > vw * 0.4 || brect.height < vh * 0.3) continue;
      var binfo = analyzeElement(bel);
      if (!binfo || binfo.validLinkCount < 5) continue;
      var overlaps = false;
      for (var oi = 0; oi < candidates.length; oi++) {
        if (!candidates[oi]) continue;
        if (candidates[oi].element.contains(bel) || bel.contains(candidates[oi].element)) { overlaps = true; break; }
      }
      if (!overlaps) {
        leftGroup.push(binfo);
        candidates.push(binfo);
      }
    }
  }

  function selectBest(group) {
    if (group.length === 0) return null;
    if (group.length === 1) return group[0];
    var filtered = group.filter(function(gc) {
      for (var gi = 0; gi < group.length; gi++) {
        var other = group[gi];
        if (gc.element !== other.element &&
          gc.element.contains(other.element) &&
          other.validLinkCount >= gc.validLinkCount * 0.7) {
          return false;
        }
      }
      return true;
    });
    var pool = filtered.length > 0 ? filtered : group;
    pool.sort(function(a, b) { return b.validLinkCount - a.validLinkCount; });
    return pool[0];
  }

  var selected = selectBest(leftGroup);
  var side = "left";

  if (!selected) {
    var nonHash = otherGroup.filter(function(oc) { return oc.hashRatio < 0.5; });
    selected = selectBest(nonHash.length > 0 ? nonHash : otherGroup);
    side = "other";
  }

  if (!selected) {
    var nonHash2 = rightGroup.filter(function(rc) { return rc.hashRatio < 0.5; });
    selected = selectBest(nonHash2.length > 0 ? nonHash2 : rightGroup);
    side = "right";
  }

  if (!selected && candidates.length > 0) {
    var validCands = candidates.filter(Boolean);
    validCands.sort(function(a, b) { return b.validLinkCount - a.validLinkCount; });
    if (validCands.length > 0) {
      selected = validCands[0];
      side = "fallback";
    }
  }

  function buildDebug(sideVal, selectedInfo) {
    return {
      sidebarSide: sideVal,
      candidateCount: candidates.filter(Boolean).length,
      leftGroupCount: leftGroup.length,
      rightGroupCount: rightGroup.length,
      selectedLinkCount: selectedInfo ? selectedInfo.validLinkCount : 0,
      expandRounds: 0,
      containerInfos: candidates.filter(Boolean).map(function(cc) {
        var pos = "other";
        if (cc.centerX < vw * 0.35 && cc.height > vh * 0.3) pos = "left";
        else if (cc.centerX > vw * 0.65) pos = "right";
        return {
          tagName: cc.element.tagName,
          className: (cc.element.className || "").toString().substring(0, 100),
          position: pos,
          left: Math.round(cc.left),
          top: Math.round(cc.top),
          width: Math.round(cc.width),
          height: Math.round(cc.height),
          linkCount: cc.validLinkCount,
          hashRatio: Math.round(cc.hashRatio * 100) / 100
        };
      })
    };
  }

  if (!selected) {
    return { items: [], totalCount: 0, debug: buildDebug("none", null) };
  }

  var sidebarEl = selected.element;

  var expandRounds = 0;
  for (var round = 0; round < maxExpandRounds; round++) {
    var expandedCount = 0;
    var ariaEls = sidebarEl.querySelectorAll('[aria-expanded="false"]');
    for (var ai = 0; ai < ariaEls.length; ai++) {
      ariaEls[ai].click();
      expandedCount++;
    }
    var detailEls = sidebarEl.querySelectorAll("details:not([open])");
    for (var di = 0; di < detailEls.length; di++) {
      detailEls[di].setAttribute("open", "");
      expandedCount++;
    }
    if (expandedCount === 0) break;
    expandRounds++;
    await new Promise(function(r) { setTimeout(r, 500); });
  }

  function findDirectLink(li) {
    var nestedLists = new Set(li.querySelectorAll(":scope > ul, :scope > ol"));
    var allLinks = li.querySelectorAll("a[href]");
    for (var ai2 = 0; ai2 < allLinks.length; ai2++) {
      var inNested = false;
      nestedLists.forEach(function(nl) {
        if (nl.contains(allLinks[ai2])) inNested = true;
      });
      if (!inNested) return allLinks[ai2];
    }
    return null;
  }

  function extractFromList(listEl, depth) {
    if (depth > maxDepth) return [];
    var items = [];
    var lis = listEl.querySelectorAll(":scope > li");
    for (var li = 0; li < lis.length; li++) {
      var children = [];
      var nestedUls = lis[li].querySelectorAll(":scope > ul, :scope > ol");
      for (var ni = 0; ni < nestedUls.length; ni++) {
        var nested = extractFromList(nestedUls[ni], depth + 1);
        for (var nc = 0; nc < nested.length; nc++) children.push(nested[nc]);
      }
      var link = findDirectLink(lis[li]);
      if (link) {
        var rawHref = link.getAttribute("href") || "";
        if (!isValidLink(link.href || rawHref)) continue;
        var title = normalizeText(link.textContent);
        if (!title) continue;
        var resolved = resolveUrl(link.href || rawHref);
        if (!resolved) continue;
        items.push({ title: title, url: resolved, children: children.length > 0 ? children : undefined });
      } else if (children.length > 0) {
        var titleText = "";
        var childNodes = lis[li].childNodes;
        for (var cn = 0; cn < childNodes.length; cn++) {
          var child = childNodes[cn];
          if (child.nodeType === Node.TEXT_NODE) {
            titleText += child.textContent || "";
          } else if (child.tagName !== "UL" && child.tagName !== "OL") {
            titleText += (child.textContent || "").trim() + " ";
          }
        }
        var groupTitle = normalizeText(titleText);
        if (groupTitle) {
          items.push({ title: groupTitle, url: "", children: children });
        } else {
          for (var gc2 = 0; gc2 < children.length; gc2++) items.push(children[gc2]);
        }
      }
    }
    return items;
  }

  function extractFromLinks(containerEl) {
    var links = containerEl.querySelectorAll("a[href]");
    if (links.length === 0) return [];
    var containerRect = containerEl.getBoundingClientRect();
    var flatItems = [];
    for (var fi = 0; fi < links.length; fi++) {
      var rawHref = links[fi].getAttribute("href") || "";
      if (!isValidLink(links[fi].href || rawHref)) continue;
      var title = normalizeText(links[fi].textContent);
      if (!title || title.length > 200) continue;
      var resolved = resolveUrl(links[fi].href || rawHref);
      if (!resolved) continue;
      var linkRect = links[fi].getBoundingClientRect();
      flatItems.push({ title: title, url: resolved, indent: Math.max(0, linkRect.left - containerRect.left), depth: 0 });
    }
    if (flatItems.length === 0) return [];

    var indentSet = new Set(flatItems.map(function(it) { return Math.round(it.indent); }));
    var sortedIndents = Array.from(indentSet).sort(function(a, b) { return a - b; });
    var indentToLevel = {};
    sortedIndents.forEach(function(val, idx) { indentToLevel[val] = idx; });
    for (var fi2 = 0; fi2 < flatItems.length; fi2++) {
      flatItems[fi2].depth = Math.min(indentToLevel[Math.round(flatItems[fi2].indent)] || 0, maxDepth);
    }

    var root = { children: [], depth: -1 };
    var stack = [root];
    for (var fi3 = 0; fi3 < flatItems.length; fi3++) {
      var item = flatItems[fi3];
      while (stack.length > 1 && stack[stack.length - 1].depth >= item.depth) stack.pop();
      var node = { title: item.title, url: item.url, children: [] };
      stack[stack.length - 1].children.push(node);
      stack.push({ children: node.children, depth: item.depth });
    }

    function cleanTree(nodes) {
      return nodes.map(function(n) {
        var cleaned = { title: n.title, url: n.url };
        if (n.children && n.children.length > 0) cleaned.children = cleanTree(n.children);
        return cleaned;
      });
    }
    return cleanTree(root.children);
  }

  async function extractFromSpaMenu(containerEl) {
    var originalHash = window.location.hash;
    var clickLimit = 200;
    var clickCount = 0;

    async function processListForSpa(listEl, depth) {
      if (depth > maxDepth) return [];
      var results = [];
      var lis = listEl.querySelectorAll(":scope > li");
      for (var i = 0; i < lis.length && clickCount < clickLimit; i++) {
        var nestedUls = lis[i].querySelectorAll(":scope > ul, :scope > ol");
        var titleText = "";
        var childNodes = lis[i].childNodes;
        for (var cn = 0; cn < childNodes.length; cn++) {
          var child = childNodes[cn];
          if (child.nodeType === Node.TEXT_NODE) {
            titleText += child.textContent || "";
          } else if (child.tagName !== "UL" && child.tagName !== "OL") {
            titleText += (child.textContent || "").trim() + " ";
          }
        }
        titleText = normalizeText(titleText);
        if (!titleText || titleText.length > 200) continue;

        if (nestedUls.length > 0) {
          var children = [];
          for (var ni = 0; ni < nestedUls.length; ni++) {
            var nested = await processListForSpa(nestedUls[ni], depth + 1);
            for (var nc = 0; nc < nested.length; nc++) children.push(nested[nc]);
          }
          if (children.length > 0) {
            results.push({ title: titleText, url: "", children: children });
          }
        } else {
          var beforeHash = window.location.hash;
          lis[i].click();
          clickCount++;
          await new Promise(function(r) { setTimeout(r, 100); });
          var afterHash = window.location.hash;
          if (afterHash !== beforeHash) {
            var fullUrl = window.location.href.split("#")[0] + afterHash;
            results.push({ title: titleText, url: fullUrl });
            window.location.hash = originalHash;
            await new Promise(function(r) { setTimeout(r, 100); });
          } else {
            var liClass = (lis[i].className || "").toString().toLowerCase();
            if (liClass.indexOf("selected") >= 0 || liClass.indexOf("active") >= 0 || liClass.indexOf("current") >= 0) {
              results.push({ title: titleText, url: window.location.href });
            }
          }
        }
      }
      return results;
    }

    var topLists;
    if (containerEl.tagName === "UL" || containerEl.tagName === "OL") {
      topLists = [containerEl];
    } else {
      var allLists = containerEl.querySelectorAll("ul, ol");
      topLists = [];
      for (var tl = 0; tl < allLists.length; tl++) {
        var isNested = false;
        for (var tl2 = 0; tl2 < allLists.length; tl2++) {
          if (allLists[tl2] !== allLists[tl] && allLists[tl2].contains(allLists[tl])) { isNested = true; break; }
        }
        if (!isNested) topLists.push(allLists[tl]);
      }
    }

    var spaResults = [];
    for (var l = 0; l < topLists.length; l++) {
      var extracted = await processListForSpa(topLists[l], 0);
      for (var ei = 0; ei < extracted.length; ei++) spaResults.push(extracted[ei]);
    }

    if (window.location.hash !== originalHash) {
      window.location.hash = originalHash;
      await new Promise(function(r) { setTimeout(r, 200); });
    }

    return spaResults;
  }

  var items = [];

  if (sidebarEl.tagName === "UL" || sidebarEl.tagName === "OL") {
    items = extractFromList(sidebarEl, 0);
  } else {
    var allLists = sidebarEl.querySelectorAll("ul, ol");
    var topLevelLists = [];
    for (var tl = 0; tl < allLists.length; tl++) {
      var isNested = false;
      for (var tl2 = 0; tl2 < allLists.length; tl2++) {
        if (allLists[tl2] !== allLists[tl] && allLists[tl2].contains(allLists[tl])) { isNested = true; break; }
      }
      if (!isNested) topLevelLists.push(allLists[tl]);
    }
    for (var tl3 = 0; tl3 < topLevelLists.length; tl3++) {
      var extracted = extractFromList(topLevelLists[tl3], 0);
      for (var ei = 0; ei < extracted.length; ei++) items.push(extracted[ei]);
    }
  }

  if (items.length === 0) {
    items = extractFromLinks(sidebarEl);
  }

  if (items.length === 0 && selected.isSpaMenu) {
    items = await extractFromSpaMenu(sidebarEl);
  }

  function countItems(arr) {
    var count = arr.length;
    for (var ci2 = 0; ci2 < arr.length; ci2++) {
      if (arr[ci2].children) count += countItems(arr[ci2].children);
    }
    return count;
  }

  var debug = buildDebug(side, selected);
  debug.expandRounds = expandRounds;

  return { items: items, totalCount: countItems(items), debug: debug };
};
`;
function createPageController() {
	return {
		async load(options) {
			const startTime = Date.now();
			logger.debug({ url: options.url }, "page load started");
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
			logger.debug({
				url: finalUrl,
				durationMs: Date.now() - startTime
			}, "page load completed");
			return {
				url: finalUrl,
				html
			};
		},
		async scanToc(options) {
			const startTime = Date.now();
			logger.debug({
				url: options.url,
				maxDepth: options.maxDepth
			}, "toc scan started");
			const context = await ensureBrowserInstance().createContext({
				timeoutMs: options.timeoutMs,
				maxImageResources: options.maxImageResources
			});
			const page = await context.newPage();
			await page.setViewportSize({
				width: 1440,
				height: 900
			});
			await page.addInitScript(TOC_SCAN_SCRIPT);
			await page.goto(options.url, {
				waitUntil: "networkidle",
				timeout: options.timeoutMs
			});
			try {
				await page.waitForSelector("nav, aside, [class*=\"sidebar\"], [class*=\"menu\"], [role=\"navigation\"]", { timeout: 3e3 });
				await page.waitForTimeout(500);
			} catch {}
			const result = await page.evaluate(([md, mer]) => window.__scanToc(md, mer), [options.maxDepth || 10, 5]);
			await context.close();
			const tocResult = result;
			logger.debug({
				url: options.url,
				totalCount: tocResult.totalCount,
				durationMs: Date.now() - startTime
			}, "toc scan completed");
			return tocResult;
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
	if (!article || !article.content) {
		logger.error({ url }, "article extraction failed: no content");
		throw new Error("Failed to extract article content");
	}
	logger.debug({
		url,
		title: article.title
	}, "article extracted");
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
		if (href.startsWith("#")) return new URL(href, baseUri).href;
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
			const lineNumberMatch = line.trimStart().match(/^(\d+)(\t| {2,})(.+)$/);
			if (lineNumberMatch) {
				hasLineNumbers = true;
				return (line.match(/^(\s*)/)?.[1] || "") + lineNumberMatch[3];
			}
			return line;
		});
		if (hasLineNumbers) return processedLines.join("\n");
		return content;
	};
	if (textContent.includes("\n") && textContent.split("\n").length > 3) return removeLineNumbers(textContent);
	const lines = text.split("\n").map((line) => {
		const lineNumberMatch = line.trimStart().match(/^(\d+)(\t| {2,})(.+)$/);
		if (lineNumberMatch) return (line.match(/^(\s*)/)?.[1] || "") + lineNumberMatch[3].trimEnd();
		return line.trimEnd();
	});
	const formattedLines = [];
	for (let i = 0; i < lines.length; i++) {
		const line = lines[i];
		if (line || i === 0 || i === lines.length - 1) formattedLines.push(line);
		else if (formattedLines.length > 0 && formattedLines[formattedLines.length - 1] !== "") formattedLines.push("");
	}
	let result = formattedLines.join("\n").replace(/\n+$/, "");
	result = removeLineNumbers(result);
	return result.split("\n").map((line) => {
		const m = line.trimStart().match(/^(\d+)(\t| {2,})(.+)$/);
		if (m) return (line.match(/^(\s*)/)?.[1] || "") + m[3];
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
		const lineNumberMatch = line.trimStart().match(/^(\d+)(\t| {2,})(.+)$/);
		if (lineNumberMatch) return (line.match(/^(\s*)/)?.[1] || "") + lineNumberMatch[3];
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
			const src = el.getAttribute("src") ?? "";
			if (src.startsWith("data:")) return cleanAttribute(el.getAttribute("alt")) || "";
			const resolved = validateUri(src, baseURI);
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
function isAnchorLinkList(block) {
	const items = block.trim().split("\n").filter((l) => l.trim());
	return items.length > 0 && items.every((item) => /\]\([^)]*#[^)]*\)/.test(item));
}
function cleanMarkdown(body, title) {
	let result = body;
	const headingMatch = result.match(/^(#{1,6})\s+(.+)/m);
	if (headingMatch) {
		if (headingMatch[2].trim() === title.trim()) result = result.replace(headingMatch[0], "").replace(/^\n+/, "");
	}
	result = result.replace(/\[]\([^)]*\)/g, "");
	result = result.replace(/^!\[.*?\]\(.*?\)\s*$/gm, "");
	const leadingMatch = result.match(/^((?:[-*+]|\d+\.)\s+\[.+?\]\([^)]*#[^)]*\)\s*\n?)+/);
	if (leadingMatch && isAnchorLinkList(leadingMatch[0])) result = result.slice(leadingMatch[0].length).replace(/^\n+/, "");
	const trailingMatch = result.match(/(?:\n{2,})((?:[-*+]|\d+\.)\s+\[.+?\]\([^)]*#[^)]*\)\s*\n?)+\s*$/);
	if (trailingMatch && isAnchorLinkList(trailingMatch[0])) result = result.slice(0, result.length - trailingMatch[0].length);
	result = result.replace(/\n+\[上一篇]\(.*?\)[\s\S]*$/m, "");
	result = result.replace(/\n+\[Previous]\(.*?\)[\s\S]*$/im, "");
	result = result.replace(/(\n\[.+?]\(.+?\))*\n.*?©.*$/s, "");
	result = result.replace(/\n.*All Rights Reserved.*$/i, "");
	result = result.replace(/\n{3,}/g, "\n\n");
	return result.trim();
}
async function convertArticleToMarkdown(article) {
	let body = (await buildTurndownService(article.url)).turndown(article.content);
	body = stripSpecialChars(body);
	const title = article.title ?? "Untitled";
	body = cleanMarkdown(body, title);
	return { markdown: `# ${title}\n\n${body}`.trim() };
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
		const startTime = Date.now();
		const url = new URL(args.url);
		if (url.protocol !== "http:" && url.protocol !== "https:") {
			logger.warn({
				url: args.url,
				protocol: url.protocol
			}, "read_url rejected: invalid protocol");
			throw new Error("Only http and https protocols are allowed");
		}
		if (isPrivateHost(url)) {
			logger.warn({
				url: args.url,
				host: url.hostname
			}, "read_url rejected: private host");
			throw new Error("Access to private network addresses is not allowed");
		}
		logger.info({ url: args.url }, "read_url started");
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
				logger.error({
					url: args.url,
					err
				}, "read_url failed: chromium not installed");
				throw new Error("Chromium is not installed. Please call the install_chromium tool to install Chromium first, then retry read_url.");
			}
			logger.error({
				url: args.url,
				err,
				durationMs: Date.now() - startTime
			}, "read_url failed");
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
		const durationMs = Date.now() - startTime;
		logger.info({
			url: args.url,
			savedPath,
			durationMs
		}, "read_url completed");
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
		logger.info({ withDeps: args.with_deps }, "install_chromium started");
		try {
			const output = execSync(cmd, {
				encoding: "utf-8",
				stdio: [
					"inherit",
					"pipe",
					"pipe"
				]
			});
			logger.info("install_chromium completed");
			return { content: [{
				type: "text",
				text: output ? `Chromium installed successfully.\n\n${output}` : "Chromium installed successfully."
			}] };
		} catch (err) {
			const stderr = err && typeof err === "object" && "stderr" in err ? String(err.stderr) : "";
			const stdout = err && typeof err === "object" && "stdout" in err ? String(err.stdout) : "";
			const msg = err instanceof Error ? err.message : String(err);
			logger.error({
				err,
				stderr
			}, "install_chromium failed");
			return { content: [{
				type: "text",
				text: `Chromium installation failed: ${msg}${stderr ? `\n\nstderr:\n${stderr}` : ""}${stdout ? `\n\nstdout:\n${stdout}` : ""}`
			}] };
		}
	});
	server.registerTool("scan_docs_toc", {
		description: "Scan the table of contents (TOC) structure from a documentation website. Returns a structured tree of all documentation pages with their titles and URLs. AI can use this to download multiple pages and combine them into a complete document.",
		inputSchema: scanDocsTocInputSchema
	}, async (args) => {
		const startTime = Date.now();
		const url = new URL(args.url);
		if (url.protocol !== "http:" && url.protocol !== "https:") {
			logger.warn({
				url: args.url,
				protocol: url.protocol
			}, "scan_docs_toc rejected: invalid protocol");
			throw new Error("Only http and https protocols are allowed");
		}
		if (isPrivateHost(url)) {
			logger.warn({
				url: args.url,
				host: url.hostname
			}, "scan_docs_toc rejected: private host");
			throw new Error("Access to private network addresses is not allowed");
		}
		logger.info({
			url: args.url,
			maxDepth: args.max_depth
		}, "scan_docs_toc started");
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
				logger.error({
					url: args.url,
					err
				}, "scan_docs_toc failed: chromium not installed");
				throw new Error("Chromium is not installed. Please call the install_chromium tool to install Chromium first, then retry scan_docs_toc.");
			}
			logger.error({
				url: args.url,
				err,
				durationMs: Date.now() - startTime
			}, "scan_docs_toc failed");
			throw err;
		}
		const durationMs = Date.now() - startTime;
		logger.info({
			url: args.url,
			totalCount: tocResult.totalCount,
			durationMs
		}, "scan_docs_toc completed");
		const resultJson = JSON.stringify(tocResult, null, 2);
		return { content: [{
			type: "text",
			text: `Found ${tocResult.totalCount} documentation pages:\n\n${resultJson}`
		}] };
	});
}

//#endregion
//#region src/index.ts
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
	logger.info({
		name: config.mcpServerName,
		version: VERSION
	}, "mcp server started");
}
main().catch((error) => {
	logger.fatal({ err: error }, "mcp server failed to start");
	process.exit(1);
});

//#endregion
export {  };