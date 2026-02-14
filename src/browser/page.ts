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

export type TocItem = {
  title: string;
  url: string;
  children?: TocItem[];
};

export type TocScanResult = {
  items: TocItem[];
  totalCount: number;
  debug?: {
    sidebarSide: string;
    candidateCount: number;
    leftGroupCount: number;
    rightGroupCount: number;
    selectedLinkCount: number;
    expandRounds: number;
    containerInfos: Array<{
      tagName: string;
      className: string;
      position: string;
      left: number;
      top: number;
      width: number;
      height: number;
      linkCount: number;
      hashRatio: number;
    }>;
  };
};

export type TocScanOptions = {
  url: string;
  timeoutMs: number;
  maxImageResources: number;
  maxDepth?: number;
};

export type PageController = {
  load: (options: PageLoadOptions) => Promise<PageContent>;
  scanToc: (options: TocScanOptions) => Promise<TocScanResult>;
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
    if (rawHref.startsWith("#")) return true;
    try {
      var resolved = new URL(rawHref, window.location.href);
      var current = new URL(window.location.href);
      return resolved.pathname === current.pathname && !!resolved.hash;
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
    if (validCount < 2) return null;
    return {
      element: el,
      left: rect.left, top: rect.top,
      width: rect.width, height: rect.height,
      centerX: rect.left + rect.width / 2,
      validLinkCount: validCount,
      hashOnlyCount: hashOnlyCount,
      hashRatio: validCount > 0 ? hashOnlyCount / validCount : 0
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
    var broadEls = document.querySelectorAll("div, section");
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
    async scanToc(options: TocScanOptions): Promise<TocScanResult> {
      const browserInstance = ensureBrowserInstance();
      const context = (await browserInstance.createContext({
        timeoutMs: options.timeoutMs,
        maxImageResources: options.maxImageResources
      })) as BrowserContext;
      const page = await context.newPage();

      await page.setViewportSize({ width: 1440, height: 900 });
      await page.addInitScript(TOC_SCAN_SCRIPT);

      await page.goto(options.url, {
        waitUntil: "networkidle",
        timeout: options.timeoutMs
      });

      try {
        await page.waitForSelector(
          'nav, aside, [class*="sidebar"], [class*="menu"], [role="navigation"]',
          { timeout: 3000 }
        );
        await page.waitForTimeout(500);
      } catch {}

      const result = await page.evaluate(
        ([md, mer]) => (window as any).__scanToc(md, mer),
        [options.maxDepth || 10, 5] as [number, number]
      );

      await context.close();

      return result as TocScanResult;
    },
    async close(): Promise<void> {
    }
  };
}

