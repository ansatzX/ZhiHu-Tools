import { handleMcpToolError, withToolTimeout } from "./error-handler";

export async function runMcpTool<T>(
  fn: () => Promise<T>,
  client: any,
  fallbackCode: string,
  fallbackMessage: string,
  verificationUrl?: string,
  options?: { toolTimeoutMs?: number }
): Promise<T | any> {
  try {
    const result = await withToolTimeout(
      fn(),
      options?.toolTimeoutMs ?? 45_000,
      `${fallbackCode}_TIMEOUT`,
      `${fallbackMessage}: 工具执行超时`
    );
    return result as T | any;
  } catch (err: any) {
    return handleMcpToolError(client, err, fallbackCode, fallbackMessage, verificationUrl);
  }
}
