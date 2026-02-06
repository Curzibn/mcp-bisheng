export type HtmlArticle = {
  title: string | null;
  content: string;
  byline?: string | null;
  excerpt?: string | null;
  url: string;
};

function ensureBaseElement(
  dom: { window: { document: Document } },
  url: string
) {
  const document = dom.window.document;
  const head = document.head ?? document.createElement("head");
  if (!document.head && document.documentElement) {
    document.documentElement.insertBefore(head, document.body ?? null);
  }
  const existingBase = head.querySelector("base");
  if (existingBase && existingBase.getAttribute("href")) {
    return;
  }
  const base = existingBase ?? document.createElement("base");
  base.setAttribute("href", url);
  if (!existingBase) {
    head.insertBefore(base, head.firstChild);
  }
}

export async function extractArticleFromHtml(html: string, url: string): Promise<HtmlArticle> {
  const [{ JSDOM: JSDOMClass }, { Readability }] = await Promise.all([
    import("jsdom"),
    import("@mozilla/readability")
  ]);
  const dom = new JSDOMClass(html, { url });
  ensureBaseElement(dom, url);
  const document = dom.window.document;
  const reader = new Readability(document);
  const article = reader.parse();

  if (!article || !article.content) {
    throw new Error("Failed to extract article content");
  }

  return {
    title: article.title ?? null,
    content: article.content,
    byline: article.byline ?? null,
    excerpt: article.excerpt ?? null,
    url
  };
}

