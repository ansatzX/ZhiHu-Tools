import { describe, it, expect, beforeEach, vi } from "vitest";
import { withCache, invalidateCache, clearAllCache } from "../src/core/cache";

describe("Cache", () => {
  beforeEach(() => {
    clearAllCache();
  });

  it("returns cached data on second call", async () => {
    const fn = vi.fn().mockResolvedValue("data");
    const key = "test-key";

    const r1 = await withCache(key, "hot", fn);
    const r2 = await withCache(key, "hot", fn);

    expect(r1).toBe("data");
    expect(r2).toBe("data");
    expect(fn).toHaveBeenCalledTimes(1);
  });

  it("invalidates cache per key", async () => {
    const fn = vi.fn().mockResolvedValue("data");
    const key = "test-key";

    await withCache(key, "hot", fn);
    invalidateCache(key);
    await withCache(key, "hot", fn);

    expect(fn).toHaveBeenCalledTimes(2);
  });

  it("calls fn when cache expires", async () => {
    vi.useFakeTimers();
    const fn = vi.fn().mockResolvedValue("data");
    const key = "test-key";

    await withCache(key, "hot", fn);
    expect(fn).toHaveBeenCalledTimes(1);

    // advance time beyond TTL (hot = 60000ms)
    vi.advanceTimersByTime(120_000);

    await withCache(key, "hot", fn);
    expect(fn).toHaveBeenCalledTimes(2);

    vi.useRealTimers();
  });

  it("separates cache by key", async () => {
    const fn1 = vi.fn().mockResolvedValue("data1");
    const fn2 = vi.fn().mockResolvedValue("data2");

    const r1 = await withCache("key1", "hot", fn1);
    const r2 = await withCache("key2", "hot", fn2);

    expect(r1).toBe("data1");
    expect(r2).toBe("data2");
    expect(fn1).toHaveBeenCalledTimes(1);
    expect(fn2).toHaveBeenCalledTimes(1);
  });
});
