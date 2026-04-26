export * from "./types";

import { ZhihuHttpClient } from "./http-client";
import { BrowserHttpClient } from "./browser-http-client";
import { BrowserSession } from "./browser/browser-session";
import { AuthService } from "./auth";
import { FeedService } from "./feed";
import { SearchService } from "./search";

export class ZhihuClient {
  public http: any;
  public auth: AuthService;
  public feed: FeedService;
  public search: SearchService;
  public browser: BrowserSession | null = null;

  constructor(cookiePath?: string, useBrowser: boolean = false) {
    if (useBrowser) {
      this.browser = new BrowserSession();
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
      this.browser = null;
    }
  }
}

export default ZhihuClient;
