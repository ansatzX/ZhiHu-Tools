import { describe, it, expect } from "vitest";
import { AuthService } from "../src/core/auth";

function makeProfile() {
  return {
    id: "id1",
    url_token: "token",
    name: "Tester",
    avatar_url: "avatar",
    headline: "headline",
    gender: 0,
    uid: "uid1",
    user_type: "people",
  };
}

describe("AuthService browser login navigation", () => {
  it("awaits cookie clearing before navigating to signin during browser login", async () => {
    const events: string[] = [];
    const session = {
      async navigate(url: string, options?: { headless?: boolean }) {
        events.push(`navigate:${url}:${options?.headless}`);
      },
      async start(url?: string) {
        events.push(`start:${url}`);
      },
      async checkAuthenticated() {
        events.push("checkAuthenticated");
        return true;
      },
      async fetch(_url: string) {
        events.push("fetchProfile");
        return { status: 200, data: makeProfile() };
      },
    };
    const client = {
      session,
      async clearCookies() {
        events.push("clear-start");
        await new Promise((resolve) => setTimeout(resolve, 10));
        events.push("clear-end");
      },
    };

    const auth = new AuthService(client);
    const profile = await auth.loginByBrowser();

    expect(profile.name).toBe("Tester");
    expect(events.slice(0, 2)).toEqual(["clear-start", "clear-end"]);
    expect(events).toContain("navigate:https://www.zhihu.com/signin:false");
    expect(events).not.toContain("start:https://www.zhihu.com/signin");
    expect(events.indexOf("clear-end")).toBeLessThan(events.indexOf("navigate:https://www.zhihu.com/signin:false"));
  });

  it("openLoginPage navigates an existing browser session to signin", async () => {
    const events: string[] = [];
    const session = {
      async navigate(url: string, options?: { headless?: boolean }) {
        events.push(`navigate:${url}:${options?.headless}`);
      },
      async start(url?: string) {
        events.push(`start:${url}`);
      },
    };
    const auth = new AuthService({ session });

    await auth.openLoginPage();

    expect(events).toEqual(["navigate:https://www.zhihu.com/signin:false"]);
  });
});
