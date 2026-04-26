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

  constructor() {
    this.cdp = new CdpClient();
    this.port = 0;
  }

  /**
   * 启动 Chrome 浏览器并连接 CDP
   */
  async start(targetUrl?: string): Promise<void> {
    if (this.started) return;

    const chromePath = findChrome();
    const profileDir = getProfileDir();
    fs.mkdirSync(profileDir, { recursive: true });

    // 清理 Chrome profile 锁，防止残留进程阻塞
    for (const lock of ["SingletonLock", "SingletonCookie", "SingletonSocket"]) {
      try { fs.unlinkSync(path.join(profileDir, lock)); } catch {}
    }

    // 随机端口，避免冲突
    this.port = 9222 + Math.floor(Math.random() * 1000);
    const url = targetUrl || "https://www.zhihu.com/";

    // 启动 Chrome（用户可见窗口，用于完成登录和后续请求）
    this.chromeProcess = spawn(
      chromePath,
      [
        `--user-data-dir=${profileDir}`,
        `--remote-debugging-port=${this.port}`,
        "--no-first-run",
        "--no-default-browser-check",
        "--disable-extensions",
        "--disable-sync",
        url,
      ],
      { stdio: "ignore" }
    );

    this.chromeProcess.on("exit", (code) => {
      this.started = false;
      this.chromeProcess = null;
    });

    this.chromeProcess.on("error", (err) => {
      this.started = false;
      this.chromeProcess = null;
      throw new BrowserSessionError(
        `Chrome 启动失败: ${err.message}`,
        ErrorCodes.CHROME_LAUNCH_FAILED
      );
    });

    // 等待 Chrome 就绪
    await this.waitForPort();

    // 获取已有的页面或创建新页面
    this.pageWsUrl = await this.getOrCreatePage(url);

    // 连接 CDP WebSocket
    await this.cdp.connect(this.pageWsUrl);

    // 标记已启动，防止 waitForPageLoad 里的 evaluate 递归调用 start
    this.started = true;

    // 等待页面完全加载
    await this.waitForPageLoad();
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
    // 只检查域名，不导航到根路径，避免打断后续页面导航
    const targetDomain = new URL(url).hostname;
    try {
      const currentUrl = await this.evaluate<string>("window.location.href").catch(() => "");
      if (currentUrl) {
        const currentDomain = new URL(currentUrl).hostname;
        if (currentDomain !== targetDomain) {
          // 域名不匹配，导航到目标域的根路径
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

    // 确保 Network 域已激活
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
    // 已登录时返回 200 + id，未登录时返回各种 3xx/4xx
    return result.status === 200 && result.data?.id != null;
  }

  /**
   * 停止浏览器进程并清理
   */
  async stop(): Promise<void> {
    this.cdp.close();
    if (this.chromeProcess && !this.chromeProcess.killed) {
      this.chromeProcess.kill("SIGTERM");
      await new Promise<void>((resolve) => {
        const timeout = setTimeout(resolve, 3000);
        this.chromeProcess!.on("exit", () => {
          clearTimeout(timeout);
          resolve();
        });
      });
    }
    this.started = false;
    this.chromeProcess = null;
  }

  /**
   * 浏览器是否正在运行
   */
  isRunning(): boolean {
    return this.started && this.chromeProcess !== null && !this.chromeProcess.killed;
  }

  // -- private helpers --

  private async ensureDomain(domain: string): Promise<void> {
    // 检查当前页面域名
    const currentUrl = await this.evaluate<string>("window.location.href").catch(() => "");
    if (currentUrl && new URL(currentUrl).hostname === domain) {
      return; // 已经在正确的域上
    }

    // 导航到目标域名
    const baseUrl = `https://${domain}/`;
    await this.cdp.send("Page.navigate", { url: baseUrl });
    await this.waitForPageLoad();
  }

  private waitForPort(timeoutMs = 15000): Promise<void> {
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

  private waitForPageLoad(timeoutMs = 10000): Promise<void> {
    return new Promise((resolve, reject) => {
      const start = Date.now();
      const check = async () => {
        try {
          const ready = await this.evaluate<string>(
            "document.readyState"
          ).catch(() => "");
          if (ready === "complete" || ready === "interactive") {
            // 再等一帧确保渲染完成
            setTimeout(resolve, 300);
            return;
          }
        } catch {
          // page might be loading
        }
        if (Date.now() - start > timeoutMs) {
          resolve(); // timeout, don't reject
        } else {
          setTimeout(check, 300);
        }
      };
      setTimeout(check, 500); // give the page a moment to start loading
    });
  }

  private async getOrCreatePage(url: string): Promise<string> {
    // 尝试获取已有页面
    try {
      const resp = await fetch(`http://127.0.0.1:${this.port}/json`);
      const pages = await resp.json() as any[];
      // 优先找匹配 URL 的页面，或取第一个
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
