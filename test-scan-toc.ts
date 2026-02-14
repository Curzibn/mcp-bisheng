import { createPageController, type TocItem } from "./src/browser/page";
import { getConfig } from "./src/config";

function printTree(items: TocItem[], indent = 0) {
  for (const item of items) {
    const prefix = "  ".repeat(indent) + (indent > 0 ? "├─ " : "");
    const urlPart = item.url ? ` → ${item.url}` : "";
    console.log(`${prefix}${item.title}${urlPart}`);
    if (item.children) printTree(item.children, indent + 1);
  }
}

async function testScanToc() {
  const url = process.argv[2] || "https://bep-openapi.meituan.com/api/sqt/openplatform_web/site/index.html#/apiDoc/basicConcept";
  const config = getConfig();

  console.log(`正在扫描文档目录: ${url}\n`);

  const controller = createPageController();

  try {
    const result = await controller.scanToc({
      url,
      timeoutMs: config.browserTimeoutMs,
      maxImageResources: config.maxImageResources,
      maxDepth: 10
    });

    console.log(`找到 ${result.totalCount} 个文档页面\n`);

    if (result.debug) {
      console.log("=== 调试信息 ===");
      console.log(`选中侧边栏位置: ${result.debug.sidebarSide}`);
      console.log(`候选容器数量: ${result.debug.candidateCount}`);
      console.log(`左侧: ${result.debug.leftGroupCount}  右侧: ${result.debug.rightGroupCount}`);
      console.log(`选中容器链接数: ${result.debug.selectedLinkCount}`);
      console.log(`展开轮数: ${result.debug.expandRounds}`);

      console.log(`\n=== 所有候选容器 ===`);
      result.debug.containerInfos.forEach((info, index) => {
        console.log(
          `  [${index + 1}] <${info.tagName}> class="${info.className}" ` +
          `| 位置=${info.position} | rect(${info.left}, ${info.top}, ${info.width}x${info.height}) ` +
          `| 链接=${info.linkCount} | hash=${(info.hashRatio * 100).toFixed(0)}%`
        );
      });
      console.log("");
    }

    console.log("=== 目录树 ===");
    printTree(result.items);

    console.log(`\n=== JSON ===`);
    console.log(JSON.stringify({ items: result.items, totalCount: result.totalCount }, null, 2));

    await controller.close();
  } catch (error) {
    console.error("扫描失败:", error);
    await controller.close();
    process.exit(1);
  }
}

testScanToc();
