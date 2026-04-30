import { beforeEach, describe, expect, it } from "vitest";
import { ErrorCodes } from "../src/core/browser/errors";
import { runMcpTool } from "../src/mcp/tool-runner";
import {
  getHumanVerificationStatus,
  handleMcpToolError,
  isHumanVerificationError,
  resetHumanVerificationState,
  withToolTimeout,
} from "../src/mcp/error-handler";

describe("MCP human verification handling", () => {
  beforeEach(() => {
    resetHumanVerificationState();
  });

  it("detects explicit human verification errors", () => {
    expect(isHumanVerificationError({ code: ErrorCodes.HUMAN_VERIFICATION_REQUIRED })).toBe(true);
  });

  it("detects likely verification timeouts from search/page loading", () => {
    expect(isHumanVerificationError({ message: "搜索页面加载超时: 可能触发知乎风控或需要登录" })).toBe(false);
  });

  it("does not open a visible browser for generic login or timeout errors", async () => {
    const events: string[] = [];
    const client = {
      browser: {
        async openVisiblePage() {
          events.push("open");
        },
      },
    };

    const result = await runMcpTool(
      async () => {
        throw { code: ErrorCodes.LOGIN_REQUIRED, message: "当前页面需要登录，请先完成知乎登录" };
      },
      client,
      "SEARCH_FAILED",
      "搜索失败",
      "https://www.zhihu.com/search?type=content&q=test",
      { toolTimeoutMs: 100 }
    );

    expect(events).toEqual([]);
    expect(result.ok).toBe(false);
    expect(result.error.code).toBe(ErrorCodes.LOGIN_REQUIRED);
  });

  it("opens a visible browser and returns actionable metadata when verification is required", async () => {
    const events: string[] = [];
    const client = {
      browser: {
        async openVisiblePage(url?: string) {
          events.push(`open:${url}`);
        },
      },
    };

    const result = await handleMcpToolError(
      client,
      { code: ErrorCodes.HUMAN_VERIFICATION_REQUIRED, message: "触发知乎人机验证" },
      "SEARCH_FAILED",
      "搜索失败",
      "https://www.zhihu.com/search?type=content&q=test"
    );

    expect(events).toEqual(["open:https://www.zhihu.com/search?type=content&q=test"]);
    expect(result.error.code).toBe(ErrorCodes.HUMAN_VERIFICATION_REQUIRED);
    expect(result.meta.browser_opened).toBe(true);
    expect(result.meta.signal).toBe("WAIT_FOR_BROWSER_CLOSE");
    expect(result.meta.status_tool).toBe("zhihu_human_verification_status");
    expect(result.meta.action).toContain("手动完成验证");
  });

  it("reports rerun readiness after the visible verification browser is closed", async () => {
    let running = true;
    const client = {
      browser: {
        isRunning() {
          return running;
        },
        async openVisiblePage() {
          running = true;
        },
      },
    };

    await handleMcpToolError(
      client,
      { code: ErrorCodes.HUMAN_VERIFICATION_REQUIRED, message: "触发知乎人机验证" },
      "SEARCH_FAILED",
      "搜索失败",
      "https://www.zhihu.com/search?type=content&q=test"
    );

    expect(getHumanVerificationStatus(client).signal).toBe("WAIT_FOR_BROWSER_CLOSE");

    running = false;
    const status = getHumanVerificationStatus(client);

    expect(status.signal).toBe("RERUN_READY");
    expect(status.event).toBe("VERIFICATION_BROWSER_CLOSED");
    expect(status.should_rerun).toBe(true);
    expect(status.browser_running).toBe(false);
  });

  it("turns a hung tool operation into a clear timeout error", async () => {
    const result = await withToolTimeout(
      new Promise(() => {}),
      1,
      "SEARCH_TIMEOUT",
      "搜索超时"
    );

    expect(result.ok).toBe(false);
    expect(result.error.code).toBe("SEARCH_TIMEOUT");
    expect(result.meta.signal).toBe("TOOL_TIMEOUT");
  });

  it("returns quickly on human verification instead of waiting for browser close", async () => {
    const events: string[] = [];
    const client = {
      browser: {
        async openVisiblePage() {
          events.push("open");
        },
        isRunning() {
          return true;
        },
      },
    };

    const started = Date.now();
    const result = await runMcpTool(
      async () => {
        throw { code: ErrorCodes.HUMAN_VERIFICATION_REQUIRED, message: "触发知乎人机验证" };
      },
      client,
      "SEARCH_FAILED",
      "搜索失败",
      "https://www.zhihu.com/search?type=content&q=test",
      { toolTimeoutMs: 100 }
    );

    expect(Date.now() - started).toBeLessThan(100);
    expect(events).toEqual(["open"]);
    expect(result.ok).toBe(false);
    expect(result.error.code).toBe(ErrorCodes.HUMAN_VERIFICATION_REQUIRED);
    expect(result.meta.signal).toBe("WAIT_FOR_BROWSER_CLOSE");
    expect(result.meta.should_rerun).toBe(false);
  });
});
