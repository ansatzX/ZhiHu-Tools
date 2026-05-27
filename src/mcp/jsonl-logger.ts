import * as fs from "fs";
import * as path from "path";
import * as os from "os";

const DEFAULT_LOG_DIR = path.join(os.homedir(), ".zhihu-tools", "logs");

export interface JsonlEntry {
  ts: string;
  level: "info" | "error";
  event: string;
  [key: string]: unknown;
}

export class JsonlLogger {
  private stream: fs.WriteStream | null = null;
  private logPath: string;

  constructor(logDir?: string) {
    const dir = logDir ?? DEFAULT_LOG_DIR;
    fs.mkdirSync(dir, { recursive: true });
    const date = new Date().toISOString().slice(0, 10);
    this.logPath = path.join(dir, `zhihu-mcp-${date}.jsonl`);
    this.stream = fs.createWriteStream(this.logPath, { flags: "a" });
  }

  log(entry: JsonlEntry): void {
    if (!this.stream) return;
    try {
      this.stream.write(JSON.stringify(entry) + "\n");
    } catch {
      // Never let logging failures break the MCP server
    }
  }

  toolRequest(tool: string, args: unknown): void {
    this.log({ ts: new Date().toISOString(), level: "info", event: "tool_request", tool, args });
  }

  toolResponse(tool: string, ok: boolean, durationMs: number, error?: string): void {
    this.log({
      ts: new Date().toISOString(),
      level: ok ? "info" : "error",
      event: "tool_response",
      tool,
      ok,
      durationMs,
      ...(error ? { error } : {}),
    });
  }

  close(): void {
    this.stream?.end();
    this.stream = null;
  }
}
