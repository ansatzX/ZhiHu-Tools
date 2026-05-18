/**
 * MCP 标准化错误码 (JSON-RPC 2.0)
 *
 * -32700  Parse error
 * -32600  Invalid Request
 * -32601  Method not found
 * -32602  Invalid params
 * -32603  Internal error
 *
 * 自定义范围: -32000 ~ -32099
 */

export const ErrorCode = {
  // JSON-RPC 标准
  PARSE_ERROR: -32700,
  INVALID_REQUEST: -32600,
  METHOD_NOT_FOUND: -32601,
  INVALID_PARAMS: -32602,
  INTERNAL_ERROR: -32603,

  // 自定义 (知乎开放平台)
  UNAUTHORIZED: -32001,
  RATE_LIMITED: -32002,
  UPSTREAM_ERROR: -32003,
  NOT_CONFIGURED: -32004,
  TIMEOUT: -32005,
} as const;

export type ErrorCodeValue = (typeof ErrorCode)[keyof typeof ErrorCode];

export interface McpStandardError {
  ok: false;
  error: {
    code: number;
    message: string;
    data?: unknown;
  };
}

export function standardError(
  code: ErrorCodeValue,
  message: string,
  data?: unknown
): McpStandardError {
  return {
    ok: false,
    error: { code, message, ...(data !== undefined && { data }) },
  };
}

export function notConfiguredError(): McpStandardError {
  return standardError(
    ErrorCode.NOT_CONFIGURED,
    "未配置 ZHIHU_ACCESS_SECRET。请在知乎开放平台获取 Access Secret 并设为环境变量"
  );
}

export function upstreamError(status: number, message: string, raw?: unknown): McpStandardError {
  return standardError(ErrorCode.UPSTREAM_ERROR, message, { status, raw });
}

export function internalError(err: unknown): McpStandardError {
  const msg = err instanceof Error ? err.message : String(err);
  return standardError(ErrorCode.INTERNAL_ERROR, msg);
}

export function timeoutError(toolName: string): McpStandardError {
  return standardError(ErrorCode.TIMEOUT, `工具 ${toolName} 执行超时`);
}
