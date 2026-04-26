import { BrowserSessionError, ErrorCodes } from "./errors";

interface PendingRequest {
  resolve: (value: any) => void;
  reject: (error: any) => void;
  timer: NodeJS.Timeout;
}

// Node.js v24 原生 WebSocket 的构造类型在 ES2020 lib 下不可用
const NativeWebSocket: any = WebSocket;

/**
 * 精简的 Chrome DevTools Protocol 客户端
 * 通过 WebSocket 与 Chrome 的远程调试接口通信
 */
export class CdpClient {
  private ws: any = null;
  private pending = new Map<number, PendingRequest>();
  private nextId = 1;
  private requestTimeoutMs = 30000;

  /**
   * 连接到 Chrome DevTools WebSocket
   */
  async connect(wsUrl: string): Promise<void> {
    return new Promise((resolve, reject) => {
      try {
        this.ws = new NativeWebSocket(wsUrl);

        this.ws.onopen = () => {
          resolve();
        };

        this.ws.onmessage = (event: any) => {
          const msg = JSON.parse(event.data.toString());
          this.handleMessage(msg);
        };

        this.ws.onerror = (err: any) => {
          reject(
            new BrowserSessionError(
              `CDP 连接失败: ${err.message || "unknown"}`,
              ErrorCodes.CDP_CONNECT_FAILED
            )
          );
        };

        this.ws.onclose = () => {
          for (const [, pending] of this.pending) {
            clearTimeout(pending.timer);
            pending.reject(new Error("CDP 连接已关闭"));
          }
          this.pending.clear();
        };
      } catch (err: any) {
        reject(
          new BrowserSessionError(
            `CDP 连接失败: ${err.message}`,
            ErrorCodes.CDP_CONNECT_FAILED
          )
        );
      }
    });
  }

  /**
   * 发送 CDP 命令并等待响应
   */
  async send(method: string, params?: any): Promise<any> {
    const id = this.nextId++;

    return new Promise((resolve, reject) => {
      const timer = setTimeout(() => {
        this.pending.delete(id);
        reject(
          new Error(`CDP 命令超时: ${method} (${this.requestTimeoutMs}ms)`)
        );
      }, this.requestTimeoutMs);

      this.pending.set(id, { resolve, reject, timer });

      try {
        this.ws.send(JSON.stringify({ id, method, params: params || {} }));
      } catch (err: any) {
        clearTimeout(timer);
        this.pending.delete(id);
        reject(err);
      }
    });
  }

  /**
   * 在浏览器页面中执行 JavaScript 表达式
   */
  async evaluate<T>(expression: string): Promise<T> {
    const result = await this.send("Runtime.evaluate", {
      expression,
      returnByValue: true,
      awaitPromise: true,
    });

    if (result.exceptionDetails) {
      const msg = result.exceptionDetails.text || "JS 执行错误";
      const exc = result.exceptionDetails.exception;
      throw new Error(
        exc?.description || exc?.value || msg
      );
    }

    return result.result.value as T;
  }

  /**
   * 关闭 WebSocket 连接
   */
  close() {
    if (this.ws) {
      try {
        this.ws.close();
      } catch {
        // ignore
      }
      this.ws = null;
    }
  }

  private handleMessage(msg: any) {
    if (msg.id !== undefined && this.pending.has(msg.id)) {
      const { resolve, reject, timer } = this.pending.get(msg.id)!;
      clearTimeout(timer);
      this.pending.delete(msg.id);

      if (msg.error) {
        reject(
          new Error(`CDP 错误 [${msg.error.code}]: ${msg.error.message}`)
        );
      } else {
        resolve(msg.result);
      }
    }
  }
}
