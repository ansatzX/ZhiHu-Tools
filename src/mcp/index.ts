import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { z } from "zod";
import { OfficialApiClient, RotatingOfficialApiClient, OfficialApiError } from "../core";
import {
  normalizeOfficialHotList,
  normalizeOfficialSearch,
  normalizeOfficialZhida,
  type OfficialMcpResult,
} from "../core/official-api-schema";
import { officialResourcePayload, officialSuccessPayload } from "./official-response";
import { JsonlLogger } from "./jsonl-logger";
import {
  ErrorCode,
  notConfiguredError,
  upstreamError,
  internalError,
  type McpStandardError,
} from "./errors";

// ============================================================
// 官方 API 客户端
// ============================================================

/** Shared interface for single-key and multi-key clients. */
type ApiClient = OfficialApiClient | RotatingOfficialApiClient;

let apiClient: ApiClient | null = null;

function getApiClient(): ApiClient {
  if (!apiClient) {
    const raw = (process.env.ZHIHU_ACCESS_SECRET || "").trim();
    const keys = raw.split(",").map((k) => k.trim()).filter(Boolean);
    if (keys.length > 1) {
      apiClient = new RotatingOfficialApiClient(keys);
    } else {
      apiClient = new OfficialApiClient({ accessSecret: keys[0] || "" });
    }
    console.error(`[zhihu-mcp] initialized with ${keys.length} API key(s)`);
  }
  return apiClient;
}

function ensureConfig(): ApiClient | McpStandardError {
  const api = getApiClient();
  if (!api.isConfigured()) {
    return notConfiguredError();
  }
  return api;
}

// ============================================================
// 请求日志
// ============================================================

const jsonl = new JsonlLogger();

function logRequest(tool: string, args: unknown) {
  const ts = new Date().toISOString();
  console.error(`[${ts}] TOOL  ${tool}  args=${JSON.stringify(args)}`);
  jsonl.toolRequest(tool, args);
}

function logResponse(tool: string, ok: boolean, durationMs: number, error?: string) {
  const ts = new Date().toISOString();
  console.error(`[${ts}] ${ok ? "OK" : "ERR"}  ${tool}  ${durationMs}ms`);
  jsonl.toolResponse(tool, ok, durationMs, error);
}

// ============================================================
// MCP 结果构造器
// ============================================================

function textResult(data: unknown) {
  return {
    content: [{ type: "text" as const, text: JSON.stringify(data) }],
  };
}

function mcpError(err: McpStandardError) {
  return {
    isError: true as const,
    content: [{ type: "text" as const, text: JSON.stringify(err) }],
  };
}

function resourceResult(uri: string, data: unknown, mimeType = "application/json") {
  return {
    contents: [{ uri, mimeType: mimeType as "application/json", text: JSON.stringify(data) }],
  };
}

// ============================================================
// 工具执行包装
// ============================================================

async function runOfficial<T>(
  tool: string,
  args: unknown,
  fn: (api: ApiClient) => Promise<unknown>,
  normalize: (raw: unknown) => OfficialMcpResult<T>
) {
  logRequest(tool, args);
  const started = Date.now();

  const apiOrErr = ensureConfig();
  if ("ok" in apiOrErr && apiOrErr.ok === false) {
    logResponse(tool, false, Date.now() - started, apiOrErr.error?.message);
    return mcpError(apiOrErr);
  }
  const api = apiOrErr as ApiClient;

  try {
    const result = normalize(await fn(api));
    logResponse(tool, true, Date.now() - started);
    return textResult(officialSuccessPayload(result));
  } catch (err: unknown) {
    const errMsg = err instanceof Error ? err.message : String(err);
    logResponse(tool, false, Date.now() - started, errMsg);
    if (err instanceof OfficialApiError) {
      return mcpError(upstreamError(err.status, err.message, err.raw));
    }
    return mcpError(internalError(err));
  }
}

// ============================================================
// 创建 MCP Server
// ============================================================

const server = new McpServer(
  { name: "zhihu-mcp", version: "0.3.0" },
  {
    capabilities: {
      tools: {},
      resources: {},
      prompts: {},
    },
  }
);

// ============================================================
// Tools — 官方 API 工具
// ============================================================

server.registerTool(
  "zhihu_search",
  {
    description:
      "知乎站内搜索（官方 API）。使用知乎开放平台 Bearer 鉴权，需设置 ZHIHU_ACCESS_SECRET 环境变量。",
    inputSchema: {
      keyword: z.string().min(1).max(200).describe("搜索关键词"),
      type: z
        .enum(["general", "question", "answer", "article"])
        .optional()
        .describe("搜索类型: general=综合, question=问题, answer=回答, article=文章"),
      limit: z.number().int().min(1).max(20).optional().describe("返回数量 (1-20, 默认 10)"),
      offset: z.number().int().min(0).optional().describe("分页偏移 (默认 0)"),
    },
  },
  async (args) =>
    runOfficial(
      "zhihu_search",
      args,
      (api) =>
        api.zhihuSearch({
          query: args.keyword,
          type: args.type as "general" | "question" | "answer" | "article",
          limit: args.limit ?? 10,
          offset: args.offset ?? 0,
        }),
      (raw) => normalizeOfficialSearch(raw, { limit: args.limit ?? 10 })
    )
);

server.registerTool(
  "zhihu_hot_list",
  {
    description: "知乎热榜（官方 API）。返回当前热门内容。Bearer 鉴权，需设置 ZHIHU_ACCESS_SECRET。",
    inputSchema: {
      limit: z.number().int().min(1).max(50).optional().describe("返回数量 (1-50, 默认 20)"),
      offset: z.number().int().min(0).optional().describe("分页偏移 (默认 0)"),
    },
  },
  async (args) =>
    runOfficial(
      "zhihu_hot_list",
      args,
      (api) => api.hotList({ limit: args.limit ?? 20, offset: args.offset ?? 0 }),
      (raw) => normalizeOfficialHotList(raw, { limit: args.limit ?? 20 })
    )
);

server.registerTool(
  "zhihu_zhida",
  {
    description: "直答 Agent — 知乎 AI 问答（官方 API）。Bearer 鉴权，需设置 ZHIHU_ACCESS_SECRET。",
    inputSchema: {
      query: z.string().min(1).max(2000).describe("提问内容"),
    },
  },
  async (args) =>
    runOfficial(
      "zhihu_zhida",
      args,
      (api) => api.zhida({ query: args.query }),
      normalizeOfficialZhida
    )
);

server.registerTool(
  "zhihu_global_search",
  {
    description: "全网搜索（官方 API）。搜索范围不限于知乎站内。Bearer 鉴权，需设置 ZHIHU_ACCESS_SECRET。",
    inputSchema: {
      keyword: z.string().min(1).max(200).describe("搜索关键词"),
      limit: z.number().int().min(1).max(20).optional().describe("返回数量 (1-20, 默认 10)"),
      offset: z.number().int().min(0).optional().describe("分页偏移 (默认 0)"),
    },
  },
  async (args) =>
    runOfficial(
      "zhihu_global_search",
      args,
      (api) =>
        api.globalSearch({ query: args.keyword, limit: args.limit ?? 10, offset: args.offset ?? 0 }),
      (raw) => normalizeOfficialSearch(raw, { limit: args.limit ?? 10 })
    )
);

server.registerTool(
  "zhihu_verify_access",
  {
    description: "验证 ZHIHU_ACCESS_SECRET 是否有效。使用知乎站内搜索 API 做最小探测。",
  },
  async () => {
    logRequest("zhihu_verify_access", {});
    const started = Date.now();
    try {
      const api = getApiClient();
      if (!api.isConfigured()) {
        return textResult({
          ok: true,
          data: { configured: false, valid: false },
          meta: { action: "请设置环境变量 ZHIHU_ACCESS_SECRET" },
        });
      }
      const result = await api.verifyAccess();
      logResponse("zhihu_verify_access", result.valid, Date.now() - started);
      return textResult({ ok: true, data: { configured: true, ...result } });
    } catch (err: unknown) {
      logResponse("zhihu_verify_access", false, Date.now() - started);
      return mcpError(internalError(err));
    }
  }
);

// ============================================================
// Resources — 可订阅的数据资源
// ============================================================

server.registerResource(
  "知乎热榜",
  "zhihu://hot",
  {
    description: "知乎当前热榜内容，通过官方 API 实时获取",
    mimeType: "application/json",
  },
  async () => {
    try {
      const apiOrErr = ensureConfig();
      if ("ok" in apiOrErr && apiOrErr.ok === false) {
        return resourceResult("zhihu://hot", apiOrErr as McpStandardError);
      }
      const result = await (apiOrErr as ApiClient).hotList({ limit: 50 });
      return resourceResult(
        "zhihu://hot",
        officialResourcePayload(normalizeOfficialHotList(result, { limit: 50 }), new Date().toISOString())
      );
    } catch (err: unknown) {
      return resourceResult("zhihu://hot", {
        ok: false,
        error: err instanceof OfficialApiError
          ? { code: err.code, message: err.message }
          : { code: "RESOURCE_ERROR", message: String(err) },
      });
    }
  }
);

server.registerResource(
  "服务健康检查",
  "zhihu://health",
  {
    description: "zhihu-mcp 服务健康状态与配置信息",
    mimeType: "application/json",
  },
  async () => {
    const api = getApiClient();
    const configured = api.isConfigured();
    let accessValid: boolean | null = null;
    if (configured) {
      const result = await api.verifyAccess().catch(() => ({ valid: false }));
      accessValid = result.valid;
    }
    return resourceResult("zhihu://health", {
      ok: true,
      data: {
        name: "zhihu-mcp",
        version: "0.3.0",
        configured,
        access_valid: accessValid,
        uptime_ms: Math.floor(process.uptime() * 1000),
        timestamp: new Date().toISOString(),
      },
    });
  }
);

// ============================================================
// Prompts — 预置提示模板
// ============================================================

server.registerPrompt(
  "zhihu_search_prompt",
  {
    description: "知乎搜索提示模板。输入关键词，生成格式化的搜索请求上下文。",
    argsSchema: {
      keyword: z.string().min(1).max(200).describe("搜索关键词"),
    },
  },
  async (args) => {
    const keyword = String(args.keyword);
    return {
      messages: [
        {
          role: "user",
          content: {
            type: "text",
            text: `在知乎上搜索「${keyword}」相关内容。请使用 zhihu_search 工具执行搜索，并总结找到的主要观点和讨论。`,
          },
        },
      ],
    };
  }
);

server.registerPrompt(
  "zhihu_hot_prompt",
  {
    description: "知乎热榜浏览提示模板。获取当前热榜并总结趋势。",
  },
  async () => {
    return {
      messages: [
        {
          role: "user",
          content: {
            type: "text",
            text:
              "获取知乎当前热榜内容。请使用 zhihu_hot_list 工具获取热门内容，然后按以下结构总结：\n" +
              "1. 热榜 TOP 5 及其简要内容\n" +
              "2. 当前主要话题趋势（科技/社会/娱乐等分布）\n" +
              "3. 值得关注的新兴话题",
          },
        },
      ],
    };
  }
);

server.registerPrompt(
  "zhihu_zhida_prompt",
  {
    description: "知乎直答提示模板。输入问题，调用直答 Agent 获取 AI 回答。",
    argsSchema: {
      question: z.string().min(1).max(2000).describe("要提问的问题"),
    },
  },
  async (args) => {
    const question = String(args.question);
    return {
      messages: [
        {
          role: "user",
          content: {
            type: "text",
            text: `请使用 zhihu_zhida 工具向知乎直答 Agent 提问：「${question}」。获取回答后，评估回答质量并补充你的见解。`,
          },
        },
      ],
    };
  }
);

// ============================================================
// 启动
// ============================================================

async function main() {
  const transport = new StdioServerTransport();
  await server.connect(transport);
  console.error("zhihu-mcp v0.3.0 (官方 API) 已启动 — 5 tools, 2 resources, 3 prompts");
}

main().catch((e) => {
  console.error("zhihu-mcp 启动失败:", e);
  process.exit(1);
});
