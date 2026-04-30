import { spawn, ChildProcess } from "child_process";
import * as fs from "fs";
import * as net from "net";
import * as path from "path";
import { CdpClient } from "./cdp-client";
import { findChrome, getProfileDir } from "./chrome-path";
import { BrowserSessionError, ErrorCodes } from "./errors";

/**
 * 通过 CDP (Chrome DevTools Protocol) 管理浏览器会话
 *
 * 启动一个 Chrome 实例（专用 profile），提供 JS 执行和 cookie 访问能力。
 * 所有知乎 API 请求通过浏览器执行 fetch()，而非 Node.js HTTP 客户端。
 */
export class BrowserSession {
  private chromeProcess: ChildProcess | null = null;
  private cdp: CdpClient;
  private port: number;
  private started = false;
  private pageWsUrl: string = "";
  private headless: boolean;
  private currentHeadless: boolean | null = null;

  constructor(options?: { headless?: boolean }) {
    this.cdp = new CdpClient();
    this.port = 0;
    this.headless = options?.headless ?? true;
  }

  /**
   * 启动 Chrome 浏览器并连接 CDP
   */
  async start(targetUrl?: string, options?: { headless?: boolean }): Promise<void> {
    if (this.started) return;

    const chromePath = findChrome();
    const profileDir = getProfileDir();
    fs.mkdirSync(profileDir, { recursive: true });

    // 清理 Chrome profile 锁，防止残留进程阻塞
    for (const lock of ["SingletonLock", "SingletonCookie", "SingletonSocket"]) {
      try { fs.unlinkSync(path.join(profileDir, lock)); } catch {}
    }

    // 使用系统分配的空闲端口
    this.port = await this.findFreePort();
    const url = targetUrl || "https://www.zhihu.com/";
    const headless = options?.headless ?? this.headless;

    const args = [
      `--user-data-dir=${profileDir}`,
      `--remote-debugging-port=${this.port}`,
      "--no-first-run",
      "--no-default-browser-check",
      "--disable-extensions",
      "--disable-sync",
    ];
    if (headless) {
      args.push("--headless=new", "--disable-gpu");
    }
    args.push(url);

    // 默认以 headless 启动；登录入口会显式使用可见窗口。
    this.chromeProcess = spawn(
      chromePath,
      args,
      { stdio: "ignore" }
    );

    return new Promise<void>((resolve, reject) => {
      let settled = false;

      const settle = (err?: Error) => {
        if (settled) return;
        settled = true;
        if (err) {
          this.started = false;
          this.chromeProcess = null;
          reject(err);
        } else {
          resolve();
        }
      };

      this.chromeProcess!.on("exit", (code) => {
        this.started = false;
        this.chromeProcess = null;
        if (!settled) {
          settle(new BrowserSessionError(
            `Chrome 进程意外退出 (code: ${code})`,
            ErrorCodes.CHROME_LAUNCH_FAILED
          ));
        }
      });

      this.chromeProcess!.on("error", (err) => {
        settle(new BrowserSessionError(
          `Chrome 启动失败: ${err.message}`,
          ErrorCodes.CHROME_LAUNCH_FAILED
        ));
      });

      // 等待 Chrome 就绪，然后连接 CDP
      this.waitForPort()
        .then(() => this.getOrCreatePage(url))
        .then((wsUrl) => {
          this.pageWsUrl = wsUrl;
          return this.cdp.connect(wsUrl);
        })
        .then(() => {
          this.started = true;
          this.currentHeadless = headless;
          return this.waitForPageLoad();
        })
        .then(() => settle())
        .catch((err) => settle(err));
    });
  }

  /**
   * 导航到指定 URL。如果浏览器尚未启动，则启动浏览器；如果已启动，则复用当前页面。
   */
  async navigate(url: string, options?: { headless?: boolean }): Promise<void> {
    if (!this.started) {
      await this.start(url, options);
      return;
    }
    if (options?.headless === false && this.currentHeadless === true) {
      await this.stop();
      await this.start(url, options);
      return;
    }
    await this.cdp.send("Page.navigate", { url });
    await this.waitForPageLoad();
  }

  /**
   * 打开可见浏览器页面，供登录、验证码和风控处理使用。
   */
  async openVisiblePage(url = "https://www.zhihu.com/"): Promise<void> {
    await this.navigate(url, { headless: false });
  }

  /**
   * 在浏览器页面上执行 JS 表达式
   */
  async evaluate<T>(expression: string): Promise<T> {
    if (!this.started) {
      await this.start();
    }
    return this.cdp.evaluate<T>(expression);
  }

  /**
   * 在浏览器中执行 fetch 请求
   */
  async fetch(url: string, options?: {
    method?: string;
    headers?: Record<string, string>;
    body?: string;
  }): Promise<{ status: number; headers: Record<string, string>; data: any }> {
    // 未启动时自动启动
    if (!this.started) {
      await this.start();
    }

    // 确保页面在正确的域上（SameSite cookie 需要同域请求）
    const targetDomain = new URL(url).hostname;
    try {
      const currentUrl = await this.evaluate<string>("window.location.href").catch(() => "");
      if (currentUrl) {
        const currentDomain = new URL(currentUrl).hostname;
        if (currentDomain !== targetDomain) {
          await this.cdp.send("Page.navigate", { url: `https://${targetDomain}/` });
          await this.waitForPageLoad();
        }
      }
    } catch {
      // 获取 URL 失败，不导航
    }

    const opts = JSON.stringify({
      method: options?.method || "GET",
      headers: options?.headers || {},
      body: options?.body,
      credentials: "include",
    });

    const expression = `
      (async () => {
        try {
          const resp = await fetch(${JSON.stringify(url)}, ${opts});
          const ct = resp.headers.get('content-type') || '';
          let data;
          if (ct.includes('json')) {
            data = await resp.json();
          } else {
            data = await resp.text();
          }
          const hdrs = {};
          resp.headers.forEach((v, k) => { hdrs[k] = v; });
          return { status: resp.status, headers: hdrs, data };
        } catch (e) {
          return { status: 0, headers: {}, data: e.message || 'fetch error' };
        }
      })()
    `;

    return this.evaluate<{ status: number; headers: Record<string, string>; data: any }>(expression);
  }

  /**
   * 获取所有浏览器 cookie（包括 httpOnly）
   */
  async getAllCookies(): Promise<Array<{ name: string; value: string; domain: string }>> {
    if (!this.started) {
      await this.start();
    }

    try {
      await this.cdp.send("Network.enable");
    } catch {
      // already enabled or not available
    }

    try {
      const result = await this.cdp.send("Network.getAllCookies");
      return (result.cookies || []).map((c: any) => ({
        name: c.name,
        value: c.value,
        domain: c.domain,
      }));
    } catch {
      return [];
    }
  }

  /**
   * 清除浏览器中所有 cookie
   */
  async clearBrowserCookies(): Promise<void> {
    // 如果浏览器未启动，先启动；否则无法通过 CDP 清除 cookie
    if (!this.started) {
      await this.start("https://www.zhihu.com/");
    }

    try {
      await this.cdp.send("Network.enable");
    } catch {
      // already enabled
    }

    try {
      await this.cdp.send("Network.clearBrowserCookies");
    } catch {
      // fallback: Network.clearBrowserCookies 可能不可用
    }

    // 同时清除知乎域的存储（localStorage, sessionStorage 等）
    try {
      await this.cdp.send("Storage.clearDataForOrigin", {
        origin: "https://www.zhihu.com",
        storageTypes: "all",
      });
    } catch {
      // Storage 域可能不可用
    }
  }

  /**
   * 发送原始 CDP 命令（供 service 层使用）
   */
  async sendCdp(method: string, params?: any): Promise<any> {
    if (!this.started) await this.start();
    return this.cdp.send(method, params);
  }

  /**
   * 检查页面是否已登录（通过 /api/v4/me 检查）
   */
  async checkAuthenticated(): Promise<boolean> {
    const result = await this.fetch("https://www.zhihu.com/api/v4/me");
    return result.status === 200 && result.data?.id != null;
  }

  /**
   * 停止浏览器进程并清理
   */
  async stop(): Promise<void> {
    this.cdp.close();
    if (this.chromeProcess && !this.chromeProcess.killed) {
      const chromeProcess = this.chromeProcess;
      chromeProcess.kill("SIGTERM");
      await new Promise<void>((resolve) => {
        const timeout = setTimeout(resolve, 3000);
        chromeProcess.on("exit", () => {
          clearTimeout(timeout);
          resolve();
        });
      });
    }
    this.started = false;
    this.chromeProcess = null;
    this.currentHeadless = null;
  }

  /**
   * 浏览器是否正在运行
   */
  isRunning(): boolean {
    if (this.chromeProcess?.exitCode !== null || this.chromeProcess?.signalCode !== null) {
      this.started = false;
      this.chromeProcess = null;
      this.currentHeadless = null;
      return false;
    }
    return this.started && this.chromeProcess !== null && !this.chromeProcess.killed;
  }

  // -- private helpers --

  protected waitForPort(timeoutMs = 15000): Promise<void> {
    return new Promise((resolve, reject) => {
      const start = Date.now();
      const tryConnect = () => {
        const socket = new net.Socket();
        socket.on("connect", () => {
          socket.destroy();
          resolve();
        });
        socket.on("error", () => {
          socket.destroy();
          if (Date.now() - start > timeoutMs) {
            reject(
              new BrowserSessionError(
                "Chrome 启动超时",
                ErrorCodes.CHROME_LAUNCH_FAILED
              )
            );
          } else {
            setTimeout(tryConnect, 200);
          }
        });
        socket.connect(this.port, "127.0.0.1");
      };
      tryConnect();
    });
  }

  protected findFreePort(): Promise<number> {
    return findFreePort();
  }

  protected waitForPageLoad(timeoutMs = 10000): Promise<void> {
    return new Promise((resolve, _reject) => {
      const start = Date.now();
      const check = async () => {
        try {
          const ready = await this.evaluate<string>(
            "document.readyState"
          ).catch(() => "");
          if (ready === "complete" || ready === "interactive") {
            setTimeout(resolve, 300);
            return;
          }
        } catch {
          // page might be loading
        }
        if (Date.now() - start > timeoutMs) {
          resolve(); // timeout, don't block startup
        } else {
          setTimeout(check, 300);
        }
      };
      setTimeout(check, 500);
    });
  }

  protected async getOrCreatePage(url: string): Promise<string> {
    // 尝试获取已有页面
    try {
      const resp = await fetch(`http://127.0.0.1:${this.port}/json`);
      const pages = await resp.json() as any[];
      const matchedPage = pages.find(
        (p: any) => p.url && p.url.includes("zhihu.com")
      );
      const page = matchedPage || pages[0];
      if (page?.webSocketDebuggerUrl) {
        return page.webSocketDebuggerUrl;
      }
    } catch {
      // fall through to creating a new page
    }

    // 创建新页面
    const resp = await fetch(
      `http://127.0.0.1:${this.port}/json/new?${encodeURIComponent(url)}`
    );
    const pageInfo: any = await resp.json();
    if (!pageInfo?.webSocketDebuggerUrl) {
      throw new BrowserSessionError(
        "无法获取页面 CDP 端点",
        ErrorCodes.CDP_CONNECT_FAILED
      );
    }
    return pageInfo.webSocketDebuggerUrl;
  }
}

/**
 * 使用系统分配的空闲端口
 */
function findFreePort(): Promise<number> {
  return new Promise((resolve, reject) => {
    const server = net.createServer();
    server.listen(0, "127.0.0.1", () => {
      const addr = server.address();
      if (addr && typeof addr === "object") {
        const port = addr.port;
        server.close(() => resolve(port));
      } else {
        server.close(() => reject(new Error("无法获取空闲端口")));
      }
    });
    server.on("error", reject);
  });
}
