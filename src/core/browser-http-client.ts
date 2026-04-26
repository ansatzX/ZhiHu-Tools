import { BrowserSession } from "./browser/browser-session";
import { BrowserSessionError, ErrorCodes } from "./browser/errors";

/**
 * 基于浏览器 CDP 的 HTTP 客户端
 * 替代 ZhihuHttpClient（axios），通过浏览器 fetch 执行所有请求
 */
export class BrowserHttpClient {
  public xsrfToken?: string;
  public session: BrowserSession;

  constructor(session?: BrowserSession) {
    this.session = session || new BrowserSession();
  }

  /**
   * 确保浏览器已启动
   */
  async ensureStarted(): Promise<void> {
    if (!this.session.isRunning()) {
      await this.session.start();
    }
  }

  async get<T = any>(url: string, config?: any): Promise<T> {
    await this.ensureStarted();
    const fullUrl = this.buildUrl(url, config);
    const result = await this.session.fetch(fullUrl, {
      headers: config?.headers,
    });
    this.updateXsrfToken();
    return this.handleResponse<T>(result, url);
  }

  async post<T = any>(
    url: string,
    data?: any,
    config?: any
  ): Promise<T> {
    await this.ensureStarted();
    let body: string | undefined;
    let headers = config?.headers || {};

    if (data) {
      const ct = headers["Content-Type"] || headers["content-type"] || "";
      if (ct.includes("json")) {
        body = typeof data === "string" ? data : JSON.stringify(data);
      } else {
        body = typeof data === "string" ? data : new URLSearchParams(data).toString();
        if (!ct) headers["content-type"] = "application/x-www-form-urlencoded";
      }
    }

    const result = await this.session.fetch(url, {
      method: "POST",
      headers,
      body,
    });
    this.updateXsrfToken();
    return this.handleResponse<T>(result, url);
  }

  async put<T = any>(url: string, data?: any, config?: any): Promise<T> {
    await this.ensureStarted();
    const result = await this.session.fetch(url, {
      method: "PUT",
      headers: config?.headers,
      body: data ? JSON.stringify(data) : undefined,
    });
    return this.handleResponse<T>(result, url);
  }

  async patch<T = any>(url: string, data?: any, config?: any): Promise<T> {
    await this.ensureStarted();
    const result = await this.session.fetch(url, {
      method: "PATCH",
      headers: config?.headers,
      body: data ? JSON.stringify(data) : undefined,
    });
    return this.handleResponse<T>(result, url);
  }

  async requestRaw(config: any): Promise<any> {
    await this.ensureStarted();
    const url = config.url || config.uri;
    const fullUrl = this.buildUrl(url, config);
    const result = await this.session.fetch(fullUrl, {
      method: config.method || "GET",
      headers: config.headers,
    });

    if (config.resolveWithFullResponse) {
      return {
        status: result.status,
        data: result.data,
        headers: result.headers,
      };
    }
    return result.data;
  }

  /**
   * 获取指定域名的 cookie 字符串（用于搜索签名）
   */
  async getCookieStringForDomain(domain: string = "zhihu.com"): Promise<string> {
    await this.ensureStarted();
    const cookies = await this.session.getAllCookies();
    return cookies
      .filter((c) => c.domain?.includes(domain))
      .map((c) => `${c.name}=${c.value}`)
      .join("; ");
  }

  /**
   * 获取 document.cookie（仅非 httpOnly 的 cookie）
   */
  async getDocumentCookie(): Promise<string> {
    await this.ensureStarted();
    return this.session.evaluate<string>("document.cookie");
  }

  setCookie(_cookieStr: string, _url: string) {
    // 浏览器管理自己的 cookie，Node 端 setCookie 无意义
  }

  clearCookies() {
    this.xsrfToken = undefined;
  }

  clearCache() {
    // no-op for browser transport
  }

  // -- private --

  private buildUrl(url: string, config?: any): string {
    if (!config?.params) return url;
    const separator = url.includes("?") ? "&" : "?";
    const params = new URLSearchParams(config.params).toString();
    return `${url}${separator}${params}`;
  }

  private handleResponse<T>(result: { status: number; data: any }, url?: string): T {
    if (result.status === 0) {
      throw new Error(`网络请求失败: ${url || "unknown"}`);
    }

    if (result.status === 403) {
      const bodyStr = typeof result.data === "string" ? result.data : JSON.stringify(result.data);
      if (bodyStr.includes("unhuman") || bodyStr.includes("captcha")) {
        throw new BrowserSessionError(
          "人机验证拦截: 请尝试重新登录 (zhihu login)",
          ErrorCodes.HUMAN_VERIFICATION_REQUIRED
        );
      }
      throw new BrowserSessionError(
        `知乎 API 返回 403`,
        ErrorCodes.UPSTREAM_FORBIDDEN
      );
    }

    return result.data as T;
  }

  private async updateXsrfToken() {
    try {
      const cookies = await this.session.getAllCookies();
      const xsrf = cookies.find((c) => c.name === "_xsrf");
      if (xsrf) {
        this.xsrfToken = xsrf.value;
      }
    } catch {
      // ignore
    }
  }
}
