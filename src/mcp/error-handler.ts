import { ErrorCodes } from "../core/browser/errors";

export type McpErrorResult = {
  ok: false;
  error: {
    code: string;
    message: string;
  };
  meta?: Record<string, any>;
};

let humanVerificationPending = false;
let lastVerificationUrl = "";
let lastVerificationStartedAt = 0;

export function resetHumanVerificationState(): void {
  humanVerificationPending = false;
  lastVerificationUrl = "";
  lastVerificationStartedAt = 0;
}

export function isHumanVerificationError(err: unknown): boolean {
  if (typeof err === "object" && err !== null && "code" in err) {
    if ((err as Record<string, unknown>).code === ErrorCodes.HUMAN_VERIFICATION_REQUIRED) return true;
  }

  const message = err instanceof Error ? err.message : String(err ?? "");
  return (
    message.includes("人机验证") ||
    message.includes("验证码") ||
    message.includes("captcha") ||
    message.includes("unhuman")
  );
}

export function getHumanVerificationStatus(client: { browser?: { isRunning?: () => boolean } | null }): Record<string, unknown> {
  const browserRunning = !!client?.browser?.isRunning?.();
  if (!humanVerificationPending) {
    return {
      ok: true,
      pending: false,
      browser_running: browserRunning,
      signal: "NO_PENDING_VERIFICATION",
      should_rerun: false,
    };
  }

  if (browserRunning) {
    return {
      ok: true,
      pending: true,
      browser_running: true,
      signal: "WAIT_FOR_BROWSER_CLOSE",
      should_rerun: false,
      verification_url: lastVerificationUrl || null,
      started_at: lastVerificationStartedAt || null,
    };
  }

  humanVerificationPending = false;
  return {
    ok: true,
    pending: false,
    browser_running: false,
    signal: "RERUN_READY",
    event: "VERIFICATION_BROWSER_CLOSED",
    should_rerun: true,
    verification_url: lastVerificationUrl || null,
    started_at: lastVerificationStartedAt || null,
  };
}

export async function withToolTimeout<T>(
  promise: Promise<T>,
  timeoutMs: number,
  timeoutCode: string,
  timeoutMessage: string
): Promise<T | McpErrorResult> {
  let timer: NodeJS.Timeout | undefined;
  try {
    return await Promise.race([
      promise,
      new Promise<McpErrorResult>((resolve) => {
        timer = setTimeout(() => {
          resolve({
            ok: false,
            error: {
              code: timeoutCode,
              message: timeoutMessage,
            },
            meta: {
              signal: "TOOL_TIMEOUT",
              should_rerun: true,
            },
          });
        }, timeoutMs);
      }),
    ]);
  } finally {
    if (timer) clearTimeout(timer);
  }
}

export async function handleMcpToolError(
  client: { browser?: { openVisiblePage?: (url: string) => Promise<void>; isRunning?: () => boolean } | null; auth?: { openLoginPage?: () => Promise<void> } },
  err: unknown,
  fallbackCode: string,
  fallbackMessage: string,
  verificationUrl = "https://www.zhihu.com/"
): Promise<McpErrorResult> {
  const errRecord = typeof err === "object" && err !== null ? err as Record<string, unknown> : {};
  const errMessage =
    err instanceof Error
      ? err.message
      : typeof errRecord.message === "string"
        ? errRecord.message
        : String(err ?? "");
  const errCode = typeof errRecord.code === "string" ? errRecord.code : undefined;

  if (isHumanVerificationError(err)) {
    let browserOpened = false;
    try {
      if (client?.browser?.openVisiblePage) {
        await client.browser.openVisiblePage(verificationUrl);
        browserOpened = true;
      } else if (client?.auth?.openLoginPage) {
        await client.auth.openLoginPage();
        browserOpened = true;
      }
    } catch (_ignored: unknown) {
      browserOpened = false;
    }
    humanVerificationPending = browserOpened;
    lastVerificationUrl = verificationUrl;
    lastVerificationStartedAt = Date.now();

    return {
      ok: false,
      error: {
        code: ErrorCodes.HUMAN_VERIFICATION_REQUIRED,
        message: browserOpened
          ? "已打开浏览器，请手动完成知乎人机验证后重试"
          : "触发知乎人机验证，但自动打开浏览器失败；请手动调用 zhihu_open_login_page",
      },
      meta: {
        browser_opened: browserOpened,
        signal: browserOpened ? "WAIT_FOR_BROWSER_CLOSE" : "OPEN_BROWSER_FAILED",
        should_rerun: false,
        status_tool: "zhihu_human_verification_status",
        action: browserOpened
          ? "请在打开的浏览器窗口中手动完成验证，然后重试当前工具"
          : "请调用 zhihu_open_login_page 打开浏览器并完成验证",
        original_error: errMessage || fallbackMessage,
      },
    };
  }

  return {
    ok: false,
    error: {
      code: errCode || fallbackCode,
      message: errMessage || fallbackMessage,
    },
  };
}
