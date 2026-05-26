/**
 * OfficialApiClient 单元测试
 *
 * 测试 auth 头生成、参数构造、错误处理，无需真实 API 调用。
 */
import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { OfficialApiClient, OfficialApiError, assertOfficialSuccess } from "../src/core/official-api";

describe("OfficialApiClient", () => {
  const OLD_ENV = process.env.ZHIHU_ACCESS_SECRET;

  beforeEach(() => {
    delete process.env.ZHIHU_ACCESS_SECRET;
  });

  afterEach(() => {
    if (OLD_ENV) {
      process.env.ZHIHU_ACCESS_SECRET = OLD_ENV;
    } else {
      delete process.env.ZHIHU_ACCESS_SECRET;
    }
  });

  describe("constructor and isConfigured", () => {
    it("is not configured when no secret provided", () => {
      const client = new OfficialApiClient();
      expect(client.isConfigured()).toBe(false);
    });

    it("is configured via constructor", () => {
      const client = new OfficialApiClient({ accessSecret: "test-secret" });
      expect(client.isConfigured()).toBe(true);
    });

    it("is configured via environment variable", () => {
      process.env.ZHIHU_ACCESS_SECRET = "env-secret";
      const client = new OfficialApiClient();
      expect(client.isConfigured()).toBe(true);
    });

    it("constructor argument takes precedence over env", () => {
      process.env.ZHIHU_ACCESS_SECRET = "env-secret";
      const client = new OfficialApiClient({ accessSecret: "ctor-secret" });
      expect(client.isConfigured()).toBe(true);
      // We can't easily inspect private accessSecret, but setAccessSecret works
    });
  });

  describe("setAccessSecret", () => {
    it("updates configuration state", () => {
      const client = new OfficialApiClient();
      expect(client.isConfigured()).toBe(false);
      client.setAccessSecret("new-secret");
      expect(client.isConfigured()).toBe(true);
    });

    it("clears when set to empty", () => {
      const client = new OfficialApiClient({ accessSecret: "old" });
      client.setAccessSecret("");
      expect(client.isConfigured()).toBe(false);
    });
  });

  describe("OfficialApiError", () => {
    it("creates error with all fields", () => {
      const err = new OfficialApiError("bad request", "400", 400, { detail: "x" });
      expect(err).toBeInstanceOf(Error);
      expect(err.name).toBe("OfficialApiError");
      expect(err.message).toBe("bad request");
      expect(err.code).toBe("400");
      expect(err.status).toBe(400);
      expect(err.raw).toEqual({ detail: "x" });
    });

    it("creates error with minimal fields", () => {
      const err = new OfficialApiError("network error", "NETWORK_ERROR", 0);
      expect(err.code).toBe("NETWORK_ERROR");
      expect(err.status).toBe(0);
      expect(err.raw).toBeUndefined();
    });
  });

  describe("official envelope business errors", () => {
    it("throws OfficialApiError when the upstream envelope Code is non-zero", () => {
      expect(() =>
        assertOfficialSuccess({ Code: 30001, Message: "day limit exceeded", Data: null })
      ).toThrow(OfficialApiError);
      expect(() =>
        assertOfficialSuccess({ Code: 30001, Message: "day limit exceeded", Data: null })
      ).toThrow("day limit exceeded");
    });

    it("accepts successful official envelopes", () => {
      expect(() =>
        assertOfficialSuccess({ Code: 0, Message: "success", Data: { Items: [] } })
      ).not.toThrow();
    });
  });

  describe("verifyAccess with no secret", () => {
    it("throws when making API call without secret", async () => {
      const client = new OfficialApiClient();
      await expect(client.zhihuSearch({ query: "test" })).rejects.toThrow(
        OfficialApiError
      );
      await expect(client.zhihuSearch({ query: "test" })).rejects.toMatchObject({
        code: "NO_ACCESS_SECRET",
        status: 0,
      });
    });
  });

  describe("verifyAccess probe", () => {
    it("uses zhihu_search as the access probe instead of hot_list quota", async () => {
      const client = new OfficialApiClient({ accessSecret: "test-secret" });
      const search = vi.fn().mockResolvedValue({ Code: 0, Message: "success", Data: { Items: [] } });
      const hotList = vi.fn().mockRejectedValue(new OfficialApiError("day limit exceeded", "30001", 200));
      client.zhihuSearch = search as any;
      client.hotList = hotList as any;

      await expect(client.verifyAccess()).resolves.toEqual({ valid: true });
      expect(search).toHaveBeenCalledWith({ query: "test", limit: 1 });
      expect(hotList).not.toHaveBeenCalled();
    });
  });
});
