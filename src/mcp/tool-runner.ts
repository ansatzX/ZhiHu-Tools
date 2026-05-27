// @deprecated — legacy browser/CDP tool runner, not used by current MCP mainline
import { handleMcpToolError, withToolTimeout, type McpErrorResult } from "./error-handler";

export async function runMcpTool<T>(
  fn: () => Promise<T>,
  client: any,
  fallbackCode: string,
  fallbackMessage: string,
  verificationUrl?: string,
  options?: { toolTimeoutMs?: number }
): Promise<T | McpErrorResult> {
  try {
    const result = await withToolTimeout(
      fn(),
      options?.toolTimeoutMs ?? 45_000,
      `${fallbackCode}_TIMEOUT`,
      `${fallbackMessage}: 工具执行超时`
    );
    return result;
  } catch (err: unknown) {
    return handleMcpToolError(client, err, fallbackCode, fallbackMessage, verificationUrl);
  }
}
