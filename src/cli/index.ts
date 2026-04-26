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
  .description("登录知乎（浏览器登录）")
  .option("-p, --password", "使用密码登录")
  .action(async (options) => {
    const client = createClient();
    await runWithBrowser(client, async () => {
      if (options.password) {
        const readline = await import("readline");
        const rl = readline.createInterface({
          input: process.stdin,
          output: process.stdout,
        });
        const phone = await new Promise<string>((r) => {
          rl.question("手机号: ", (a) => {
            rl.close();
            r(a.trim());
          });
        });
        const password = await new Promise<string>((r) => {
          const rl2 = readline.createInterface({
            input: process.stdin,
            output: process.stdout,
          });
          rl2.question("密码: ", (a) => {
            rl2.close();
            r(a.trim());
          });
        });
        const profile = await client.auth.loginByPassword(phone, password);
        console.log(`登录成功！你好, ${profile.name}`);
      } else {
        await client.auth.loginByBrowser(async () => {
          const readline = await import("readline");
          const rl = readline.createInterface({
            input: process.stdin,
            output: process.stdout,
          });
          await new Promise<void>((resolve) => {
            rl.question("", () => {
              rl.close();
              resolve();
            });
          });
        });
        console.log("登录成功！");
      }
    });
  });

program
  .command("logout")
  .description("退出登录")
  .action(async () => {
    const client = createClient();
    client.auth.logout();
    console.log("已退出登录");
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
        // 从 target.url 提取问题 ID，格式: https://api.zhihu.com/questions/{id}
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
      // 从 URL 中提取纯数字 ID（保持字符串，避免 parseInt 丢失精度）
      const qid = (id.match(/(\d+)/)?.[1] || id).replace(/^0+/, "");
      const question = await client.feed.getQuestionDetail(qid);
      console.log(`\n问题: ${question.title}`);
      console.log(`描述: ${question.excerpt}`);
      console.log(`回答数: ${question.answer_count}`);
      console.log();
      if (parseInt(options.answers) > 0) {
        const answers = await client.feed.getQuestionAnswers(
          qid,
          0,
          parseInt(options.answers)
        );
        answers.forEach((a: any, i: number) => {
          console.log(`--- 回答 ${i + 1} (${a.voteup_count} 赞同) ---`);
          const text = (a.excerpt || a.content || "").replace(/<[^>]+>/g, "");
          console.log(text.slice(0, 300));
          console.log();
        });
      }
    });
  });

program
  .command("article")
  .description("查看文章详情")
  .argument("<id>", "文章 ID 或链接 (如 https://zhuanlan.zhihu.com/p/123456)")
  .action(async (id) => {
    const client = createClient();
    await runWithBrowser(client, async () => {
      if (!(await ensureLoggedIn(client))) return;
      const articleId = (id.match(/(\d+)/)?.[1] || id).replace(/^0+/, "");
      const article = await client.feed.getArticleDetail(articleId);
      console.log(`\n标题: ${article.title}`);
      console.log(`作者: ${article.author?.name || "匿名"}`);
      console.log(`赞同: ${article.voteup_count}`);
      console.log(`评论: ${article.comment_count}`);
      const text = (article.content || article.excerpt || "").replace(
        /<[^>]+>/g,
        ""
      );
      console.log(`\n${text.slice(0, 500)}...`);
    });
  });

program.parse();
