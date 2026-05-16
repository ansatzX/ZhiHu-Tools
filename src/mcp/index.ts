import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { z } from "zod";
import { ZhihuClient } from "../core";
import { getHumanVerificationStatus, type McpErrorResult } from "./error-handler";
import { runMcpTool } from "./tool-runner";

// ============================================================
// 全局状态
// ============================================================

let zhihu: ZhihuClient | null = null;

function getClient(): ZhihuClient {
  if (!zhihu) {
    zhihu = new ZhihuClient(undefined, true, { headless: true });
  }
  return zhihu;
}

// ============================================================
// 串行队列：防止并发请求污染共享 browser page
// ============================================================

type Task = () => Promise<void>;
const queue: Task[] = [];
let processing = false;

function processQueue() {
  if (processing) return;
  processing = true;
  const next = () => {
    if (queue.length === 0) {
      processing = false;
      return;
    }
    queue.shift()!().finally(next);
  };
  next();
}

function enqueue<T>(fn: () => Promise<T>): Promise<T> {
  return new Promise((resolve, reject) => {
    queue.push(async () => {
      try {
        await rateLimit();
        resolve(await fn());
      } catch (e) {
        reject(e);
      }
    });
    processQueue();
  });
}

// ============================================================
// 工具函数
// ============================================================

function extractNumericId(input: string): string {
  const match = input.match(/\d+/);
  if (!match) throw new Error("ID 必须包含数字");
  return match[0].replace(/^0+/, "") || "0";
}

const IdInput = z.string()
  .min(1)
  .refine((s) => /\d+/.test(s), "必须包含数字 ID")
  .describe("问题/文章 ID（数字或包含数字的 URL）");

let lastRequestTime = 0;
const MIN_INTERVAL_MS = 2000;
const JITTER_MS = 1000;
const TOOL_TIMEOUT_MS = 45_000;

function rateLimit(): Promise<void> {
  const now = Date.now();
  const elapsed = now - lastRequestTime;
  const targetInterval = MIN_INTERVAL_MS + Math.floor(Math.random() * JITTER_MS);
  if (elapsed < targetInterval) {
    const delay = targetInterval - elapsed;
    lastRequestTime = Date.now() + delay;
    return new Promise((r) => setTimeout(r, delay));
  }
  lastRequestTime = now;
  return Promise.resolve();
}

// ============================================================
// MCP 结果构造器
// ============================================================

/** 成功的 CallToolResult */
function textResult(data: unknown) {
  return {
    content: [{
      type: "text" as const,
      text: JSON.stringify(data),
    }],
  };
}

/** 错误的 CallToolResult（MCP 规范：isError: true） */
function errorResult(err: McpErrorResult) {
  return {
    isError: true as const,
    content: [{
      type: "text" as const,
      text: JSON.stringify(err),
    }],
  };
}

/** Resource handler 专用：返回 ReadResourceResult { contents: [...] } */
function resourceResult(uri: string, data: unknown) {
  return {
    contents: [{
      uri,
      mimeType: "application/json" as const,
      text: JSON.stringify(data),
    }],
  };
}

// ============================================================
// 统一工具执行入口
// ============================================================

/**
 * 超时 + 错误处理包装。
 * 成功返回 CallToolResult；失败返回带 isError:true 的 CallToolResult。
 */
async function runTool(
  fn: () => Promise<unknown>,
  fallbackCode: string,
  fallbackMessage: string,
  verificationUrl?: string,
  toolTimeoutMs?: number
) {
  const result = await runMcpTool(
    fn,
    getClient(),
    fallbackCode,
    fallbackMessage,
    verificationUrl,
    { toolTimeoutMs: toolTimeoutMs ?? TOOL_TIMEOUT_MS }
  );
  // runMcpTool 在错误时返回 McpErrorResult { ok: false, error: {...} }
  if (result && typeof result === "object" && "ok" in result && (result as McpErrorResult).ok === false) {
    return errorResult(result as McpErrorResult);
  }
  return result as ReturnType<typeof textResult>;
}

// ============================================================
// 进程退出清理
// ============================================================

process.on("SIGINT", async () => {
  if (zhihu) await zhihu.stopBrowser();
  process.exit(0);
});
process.on("SIGTERM", async () => {
  if (zhihu) await zhihu.stopBrowser();
  process.exit(0);
});

// ============================================================
// 创建 MCP Server
// ============================================================

const server = new McpServer(
  { name: "zhihu-mcp", version: "0.1.0" },
  { capabilities: { tools: {}, resources: {} } }
);

// ============================================================
// 注册工具
// ============================================================

// -- 登录与验证 --

server.registerTool(
  "zhihu_login_check",
  {
    description: "检查知乎登录状态。不会启动浏览器——仅在浏览器已运行时检查。",
    // 无参数：省略 inputSchema，SDK 自动处理为无参数工具
  },
  async () => {
    const client = getClient();
    if (!client.browser || !client.browser.isRunning()) {
      return textResult({
        ok: true,
        data: { logged_in: false, browser_running: false },
        meta: { action: "请使用 zhihu_open_login_page 打开登录页面" },
      });
    }
    const authed = await client.auth.isAuthenticated();
    if (authed) {
      const profile = await client.auth.getProfile();
      await client.stopBrowser();
      return textResult({
        ok: true,
        data: { logged_in: true, user: profile?.name || null },
      });
    }
    return textResult({
      ok: true,
      data: { logged_in: false, browser_running: true },
      meta: { action: "请在打开的浏览器窗口中完成登录" },
    });
  }
);

server.registerTool(
  "zhihu_open_login_page",
  {
    description: "打开知乎登录页面。启动专用浏览器并导航到知乎登录页，用户手动完成登录后即可使用其他工具。",
  },
  async () => {
    return runTool(async () => {
      const client = getClient();
      await enqueue(() => client.auth.openLoginPage());
      return textResult({
        ok: true,
        data: { message: "浏览器已打开知乎登录页，请在浏览器窗口中完成登录" },
        meta: { action: "登录完成后可使用 zhihu_login_check 验证状态" },
      });
    }, "OPEN_LOGIN_FAILED", "打开登录页失败", "https://www.zhihu.com/signin");
  }
);

server.registerTool(
  "zhihu_login_qrcode",
  {
    description: "扫码登录知乎。启动 headless 浏览器访问登录页，返回二维码图片（base64）。用户用知乎 App 扫码后自动完成登录。无需弹出浏览器窗口。",
  },
  async () => {
    return runTool(async () => {
      const client = getClient();
      // 确保浏览器启动并导航到登录页
      await enqueue(async () => {
        if (!client.browser!.isRunning()) {
          await client.browser!.start("https://www.zhihu.com/signin", { headless: true });
        } else {
          await client.browser!.navigate("https://www.zhihu.com/signin");
        }
      });

      // 等待二维码渲染
      await new Promise(r => setTimeout(r, 3000));

      // 提取二维码图片 base64
      const qrBase64 = await enqueue(() =>
        client.browser!.evaluate<string>(`
          (() => {
            const img = document.querySelector('.Qrcode-qrcode img')
              || document.querySelector('.qrcode-img img')
              || document.querySelector('img[src*="qrcode"]');
            if (!img) return null;
            const src = img.src || '';
            if (src.startsWith('data:')) return src.split(',')[1] || null;
            return null;
          })()
        `)
      );

      if (!qrBase64) {
        // 尝试截取二维码区域
        const screenshot = await enqueue(() =>
          client.browser!.evaluate<string>(`
            (() => {
              const el = document.querySelector('.Qrcode-qrcode')
                || document.querySelector('.qrcode-img')
                || document.querySelector('[class*="qrcode"]');
              if (!el) return null;
              // 返回元素位置信息供后续截图
              const rect = el.getBoundingClientRect();
              return JSON.stringify({ x: rect.x, y: rect.y, w: rect.width, h: rect.height });
            })()
          `)
        );

        return {
          isError: true as const,
          content: [{ type: "text" as const, text: JSON.stringify({
            ok: false,
            error: { code: "QR_NOT_FOUND", message: "无法提取二维码，请使用 zhihu_open_login_page 弹出浏览器手动登录" },
            debug: screenshot,
          }) }],
        };
      }

      // 轮询等待扫码完成（最多 120 秒）
      const deadline = Date.now() + 120_000;
      let loggedIn = false;
      while (Date.now() < deadline) {
        await new Promise(r => setTimeout(r, 3000));
        try {
          const url = await client.browser!.evaluate<string>("window.location.href");
          if (!url.includes("/signin") && !url.includes("/sign_in")) {
            loggedIn = true;
            break;
          }
          // 检查是否已设置登录 cookie
          const cookies = await client.browser!.getAllCookies();
          if (cookies.some(c => c.name === "z_c0" && c.value.length > 10)) {
            loggedIn = true;
            break;
          }
        } catch {}
      }

      if (loggedIn) {
        return textResult({
          ok: true,
          data: { logged_in: true },
          meta: { action: "扫码登录成功，可以使用其他知乎工具" },
        });
      }

      return {
        isError: true as const,
        content: [{ type: "text" as const, text: JSON.stringify({
          ok: false,
          error: { code: "QR_TIMEOUT", message: "扫码超时（120秒），请重新调用此工具获取新二维码" },
        }) }],
      };
    }, "QR_LOGIN_FAILED", "扫码登录失败", undefined, 150_000);
  }
);

server.registerTool(
  "zhihu_human_verification_status",
  {
    description: "检查自动弹出的人机验证浏览器状态。返回 WAIT_FOR_BROWSER_CLOSE 或 RERUN_READY，供 agent 决定是否重跑上一次工具。",
  },
  async () => {
    return textResult(getHumanVerificationStatus(getClient()));
  }
);

server.registerTool(
  "zhihu_refresh_session",
  {
    description: "刷新知乎会话。重启浏览器（使用已保存的 profile），访问知乎首页验证登录状态。当工具连续返回 403 或人机验证后使用。",
  },
  async () => {
    const client = getClient();
    // 停止当前浏览器
    await client.stopBrowser();
    // 用已有 profile 重新启动
    return runTool(async () => {
      await enqueue(() => client.browser!.start("https://www.zhihu.com/"));
      const authed = await enqueue(() => client.auth.isAuthenticated());
      if (!authed) {
        return textResult({
          ok: false,
          data: { refreshed: false, logged_in: false },
          meta: { action: "登录已过期，请使用 zhihu_open_login_page 重新登录" },
        });
      }
      return textResult({
        ok: true,
        data: { refreshed: true, logged_in: true },
        meta: { action: "会话已刷新，可以重新尝试之前的工具" },
      });
    }, "REFRESH_FAILED", "刷新会话失败");
  }
);

server.registerTool(
  "zhihu_get_profile",
  {
    description: "获取当前登录用户的个人信息（用户名、简介等）。",
  },
  async () => {
    return runTool(async () => {
      const client = getClient();
      const profile = await enqueue(() => client.auth.getProfile());
      if (!profile) {
        return {
          isError: true as const,
          content: [{ type: "text" as const, text: JSON.stringify({ ok: false, error: { code: "NOT_LOGGED_IN", message: "获取用户信息失败或未登录" } }) }],
        };
      }
      return textResult({ ok: true, data: profile });
    }, "GET_PROFILE_FAILED", "获取用户信息失败", "https://www.zhihu.com/");
  }
);

// -- 搜索与浏览 --

server.registerTool(
  "zhihu_search",
  {
    description: "搜索知乎内容（问题、回答、文章等）。",
    inputSchema: {
      keyword: z.string().min(1).max(200).describe("搜索关键词（1-200字符）"),
      type: z.enum(["general", "question", "answer", "article"]).optional().describe("搜索类型：general=综合，question=问题，article=文章"),
      limit: z.number().int().min(1).max(30).optional().describe("返回结果数量（1-30）"),
    },
  },
  async (args) => {
    const keyword = args.keyword;
    const type = args.type || "general";
    const limit = args.limit || 10;
    const searchType = type === "question" ? "question" : type === "article" ? "article" : "content";
    const verificationUrl = `https://www.zhihu.com/search?type=${searchType}&q=${encodeURIComponent(keyword)}`;

    return runTool(async () => {
      const client = getClient();
      const results = await enqueue(() => client.search.search(keyword, type, limit));
      return textResult({
        ok: true,
        data: results,
        meta: { source: "browser_page", count: results.length },
      });
    }, "SEARCH_FAILED", "搜索失败", verificationUrl);
  }
);

server.registerTool(
  "zhihu_hot_stories",
  {
    description: "获取知乎热榜当前热门内容。",
    inputSchema: {
      limit: z.number().int().min(1).max(50).optional().describe("显示数量（1-50）"),
    },
  },
  async (args) => {
    const limit = args.limit || 20;
    return runTool(async () => {
      const client = getClient();
      const stories = await enqueue(() => client.feed.getHotStories());
      const data = stories.slice(0, limit).map((s: any) => ({
        title: s.target?.title || "(无标题)",
        excerpt: s.target?.excerpt || s.detail_text || "",
        answer_count: s.target?.answer_count || 0,
        trend: s.trend || 0,
        url: s.target?.url || "",
      }));
      return textResult({
        ok: true,
        data,
        meta: { total_available: stories.length, returned: data.length },
      });
    }, "HOT_STORIES_FAILED", "获取热榜失败", "https://www.zhihu.com/hot");
  }
);

server.registerTool(
  "zhihu_get_feed",
  {
    description: "获取知乎首页推荐内容流。需要登录。",
    inputSchema: {
      limit: z.number().int().min(1).max(30).optional().describe("数量（1-30）"),
    },
  },
  async (args) => {
    const limit = args.limit || 10;
    return runTool(async () => {
      const client = getClient();
      const items = await enqueue(() => client.feed.getFeed(limit));
      const data = items.map((item: any) => ({
        type: item.type,
        verb: item.verb,
        created_time: item.created_time,
        title: item.target?.title || item.target?.question?.title || "(无标题)",
        excerpt: item.target?.excerpt || "",
        url: item.target?.url || "",
        author: item.target?.author?.name || "匿名",
        voteup_count: item.target?.voteup_count || 0,
      }));
      return textResult({
        ok: true,
        data,
        meta: { count: data.length, source: "api" },
      });
    }, "FEED_FAILED", "获取推荐流失败", "https://www.zhihu.com/");
  }
);

// -- 内容详情 --

server.registerTool(
  "zhihu_get_question",
  {
    description: "获取问题详情及回答摘要。每条回答包含链接、赞同数、评论数；可用 zhihu_get_answer 获取单条回答详情。",
    inputSchema: {
      question_id: IdInput,
      answer_limit: z.number().int().min(0).max(50).optional().describe("返回回答数量（0-50）"),
    },
  },
  async (args) => {
    const questionId = extractNumericId(args.question_id);
    const answerLimit = args.answer_limit ?? 5;

    return runTool(async () => {
      const client = getClient();
      const question = await enqueue(() => client.feed.getQuestionDetail(questionId));
      let answers: any[] = [];
      if (answerLimit > 0) {
        answers = await enqueue(() => client.feed.getQuestionAnswers(questionId, 0, answerLimit));
      }
      const data = {
        id: question.id || questionId,
        title: question.title || "(无标题)",
        detail: question.detail || null,
        excerpt: question.excerpt || null,
        answer_count: question.answer_count ?? null,
        follower_count: question.follower_count ?? null,
        answers: answers.map((a: any) => ({
          id: a.id ?? null,
          url: a.url || null,
          api_url: a.api_url || null,
          voteup_count: a.voteup_count ?? null,
          comment_count: a.comment_count ?? null,
          excerpt: a.excerpt || "",
          author: a.author?.name || "匿名",
        })),
        truncated: false,
      };
      return textResult({
        ok: true,
        data,
        warnings: answers.length < answerLimit ? ["返回回答数少于请求数，可能是接口分页或权限限制"] : [],
        meta: { source: "api", answers_returned: answers.length, answers_requested: answerLimit },
      });
    }, "QUESTION_FAILED", "获取问题失败", `https://www.zhihu.com/question/${questionId}`);
  }
);

server.registerTool(
  "zhihu_get_answer",
  {
    description: "获取单条知乎回答详情，可选返回评论。",
    inputSchema: {
      answer_id: IdInput,
      comment_limit: z.number().int().min(0).max(50).optional().describe("返回评论数量（0-50）"),
    },
  },
  async (args) => {
    const answerId = extractNumericId(args.answer_id);
    const commentLimit = args.comment_limit ?? 0;
    return runTool(async () => {
      const client = getClient();
      const answer = await enqueue(() => client.feed.getAnswerDetail(Number(answerId)));
      let comments: any[] = [];
      if (commentLimit > 0) {
        comments = await enqueue(() => client.feed.getAnswerComments(answerId, commentLimit));
      }
      return textResult({
        ok: true,
        data: { ...answer, comments },
        meta: { source: "api", comments_returned: comments.length, comments_requested: commentLimit },
      });
    }, "ANSWER_FAILED", "获取回答失败", `https://www.zhihu.com/answer/${answerId}`);
  }
);

server.registerTool(
  "zhihu_get_article",
  {
    description: "查看知乎专栏文章详情，可选返回评论。",
    inputSchema: {
      article_id: IdInput,
      comment_limit: z.number().int().min(0).max(50).optional().describe("返回评论数量（0-50）"),
    },
  },
  async (args) => {
    const articleId = extractNumericId(args.article_id);
    const commentLimit = args.comment_limit ?? 0;
    return runTool(async () => {
      const client = getClient();
      const article = await enqueue(() => client.feed.getArticleDetail(articleId));
      let comments: any[] = [];
      if (commentLimit > 0) {
        comments = await enqueue(() => client.feed.getArticleComments(articleId, commentLimit));
      }
      return textResult({
        ok: true,
        data: { ...article, comments },
        meta: { source: "api", content_truncated: article.content_truncated ?? false, comments_returned: comments.length, comments_requested: commentLimit },
      });
    }, "ARTICLE_FAILED", "获取文章失败", `https://zhuanlan.zhihu.com/p/${articleId}`);
  }
);

// ============================================================
// 注册资源
// Resource handler 必须返回 ReadResourceResult { contents: [...] }
// 不能复用 runTool（它返回 CallToolResult 格式）
// ============================================================

server.registerResource(
  "知乎热榜",
  "zhihu://hot",
  { description: "知乎热榜内容", mimeType: "application/json" },
  async () => {
    try {
      const client = getClient();
      const stories = await enqueue(() => client.feed.getHotStories());
      return resourceResult("zhihu://hot", { ok: true, data: stories });
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : "获取热榜资源失败";
      return resourceResult("zhihu://hot", { ok: false, error: { code: "HOT_RESOURCE_FAILED", message: msg } });
    }
  }
);

server.registerResource(
  "知乎推荐流",
  "zhihu://feed",
  { description: "知乎推荐内容", mimeType: "application/json" },
  async () => {
    try {
      const client = getClient();
      const items = await enqueue(() => client.feed.getFeed(10));
      return resourceResult("zhihu://feed", { ok: true, data: items });
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : "获取推荐流资源失败";
      return resourceResult("zhihu://feed", { ok: false, error: { code: "FEED_RESOURCE_FAILED", message: msg } });
    }
  }
);

server.registerResource(
  "知乎用户信息",
  "zhihu://profile",
  { description: "当前登录用户的信息", mimeType: "application/json" },
  async () => {
    try {
      const client = getClient();
      const profile = await enqueue(() => client.auth.getProfile());
      return resourceResult("zhihu://profile", { ok: true, data: profile });
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : "获取用户资源失败";
      return resourceResult("zhihu://profile", { ok: false, error: { code: "PROFILE_RESOURCE_FAILED", message: msg } });
    }
  }
);

// ============================================================
// 启动
// ============================================================

async function main() {
  const transport = new StdioServerTransport();
  transport.onclose = async () => {
    if (zhihu) await zhihu.stopBrowser();
    process.exit(0);
  };
  await server.connect(transport);
  console.error("zhihu-mcp v0.1.0 已启动");
}

main().catch((e) => {
  console.error("MCP Server 启动失败:", e);
  process.exit(1);
});
