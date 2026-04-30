import { ZhihuHttpClient } from "./http-client";
import { ZhihuProfile } from "./types";
import { encrypt as zhihuEncrypt } from "zhihu-encrypt";
import * as crypto from "crypto";
import { execSync } from "child_process";
import * as fs from "fs";
import * as path from "path";
import * as os from "os";

const CAPTCHA_API = "https://www.zhihu.com/api/v3/oauth/captcha?lang=en";
const LOGIN_API = "https://www.zhihu.com/api/v3/oauth/sign_in";
const PROFILE_API = "https://www.zhihu.com/api/v4/me";
const SIGNUP_PAGE = "https://www.zhihu.com/signup";

function openBrowser(url: string) {
  const cmd = process.platform === "darwin" ? "open" :
              process.platform === "win32" ? "start" : "xdg-open";
  try {
    execSync(`${cmd} "${url}"`, { timeout: 3000 });
  } catch {}
}

export class AuthService {
  constructor(private client: any) {}

  async isAuthenticated(): Promise<boolean> {
    // CDP 浏览器模式：通过 /api/v4/me 检查登录状态
    const browserSession = this.client.session;
    if (browserSession) {
      try {
        return await browserSession.checkAuthenticated();
      } catch {
        return false;
      }
    }

    // 旧 axios 模式
    try {
      const resp = await this.client.requestRaw({
        url: SIGNUP_PAGE,
        method: "GET",
        maxRedirects: 0,
        resolveWithFullResponse: true,
        validateStatus: (s) => s >= 200 && s < 400,
      });
      return resp.status === 302 || resp.status === 304;
    } catch {
      return false;
    }
  }

  async getProfile(): Promise<ZhihuProfile | null> {
    // CDP 浏览器模式
    const browserSession = this.client.session;
    if (browserSession) {
      try {
        const result = await browserSession.fetch(PROFILE_API);
        if (result.status === 200 && result.data) {
          const profile = result.data;
          return {
            id: profile.id,
            url_token: profile.url_token,
            name: profile.name,
            avatar_url: profile.avatar_url,
            headline: profile.headline,
            gender: profile.gender,
            uid: profile.uid,
            user_type: profile.user_type,
          };
        }
      } catch {}
      return null;
    }

    // 旧 axios 模式
    try {
      const resp = await this.client.requestRaw({
        url: PROFILE_API,
        method: "GET",
        resolveWithFullResponse: true,
        validateStatus: (s) => s >= 200 && s < 500,
      });
      if (resp.status === 200) {
        const profile = resp.data;
        return {
          id: profile.id,
          url_token: profile.url_token,
          name: profile.name,
          avatar_url: profile.avatar_url,
          headline: profile.headline,
          gender: profile.gender,
          uid: profile.uid,
          user_type: profile.user_type,
        };
      }
    } catch {}
    return null;
  }

  async logout() {
    await this.client.clearCookies();
  }

  async openLoginPage(): Promise<void> {
    const browserSession = this.client.session;
    if (browserSession) {
      if (typeof browserSession.navigate === "function") {
        await browserSession.navigate("https://www.zhihu.com/signin", { headless: false });
      } else {
        await browserSession.start("https://www.zhihu.com/signin", { headless: false });
      }
    }
  }

  async loginByBrowser(onPrompt?: () => Promise<void>): Promise<ZhihuProfile> {
    await this.client.clearCookies();

    const browserSession = this.client.session;

    if (browserSession) {
      // CDP 浏览器模式：在控制的 Chrome 中打开登录页
      if (typeof browserSession.navigate === "function") {
        await browserSession.navigate("https://www.zhihu.com/signin", { headless: false });
      } else {
        await browserSession.start("https://www.zhihu.com/signin", { headless: false });
      }

      if (onPrompt) {
        console.log("请在浏览器窗口中完成登录，然后回到终端按回车继续...");
        await onPrompt();
      }

      if (!(await this.isAuthenticated())) {
        throw new Error("登录验证失败");
      }

      const profile = await this.getProfile();
      if (!profile) throw new Error("获取用户信息失败");
      return profile;
    }

    // 旧模式：打开系统默认浏览器 + cookie 导入
    console.log("正在浏览器中打开知乎登录页...");
    openBrowser("https://www.zhihu.com/signin");

    if (onPrompt) {
      console.log("请在浏览器中完成登录，然后回到终端按回车继续...");
      await onPrompt();
    }

    if (!(await this.isAuthenticated())) {
      throw new Error("登录失败: 未检测到有效的会话");
    }

    const profile = await this.getProfile();
    if (!profile) throw new Error("获取用户信息失败");
    return profile;
  }

  async loginByBrowserInteractive(onPrompt?: () => Promise<void>): Promise<ZhihuProfile> {
    return this.loginByBrowser(onPrompt);
  }

  /** @deprecated 密码登录在浏览器模式下不可用，请使用 loginByBrowser */
  async loginByPassword(
    phoneNumber: string,
    password: string
  ): Promise<ZhihuProfile> {
    this.client.clearCookies();
    let captcha = "";

    const captchaStatus: any = await this.client.get(CAPTCHA_API);
    if (captchaStatus.show_captcha) {
      const captchaImg: any = await this.client.put(CAPTCHA_API);
      const imgBase64 = captchaImg["img_base64"];
      captcha = await this.promptCaptcha(imgBase64);

      let captchaResp: any = await this.client.post(
        CAPTCHA_API,
        { input_text: captcha },
        {
          headers: { "Content-Type": "application/x-www-form-urlencoded" },
          resolveWithFullResponse: true,
        }
      );

      let retries = 0;
      while (captchaResp.status !== 201 && retries < 3) {
        captcha = (await this.promptCaptcha(imgBase64)) || "";
        captchaResp = await this.client.post(
          CAPTCHA_API,
          { input_text: captcha },
          {
            headers: { "Content-Type": "application/x-www-form-urlencoded" },
            resolveWithFullResponse: true,
          }
        );
        retries++;
      }
    }

    const loginData: Record<string, any> = {
      client_id: "c3cef7c66a1843f8b3a9e6a1e3160e20",
      grant_type: "password",
      source: "com.zhihu.web",
      username: phoneNumber.startsWith("+86") ? phoneNumber : "+86" + phoneNumber,
      password: password,
      lang: "en",
      ref_source: "homepage",
      utm_source: "",
      captcha: captcha,
      timestamp: Math.round(Date.now()),
      signature: "",
    };

    loginData.signature = crypto
      .createHmac("sha1", "d1b964811afb40118a12068ff74a12f4")
      .update(
        "password" +
          loginData.client_id +
          loginData.source +
          loginData.timestamp.toString()
      )
      .digest("hex");

    const formurlencoded = require("form-urlencoded").default;
    const encryptedFormData = zhihuEncrypt(formurlencoded(loginData));

    const loginResp: any = await this.client.post(LOGIN_API, encryptedFormData, {
      headers: {
        "x-zse-83": "3_2.0",
        "Content-Type": "application/x-www-form-urlencoded",
      },
      resolveWithFullResponse: true,
    });

    if (loginResp.status !== 201) {
      throw new Error(`登录失败，状态码: ${loginResp.status}`);
    }

    const profile = await this.getProfile();
    if (!profile) throw new Error("登录后获取用户信息失败");
    return profile;
  }

  private async promptCaptcha(base64: string): Promise<string> {
    const prompts = await import("../util/captcha-prompt");
    return prompts.promptCaptcha(base64);
  }

  async getColumns(): Promise<any[]> {
    const profile = await this.getProfile();
    if (!profile) return [];
    const resp: any = await this.client.get(
      `https://www.zhihu.com/api/v4/members/${profile.url_token}/column-contributions?include=data%5B*%5D.column.intro%2Cfollowers%2Carticles_count&offset=0&limit=20`
    );
    return (resp.data || []).map((d: any) => d.column);
  }
}
