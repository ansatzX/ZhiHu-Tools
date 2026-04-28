import { ZhihuSearchResult } from "./types";
import { BrowserSessionError, ErrorCodes } from "./browser/errors";

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
    const safeUrl = JSON.stringify(`https://www.zhihu.com/search?type=${searchType}&q=${encodeURIComponent(keyword)}`);
    const safeLimit = JSON.stringify(limit);

    await session.evaluate(`window.location.href = ${safeUrl}`);

    // 等待搜索结果渲染（超时抛错）
    await waitForSearchResults(session);

    const raw: any[] = await session.evaluate(`
      (() => {
        return Array.from(document.querySelectorAll('.Card.SearchResult-Card')).slice(0, ${safeLimit}).map(card => {
          const titleEl = card.querySelector('.ContentItem-title');
          const linkEl = titleEl?.querySelector('a');
          const richContent = card.querySelector('.RichContent');
          const excerptEl = richContent?.querySelector('.RichText') || card;

          // 根据 URL 路径判断类型
          const linkHref = linkEl?.getAttribute('href') || '';
          let itemType = 'answer';
          if (linkHref.startsWith('/question/')) itemType = 'question';
          else if (linkHref.startsWith('/p/') || linkHref.startsWith('/zhanlan/')) itemType = 'article';
          else if (linkHref.startsWith('/people/') || linkHref.startsWith('/org/')) itemType = 'user';
          else if (linkHref.startsWith('/pin/')) itemType = 'pin';

          const title = linkEl?.textContent?.trim() || titleEl?.textContent?.trim() || '';
          const link = linkHref || '';
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

async function waitForSearchResults(session: any, timeoutMs = 15000): Promise<void> {
  const start = Date.now();
  for (let i = 0; i < 60; i++) {
    const count: number = await session.evaluate(
      "document.querySelectorAll('.Card.SearchResult-Card').length"
    ).catch(() => 0);
    if (count > 0) return;
    if (Date.now() - start > timeoutMs) break;
    await sleep(500);
  }
  throw new BrowserSessionError(
    "搜索页面加载超时: 可能触发知乎风控或需要登录",
    ErrorCodes.CDP_CONNECT_FAILED
  );
}

function sleep(ms: number): Promise<void> {
  return new Promise((r) => setTimeout(r, ms));
}
