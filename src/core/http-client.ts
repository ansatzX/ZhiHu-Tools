/**
 * @deprecated 此模块为旧版 axios/cookie 路径，已不推荐使用。
 * 当前主线方案为 BrowserHttpClient + Chrome CDP（见 browser-http-client.ts）。
 * 纯 Node HTTP 客户端会被知乎 TLS/浏览器指纹识别拦截。
 * 此模块仅保留用于参考和向后兼容。
 */
import axios, { AxiosInstance, AxiosRequestConfig, AxiosResponse } from "axios";
import { CookieJar } from "tough-cookie";
import { FileCookieStore } from "./cookie-store";
import * as path from "path";
import * as os from "os";
import * as fs from "fs";

/** @deprecated 使用 BrowserHttpClient 替代 */
export class ZhihuHttpClient {
  public xsrfToken: string;
  private jar: CookieJar;
  private store: FileCookieStore;
  private axios: AxiosInstance;
  private cookiePath: string;
  private cache: Record<string, any> = {};

  constructor(cookiePath?: string) {
    this.cookiePath = cookiePath || path.join(os.homedir(), ".zhihu-cookie.json");

    if (!fs.existsSync(this.cookiePath)) {
      fs.writeFileSync(this.cookiePath, "[]", "utf-8");
    }

    this.store = new FileCookieStore(this.cookiePath);
    this.jar = new CookieJar(this.store);

    this.axios = axios.create({
      timeout: 30000,
      headers: {
        "User-Agent":
          "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 " +
          "(KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36",
      },
    });

    this.axios.interceptors.request.use(async (config) => {
      if (!config.headers) config.headers = {} as any;

      const cookieStr = this.jar.getCookieStringSync(
        config.url || "https://www.zhihu.com"
      );
      if (cookieStr) {
        config.headers["Cookie"] = cookieStr;
      }

      return config;
    });

    this.axios.interceptors.response.use((response: AxiosResponse) => {
      const setCookieHeaders = response.headers["set-cookie"];
      if (setCookieHeaders) {
        const reqUrl = response.config.url || "https://www.zhihu.com";
        const cookies = Array.isArray(setCookieHeaders)
          ? setCookieHeaders
          : [setCookieHeaders];
        cookies.forEach((c: string) => {
          try {
            this.jar.setCookieSync(c, reqUrl);
          } catch (e) {
            // ignore invalid cookies
          }
        });
        this.extractXsrfToken();
      }
      return response;
    });

    this.extractXsrfToken();
  }

  private extractXsrfToken() {
    try {
      const cookies = this.jar.getCookiesSync("https://www.zhihu.com");
      const xsrf = cookies.find((c) => c.key === "_xsrf");
      if (xsrf) {
        this.xsrfToken = xsrf.value;
      }
    } catch {
      // ignore
    }
  }

  getCookieString(url: string): string {
    return this.jar.getCookieStringSync(url);
  }

  setCookie(cookieStr: string, url: string) {
    try {
      this.jar.setCookieSync(cookieStr, url);
    } catch {}
  }

  setCookieFromHeader(setCookieHeaders: string | string[] | undefined, url: string) {
    if (!setCookieHeaders) return;
    const cookies = Array.isArray(setCookieHeaders)
      ? setCookieHeaders
      : [setCookieHeaders];
    cookies.forEach((c: string) => {
      try {
        this.jar.setCookieSync(c, url);
      } catch {}
    });
    this.extractXsrfToken();
  }

  clearCache() {
    this.cache = {};
  }

  getCookieStringForDomain(domain: string = "zhihu.com"): string {
    const cookies = this.jar.getCookiesSync(`https://${domain}`);
    return cookies
      .map((c: any) => `${c.key}=${c.value}`)
      .join("; ");
  }

  clearCookies() {
    this.store.removeAllCookiesSync();
    try {
      fs.writeFileSync(this.cookiePath, "[]", "utf-8");
    } catch {}
    this.xsrfToken = undefined;
  }

  async get<T = any>(
    url: string,
    config?: AxiosRequestConfig & { enableCache?: boolean }
  ): Promise<T> {
    if (config?.enableCache && this.cache[url]) {
      return this.cache[url] as T;
    }
    const resp = await this.axios.get<T>(url, config);
    if (config?.enableCache) {
      this.cache[url] = resp.data;
    }
    return resp.data;
  }

  async post<T = any>(
    url: string,
    data?: any,
    config?: AxiosRequestConfig & { resolveWithFullResponse?: boolean }
  ): Promise<T> {
    const resp = await this.axios.post<T>(url, data, config);
    if (config?.resolveWithFullResponse) {
      return resp as any;
    }
    return resp.data;
  }

  async put<T = any>(
    url: string,
    data?: any,
    config?: AxiosRequestConfig & { resolveWithFullResponse?: boolean }
  ): Promise<T> {
    const resp = await this.axios.put<T>(url, data, config);
    if (config?.resolveWithFullResponse) {
      return resp as any;
    }
    return resp.data;
  }

  async patch<T = any>(
    url: string,
    data?: any,
    config?: AxiosRequestConfig
  ): Promise<T> {
    const resp = await this.axios.patch<T>(url, data, config);
    return resp.data;
  }

  async requestRaw(config: AxiosRequestConfig & { resolveWithFullResponse?: boolean }): Promise<any> {
    const resp = await this.axios.request(config);
    if (config.resolveWithFullResponse) {
      return resp;
    }
    return resp.data;
  }

  async getBuffer(url: string): Promise<Buffer> {
    const resp = await this.axios.get(url, {
      responseType: "arraybuffer",
    });
    return Buffer.from(resp.data);
  }
}

export function createClient(cookiePath?: string): ZhihuHttpClient {
  return new ZhihuHttpClient(cookiePath);
}
