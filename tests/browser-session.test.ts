import { describe, expect, it, vi } from "vitest";

const spawnCalls: Array<{ command: string; args: string[] }> = [];

vi.mock("child_process", () => ({
  spawn: vi.fn((command: string, args: string[]) => {
    const listeners = new Map<string, Array<(...args: any[]) => void>>();
    const proc: any = {
      on: vi.fn((event: string, listener: (...args: any[]) => void) => {
        const current = listeners.get(event) || [];
        current.push(listener);
        listeners.set(event, current);
        return proc;
      }),
      killed: false,
      kill: vi.fn(() => {
        proc.killed = true;
        proc.exitCode = 0;
        setTimeout(() => {
          for (const listener of listeners.get("exit") || []) listener(0);
        }, 0);
      }),
      exitCode: null,
      signalCode: null,
    };
    spawnCalls.push({ command, args });
    return proc;
  }),
}));

vi.mock("fs", async () => {
  const actual = await vi.importActual<typeof import("fs")>("fs");
  return {
    ...actual,
    existsSync: vi.fn(() => true),
    mkdirSync: vi.fn(),
    unlinkSync: vi.fn(),
  };
});

vi.mock("../src/core/browser/cdp-client", () => ({
  CdpClient: class {
    async connect() {}
    async evaluate() {
      return "complete";
    }
    close() {}
  },
}));

vi.mock("../src/core/browser/browser-session", async (importOriginal) => {
  const actual = await importOriginal<typeof import("../src/core/browser/browser-session")>();
  class TestBrowserSession extends actual.BrowserSession {
    protected findFreePort(): Promise<number> {
      return Promise.resolve(9222);
    }
    protected waitForPort(): Promise<void> {
      return Promise.resolve();
    }
    protected waitForPageLoad(): Promise<void> {
      return Promise.resolve();
    }
    protected getOrCreatePage(): Promise<string> {
      return Promise.resolve("ws://127.0.0.1/devtools/page/1");
    }
  }
  return {
    ...actual,
    BrowserSession: TestBrowserSession,
  };
});

describe("BrowserSession launch mode", () => {
  it("starts Chrome headless by default for non-login MCP work", async () => {
    spawnCalls.length = 0;
    const { BrowserSession } = await import("../src/core/browser/browser-session");
    const session = new BrowserSession();

    await session.start("https://www.zhihu.com/search?q=test");

    expect(spawnCalls[0].args).toContain("--headless=new");
  });

  it("can start Chrome visibly for login", async () => {
    spawnCalls.length = 0;
    const { BrowserSession } = await import("../src/core/browser/browser-session");
    const session = new BrowserSession();

    await session.start("https://www.zhihu.com/signin", { headless: false });

    expect(spawnCalls[0].args).not.toContain("--headless=new");
  });

  it("restarts a headless session as visible when human verification needs user action", async () => {
    spawnCalls.length = 0;
    const { BrowserSession } = await import("../src/core/browser/browser-session");
    const session = new BrowserSession();

    await session.start("https://www.zhihu.com/search?q=test");
    await session.openVisiblePage("https://www.zhihu.com/search?q=test");

    expect(spawnCalls).toHaveLength(2);
    expect(spawnCalls[0].args).toContain("--headless=new");
    expect(spawnCalls[1].args).not.toContain("--headless=new");
  });
});
