import { ZhihuHotStory, ZhihuFeedItem } from "./types";
import { BrowserSessionError, ErrorCodes } from "./browser/errors";
import { withCache } from "./cache";

const FEED_API = "https://www.zhihu.com/api/v3/feed/topstory/recommend";
const HOT_API = "https://www.zhihu.com/api/v3/feed/topstory/hot-lists/total";
const QUESTION_API = "https://www.zhihu.com/api/v4/questions";
const ANSWER_API = "https://www.zhihu.com/api/v4/answers";
const ARTICLE_API = "https://www.zhihu.com/api/v4/articles";
const COMMENT_API = "https://www.zhihu.com/api/v4/comment_v5";

export class FeedService {
  constructor(private client: any) {}

  async getFeed(limit: number = 10, offset: number = 0): Promise<ZhihuFeedItem[]> {
    const resp: any = await this.client.get(FEED_API, {
      params: { limit, offset },
    });
    return (resp.data || []).filter(
      (item: any) => item.type !== "feed_advert"
    );
  }

  async getHotStories(): Promise<ZhihuHotStory[]> {
    return withCache("hot_stories", "hot", async () => {
      const resp: any = await this.client.get(HOT_API);
      return resp.data || [];
    });
  }

  async getQuestionDetail(questionId: number | string): Promise<any> {
    const session = this.client.session;
    if (session) {
      return this.getQuestionByPage(session, questionId);
    }
    const resp: any = await this.client.get(
      `${QUESTION_API}/${questionId}?include=detail%2cexcerpt`
    );
    return resp;
  }

  async getQuestionAnswers(
    questionId: number | string,
    offset: number = 0,
    limit: number = 10
  ): Promise<any[]> {
    try {
      const answers: any[] = [];
      let nextOffset = offset;
      const pageSize = Math.min(Math.max(limit, 1), 20);

      while (answers.length < limit) {
        const remaining = limit - answers.length;
        const resp: any = await this.client.get(
          `${QUESTION_API}/${questionId}/answers`,
          {
            params: {
              include: "data[*].id,content,excerpt,voteup_count,comment_count,created_time,updated_time,author.name,author.url_token,author.avatar_url",
              offset: nextOffset,
              limit: Math.min(pageSize, remaining),
              sort_by: "default",
            },
          }
        );

        const data = Array.isArray(resp.data) ? resp.data : [];
        answers.push(...data.map((answer: any) => normalizeAnswer(answer, questionId)));

        if (data.length === 0 || data.length >= remaining) break;
        nextOffset += data.length;
      }

      if (answers.length > 0 || limit === 0) {
        return answers.slice(0, limit);
      }
    } catch {
      // Browser API may be blocked by upstream changes; fall back to DOM below.
    }

    const session = this.client.session;
    if (session) {
      return this.getAnswersByPage(session, questionId, limit);
    }
    return [];
  }

  async getAnswerDetail(answerId: number): Promise<any> {
    const resp: any = await this.client.get(
      `${ANSWER_API}/${answerId}?include=data[*].content,excerpt,voteup_count`
    );
    return resp;
  }

  async getArticleDetail(articleId: number | string): Promise<any> {
    try {
      const resp: any = await this.client.get(
        `${ARTICLE_API}/${articleId}`,
        {
          params: {
            include: "title,content,excerpt,voteup_count,comment_count,created,updated,author.name,author.url_token,author.avatar_url",
          },
        }
      );
      if (resp && (resp.content || resp.title)) {
        const content = sanitizeZhihuText(resp.content || "");
        return {
          ...resp,
          content,
          excerpt: resp.excerpt || htmlToText(content).slice(0, 200),
          author: resp.author || { name: "匿名" },
          url: `https://zhuanlan.zhihu.com/p/${articleId}`,
          content_truncated: false,
        };
      }
    } catch {
      // Browser API may be blocked by upstream changes; fall back to DOM below.
    }

    const session = this.client.session;
    if (session) {
      return this.getArticleByPage(session, articleId);
    }
    return null;
  }

  async getAnswerComments(answerId: number | string, limit: number = 20, offset: number = 0): Promise<any[]> {
    return this.getComments("answers", answerId, limit, offset);
  }

  async getArticleComments(articleId: number | string, limit: number = 20, offset: number = 0): Promise<any[]> {
    return this.getComments("articles", articleId, limit, offset);
  }

  private async getComments(resourceType: "answers" | "articles", resourceId: number | string, limit: number, offset: number): Promise<any[]> {
    const url = `${COMMENT_API}/${resourceType}/${resourceId}/root_comment`;
    const resp: any = await this.client.get(url);
    const data = Array.isArray(resp.data) ? resp.data : [];
    return data.slice(offset, offset + limit).map(normalizeComment);
  }

  async getArticleByUrl(url: string): Promise<any> {
    const resp: any = await this.client.get(`${url}?include=voteup_count`);
    return resp;
  }

  // -- CDP browser-mode helpers --

  private async getQuestionByPage(session: any, questionId: number | string): Promise<any> {
    const url = `https://www.zhihu.com/question/${questionId}`;
    const safeId = JSON.stringify(String(questionId));

    await navToPage(session, url);
    await waitForUrl(session, "https://www.zhihu.com/question/");
    await waitContent(session);

    // 检测页面类型
    await detectPageType(session, "question");

    const data = await session.evaluate(`
      (() => {
        const title = document.querySelector('h1')?.textContent?.trim()
          || document.title?.replace(/ - 知乎.*/, '') || '';
        const excerptEl = document.querySelector('.QuestionHeader-detail');
        const excerpt = excerptEl?.textContent?.trim()
          || document.querySelector('meta[name="description"]')?.content || '';

        const bodyText = document.body?.innerText || '';
        const answerMatch = bodyText.match(/(\\d+)\\s*[个]?\\s*回答/);
        const followerMatch = bodyText.match(/(\\d+)\\s*[个]?\\s*关注/);
        const answerCount = answerMatch ? parseInt(answerMatch[1]) : 0;
        const followerCount = followerMatch ? parseInt(followerMatch[1]) : 0;

        return { id: ${safeId}, title, excerpt, answer_count: answerCount, follower_count: followerCount };
      })()
    `);
    return data;
  }

  private async getAnswersByPage(session: any, questionId: number | string, limit: number): Promise<any[]> {
    await navToPage(session, `https://www.zhihu.com/question/${questionId}`);
    await waitForUrl(session, "https://www.zhihu.com/question/");
    await waitContent(session);

    const safeLimit = JSON.stringify(limit);
    const safeQuestionId = JSON.stringify(String(questionId));

    // 滚动加载更多回答，直到达到 limit 或没有新内容
    if (limit > 3) {
      await scrollForMoreAnswers(session, limit);
    }

    const answers: any[] = await session.evaluate(`
      (() => {
        function parseZhihuNumber(text) {
          if (!text) return 0;
          const cleaned = text.replace(/[,，\\s]/g, '');
          const match = cleaned.match(/^([\\d.]+)\\s*([万千kKmMbB]?)/);
          if (!match) {
            const n = parseInt(cleaned.replace(/[^0-9]/g, '')) || 0;
            return n;
          }
          let num = parseFloat(match[1]);
          const unit = match[2].toLowerCase();
          if (unit === '万') num *= 10000;
          else if (unit === '千' || unit === 'k') num *= 1000;
          else if (unit === 'm') num *= 1000000;
          else if (unit === 'b') num *= 1000000000;
          return Math.round(num);
        }

        const questionId = ${safeQuestionId};
        const seen = new Set();
        return Array.from(document.querySelectorAll('.ContentItem.AnswerItem')).slice(0, ${safeLimit}).filter(a => {
          const key = a.textContent?.slice(0, 100);
          if (seen.has(key)) return false;
          seen.add(key);
          return true;
        }).map(a => {
          const userEl = a.querySelector('.UserLink-link');
          const voteEl = a.querySelector('[class*=Vote]');
          const excerpt = a.querySelector('.RichText')?.textContent?.trim() || '';
          const voteText = voteEl?.textContent?.trim() || '0';
          const voteCount = parseZhihuNumber(voteText);
          const answerLink = a.querySelector('a[href*="/answer/"]')?.getAttribute('href') || '';
          const idMatch = answerLink.match(/answer\/(\d+)/);
          const answerId = idMatch ? idMatch[1] : null;
          const commentText = Array.from(a.querySelectorAll('button, a')).map(el => el.textContent || '').find(t => /评论/.test(t)) || '';
          const commentMatch = commentText.match(/([\d,，]+)\s*条?评论/);
          return {
            id: answerId,
            question_id: questionId,
            url: answerId ? 'https://www.zhihu.com/question/' + questionId + '/answer/' + answerId : '',
            voteup_count: voteCount,
            comment_count: commentMatch ? parseInt(commentMatch[1].replace(/[,，]/g, '')) : null,
            author: { name: userEl?.textContent?.trim() || '匿名' },
            excerpt,
            content: excerpt,
          };
        });
      })()
    `);
    return answers;
  }

  private async getArticleByPage(session: any, articleId: number | string): Promise<any> {
    await navToPage(session, `https://zhuanlan.zhihu.com/p/${articleId}`);
    await waitForUrl(session, "https://zhuanlan.zhihu.com/p/");
    await waitContent(session);

    // 检测页面类型
    await detectPageType(session, "article");

    const safeId = JSON.stringify(String(articleId));

    const data = await session.evaluate(`
      (() => {
        function parseZhihuNumber(text) {
          if (!text) return 0;
          const cleaned = text.replace(/[,，\\s]/g, '');
          const match = cleaned.match(/^([\\d.]+)\\s*([万千kKmMbB]?)/);
          if (!match) return parseInt(cleaned.replace(/[^0-9]/g, '')) || 0;
          let num = parseFloat(match[1]);
          const unit = match[2].toLowerCase();
          if (unit === '万') num *= 10000;
          else if (unit === '千' || unit === 'k') num *= 1000;
          else if (unit === 'm') num *= 1000000;
          else if (unit === 'b') num *= 1000000000;
          return Math.round(num);
        }

        const title = document.querySelector('h1.Post-Title')?.textContent?.trim()
          || document.title?.replace(/ - 知乎.*/, '') || '';
        function cleanText(text) {
          const value = (text || '').replace(/\s+/g, ' ').trim();
          if (!value) return '';
          if (value.includes('{') || value.includes('}') || value.includes('.css-')) return '';
          if (value.length > 80) return '';
          return value;
        }

        const authorCandidates = [
          ...Array.from(document.querySelectorAll('.Post-Author a[href*="/people/"], .AuthorInfo a[href*="/people/"], a.UserLink-link[href*="/people/"], [itemprop="author"] [itemprop="name"], [itemprop="name"]'))
        ];
        const author = authorCandidates.map(el => cleanText(el.textContent)).find(Boolean) || '匿名';
        const rawContent = document.querySelector('.Post-RichText')?.textContent?.trim()
          || document.querySelector('article')?.textContent?.trim()
          || '';
        const content = rawContent.replace(/\.css-[^{\s]+\{[^}]*\}/g, '').replace(/\s+/g, ' ').trim();
        const excerpt = content.slice(0, 200);

        // 尝试提取真实的 vote/comment 数量
        const bodyText = document.body?.innerText || '';
        const voteMatch = bodyText.match(/([\\d.]+\\s*[万千]?)\\s*(?:赞|赞同|个赞)/);
        const commentMatch = bodyText.match(/(\\d+)\\s*(?:条评论|评论|条回复)/);
        const voteup = voteMatch ? parseZhihuNumber(voteMatch[1]) : null;
        const comments = commentMatch ? parseInt(commentMatch[1]) : null;

        return {
          id: ${safeId},
          title,
          content,
          excerpt,
          voteup_count: voteup,
          comment_count: comments,
          author: { name: author },
          url: 'https://zhuanlan.zhihu.com/p/' + ${safeId},
          content_truncated: false,
        };
      })()
    `);
    return data;
  }
}

// -- 页面导航与等待辅助函数 --

async function navToPage(session: any, url: string): Promise<void> {
  try {
    await session.sendCdp("Page.navigate", { url });
  } catch {
    await session.evaluate(`window.location.href = ${JSON.stringify(url)}`);
  }
}

async function waitForUrl(session: any, expectedPrefix: string, timeoutMs = 15000): Promise<void> {
  const start = Date.now();
  for (let i = 0; i < 60; i++) {
    const currentUrl: string = await session.evaluate("window.location.href").catch(() => "");
    if (currentUrl.startsWith(expectedPrefix)) return;
    if (Date.now() - start > timeoutMs) break;
    await sleep(500);
  }
  throw new BrowserSessionError(
    `页面导航超时: 期望地址前缀 "${expectedPrefix}"`,
    ErrorCodes.CDP_CONNECT_FAILED
  );
}

async function waitContent(session: any, timeoutMs = 15000): Promise<void> {
  // 使用通用 selector：检测页面核心元素是否出现
  const start = Date.now();
  for (let i = 0; i < 60; i++) {
    const ready: boolean = await session.evaluate(`
      (() => {
        const h1 = document.querySelector('h1');
        const questionHeader = document.querySelector('.QuestionHeader');
        const postTitle = document.querySelector('.Post-Title');
        const richText = document.querySelector('.Post-RichText');
        const cards = document.querySelectorAll('.Card');
        return !!(h1 || questionHeader || postTitle || richText || cards.length > 0);
      })()
    `).catch(() => false);
    if (ready) return;
    if (Date.now() - start > timeoutMs) break;
    await sleep(500);
  }
  throw new BrowserSessionError(
    "页面内容加载超时: 页面可能被风控或需要登录",
    ErrorCodes.CDP_CONNECT_FAILED
  );
}

/**
 * 检测页面类型：登录页、验证码页、404等
 */
async function detectPageType(session: any, expectedType: "question" | "article"): Promise<void> {
  const pageInfo: { url: string; title: string; bodyText: string } = await session.evaluate(`
    (() => ({
      url: window.location.href,
      title: document.title || '',
      bodyText: document.body?.innerText?.slice(0, 500) || '',
    }))()
  `).catch(() => ({ url: "", title: "", bodyText: "" }));

  // 检测登录页
  if (pageInfo.url.includes("signin") || pageInfo.url.includes("login") ||
      pageInfo.title.includes("登录") || pageInfo.title.includes("Sign in")) {
    throw new BrowserSessionError(
      "当前页面为登录页，请先完成知乎登录",
      ErrorCodes.LOGIN_REQUIRED
    );
  }

  // 检测验证码
  if (pageInfo.bodyText.includes("验证") || pageInfo.bodyText.includes("captcha") ||
      pageInfo.url.includes("captcha")) {
    throw new BrowserSessionError(
      "触发知乎人机验证，请在浏览器中手动完成验证",
      ErrorCodes.HUMAN_VERIFICATION_REQUIRED
    );
  }

  // 检测 404
  if (pageInfo.title.includes("404") || pageInfo.title.includes("页面不存在") ||
      pageInfo.bodyText.includes("你似乎来到了没有知识存在的荒原")) {
    throw new BrowserSessionError(
      "页面不存在 (404)",
      ErrorCodes.UPSTREAM_FORBIDDEN
    );
  }
}

async function scrollForMoreAnswers(session: any, targetCount: number, maxScrolls = 20): Promise<void> {
  for (let i = 0; i < maxScrolls; i++) {
    const info: { count: number; height: number } = await session.evaluate(`
      (() => {
        window.scrollBy(0, 800);
        const count = document.querySelectorAll('.ContentItem.AnswerItem').length;
        const height = document.body.scrollHeight;
        return { count, height };
      })()
    `).catch(() => ({ count: 0, height: 0 }));

    if (info.count >= targetCount) break;

    // 等待新内容渲染
    await sleep(800);

    // 检查是否还有更多内容（页面高度不再增长）
    const newInfo: { count: number; height: number } = await session.evaluate(`
      (() => ({ count: document.querySelectorAll('.ContentItem.AnswerItem').length, height: document.body.scrollHeight }))()
    `).catch(() => ({ count: 0, height: 0 }));

    if (newInfo.count >= targetCount || newInfo.height <= info.height) break;
  }
}

function normalizeComment(comment: any): any {
  return {
    id: comment.id ?? null,
    content: comment.content || "",
    created_time: comment.created_time ?? null,
    vote_count: comment.vote_count ?? comment.like_count ?? null,
    reply_count: comment.child_comment_count ?? comment.reply_count ?? null,
    author: comment.author || comment.member || { name: "匿名" },
  };
}

function normalizeAnswer(answer: any, questionId: number | string): any {
  const answerId = answer?.id != null ? String(answer.id) : "";
  return {
    ...answer,
    id: answer.id ?? null,
    question_id: String(questionId),
    url: answerId ? `https://www.zhihu.com/question/${questionId}/answer/${answerId}` : (answer.url || ""),
    api_url: answer.url || (answerId ? `${ANSWER_API}/${answerId}` : ""),
    comment_count: answer.comment_count ?? null,
    voteup_count: answer.voteup_count ?? null,
    content: answer.content || answer.excerpt || "",
    excerpt: answer.excerpt || htmlToText(answer.content || "").slice(0, 200),
    author: answer.author || { name: "匿名" },
  };
}

function sanitizeZhihuText(text: string): string {
  return (text || "")
    .replace(/<style[\s\S]*?<\/style>/gi, "")
    .replace(/\.css-[^{\s]+\{[^}]*\}/g, "")
    .replace(/dynamic-range-limit:[^;}]+;?/g, "")
    .replace(/box-sizing:[^;}]+;?/g, "")
    .replace(/border-radius:[^;}]+;?/g, "")
    .replace(/\s+/g, " ")
    .trim();
}

function htmlToText(html: string): string {
  return html.replace(/<[^>]+>/g, "").replace(/\s+/g, " ").trim();
}

function sleep(ms: number): Promise<void> {
  return new Promise((r) => setTimeout(r, ms));
}
