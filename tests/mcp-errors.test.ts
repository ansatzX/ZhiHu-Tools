import { describe, it, expect } from "vitest";
import {
  ErrorCode,
  standardError,
  notConfiguredError,
  upstreamError,
  internalError,
  timeoutError,
} from "../src/mcp/errors";

describe("MCP Error Codes", () => {
  describe("ErrorCode constants", () => {
    it("has standard JSON-RPC error codes", () => {
      expect(ErrorCode.PARSE_ERROR).toBe(-32700);
      expect(ErrorCode.INVALID_REQUEST).toBe(-32600);
      expect(ErrorCode.METHOD_NOT_FOUND).toBe(-32601);
      expect(ErrorCode.INVALID_PARAMS).toBe(-32602);
      expect(ErrorCode.INTERNAL_ERROR).toBe(-32603);
    });

    it("has custom error codes", () => {
      expect(ErrorCode.UNAUTHORIZED).toBe(-32001);
      expect(ErrorCode.RATE_LIMITED).toBe(-32002);
      expect(ErrorCode.UPSTREAM_ERROR).toBe(-32003);
      expect(ErrorCode.NOT_CONFIGURED).toBe(-32004);
      expect(ErrorCode.TIMEOUT).toBe(-32005);
    });
  });

  describe("standardError", () => {
    it("creates error with code and message", () => {
      const err = standardError(ErrorCode.UNAUTHORIZED, "unauthorized");
      expect(err.ok).toBe(false);
      expect(err.error.code).toBe(-32001);
      expect(err.error.message).toBe("unauthorized");
      expect(err.error.data).toBeUndefined();
    });

    it("includes optional data", () => {
      const err = standardError(ErrorCode.UPSTREAM_ERROR, "bad gateway", { status: 502 });
      expect(err.error.data).toEqual({ status: 502 });
    });
  });

  describe("notConfiguredError", () => {
    it("returns NOT_CONFIGURED error", () => {
      const err = notConfiguredError();
      expect(err.error.code).toBe(ErrorCode.NOT_CONFIGURED);
      expect(err.error.message).toContain("ZHIHU_ACCESS_SECRET");
    });
  });

  describe("upstreamError", () => {
    it("includes status and raw data", () => {
      const raw = { detail: "quota exceeded" };
      const err = upstreamError(429, "rate limited", raw);
      expect(err.error.code).toBe(ErrorCode.UPSTREAM_ERROR);
      expect(err.error.data).toEqual({ status: 429, raw });
    });
  });

  describe("internalError", () => {
    it("wraps Error instance", () => {
      const err = internalError(new Error("something broke"));
      expect(err.error.code).toBe(ErrorCode.INTERNAL_ERROR);
      expect(err.error.message).toBe("something broke");
    });

    it("wraps string", () => {
      const err = internalError("plain error");
      expect(err.error.message).toBe("plain error");
    });
  });

  describe("timeoutError", () => {
    it("includes tool name", () => {
      const err = timeoutError("zhihu_search");
      expect(err.error.code).toBe(ErrorCode.TIMEOUT);
      expect(err.error.message).toContain("zhihu_search");
    });
  });
});
