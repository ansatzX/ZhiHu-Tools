import * as fs from "fs";
import * as os from "os";
import * as path from "path";
import { BrowserSessionError, ErrorCodes } from "./errors";

/**
 * 查找系统上可用的 Chrome/Chromium/Edge 浏览器路径
 */
export function findChrome(): string {
  const platform = process.platform;
  const candidates: string[] = [];

  if (platform === "darwin") {
    candidates.push(
      "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome",
      "/Applications/Google Chrome Canary.app/Contents/MacOS/Google Chrome Canary",
      "/Applications/Chromium.app/Contents/MacOS/Chromium",
      "/Applications/Microsoft Edge.app/Contents/MacOS/Microsoft Edge",
      "/Applications/Brave Browser.app/Contents/MacOS/Brave Browser"
    );
    // 检查 ~/Applications 目录
    const home = os.homedir();
    candidates.push(
      path.join(home, "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome"),
      path.join(home, "/Applications/Chromium.app/Contents/MacOS/Chromium")
    );
  } else if (platform === "win32") {
    const programFiles = process.env["PROGRAMFILES"] || "C:\\Program Files";
    const programFilesX86 = process.env["PROGRAMFILES(X86)"] || "C:\\Program Files (x86)";
    const localAppData = process.env["LOCALAPPDATA"] || `${os.homedir()}\\AppData\\Local`;
    candidates.push(
      path.join(programFiles, "Google/Chrome/Application/chrome.exe"),
      path.join(programFilesX86, "Google/Chrome/Application/chrome.exe"),
      path.join(localAppData, "Google/Chrome/Application/chrome.exe"),
      path.join(programFilesX86, "Microsoft/Edge/Application/msedge.exe"),
      path.join(localAppData, "Microsoft/Edge/Application/msedge.exe")
    );
  } else if (platform === "linux") {
    candidates.push(
      "/usr/bin/google-chrome",
      "/usr/bin/google-chrome-stable",
      "/usr/bin/chromium-browser",
      "/usr/bin/chromium",
      "/snap/bin/chromium"
    );
  }

  for (const candidate of candidates) {
    if (fs.existsSync(candidate)) {
      return candidate;
    }
  }

  throw new BrowserSessionError(
    `未找到 Chrome/Chromium 浏览器。请先安装 Google Chrome。`,
    ErrorCodes.CHROME_NOT_FOUND
  );
}

/**
 * 获取 zhihu-tools 专用的 Chrome profile 目录
 */
export function getProfileDir(): string {
  return path.join(os.homedir(), ".zhihu-tools", "chrome-profile");
}
