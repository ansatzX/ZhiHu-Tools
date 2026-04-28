/** @deprecated 旧版 cookie 文件存储，主线已改用 Chrome profile。见 browser-session.ts */
import * as fs from "fs";
import { Store, Cookie } from "tough-cookie";

interface StoredCookie {
  key: string;
  value: string;
  domain: string;
  path: string;
  secure?: boolean;
  httpOnly?: boolean;
  hostOnly?: boolean;
  creation?: string;
  lastAccessed?: string;
  expires?: string;
  maxAge?: number;
}

export class FileCookieStore extends Store {
  private filePath: string;
  private cookies: StoredCookie[] = [];

  constructor(filePath: string) {
    super();
    (this as any).synchronous = true;
    this.filePath = filePath;
    this.load();
  }

  private load() {
    try {
      const data = JSON.parse(fs.readFileSync(this.filePath, "utf-8"));
      this.cookies = Array.isArray(data) ? data : [];
    } catch {
      this.cookies = [];
    }
  }

  private save() {
    fs.writeFileSync(this.filePath, JSON.stringify(this.cookies, null, 2), "utf-8");
  }

  putCookie(cookie: Cookie, callback: (err: Error | null) => void) {
    const existing = this.cookies.findIndex(
      (c) =>
        c.key === cookie.key &&
        c.domain === cookie.domain &&
        c.path === cookie.path
    );
    const stored = cookie.toJSON() as any;
    if (existing >= 0) {
      this.cookies[existing] = stored;
    } else {
      this.cookies.push(stored);
    }
    this.save();
    callback(null);
  }

  findCookie(
    domain: string,
    path: string,
    key: string,
    callback: (err: Error | null, cookie?: Cookie | null) => void
  ) {
    const c = this.cookies.find(
      (c) => c.key === key && c.domain === domain && c.path === path
    );
    callback(null, c ? Cookie.fromJSON(JSON.stringify(c)) : null);
  }

  findCookies(
    domain: string,
    path: string,
    callback: (err: Error | null, cookies?: Cookie[]) => void
  ): void;
  findCookies(
    domain: string,
    path: string,
    allowSpecialUseDomain: boolean,
    callback: (err: Error | null, cookies?: Cookie[]) => void
  ): void;
  findCookies(domain: string, path: string, arg3: any, arg4?: any) {
    const callback = arguments.length === 4 ? arg4 : arg3;
    // Return all non-expired cookies; CookieJar handles domain/path matching
    const matching = this.cookies.filter((c) => {
      if (c.expires && new Date(c.expires) < new Date()) return false;
      return true;
    });
    callback(null, matching.map((c) => Cookie.fromJSON(JSON.stringify(c))));
  }

  removeCookie(
    domain: string,
    path: string,
    key: string,
    callback: (err: Error | null) => void
  ) {
    this.cookies = this.cookies.filter(
      (c) => !(c.key === key && c.domain === domain && c.path === path)
    );
    this.save();
    callback(null);
  }

  removeCookies(
    domain: string,
    path: string,
    callback: (err: Error | null) => void
  ) {
    this.cookies = this.cookies.filter((c) => c.domain !== domain);
    this.save();
    callback(null);
  }

  getAllCookies(callback: (err: Error | null, cookies?: Cookie[]) => void) {
    callback(
      null,
      this.cookies.map((c) => Cookie.fromJSON(JSON.stringify(c)))
    );
  }

  removeAllCookiesSync() {
    this.cookies = [];
    this.save();
  }
}
