# zhihu-tools

知乎 CLI 工具 & MCP Server — 通过本机 Chrome/Chromium 浏览器读取知乎内容，支持搜索、热榜、推荐流、问题回答、回答详情、文章与评论。

## 前置要求

- **Node.js >= 20**
- **Chrome/Chromium 浏览器**（工具通过 Chrome DevTools Protocol 控制浏览器）
- macOS / Linux / Windows

## 安装

```bash
cd zhihu-tools
npm install
npm run build
```

本仓库的 CLI 二进制名为 `zhihu`，开发环境中可直接使用：

```bash
npx zhihu --help
```

## 登录模型

登录状态保存在**专用 Chrome profile** 中：

```text
~/.zhihu-tools/chrome-profile
```

工具不再使用 cookie 文件，也不支持密码直登。登录、验证码和风控校验需要一个可见的专用 Chrome 窗口；搜索、热榜、问题、文章等普通读取操作默认通过 headless Chrome/CDP 执行，只有检测到需要人工处理的人机验证/风控时才会自动弹出可见窗口。

- 登录态在 CLI 和 MCP Server 之间共享（共用同一个 profile）
- 退出登录会清除该 profile 中的知乎 Cookie/存储
- MCP 登录成功后会关闭可见浏览器；后续普通工具调用会复用同一 profile 并以 headless 模式启动
- 纯 HTTP 密码登录已移除，避免被知乎风控直接阻断

## CLI 使用

```bash
# 登录：打开专用浏览器窗口，手动完成登录后回车
npx zhihu login

# 检查当前登录用户
npx zhihu whoami

# 搜索浏览
npx zhihu search <关键词>
npx zhihu search <关键词> -t article -l 20
npx zhihu hot -l 20
npx zhihu feed -l 10

# 问题详情 + 回答摘要
npx zhihu question <问题ID或链接>
npx zhihu question 546859351 -a 29

# 文章详情，可选评论
npx zhihu article <文章ID或链接>
npx zhihu article 2030369875114336526 -c 5

# 退出登录并清理知乎 Cookie
npx zhihu logout
```

> 注意：每个 CLI 命令会启动/停止浏览器进程；命令之间共享登录 profile，但不共享同一个浏览器进程。如需连续多次调用，建议使用 MCP 模式。

### `question` 输出说明

`question -a <count>` 会尽量通过知乎 API 分页返回指定数量的回答摘要；API 失败时退回页面 DOM 抓取。每条回答会包含赞同数、评论数和回答链接，回答正文在问题列表里是摘要/正文片段，不保证完整全文。

示例输出形态：

```text
问题: 哪所大学的人工智能比较强?
回答数: 29
关注者: 940

--- 回答 1 (114 赞同 · 43 评论) ---
链接: https://www.zhihu.com/question/546859351/answer/3564890668
人工智能专业超强的15所大学：第一名清华大学...
```

如果需要单条回答的完整详情和评论，请使用 MCP 工具 `zhihu_get_answer`，或从输出中的 `answer/<id>` 链接取得回答 ID 后再调用相应接口。

### `article` 输出说明

`article` 会优先通过文章 API 获取标题、作者、正文、赞同数和评论数；API 不可用时退回页面 DOM 抓取。文章正文不会再固定截断到 500 字符，返回结果会尽量保持完整，并清理知乎页面中常见的 `.css-xxx{...}` 样式污染。

使用 `-c, --comments <count>` 可额外输出文章评论：

```bash
npx zhihu article 2030369875114336526 -c 2
```

## MCP Server

MCP 模式下，除 `zhihu_open_login_page` 以及需要用户手动处理的登录/风控场景外，工具默认不会弹出 Chrome 窗口。普通工具调用会在后台启动 headless Chrome，使用 `~/.zhihu-tools/chrome-profile` 中已有的登录态读取数据；如果明确检测到人机验证，会自动打开可见 Chrome 窗口并快速返回结构化错误，不会等待用户操作导致 JSON-RPC 请求挂住。普通加载超时或登录错误不会自动弹窗。

在 Claude Code 等 MCP 客户端中配置：

```json
{
  "mcpServers": {
    "zhihu": {
      "command": "node",
      "args": ["/path/to/zhihu-tools/dist/mcp/index.js"]
    }
  }
}
```

也可以在本仓库内使用 npm script 启动：

```bash
npm run mcp
```

### Tools

| 工具 | 说明 |
|------|------|
| `zhihu_open_login_page` | 打开可见专用浏览器并进入知乎登录页 |
| `zhihu_human_verification_status` | 检查自动弹出的人机验证浏览器状态；返回 `WAIT_FOR_BROWSER_CLOSE` 或 `RERUN_READY` |
| `zhihu_login_check` | 检查登录状态；不会主动启动浏览器；确认已登录后会关闭可见浏览器 |
| `zhihu_get_profile` | 获取当前登录用户信息 |
| `zhihu_search` | 搜索知乎内容（问题、回答、文章等） |
| `zhihu_hot_stories` | 获取知乎热榜（缓存 1 分钟） |
| `zhihu_get_feed` | 获取首页推荐流（需登录） |
| `zhihu_get_question` | 获取问题详情和回答摘要；回答包含链接、API 链接、赞同数、评论数 |
| `zhihu_get_answer` | 获取单条回答详情，可选返回回答评论 |
| `zhihu_get_article` | 获取文章详情，可选返回文章评论 |

MCP 工具返回 JSON 文本，统一采用类似结构：

```json
{
  "ok": true,
  "data": {},
  "meta": {}
}
```

### MCP 参数示例

获取问题和 29 条回答摘要：

```json
{
  "question_id": "546859351",
  "answer_limit": 29
}
```

`zhihu_get_question` 的每条回答摘要包含常用字段：

```json
{
  "id": "3564890668",
  "url": "https://www.zhihu.com/question/546859351/answer/3564890668",
  "api_url": "https://www.zhihu.com/api/v4/answers/3564890668",
  "voteup_count": 114,
  "comment_count": 43,
  "excerpt": "...",
  "author": "匿名"
}
```

获取单条回答详情并返回 10 条评论：

```json
{
  "answer_id": "3564890668",
  "comment_limit": 10
}
```

获取文章详情并返回 5 条评论：

```json
{
  "article_id": "2030369875114336526",
  "comment_limit": 5
}
```

### Resources

| URI | 说明 |
|-----|------|
| `zhihu://hot` | 知乎热榜 |
| `zhihu://feed` | 推荐流 |
| `zhihu://profile` | 当前用户信息 |

## 功能边界

- 本工具依赖知乎 Web/API 返回结构；知乎改版、登录态失效或风控会影响结果。
- `zhihu_get_question` / `question -a` 用于回答列表摘要，不承诺返回每个回答的完整全文。
- 单条回答详情、回答评论应使用 `zhihu_get_answer`。
- 文章详情和评论应使用 `zhihu_get_article` 或 CLI `article -c`。
- MCP 侧对共享浏览器页做了串行队列，避免并发 tool call 互相污染页面状态。

## Troubleshooting

### Chrome 启动失败

确保系统已安装 Chrome/Chromium。工具会自动查找以下路径：

- **macOS**: `/Applications/Google Chrome.app/Contents/MacOS/Google Chrome`
- **Linux**: `google-chrome` / `chromium-browser` / `chromium`
- **Windows**: `C:\Program Files\Google\Chrome\Application\chrome.exe` / `C:\Program Files (x86)\...`

### 登录后仍提示未登录

1. 确保在打开的 Chrome 窗口中**手动完成**了知乎登录（不是工具自动登录）。
2. 检查 `~/.zhihu-tools/chrome-profile` 目录是否存在。
3. 尝试 `npx zhihu logout` 后重新执行 `npx zhihu login`。
4. 如果 MCP 的 `zhihu_login_check` 显示 `browser_running: false`，先调用 `zhihu_open_login_page` 打开浏览器。

### 人机验证 / 风控

如果触发知乎风控或验证码，MCP 普通工具会自动打开可见专用 Chrome 窗口，并立即返回 `HUMAN_VERIFICATION_REQUIRED`，不会等待用户关闭浏览器：

```json
{
  "ok": false,
  "error": {
    "code": "HUMAN_VERIFICATION_REQUIRED",
    "message": "已打开浏览器，请手动完成知乎人机验证后重试"
  },
  "meta": {
    "browser_opened": true,
    "signal": "WAIT_FOR_BROWSER_CLOSE",
    "should_rerun": false,
    "status_tool": "zhihu_human_verification_status"
  }
}
```

外部 agent 可以调用 `zhihu_human_verification_status` 轮询状态。用户在浏览器里完成验证并关闭窗口后，该工具会返回：

```json
{
  "ok": true,
  "signal": "RERUN_READY",
  "event": "VERIFICATION_BROWSER_CLOSED",
  "should_rerun": true,
  "browser_running": false
}
```

收到 `RERUN_READY` 后即可重跑原工具。若自动打开失败，再手动调用 MCP 工具 `zhihu_open_login_page`（或 CLI `npx zhihu login`）。

### 普通工具不应弹出窗口

MCP 中的 `zhihu_search`、`zhihu_hot_stories`、`zhihu_get_question`、`zhihu_get_answer`、`zhihu_get_article` 等普通读取工具默认使用 headless Chrome。无风控时它们不应弹窗；若检测到人机验证，会自动弹出可见浏览器。若无风控时仍弹出窗口，请确认 MCP 客户端使用的是重新构建后的 `dist/mcp/index.js`：

```bash
npm run build
```

### 重置登录态

```bash
# 清除 Chrome profile
rm -rf ~/.zhihu-tools/chrome-profile

# 或通过 CLI 退出
npx zhihu logout
```

### 结果为空或不全

- 问题回答列表优先走知乎 API 分页；如果 API 被限制，会退回 DOM 抓取，此时可能只能获取页面已渲染内容。
- `question -a <count>` / `zhihu_get_question` 返回的是回答摘要列表，正文可能不是完整全文；请用回答链接或 `zhihu_get_answer` 获取单条回答详情。
- 文章评论和回答评论来自知乎评论接口；部分内容可能因权限、折叠、删除、风控而无法返回。
- 热榜数据缓存 1 分钟。
- 频繁请求可能触发速率限制；工具内置 500ms 最小间隔。

### 本地沙箱 / CI 中运行失败

浏览器模式需要启动 Chrome 并监听本机 CDP 端口。在受限沙箱或 CI 环境中，可能出现类似错误：

```text
listen EPERM: operation not permitted 127.0.0.1
```

这种情况下需要允许本机端口监听，或在真实桌面环境中运行 CLI/MCP。

## 隐私说明

- 登录状态（Cookie、浏览历史等）保存在 `~/.zhihu-tools/chrome-profile`。
- 工具不会上传或分享任何个人数据。
- 退出登录时会清除知乎域的 Cookie 和存储。

## 开发

```bash
npm run build    # TypeScript 构建
npm test         # 单元测试
npm run cli      # CLI 模式
npm run mcp      # MCP 模式
```

### 架构

```text
CLI / MCP 请求 → ZhihuClient → BrowserHttpClient → BrowserSession → Chrome CDP
                                    ↕（同一 Chrome page，串行访问）
                               FeedService / SearchService / AuthService
```

核心策略：

- CLI/MCP 共享 `ZhihuClient`、`FeedService`、`SearchService`、`AuthService`。
- 数据获取优先使用知乎 API；API 不可用时尽量使用浏览器页面 DOM 作为 fallback。
- 普通读取默认使用 headless Chrome/CDP；登录、验证码和风控处理会切换到可见 Chrome 窗口。
