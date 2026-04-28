import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { z } from "zod";
import { ZhihuClient } from "../core";

let zhihu: ZhihuClient | null = null;

function getClient(): ZhihuClient {
  if (!zhihu) {
    zhihu = new ZhihuClient(undefined, true);
  }
  return zhihu;
}

// -- 串行队列：防止并发请求污染共享 browser page --
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
        // 速率限制：确保请求之间有最小间隔
        await rateLimit();
        resolve(await fn());
      } catch (e) {
        reject(e);
      }
    });
    processQueue();
  });
}

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
const MIN_INTERVAL_MS = 500;

function rateLimit(): Promise<void> {
  const now = Date.now();
  const elapsed = now - lastRequestTime;
  if (elapsed < MIN_INTERVAL_MS) {
    const delay = MIN_INTERVAL_MS - elapsed;
    lastRequestTime = Date.now() + delay;
    return new Promise((r) => setTimeout(r, delay));
  }
  lastRequestTime = now;
  return Promise.resolve();
}

// -- 退出清理 --
process.on("SIGINT", async () => {
  if (zhihu) await zhihu.stopBrowser();
  process.exit(0);
});
process.on("SIGTERM", async () => {
  if (zhihu) await zhihu.stopBrowser();
  process.exit(0);
});

// -- 创建 MCP Server --

const server = new McpServer(
  {
    name: "zhihu-mcp",
    version: "0.1.0",
  },
  {
    capabilities: {
      tools: {},
      resources: {},
    },
  }
);

// -- 注册工具 --

server.registerTool(
  "zhihu_login_check",
  {
    description: "检查知乎登录状态。不会启动浏览器——仅在浏览器已运行时检查。",
    inputSchema: {},
  },
  async () => {
    const client = getClient();
    if (!client.browser || !client.browser.isRunning()) {
      return {
        content: [{
          type: "text",
          text: JSON.stringify({
            ok: true,
            data: { logged_in: false, browser_running: false },
            meta: { action: "请使用 zhihu_open_login_page 打开登录页面" },
          }),
        }],
      };
    }
    const authed = await client.auth.isAuthenticated();
    if (authed) {
      const profile = await client.auth.getProfile();
      return {
        content: [{
          type: "text",
          text: JSON.stringify({
            ok: true,
            data: { logged_in: true, user: profile?.name || null },
          }),
        }],
      };
    }
    return {
      content: [{
        type: "text",
        text: JSON.stringify({
          ok: true,
          data: { logged_in: false, browser_running: true },
          meta: { action: "请在打开的浏览器窗口中完成登录" },
        }),
      }],
    };
  }
);

server.registerTool(
  "zhihu_open_login_page",
  {
    description: "打开知乎登录页面。启动专用浏览器并导航到知乎登录页，用户手动完成登录后即可使用其他工具。",
    inputSchema: {},
  },
  async () => {
    const client = getClient();
    await enqueue(() => client.auth.openLoginPage());
    return {
      content: [{
        type: "text",
        text: JSON.stringify({
          ok: true,
          data: { message: "浏览器已打开知乎登录页，请在浏览器窗口中完成登录" },
          meta: { action: "登录完成后可使用 zhihu_login_check 验证状态" },
        }),
      }],
    };
  }
);

server.registerTool(
  "zhihu_get_profile",
  {
    description: "获取当前登录用户的个人信息（用户名、简介等）。",
    inputSchema: {},
  },
  async () => {
    const client = getClient();
    const profile = await enqueue(() => client.auth.getProfile());
    if (!profile) {
      return {
        content: [{
          type: "text",
          text: JSON.stringify({ ok: false, error: { code: "NOT_LOGGED_IN", message: "获取用户信息失败或未登录" } }),
        }],
      };
    }
    return {
      content: [{
        type: "text",
        text: JSON.stringify({ ok: true, data: profile }),
      }],
    };
  }
);

server.registerTool(
  "zhihu_search",
  {
    description: "搜索知乎内容（问题、回答、文章等）。",
    inputSchema: {
      keyword: z.string().min(1).max(200).describe("搜索关键词（1-200字符）"),
      type: z.enum(["general", "question", "answer", "article"]).optional().describe("搜索类型"),
      limit: z.number().int().min(1).max(30).optional().describe("返回结果数量（1-30）"),
    },
  },
  async (args) => {
    const keyword = args.keyword;
    const type = args.type || "general";
    const limit = args.limit || 10;

    const client = getClient();
    const results = await enqueue(() => client.search.search(keyword, type, limit));
    return {
      content: [{
        type: "text",
        text: JSON.stringify({
          ok: true,
          data: results,
          meta: { source: "browser_page", count: results.length },
        }),
      }],
    };
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
    const client = getClient();
    const stories = await enqueue(() => client.feed.getHotStories());
    const data = stories.slice(0, limit).map((s: any) => ({
      title: s.target?.title || "(无标题)",
      excerpt: s.target?.excerpt || s.detail_text || "",
      answer_count: s.target?.answer_count || 0,
      trend: s.trend || 0,
      url: s.target?.url || "",
    }));
    return {
      content: [{
        type: "text",
        text: JSON.stringify({
          ok: true,
          data,
          meta: { total_available: stories.length, returned: data.length },
        }),
      }],
    };
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
    return {
      content: [{
        type: "text",
        text: JSON.stringify({
          ok: true,
          data,
          meta: { count: data.length, source: "api" },
        }),
      }],
    };
  }
);

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
    return {
      content: [{
        type: "text",
        text: JSON.stringify({
          ok: true,
          data,
          warnings: answers.length < answerLimit ? ["返回回答数少于请求数，可能是接口分页或权限限制"] : [],
          meta: { source: "api", answers_returned: answers.length, answers_requested: answerLimit },
        }),
      }],
    };
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
    const client = getClient();
    const answer = await enqueue(() => client.feed.getAnswerDetail(Number(answerId)));
    let comments: any[] = [];
    if (commentLimit > 0) {
      comments = await enqueue(() => client.feed.getAnswerComments(answerId, commentLimit));
    }
    return {
      content: [{
        type: "text",
        text: JSON.stringify({
          ok: true,
          data: { ...answer, comments },
          meta: { source: "api", comments_returned: comments.length, comments_requested: commentLimit },
        }),
      }],
    };
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
    const client = getClient();
    const article = await enqueue(() => client.feed.getArticleDetail(articleId));
    let comments: any[] = [];
    if (commentLimit > 0) {
      comments = await enqueue(() => client.feed.getArticleComments(articleId, commentLimit));
    }
    return {
      content: [{
        type: "text",
        text: JSON.stringify({
          ok: true,
          data: { ...article, comments },
          meta: { source: "api", content_truncated: article.content_truncated ?? false, comments_returned: comments.length, comments_requested: commentLimit },
        }),
      }],
    };
  }
);

// -- 注册资源 --

server.registerResource(
  "知乎热榜",
  "zhihu://hot",
  { description: "知乎热榜内容", mimeType: "application/json" },
  async () => {
    const client = getClient();
    const stories = await enqueue(() => client.feed.getHotStories());
    return {
      contents: [{
        uri: "zhihu://hot",
        mimeType: "application/json",
        text: JSON.stringify({ ok: true, data: stories }),
      }],
    };
  }
);

server.registerResource(
  "知乎推荐流",
  "zhihu://feed",
  { description: "知乎推荐内容", mimeType: "application/json" },
  async () => {
    const client = getClient();
    const items = await enqueue(() => client.feed.getFeed(10));
    return {
      contents: [{
        uri: "zhihu://feed",
        mimeType: "application/json",
        text: JSON.stringify({ ok: true, data: items }),
      }],
    };
  }
);

server.registerResource(
  "知乎用户信息",
  "zhihu://profile",
  { description: "当前登录用户的信息", mimeType: "application/json" },
  async () => {
    const client = getClient();
    const profile = await enqueue(() => client.auth.getProfile());
    return {
      contents: [{
        uri: "zhihu://profile",
        mimeType: "application/json",
        text: JSON.stringify({ ok: true, data: profile }),
      }],
    };
  }
);

// -- 启动 --

async function main() {
  const transport = new StdioServerTransport();
  await server.connect(transport);
  console.error("zhihu-mcp v0.1.0 启动成功，等待 MCP 客户端连接...");
}

main().catch((e) => {
  console.error("MCP Server 启动失败:", e);
  process.exit(1);
});
