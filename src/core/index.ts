export * from "./types";
export { OfficialApiClient, OfficialApiError, getOfficialClient, resetOfficialClient } from "./official-api";
export { RotatingOfficialApiClient } from "./rotating-client";

/**
 * @deprecated ZhihuClient (浏览器 DOM / 内部 API 路径) 已被 official-api.ts 取代。
 * 保留用于向后兼容，但新功能应使用 OfficialApiClient。
 */

import { ZhihuHttpClient } from "./http-client";
import { BrowserHttpClient } from "./browser-http-client";
import { BrowserSession } from "./browser/browser-session";
import { AuthService } from "./auth";
import { FeedService } from "./feed";
import { SearchService } from "./search";

/** @deprecated 使用 OfficialApiClient 替代 */
export class ZhihuClient {
  public http: any;
  public auth: AuthService;
  public feed: FeedService;
  public search: SearchService;
  public browser: BrowserSession | null = null;

  constructor(cookiePath?: string, useBrowser: boolean = false, browserOptions?: { headless?: boolean }) {
    if (useBrowser) {
      this.browser = new BrowserSession(browserOptions);
      this.http = new BrowserHttpClient(this.browser);
    } else {
      this.http = new ZhihuHttpClient(cookiePath);
    }
    this.auth = new AuthService(this.http);
    this.feed = new FeedService(this.http);
    this.search = new SearchService(this.http);
  }

  async stopBrowser() {
    if (this.browser) {
      await this.browser.stop();
    }
  }
}

export default ZhihuClient;
