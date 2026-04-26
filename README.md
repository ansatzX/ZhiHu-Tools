# zhihu-tools

知乎 CLI 工具 & MCP Server — 在命令行中搜索、浏览知乎内容。

## 安装

```bash
cd zhihu-tools
npm install
npm run build
```

## CLI 使用

```bash
# 登录
npx zhihu login          # 二维码登录
npx zhihu login -p       # 密码登录

# 搜索浏览
npx zhihu search <关键词>
npx zhihu hot            # 热榜
npx zhihu feed           # 推荐流
npx zhihu question <id>  # 问题详情
npx zhihu article <id>   # 文章详情
npx zhihu whoami         # 当前用户
npx zhihu logout         # 退出
```

## MCP Server

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

**Tools:** `zhihu_login_check`, `zhihu_get_profile`, `zhihu_search`, `zhihu_hot_stories`, `zhihu_get_feed`, `zhihu_get_question`, `zhihu_get_article`

**Resources:** `zhihu://hot`, `zhihu://feed`, `zhihu://profile`

## Cookie

登录状态保存在 `~/.zhihu-cookie.json`，CLI 和 MCP Server 共享。
