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
    await this.updateXsrfToken();
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
    await this.updateXsrfToken();
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
    return this.handleResponse(result, url);
  }

  async getCookieStringForDomain(domain: string = "zhihu.com"): Promise<string> {
    await this.ensureStarted();
    const cookies = await this.session.getAllCookies();
    return cookies
      .filter((c) => c.domain?.includes(domain))
      .map((c) => `${c.name}=${c.value}`)
      .join("; ");
  }

  async getDocumentCookie(): Promise<string> {
    await this.ensureStarted();
    return this.session.evaluate<string>("document.cookie");
  }

  setCookie(_cookieStr: string, _url: string) {
    // 浏览器管理自己的 cookie，Node 端 setCookie 无意义
  }

  async clearCookies() {
    this.xsrfToken = undefined;
    await this.session.clearBrowserCookies();
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
    const status = result.status;

    // 网络错误
    if (status === 0) {
      throw new BrowserSessionError(
        `网络请求失败: ${url || "unknown"}`,
        ErrorCodes.CDP_CONNECT_FAILED
      );
    }

    // 检测 HTML 响应（登录页、验证码页、风控页）
    if (typeof result.data === "string" && status === 200) {
      const html = result.data as string;
      if (html.includes("signin") || html.includes("sign_in") || html.includes("login")) {
        throw new BrowserSessionError(
          "请求返回登录页，可能未登录或登录已过期",
          ErrorCodes.LOGIN_REQUIRED
        );
      }
      if (html.includes("captcha") || html.includes("unhuman") || html.includes("验证")) {
        throw new BrowserSessionError(
          "触发知乎人机验证，请在浏览器中手动完成验证",
          ErrorCodes.HUMAN_VERIFICATION_REQUIRED
        );
      }
    }

    // 401: 未授权/未登录
    if (status === 401) {
      throw new BrowserSessionError(
        "未登录或登录已过期，请运行 zhihu login 重新登录",
        ErrorCodes.LOGIN_REQUIRED
      );
    }

    // 403: 禁止访问
    if (status === 403) {
      const bodyStr = typeof result.data === "string" ? result.data : JSON.stringify(result.data);
      if (bodyStr.includes("unhuman") || bodyStr.includes("captcha")) {
        throw new BrowserSessionError(
          "人机验证拦截: 请在浏览器中手动完成验证",
          ErrorCodes.HUMAN_VERIFICATION_REQUIRED
        );
      }
      throw new BrowserSessionError(
        `知乎 API 返回 403${url ? `: ${url}` : ""}`,
        ErrorCodes.UPSTREAM_FORBIDDEN
      );
    }

    // 404: 资源不存在
    if (status === 404) {
      throw new BrowserSessionError(
        `请求的资源不存在 (404)${url ? `: ${url}` : ""}`,
        ErrorCodes.UPSTREAM_FORBIDDEN
      );
    }

    // 429: 请求过于频繁
    if (status === 429) {
      throw new BrowserSessionError(
        "请求过于频繁，触发知乎速率限制，请稍后再试",
        ErrorCodes.UPSTREAM_FORBIDDEN
      );
    }

    // 5xx: 服务器错误
    if (status >= 500) {
      throw new BrowserSessionError(
        `知乎服务器错误 (${status})${url ? `: ${url}` : ""}`,
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
