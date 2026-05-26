# zhihu-tools

知乎官方开放平台 MCP Server。当前 MCP 主线通过 `developer.zhihu.com` 官方 API 读取内容，不依赖 Chrome、Cookie、知乎网页登录态或 CDP。

## 前置要求

- Node.js >= 20
- 知乎开放平台 Access Secret
- 环境变量 `ZHIHU_ACCESS_SECRET`

```bash
export ZHIHU_ACCESS_SECRET="your-access-secret"
```

### 多 Key 轮测

支持逗号分隔多个 Access Secret，分散请求到不同 key 上。当某个 key 的接口额度用尽（返回 `Code: 30001`）时，自动切换到下一个可用 key，避免单点额度瓶颈。

```bash
export ZHIHU_ACCESS_SECRET="key-1,key-2,key-3"
```

启动时会输出初始化的 key 数量。每个 key 的额度用尽后会被标记为暂时不可用，冷却 5 分钟后自动恢复重试。可通过 `zhihu://health` resource 查看当前服务状态。

多 key 模式对所有工具（`zhihu_search`、`zhihu_hot_list`、`zhihu_zhida`、`zhihu_global_search`）和资源（`zhihu://hot`）均生效，请求按 round-robin 分配到各 key。

## 安装与构建

```bash
npm install
npm run build
```

## MCP Server

在 Claude Code 等 MCP 客户端中配置：

```json
{
  "mcpServers": {
    "zhihu": {
      "command": "node",
      "args": ["/path/to/zhihu-tools/dist/mcp/index.js"],
      "env": {
        "ZHIHU_ACCESS_SECRET": "your-access-secret"
      }
    }
  }
}
```

也可以在仓库内启动：

```bash
npm run mcp
```

启动后服务标识为 `zhihu-mcp`，当前版本 `0.3.0`。

## Tools

| 工具 | 说明 |
| --- | --- |
| `zhihu_verify_access` | 验证 `ZHIHU_ACCESS_SECRET` 是否已配置且站内搜索探测接口可用 |
| `zhihu_search` | 知乎站内搜索 |
| `zhihu_hot_list` | 知乎热榜 |
| `zhihu_zhida` | 知乎直答 Agent |
| `zhihu_global_search` | 全网搜索 |

### `zhihu_search`

```json
{
  "keyword": "人工智能",
  "type": "general",
  "limit": 10,
  "offset": 0
}
```

`type` 可选：`general`、`question`、`answer`、`article`。`limit` 范围为 1-20。
如果上游忽略返回数量参数，MCP 会在 normalization 后本地截断到 `limit`。

### `zhihu_hot_list`

```json
{
  "limit": 20,
  "offset": 0
}
```

`limit` 范围为 1-50。该接口受官方开放平台额度限制；额度用尽时会返回上游错误，例如 `day limit exceeded`。
如果上游忽略返回数量参数，MCP 会在 normalization 后本地截断到 `limit`。

### `zhihu_zhida`

```json
{
  "query": "如何理解大模型 RAG？"
}
```

### `zhihu_global_search`

```json
{
  "keyword": "OpenAI",
  "limit": 10,
  "offset": 0
}
```

## Resources

| URI | 说明 |
| --- | --- |
| `zhihu://health` | 服务健康状态、配置状态、Access Secret 探测结果 |
| `zhihu://hot` | 知乎热榜资源，使用与 `zhihu_hot_list` 相同的官方 API normalization |

## 返回 Schema

MCP 工具返回 JSON 文本，成功响应统一为：

```json
{
  "ok": true,
  "data": {},
  "meta": {
    "upstream_code": 0,
    "upstream_message": "success",
    "raw_data_keys": ["Items"]
  }
}
```

`meta` 保留官方 API envelope 信息，便于排查上游字段变化。真实官方 API 的外层字段是 `Code`、`Message`、`Data`；MCP 会将其规范化为更适合 agent 消费的小写结构。

### 搜索响应

`zhihu_search` 和 `zhihu_global_search` 返回：

```json
{
  "ok": true,
  "data": {
    "items": [],
    "total": 10,
    "has_more": true,
    "search_hash_id": "..."
  },
  "meta": {
    "upstream_code": 0,
    "upstream_message": "success",
    "raw_data_keys": ["HasMore", "Items", "SearchHashId"]
  }
}
```

`total` 和 `search_hash_id` 只有上游返回时才出现。

### 热榜响应

`zhihu_hot_list` 和 `zhihu://hot` 返回：

```json
{
  "ok": true,
  "data": {
    "items": [],
    "total": 50
  },
  "meta": {
    "upstream_code": 0,
    "upstream_message": "success",
    "raw_data_keys": ["Items", "Total"]
  }
}
```

`zhihu://hot` 资源会额外包含 `updated` 时间戳。

### 直答响应

`zhihu_zhida` 返回：

```json
{
  "ok": true,
  "data": {
    "answer": "...",
    "session_id": "...",
    "sources": []
  },
  "meta": {
    "upstream_code": 0,
    "upstream_message": "success",
    "raw_data_keys": ["Answer", "SessionId", "Sources"]
  }
}
```

直答接口当前以 SSE `data: {...}` 事件流返回；MCP 会解析事件流，选择最后一个带有效 `Data` 的事件，并从 `message.text`、`req_session_id`、`cards` 中映射出 `answer`、`session_id`、`sources`。该接口也受开放平台日额度限制，额度用尽时会返回上游错误。

## 错误 Schema

未配置 Access Secret：

```json
{
  "ok": false,
  "error": {
    "code": -32004,
    "message": "未配置 ZHIHU_ACCESS_SECRET。请在知乎开放平台获取 Access Secret 并设为环境变量"
  }
}
```

上游 HTTP 或业务错误：

```json
{
  "ok": false,
  "error": {
    "code": -32003,
    "message": "day limit exceeded",
    "data": {
      "status": 200,
      "raw": {
        "Code": 30001,
        "Message": "day limit exceeded",
        "Data": null
      }
    }
  }
}
```

## 功能边界

- MCP 主线只承诺官方开放平台已提供的能力：站内搜索、热榜、直答、全网搜索。
- 当前 MCP 不提供旧版 `zhihu_get_question`、`zhihu_get_answer`、`zhihu_get_article`、`zhihu_get_feed`、网页登录或人机验证工具。
- 官方 API 可能返回业务错误码，即使 HTTP 状态是 200；代码会把 `Code !== 0` 转为 MCP 上游错误。
- 开放平台额度、权限、接口变更会直接影响返回结果。

## CLI 状态

仓库仍保留 legacy CLI：

```bash
npx zhihu --help
```

CLI 仍走旧的浏览器/CDP/知乎网页登录路径，用于历史兼容；它不是当前 MCP 主线能力。新功能和 MCP 集成应优先使用 `src/core/official-api.ts` 与 `src/mcp/index.ts`。

## 开发

```bash
npm run build
npm test
npm run mcp
```

测试重点：

- `tests/official-api-schema.test.ts`：官方 API envelope 到 MCP schema 的 normalization。
- `tests/mcp-official-response.test.ts`：MCP 工具/resource 成功响应结构。
- `tests/official-api.test.ts`：鉴权配置、官方业务错误、基础客户端行为。
- 旧浏览器/CDP 测试作为 legacy 覆盖保留，不定义当前 MCP 主线 schema。

## 架构

```text
MCP Client
  -> dist/mcp/index.js
  -> OfficialApiClient
  -> developer.zhihu.com/api/v1/content
  -> official-api-schema normalization
  -> MCP JSON text result
```

核心文件：

- `src/core/official-api.ts`：官方 API HTTP client、鉴权、上游错误转换。
- `src/core/official-api-schema.ts`：真实 `Code/Message/Data` envelope 到 MCP schema 的 normalization。
- `src/mcp/official-response.ts`：MCP 成功响应和 resource payload 构造。
- `src/mcp/index.ts`：MCP tools、resources、prompts 注册。
