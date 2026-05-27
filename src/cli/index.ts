#!/usr/bin/env node

import { Command } from "commander";
import { OfficialApiClient, RotatingOfficialApiClient, OfficialApiError } from "../core";
import { normalizeOfficialSearch, normalizeOfficialHotList, normalizeOfficialZhida } from "../core/official-api-schema";

function createClient(): OfficialApiClient | RotatingOfficialApiClient {
  const raw = (process.env.ZHIHU_ACCESS_SECRET || "").trim();
  const keys = raw.split(",").map((k) => k.trim()).filter(Boolean);
  if (keys.length > 1) {
    return new RotatingOfficialApiClient(keys);
  }
  return new OfficialApiClient({ accessSecret: keys[0] || "" });
}

function formatJson(data: unknown): void {
  console.log(JSON.stringify(data, null, 2));
}

const program = new Command();

program
  .name("zhihu")
  .description("知乎 CLI 工具 - 官方开放平台 API")
  .version("0.2.0");

program
  .command("verify")
  .description("验证 ZHIHU_ACCESS_SECRET 是否有效")
  .action(async () => {
    const client = createClient();
    if (!client.isConfigured()) {
      console.error("错误: 未配置 ZHIHU_ACCESS_SECRET 环境变量");
      process.exit(1);
    }
    const result = await client.verifyAccess();
    formatJson(result);
  });

program
  .command("search")
  .description("知乎站内搜索")
  .argument("<keyword>", "搜索关键词")
  .option("-t, --type <type>", "搜索类型 (general|question|answer|article)", "general")
  .option("-l, --limit <count>", "结果数量 (1-20)", "10")
  .option("-o, --offset <offset>", "分页偏移", "0")
  .action(async (keyword, options) => {
    const client = createClient();
    try {
      const raw = await client.zhihuSearch({
        query: keyword,
        type: options.type as "general" | "question" | "answer" | "article",
        limit: parseInt(options.limit),
        offset: parseInt(options.offset),
      });
      const result = normalizeOfficialSearch(raw, { limit: parseInt(options.limit) });
      formatJson({ ok: true, data: result.data, meta: result.meta });
    } catch (err: unknown) {
      if (err instanceof OfficialApiError) {
        formatJson({ ok: false, error: { code: err.code, message: err.message } });
        process.exit(1);
      }
      throw err;
    }
  });

program
  .command("hot")
  .description("获取知乎热榜")
  .option("-l, --limit <count>", "返回数量 (1-50)", "20")
  .option("-o, --offset <offset>", "分页偏移", "0")
  .action(async (options) => {
    const client = createClient();
    try {
      const raw = await client.hotList({
        limit: parseInt(options.limit),
        offset: parseInt(options.offset),
      });
      const result = normalizeOfficialHotList(raw, { limit: parseInt(options.limit) });
      formatJson({ ok: true, data: result.data, meta: result.meta });
    } catch (err: unknown) {
      if (err instanceof OfficialApiError) {
        formatJson({ ok: false, error: { code: err.code, message: err.message } });
        process.exit(1);
      }
      throw err;
    }
  });

program
  .command("global-search")
  .description("全网搜索")
  .argument("<keyword>", "搜索关键词")
  .option("-l, --limit <count>", "结果数量 (1-20)", "10")
  .option("-o, --offset <offset>", "分页偏移", "0")
  .action(async (keyword, options) => {
    const client = createClient();
    try {
      const raw = await client.globalSearch({
        query: keyword,
        limit: parseInt(options.limit),
        offset: parseInt(options.offset),
      });
      const result = normalizeOfficialSearch(raw, { limit: parseInt(options.limit) });
      formatJson({ ok: true, data: result.data, meta: result.meta });
    } catch (err: unknown) {
      if (err instanceof OfficialApiError) {
        formatJson({ ok: false, error: { code: err.code, message: err.message } });
        process.exit(1);
      }
      throw err;
    }
  });

program
  .command("zhida")
  .description("知乎直答 Agent")
  .argument("<query>", "提问内容")
  .action(async (query) => {
    const client = createClient();
    try {
      const raw = await client.zhida({ query });
      const result = normalizeOfficialZhida(raw);
      formatJson({ ok: true, data: result.data, meta: result.meta });
    } catch (err: unknown) {
      if (err instanceof OfficialApiError) {
        formatJson({ ok: false, error: { code: err.code, message: err.message } });
        process.exit(1);
      }
      throw err;
    }
  });

program.parse();
