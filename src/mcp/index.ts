import { ZhihuClient } from "../core";

let zhihu: ZhihuClient | null = null;

function getClient(): ZhihuClient {
  if (!zhihu) {
    zhihu = new ZhihuClient(undefined, true); // useBrowser: true
  }
  return zhihu;
}

// 退出时清理浏览器进程
process.on("exit", () => {
  zhihu?.stopBrowser();
});
process.on("SIGINT", () => {
  zhihu?.stopBrowser();
  process.exit(0);
});
process.on("SIGTERM", () => {
  zhihu?.stopBrowser();
  process.exit(0);
});

type ToolHandler = (args: any) => Promise<{ content: Array<{ type: string; text: string }>; isError?: boolean }>;

const toolHandlers: Record<string, ToolHandler> = {};

const SERVER_NAME = "zhihu-mcp";
const SERVER_VERSION = "0.1.0";

let messageId = 0;

function sendMessage(msg: any) {
  const line = JSON.stringify(msg) + "\n";
  process.stdout.write(line);
}

function sendLog(msg: string) {
  process.stderr.write(msg + "\n");
}

toolHandlers["zhihu_login_check"] = async (_args) => {
  const client = getClient();
  const authed = await client.auth.isAuthenticated();
  if (authed) {
    const profile = await client.auth.getProfile();
    return {
      content: [
        {
          type: "text",
          text: profile ? `已登录: ${profile.name}` : "已登录（获取用户信息失败）",
        },
      ],
    };
  }
  return { content: [{ type: "text", text: "未登录" }] };
};

toolHandlers["zhihu_get_profile"] = async (_args) => {
  const client = getClient();
  const profile = await client.auth.getProfile();
  if (!profile) {
    return { content: [{ type: "text", text: "获取用户信息失败或未登录" }] };
  }
  return { content: [{ type: "text", text: JSON.stringify(profile, null, 2) }] };
};

toolHandlers["zhihu_search"] = async (args) => {
  const client = getClient();
  const results = await client.search.search(
    args.keyword,
    args.type || "general",
    args.limit || 10
  );
  return { content: [{ type: "text", text: JSON.stringify(results, null, 2) }] };
};

toolHandlers["zhihu_hot_stories"] = async (args) => {
  const client = getClient();
  const stories = await client.feed.getHotStories();
  const limit = args.limit || 20;
  const data = stories.slice(0, limit).map((s: any) => ({
    title: s.target?.title || "(无标题)",
    excerpt: s.target?.excerpt || s.detail_text || "",
    answerCount: s.target?.answer_count || 0,
    trend: s.trend || 0,
  }));
  return { content: [{ type: "text", text: JSON.stringify(data, null, 2) }] };
};

toolHandlers["zhihu_get_feed"] = async (args) => {
  const client = getClient();
  const items = await client.feed.getFeed(args.limit || 10);
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
  return { content: [{ type: "text", text: JSON.stringify(data, null, 2) }] };
};

toolHandlers["zhihu_get_question"] = async (args) => {
  const client = getClient();
  const question = await client.feed.getQuestionDetail(args.question_id);
  const answers = await client.feed.getQuestionAnswers(
    args.question_id,
    0,
    args.answer_limit || 5
  );
  const data = {
    id: question.id,
    title: question.title,
    detail: question.detail,
    excerpt: question.excerpt,
    answer_count: question.answer_count,
    follower_count: question.follower_count,
    answers: answers.map((a: any) => ({
      id: a.id,
      voteup_count: a.voteup_count,
      excerpt: a.excerpt || "",
      author: a.author?.name || "匿名",
    })),
  };
  return { content: [{ type: "text", text: JSON.stringify(data, null, 2) }] };
};

toolHandlers["zhihu_get_article"] = async (args) => {
  const client = getClient();
  const article = await client.feed.getArticleDetail(args.article_id);
  return { content: [{ type: "text", text: JSON.stringify(article, null, 2) }] };
};

const tools = [
  {
    name: "zhihu_login_check",
    description: "检查知乎登录状态",
    inputSchema: { type: "object", properties: {} },
  },
  {
    name: "zhihu_get_profile",
    description: "获取当前登录用户的个人信息",
    inputSchema: { type: "object", properties: {} },
  },
  {
    name: "zhihu_search",
    description: "搜索知乎内容（问题、回答、文章等）",
    inputSchema: {
      type: "object",
      properties: {
        keyword: { type: "string", description: "搜索关键词" },
        type: {
          type: "string",
          description: "搜索类型",
          enum: ["general", "question", "answer", "article"],
        },
        limit: { type: "number", description: "返回结果数量" },
      },
      required: ["keyword"],
    },
  },
  {
    name: "zhihu_hot_stories",
    description: "获取知乎热榜",
    inputSchema: {
      type: "object",
      properties: {
        limit: { type: "number", description: "显示数量" },
      },
    },
  },
  {
    name: "zhihu_get_feed",
    description: "获取知乎推荐流",
    inputSchema: {
      type: "object",
      properties: {
        limit: { type: "number", description: "数量" },
      },
    },
  },
  {
    name: "zhihu_get_question",
    description: "获取问题详情和回答",
    inputSchema: {
      type: "object",
      properties: {
        question_id: { type: "number", description: "问题 ID" },
        answer_limit: { type: "number", description: "返回回答数量" },
      },
      required: ["question_id"],
    },
  },
  {
    name: "zhihu_get_article",
    description: "查看文章详情",
    inputSchema: {
      type: "object",
      properties: {
        article_id: { type: "number", description: "文章 ID" },
      },
      required: ["article_id"],
    },
  },
];

const resources = [
  {
    uri: "zhihu://hot",
    name: "知乎热榜",
    description: "知乎热榜内容",
    mimeType: "application/json",
  },
  {
    uri: "zhihu://feed",
    name: "知乎推荐流",
    description: "知乎推荐内容",
    mimeType: "application/json",
  },
  {
    uri: "zhihu://profile",
    name: "知乎用户信息",
    description: "当前登录用户的信息",
    mimeType: "application/json",
  },
];

async function handleInitialize(msg: any) {
  sendMessage({
    jsonrpc: "2.0",
    id: msg.id,
    result: {
      protocolVersion: "2024-11-05",
      capabilities: {
        tools: {},
        resources: {},
      },
      serverInfo: {
        name: SERVER_NAME,
        version: SERVER_VERSION,
      },
    },
  });
  // Send initialized notification
  sendMessage({
    jsonrpc: "2.0",
    method: "notifications/initialized",
  });
}

async function handleListTools(msg: any) {
  sendMessage({
    jsonrpc: "2.0",
    id: msg.id,
    result: { tools },
  });
}

async function handleCallTool(msg: any) {
  const { name, arguments: args } = msg.params;
  const handler = toolHandlers[name];
  if (!handler) {
    sendMessage({
      jsonrpc: "2.0",
      id: msg.id,
      error: { code: -32601, message: `未知工具: ${name}` },
    });
    return;
  }
  try {
    const result = await handler(args || {});
    sendMessage({
      jsonrpc: "2.0",
      id: msg.id,
      result,
    });
  } catch (e: any) {
    sendMessage({
      jsonrpc: "2.0",
      id: msg.id,
      result: {
        isError: true,
        content: [{ type: "text", text: `错误: ${e.message}` }],
      },
    });
  }
}

async function handleListResources(msg: any) {
  sendMessage({
    jsonrpc: "2.0",
    id: msg.id,
    result: { resources },
  });
}

async function handleReadResource(msg: any) {
  const uri = msg.params?.uri || "";
  try {
    const client = getClient();
    let text = "";

    if (uri === "zhihu://hot") {
      const stories = await client.feed.getHotStories();
      text = JSON.stringify(stories, null, 2);
    } else if (uri === "zhihu://feed") {
      const items = await client.feed.getFeed(10);
      text = JSON.stringify(items, null, 2);
    } else if (uri === "zhihu://profile") {
      const profile = await client.auth.getProfile();
      text = JSON.stringify(profile, null, 2);
    } else {
      throw new Error(`未知资源: ${uri}`);
    }

    sendMessage({
      jsonrpc: "2.0",
      id: msg.id,
      result: {
        contents: [{ uri, mimeType: "application/json", text }],
      },
    });
  } catch (e: any) {
    sendMessage({
      jsonrpc: "2.0",
      id: msg.id,
      result: {
        contents: [{ uri, mimeType: "text/plain", text: `错误: ${e.message}` }],
      },
    });
  }
}

async function handleMessage(msg: any) {
  if (!msg || !msg.jsonrpc) return;

  if (msg.method === "initialize") {
    await handleInitialize(msg);
  } else if (msg.method === "notifications/initialized") {
    // do nothing
  } else if (msg.method === "tools/list") {
    await handleListTools(msg);
  } else if (msg.method === "tools/call") {
    await handleCallTool(msg);
  } else if (msg.method === "resources/list") {
    await handleListResources(msg);
  } else if (msg.method === "resources/read") {
    await handleReadResource(msg);
  } else {
    sendMessage({
      jsonrpc: "2.0",
      id: msg.id,
      error: { code: -32601, message: `未知方法: ${msg.method}` },
    });
  }
}

let buffer = "";

process.stdin.on("data", (chunk: Buffer) => {
  buffer += chunk.toString();
  const lines = buffer.split("\n");
  buffer = lines.pop() || "";
  for (const line of lines) {
    const trimmed = line.trim();
    if (!trimmed) continue;
    try {
      const msg = JSON.parse(trimmed);
      handleMessage(msg).catch((e) => sendLog(`处理消息错误: ${e.message}`));
    } catch (e) {
      sendLog(`JSON 解析错误: ${e}`);
    }
  }
});

process.stdin.on("end", () => {
  process.exit(0);
});

sendLog(`${SERVER_NAME} v${SERVER_VERSION} 启动成功，等待 MCP 客户端连接...`);
