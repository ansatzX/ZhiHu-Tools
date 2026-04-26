#!/usr/bin/env node
/**
 * 从 Chrome 中提取知乎 Cookie 并保存为 JSON
 * 用法: node scripts/extract-zhihu-cookies.mjs
 */

import { execSync } from "child_process";
import { createDecipheriv, pbkdf2Sync } from "crypto";
import { existsSync, readFileSync, writeFileSync } from "fs";
import { homedir } from "os";
import { join } from "path";
import { createRequire } from "module";

const require = createRequire(import.meta.url);

const CHROME_COOKIE_PATHS = [
  join(homedir(), "Library/Application Support/Google/Chrome/Default/Cookies"),
  join(homedir(), "Library/Application Support/Google/Chrome/Default/Network/Cookies"),
];

const OUTPUT_PATH = join(homedir(), ".zhihu-cookies.json");

function findCookieDb() {
  for (const p of CHROME_COOKIE_PATHS) {
    if (existsSync(p)) return p;
  }
  return null;
}

function getKeychainPassword() {
  try {
    const keytar = require("keytar");
    return keytar.getPasswordSync("Chrome Safe Storage", "Chrome");
  } catch {
    try {
      return execSync(
        'security find-generic-password -w -s "Chrome Safe Storage"',
        { encoding: "utf-8", timeout: 5000 }
      ).trim();
    } catch {
      return null;
    }
  }
}

function decryptV10(derivedKey, encryptedValue) {
  const iv = Buffer.alloc(16, 0x20);
  const data = encryptedValue.slice(3);
  const decipher = createDecipheriv("aes-128-cbc", derivedKey, iv);
  decipher.setAutoPadding(false);
  let decrypted = decipher.update(data);
  const final = decipher.final();
  decrypted = Buffer.concat([decrypted, final]);
  const padding = decrypted[decrypted.length - 1];
  return decrypted.slice(32, decrypted.length - padding).toString("utf8");
}

function decryptV11(keychainPwd, encryptedValue) {
  const nonce = encryptedValue.slice(3, 15);
  const tag = encryptedValue.slice(encryptedValue.length - 16);
  const data = encryptedValue.slice(15, encryptedValue.length - 16);
  const derivedKey = pbkdf2Sync(keychainPwd, "saltysalt", 1003, 32, "sha1");
  const decipher = createDecipheriv("aes-256-gcm", derivedKey, nonce);
  decipher.setAuthTag(tag);
  let str = decipher.update(data, "binary", "utf8");
  str += decipher.final("utf-8");
  return str;
}

function main() {
  console.log("查找 Chrome cookie 数据库...");
  const dbPath = findCookieDb();
  if (!dbPath) {
    console.error("❌ 未找到 Chrome cookie 数据库！");
    console.error("   请确保安装了 Chrome 并且至少登录过一次知乎。");
    process.exit(1);
  }
  console.log(`✅ 找到: ${dbPath}`);

  // 获取 keychain 密码
  console.log("\n获取 Chrome 加密密钥...");
  const keychainPwd = getKeychainPassword();
  if (!keychainPwd) {
    console.error("❌ 无法获取 Chrome keychain 密码！");
    console.error("   请确保运行了以下命令并允许访问 keychain：");
    console.error('   security find-generic-password -w -s "Chrome Safe Storage"');
    process.exit(1);
  }
  // 派生 AES-128-CBC 密钥
  const derivedKeyCBC = pbkdf2Sync(keychainPwd, "saltysalt", 1003, 16, "sha1");
  console.log("✅ 密钥获取成功");

  // 查询 zhihu.com cookies
  console.log("\n查询 cookie 数据库...");
  const safePath = dbPath.replace(/'/g, "'\\''");
  const query = `SELECT host_key, name, hex(encrypted_value) as enc_hex FROM cookies WHERE host_key LIKE '%zhihu.com'`;

  let output;
  try {
    output = execSync(
      `sqlite3 '${safePath}' -separator $'\\t' "${query}"`,
      { encoding: "utf-8", timeout: 10000 }
    );
  } catch (e) {
    console.error("❌ 查询失败:", e.message);
    process.exit(1);
  }

  const lines = output.trim().split("\n").filter(Boolean);
  if (lines.length === 0) {
    console.error("❌ Chrome 中未找到 zhihu.com 的 cookie。");
    console.error("   请先在 Chrome 中登录 https://www.zhihu.com");
    process.exit(1);
  }
  console.log(`✅ 找到 ${lines.length} 个 cookie 条目`);

  // 解密
  const cookies = [];
  let success = 0;
  let fail = 0;

  for (const line of lines) {
    const parts = line.split("\t");
    if (parts.length < 3) {
      fail++;
      continue;
    }
    const [host_key, name, enc_hex] = parts;
    if (!enc_hex || enc_hex.length === 0) {
      fail++;
      continue;
    }

    try {
      const buf = Buffer.from(enc_hex, "hex");
      if (buf.length < 3) { fail++; continue; }

      const version = buf.slice(0, 3).toString();
      let value;

      if (version === "v10") {
        value = decryptV10(derivedKeyCBC, buf);
      } else if (version === "v11") {
        value = decryptV11(keychainPwd, buf);
      } else {
        fail++;
        continue;
      }

      cookies.push({ name, value, domain: host_key });
      success++;
    } catch (e) {
      fail++;
    }
  }

  console.log(`   解密成功: ${success}, 失败: ${fail}`);

  if (cookies.length === 0) {
    console.error("❌ 未能解密任何 cookie");
    process.exit(1);
  }

  // 检查关键 cookie
  const names = cookies.map((c) => c.name);
  const keyCookies = ["sessionid", "z_c0", "login", "q_c1", "_xsrf"];
  for (const k of keyCookies) {
    console.log(`   ${k}: ${names.includes(k) ? "✅" : "❌"}`);
  }

  // 保存
  writeFileSync(OUTPUT_PATH, JSON.stringify(cookies, null, 2), "utf-8");
  console.log(`\n✅ 已保存 ${cookies.length} 个 cookie 到 ${OUTPUT_PATH}`);
}

main();
