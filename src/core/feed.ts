import { ZhihuHotStory, ZhihuFeedItem } from "./types";

const FEED_API = "https://www.zhihu.com/api/v3/feed/topstory/recommend";
const HOT_API = "https://www.zhihu.com/api/v3/feed/topstory/hot-lists/total";
const QUESTION_API = "https://www.zhihu.com/api/v4/questions";
const ANSWER_API = "https://www.zhihu.com/api/v4/answers";
const ARTICLE_API = "https://www.zhihu.com/api/v4/articles";

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
    const resp: any = await this.client.get(HOT_API);
    return resp.data || [];
  }

  async getQuestionDetail(questionId: number | string): Promise<any> {
    // CDP 模式：从页面 DOM 提取
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
    const session = this.client.session;
    if (session) {
      return this.getAnswersByPage(session, questionId, limit);
    }
    const resp: any = await this.client.get(
      `${QUESTION_API}/${questionId}/answers`,
      {
        params: {
          include: "data[*].content,excerpt,voteup_count",
          offset,
          limit,
        },
      }
    );
    return resp.data || [];
  }

  async getAnswerDetail(answerId: number): Promise<any> {
    const resp: any = await this.client.get(
      `${ANSWER_API}/${answerId}?include=data[*].content,excerpt,voteup_count`
    );
    return resp;
  }

  async getArticleDetail(articleId: number | string): Promise<any> {
    // CDP 模式：从页面 DOM 提取
    const session = this.client.session;
    if (session) {
      return this.getArticleByPage(session, articleId);
    }
    const resp: any = await this.client.get(
      `${ARTICLE_API}/${articleId}?include=voteup_count`
    );
    return resp;
  }

  async getArticleByUrl(url: string): Promise<any> {
    const resp: any = await this.client.get(`${url}?include=voteup_count`);
    return resp;
  }

  // -- CDP browser-mode helpers --

  private async getQuestionByPage(session: any, questionId: number | string): Promise<any> {
    const url = `https://www.zhihu.com/question/${questionId}`;

    // 导航到问题页
    try {
      await session.sendCdp("Page.navigate", { url });
    } catch {
      await session.evaluate(`window.location.href = ${JSON.stringify(url)}`);
    }

    // 等待页面加载
    await waitForUrl(session, "https://www.zhihu.com/question/");
    await waitContent(session);

    const data = await session.evaluate(`
      (() => {
        const title = document.querySelector('h1')?.textContent?.trim()
          || document.title?.replace(' - 知乎', '') || '';
        const excerpt = document.querySelector('.QuestionHeader-detail')?.textContent?.trim()
          || document.querySelector('meta[name="description"]')?.content || '';

        // 从匹配"968 个回答"的文本中提取数字
        const bodyText = document.body?.innerText || '';
        const answerMatch = bodyText.match(/(\\d+)\\s*[个]?\\s*回答/);
        const answerCount = answerMatch ? parseInt(answerMatch[1]) : 0;

        return { id: ${questionId}, title, excerpt, answer_count: answerCount || 0 };
      })()
    `);
    return data;
  }

  private async getAnswersByPage(session: any, questionId: number | string, limit: number): Promise<any[]> {
    await navToPage(session, `https://www.zhihu.com/question/${questionId}`);
    await waitForUrl(session, "https://www.zhihu.com/question/");
    await waitContent(session);

    const answers: any[] = await session.evaluate(`
      (() => {
        const seen = new Set();
        return Array.from(document.querySelectorAll('.ContentItem.AnswerItem')).slice(0, ${limit}).filter(a => {
          // 去重
          const key = a.textContent?.slice(0, 100);
          if (seen.has(key)) return false;
          seen.add(key);
          return true;
        }).map(a => {
          const userEl = a.querySelector('.UserLink-link');
          const voteEl = a.querySelector('[class*=Vote]');
          const excerpt = a.querySelector('.RichText')?.textContent?.trim()?.slice(0, 300) || '';
          const voteText = voteEl?.textContent?.trim() || '0';
          const voteCount = parseInt(voteText.replace(/[^0-9]/g, '')) || 0;
          return {
            voteup_count: voteCount,
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

    const data = await session.evaluate(`
      (() => {
        const title = document.querySelector('h1.Post-Title')?.textContent?.trim()
          || document.title?.replace(' - 知乎', '') || '';
        const author = document.querySelector('.Post-Author .UserLink-link')?.textContent?.trim() || '匿名';
        const content = document.querySelector('.Post-RichText')?.textContent?.trim()?.slice(0, 500) || '';
        const excerpt = content.slice(0, 200);
        return {
          id: ${articleId},
          title,
          content,
          excerpt,
          voteup_count: 0,
          comment_count: 0,
          author: { name: author },
        };
      })()
    `);
    return data;
  }
}

async function navToPage(session: any, url: string): Promise<void> {
  // 使用 CDP Page.navigate 更可靠
  try {
    await session.sendCdp("Page.navigate", { url });
  } catch {
    await session.evaluate(`window.location.href = ${JSON.stringify(url)}`);
  }
}

async function waitForUrl(session: any, expectedPrefix: string): Promise<void> {
  for (let i = 0; i < 30; i++) {
    const currentUrl: string = await session.evaluate("window.location.href").catch(() => "");
    if (currentUrl.startsWith(expectedPrefix)) return;
    await sleep(500);
  }
}

async function waitContent(session: any): Promise<void> {
  for (let i = 0; i < 30; i++) {
    const count: number = await session.evaluate(
      "document.querySelectorAll('h1, .QuestionHeader, .Post-Title, .Card').length"
    ).catch(() => 0);
    if (count > 3) return;
    await sleep(500);
  }
}

function sleep(ms: number): Promise<void> {
  return new Promise((r) => setTimeout(r, ms));
}
