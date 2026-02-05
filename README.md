# BiSheng (毕昇)

中文 | [English](README_EN.md)

[![License: MIT](https://img.shields.io/badge/License-MIT-yellow.svg)](https://opensource.org/licenses/MIT)
[![npm version](https://img.shields.io/npm/v/@zibin/mcp-bisheng.svg)](https://www.npmjs.com/package/@zibin/mcp-bisheng)

> **"The movable type printing for the AI era."**
> 像活字印刷术重新排列文字一样，BiSheng 将杂乱的现代网页重组为 AI 最易阅读的 Markdown。

BiSheng（毕昇） 是一个基于 **MCP (Model Context Protocol)** 的高性能网页解析工具。它专为大语言模型（LLM）设计，解决了 AI 访问现代网页时的 **SPA 渲染**、**Token 浪费** 和 **反爬虫拦截** 三大难题。

### 原始 HTML vs BiSheng Markdown

| 原始网页 | BiSheng 输出 |
| --- | --- |
| ![原始 HTML](images/html.png) | ![BiSheng Markdown](images/bisheng.png) |

## ✨ 核心特性 (Features)

* **🖥️ 真浏览器渲染**: 基于 Playwright (Chromium)，完美支持 React/Vue 等 SPA 页面，自动处理懒加载。
* **🧹 智能降噪**: 集成 Readability 算法，自动剔除广告、侧边栏，只保留核心正文。
* **📝 完美 Markdown**: 保留代码块高亮、表格结构，自动修复相对链接。
* **🛡️ 企业级控制**: 内置私有 IP 拦截（防 SSRF）、超时控制、图片资源限制。

## 🛠️ 工具列表 (Tools)

BiSheng 向 MCP 客户端暴露以下工具：

### `read_url`

使用无头浏览器渲染网页并返回 Markdown 格式的主内容。提供 `output_path` 时同时保存到本地文件。

* **参数**:
  * `url` (string, required): 目标网页地址，仅支持 http/https。
  * `output_path` (string, optional): 保存 Markdown 的路径。相对路径从 MCP 进程工作目录解析，建议使用绝对路径。

* **示例**:
```json
{ "url": "https://react.dev/learn" }
```

```json
{ "url": "https://example.com", "output_path": "d:\\output\\page.md" }
```

### `install_chromium`

安装 Playwright 所需的 Chromium 浏览器。当 `read_url` 因 Chromium 未安装而失败时，可先调用此工具再重试。

* **参数**:
  * `with_deps` (boolean, optional): 是否同时安装系统依赖，默认 `false`。

## 🚀 快速开始 (Quick Start)

### 1. Claude Desktop (推荐)

在 `claude_desktop_config.json` 中添加配置：

```json
{
  "mcpServers": {
    "bisheng": {
      "command": "npx",
      "args": ["-y", "@zibin/mcp-bisheng"]
    }
  }
}
```

在 Claude 中，你可以直接对模型说类似的话：

```json
{ "tool": "read_url", "params": { "url": "https://react.dev/learn" } }
```

Claude 会通过 MCP 调用 BiSheng，得到干净的 Markdown 文档后再继续对话和生成代码。

### 2. 在 Cursor 中作为 MCP 工具使用

在 Cursor 中，你可以在“Settings → MCP Servers”（或相应的 MCP 配置入口）中新增一个 Server，命令填写：

```bash
{
  "mcpServers": {
    "bisheng": {
      "command": "npx",
      "args": ["-y", "@zibin/mcp-bisheng"]
    }
  }
}
```

保存后，Cursor 会在本地通过 MCP 启动 BiSheng。此时你可以：

- **在对话框中直接引用 URL**，让 Cursor 调用 `read_url`，把网页转成 Markdown 后再继续回答。
- **结合 `output_path` 参数**，把外部文档抓取后直接保存到当前仓库，例如：

```json
{
  "tool": "read_url",
  "params": {
    "url": "https://example.com/docs",
    "output_path": "docs/external/example-docs.md"
  }
}
```

这样生成的 Markdown 会被 Cursor 索引，之后的任何对话都可以自动检索这些文档。

### 3. Docker 运行

适合部署在服务器或无法安装 Node.js 的环境。

```bash
docker pull curzbin/mcp-bisheng:latest

docker run --rm -i curzbin/mcp-bisheng:latest
```

### 4. CLI 临时使用

```bash
npx @zibin/mcp-bisheng
```

## ⚙️ 配置 (Configuration)

通过环境变量调整 BiSheng 行为：

| 变量名 | 默认值 | 说明 |
| --- | --- | --- |
| `BROWSER_TIMEOUT_MS` | `30000` | 页面加载超时时间 (毫秒) |
| `MAX_IMAGE_RESOURCES` | `50` | 单页最大图片资源数量 |
| `MCP_SERVER_NAME` | `@zibin/mcp-bisheng` | MCP 服务显示名称 |

## 🏗️ 架构与开发

本项目采用 TypeScript + Playwright 开发。

```bash
pnpm install
pnpm dev
pnpm build
```

# ☕ 捐助

如果这个项目对您有帮助，欢迎通过以下方式支持我的工作。您的支持是我持续改进和维护这个项目的动力。

<div align="center">
<table>
<tr>
<td align="center">
<img src="images/alipay.png" width="300" alt="支付宝收款码" />
</td>
<td width="50"></td>
<td align="center">
<img src="images/wechat.png" width="300" alt="微信收款码" />
</td>
</tr>
</table>
</div>

感谢您的支持！🙏