import { ZhihuSearchResult } from "./types";

const TYPE_MAP: Record<string, string> = {
  question: "question",
  answer: "content",
  article: "article",
  general: "content",
};

export class SearchService {
  constructor(private client: any) {}

  async search(
    keyword: string,
    type: string = "general",
    limit: number = 20,
    _offset: number = 0
  ): Promise<ZhihuSearchResult[]> {
    // CDP 浏览器模式：导航到搜索页，从 DOM 提取结果
    const session = this.client.session;
    if (session) {
      return this.searchViaPage(session, keyword, type, limit);
    }

    // 旧 axios 模式（保留但不再推荐）
    const { encrypt } = await import("../util/g_encrypt");
    const md5 = (await import("md5")).default;
    const cookieStr = await this.getCookieString();
    const dC0 = (cookieStr.match(/d_c0=([^;]+)/) || [])[1] || "";
    const SEARCH_API = "https://www.zhihu.com/api/v4/search_v3";
    const str = `101_3_2.0+/api/v4/search_v3?t=${type}&q=${keyword}&correction=1&offset=${_offset}&limit=${limit}&filter_fields=&lc_idx=0&show_all_topics=0&search_source=Normal+${dC0}`;
    const xZse96 = "2.0_" + encrypt(md5(str));

    const resp: any = await this.client.get(SEARCH_API, {
      params: {
        t: type, q: keyword, correction: "1",
        offset: String(_offset), limit: String(limit),
        filter_fields: "", lc_idx: "0", show_all_topics: "0", search_source: "Normal",
      },
      headers: { "x-zse-93": "101_3_2.0", "x-zse-96": xZse96 },
    });

    return (resp.data || []).filter(
      (item: any) => item.type === "search_result"
    );
  }

  private async searchViaPage(
    session: any,
    keyword: string,
    type: string,
    limit: number
  ): Promise<ZhihuSearchResult[]> {
    const searchType = TYPE_MAP[type] || "content";
    const url = `https://www.zhihu.com/search?type=${searchType}&q=${encodeURIComponent(keyword)}`;

    // 导航到搜索页
    await session.evaluate(`window.location.href = ${JSON.stringify(url)}`);

    // 等待搜索结果渲染
    for (let i = 0; i < 30; i++) {
      await sleep(500);
      const count: number = await session.evaluate(
        "document.querySelectorAll('.Card.SearchResult-Card').length"
      ).catch(() => 0);
      if (count > 0) break;
    }

    // 提取结果
    const raw: any[] = await session.evaluate(`
      (() => {
        return Array.from(document.querySelectorAll('.Card.SearchResult-Card')).slice(0, ${limit}).map(card => {
          const titleEl = card.querySelector('.ContentItem-title');
          const linkEl = titleEl?.querySelector('a');
          const richContent = card.querySelector('.RichContent');
          const excerptEl = richContent?.querySelector('.RichText') || card;

          // 判断类型
          let itemType = 'answer';
          if (card.querySelector('.ArticleItem')) itemType = 'article';
          else if (card.querySelector('.QuestionItem')) itemType = 'question';

          const title = linkEl?.textContent?.trim() || titleEl?.textContent?.trim() || '';
          const link = linkEl?.getAttribute('href') || '';
          const excerpt = excerptEl?.textContent?.trim()?.slice(0, 300) || '';

          return {
            type: itemType,
            title,
            link,
            excerpt,
            highlight: { title, description: excerpt },
            object: {
              type: itemType,
              title,
              excerpt,
              url: link.startsWith("http") ? link : "https://www.zhihu.com" + (link.startsWith("/") ? "" : "/") + link,
            },
          };
        });
      })()
    `);

    return raw as ZhihuSearchResult[];
  }

  private async getCookieString(): Promise<string> {
    if (typeof this.client.getCookieStringForDomain === "function") {
      return this.client.getCookieStringForDomain("zhihu.com");
    }
    return "";
  }
}

function sleep(ms: number): Promise<void> {
  return new Promise((r) => setTimeout(r, ms));
}
