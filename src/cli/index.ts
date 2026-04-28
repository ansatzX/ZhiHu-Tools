#!/usr/bin/env node

import { Command } from "commander";
import { ZhihuClient } from "../core";

const program = new Command();

function createClient(): ZhihuClient {
  return new ZhihuClient(undefined, true); // useBrowser: true
}

async function runWithBrowser<T>(client: ZhihuClient, fn: () => Promise<T>): Promise<T> {
  try {
    return await fn();
  } finally {
    await client.stopBrowser();
  }
}

async function ensureLoggedIn(client: ZhihuClient): Promise<boolean> {
  const authed = await client.auth.isAuthenticated();
  if (!authed) {
    console.error("错误: 请先登录。运行: zhihu login");
    return false;
  }
  return true;
}

program
  .name("zhihu")
  .description("知乎 CLI 工具 - 在命令行中搜索、浏览知乎内容")
  .version("0.1.0");

program
  .command("login")
  .description("打开专用浏览器窗口登录知乎")
  .action(async () => {
    const client = createClient();
    await runWithBrowser(client, async () => {
      await client.auth.loginByBrowser(async () => {
        const readline = await import("readline");
        const rl = readline.createInterface({
          input: process.stdin,
          output: process.stdout,
        });
        await new Promise<void>((resolve) => {
          rl.question("请在浏览器窗口中完成登录，然后按回车继续...", () => {
            rl.close();
            resolve();
          });
        });
      });
      console.log("登录成功！");
    });
  });

program
  .command("logout")
  .description("退出登录并清除浏览器中的知乎 Cookie")
  .action(async () => {
    const client = createClient();
    await client.auth.logout();
    console.log("已退出登录");
    await client.stopBrowser();
  });

program
  .command("whoami")
  .description("显示当前用户信息")
  .action(async () => {
    const client = createClient();
    await runWithBrowser(client, async () => {
      if (!(await ensureLoggedIn(client))) return;
      const profile = await client.auth.getProfile();
      if (profile) {
        console.log(`用户名: ${profile.name}`);
        console.log(`简介:   ${profile.headline}`);
        console.log(`UID:    ${profile.uid}`);
        console.log(`头像:   ${profile.avatar_url}`);
      } else {
        console.log("未登录或获取信息失败");
      }
    });
  });

program
  .command("search")
  .description("搜索知乎内容")
  .argument("<keyword>", "搜索关键词")
  .option("-t, --type <type>", "搜索类型 (general|question|answer|article)", "general")
  .option("-l, --limit <count>", "结果数量", "10")
  .action(async (keyword, options) => {
    const client = createClient();
    await runWithBrowser(client, async () => {
      if (!(await ensureLoggedIn(client))) return;
      console.log(`正在搜索: "${keyword}" (类型: ${options.type})...`);
      const results = await client.search.search(
        keyword,
        options.type,
        parseInt(options.limit)
      );
      const typeLabels: Record<string, string> = {
        question: "问题",
        answer: "回答",
        article: "文章",
        user: "用户",
        pin: "想法",
      };
      results.forEach((item: any, i: number) => {
        const obj = item.object || item;
        const label = typeLabels[obj.type] || obj.type;
        console.log(
          `${i + 1}. [${label}] ${item.highlight?.title || obj.title || "(无标题)"}`
        );
        console.log(`   ${item.highlight?.description || obj.excerpt || ""}`);
        if (obj.url) console.log(`   ${obj.url}`);
        console.log();
      });
      if (results.length === 0) {
        console.log("未找到结果");
      }
    });
  });

program
  .command("hot")
  .description("获取知乎热榜")
  .option("-l, --limit <count>", "显示数量", "20")
  .action(async (options) => {
    const client = createClient();
    await runWithBrowser(client, async () => {
      if (!(await ensureLoggedIn(client))) return;
      const stories = await client.feed.getHotStories();
      const count = Math.min(parseInt(options.limit), stories.length);
      console.log("========== 知乎热榜 ==========\n");
      stories.slice(0, count).forEach((story, i) => {
        const title = story.target?.title || "(无标题)";
        const excerpt = story.target?.excerpt || story.detail_text || "";
        const trend = story.trend ? (story.trend > 0 ? "↑" : "↓") : "";
        const answerCount = story.target?.answer_count
          ? ` ${story.target.answer_count} 回答`
          : "";
        const qid = story.target?.url?.match(/\/questions\/(\d+)/)?.[1];
        console.log(`${i + 1}. ${title} ${trend}`);
        if (excerpt) console.log(`   ${excerpt.slice(0, 80)}`);
        const info = [];
        if (answerCount) info.push(answerCount.trim());
        if (qid) info.push(`ID: ${qid}`);
        if (info.length) console.log(`   ${info.join(" · ")}`);
        console.log();
      });
    });
  });

program
  .command("feed")
  .description("获取知乎推荐流")
  .option("-l, --limit <count>", "显示数量", "10")
  .action(async (options) => {
    const client = createClient();
    await runWithBrowser(client, async () => {
      if (!(await ensureLoggedIn(client))) return;
      const items = await client.feed.getFeed(parseInt(options.limit));
      console.log("========== 推荐内容 ==========\n");
      items.forEach((item, i) => {
        const target = item.target;
        const title = target.title || target.question?.title || "(无标题)";
        const excerpt = target.excerpt || "";
        const author = target.author?.name || "匿名";
        let info = `${i + 1}. ${title}`;
        if (target.voteup_count) info += ` [${target.voteup_count} 赞同]`;
        console.log(info);
        console.log(`   作者: ${author}`);
        if (excerpt) console.log(`   ${excerpt.slice(0, 100)}`);
        console.log();
      });
    });
  });

program
  .command("question")
  .description("查看问题详情")
  .argument("<id>", "问题 ID 或链接 (如 https://www.zhihu.com/question/123456)")
  .option("-a, --answers <count>", "显示回答数", "5")
  .action(async (id, options) => {
    const client = createClient();
    await runWithBrowser(client, async () => {
      if (!(await ensureLoggedIn(client))) return;
      const qid = (id.match(/(\d+)/)?.[1] || id).replace(/^0+/, "");
      const question = await client.feed.getQuestionDetail(qid);
      console.log(`\n问题: ${question.title}`);
      console.log(`描述: ${question.excerpt}`);
      console.log(`回答数: ${question.answer_count}`);
      if (question.follower_count) console.log(`关注者: ${question.follower_count}`);
      console.log();
      if (parseInt(options.answers) > 0) {
        const answers = await client.feed.getQuestionAnswers(
          qid,
          0,
          parseInt(options.answers)
        );
        answers.forEach((a: any, i: number) => {
          const comments = a.comment_count != null ? ` · ${a.comment_count} 评论` : "";
          console.log(`--- 回答 ${i + 1} (${a.voteup_count ?? 0} 赞同${comments}) ---`);
          if (a.url) console.log(`链接: ${a.url}`);
          const text = (a.content || a.excerpt || "").replace(/<[^>]+>/g, "");
          console.log(text);
          console.log();
        });
      }
    });
  });

program
  .command("article")
  .description("查看文章详情")
  .argument("<id>", "文章 ID 或链接 (如 https://zhuanlan.zhihu.com/p/123456)")
  .option("-c, --comments <count>", "显示评论数", "0")
  .action(async (id, options) => {
    const client = createClient();
    await runWithBrowser(client, async () => {
      if (!(await ensureLoggedIn(client))) return;
      const articleId = (id.match(/(\d+)/)?.[1] || id).replace(/^0+/, "");
      const article = await client.feed.getArticleDetail(articleId);
      console.log(`\n标题: ${article.title}`);
      console.log(`作者: ${article.author?.name || "匿名"}`);
      if (article.voteup_count != null) console.log(`赞同: ${article.voteup_count}`);
      if (article.comment_count != null) console.log(`评论: ${article.comment_count}`);
      const text = (article.content || article.excerpt || "").replace(
        /<[^>]+>/g,
        ""
      );
      console.log(`\n${text}${article.content_truncated ? "..." : ""}`);
      const commentLimit = parseInt(options.comments || "0");
      if (commentLimit > 0) {
        const comments = await client.feed.getArticleComments(articleId, commentLimit);
        if (comments.length) console.log("\n========== 评论 ==========");
        comments.forEach((c: any, i: number) => {
          const author = c.author?.member?.name || c.author?.name || "匿名";
          const content = (c.content || "").replace(/<[^>]+>/g, "");
          console.log(`${i + 1}. ${author}: ${content}`);
        });
      }
    });
  });

program.parse();
