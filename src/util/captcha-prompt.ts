import * as fs from "fs";
import * as path from "path";
import * as os from "os";

export async function promptCaptcha(base64Image: string): Promise<string> {
  const tmpFile = path.join(os.tmpdir(), `zhihu-captcha-${Date.now()}.jpg`);
  fs.writeFileSync(tmpFile, base64Image, "base64");

  console.log(`\n验证码图片已保存至: ${tmpFile}`);
  console.log("请打开该图片查看验证码");

  const readline = await import("readline");
  const rl = readline.createInterface({
    input: process.stdin,
    output: process.stdout,
  });

  return new Promise((resolve) => {
    rl.question("请输入验证码: ", (answer) => {
      rl.close();
      try {
        fs.unlinkSync(tmpFile);
      } catch {}
      resolve(answer.trim());
    });
  });
}
