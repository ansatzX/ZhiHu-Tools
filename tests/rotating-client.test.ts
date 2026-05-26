import { describe, expect, it, vi } from "vitest";
import { RotatingOfficialApiClient } from "../src/core/rotating-client";
import { OfficialApiError } from "../src/core/official-api";

/**
 * Build a createHttp factory for testing. Each key maps to a response
 * value (object or function). Interceptors are wired so that
 * assertOfficialSuccess in OfficialApiClient fires correctly.
 */
function makeCreateHttp(responses: Record<string, unknown | (() => unknown)>) {
  return (secret: string) => {
    const reqInterceptors: Array<(c: any) => any> = [];
    const resInterceptors: Array<(r: any) => any> = [];
    return {
      get: vi.fn(async (_url: string, config?: any) => {
        let cfg = { headers: {}, ...(config ?? {}) };
        for (const fn of reqInterceptors) cfg = await fn(cfg);
        const raw = responses[secret];
        const data = typeof raw === "function" ? (raw as Function)() : raw;
        let resp = { data, status: 200, headers: {}, config: cfg };
        for (const fn of resInterceptors) resp = await fn(resp);
        return resp;
      }),
      post: vi.fn(async (_url: string, _data?: any, config?: any) => {
        let cfg = { headers: {}, ...(config ?? {}) };
        for (const fn of reqInterceptors) cfg = await fn(cfg);
        const raw = responses[secret];
        const data = typeof raw === "function" ? (raw as Function)() : raw;
        let resp = { data, status: 200, headers: {}, config: cfg };
        for (const fn of resInterceptors) resp = await fn(resp);
        return resp;
      }),
      interceptors: {
        request: { use: vi.fn((fn: any) => reqInterceptors.push(fn)) },
        response: {
          use: vi.fn((successFn: any, _errFn?: any) => resInterceptors.push(successFn)),
        },
      },
    } as any;
  };
}

const OK_EMPTY = { Code: 0, Message: "ok", Data: { Items: [] } };
const RATE_LIMIT = { Code: 30001, Message: "day limit exceeded", Data: null };

describe("RotatingOfficialApiClient", () => {
  it("distributes requests round-robin across keys", async () => {
    const calls: string[] = [];
    const client = new RotatingOfficialApiClient(["k0", "k1", "k2"], {
      createHttp: makeCreateHttp({
        k0: () => { calls.push("k0"); return OK_EMPTY; },
        k1: () => { calls.push("k1"); return OK_EMPTY; },
        k2: () => { calls.push("k2"); return OK_EMPTY; },
      }),
    });

    await client.hotList({ limit: 1 });
    await client.hotList({ limit: 1 });
    await client.hotList({ limit: 1 });

    expect(calls).toEqual(["k0", "k1", "k2"]);
  });

  it("retries with next key on rate limit and marks key exhausted", async () => {
    const client = new RotatingOfficialApiClient(["key-bad", "key-good"], {
      createHttp: makeCreateHttp({
        "key-bad": RATE_LIMIT,
        "key-good": { Code: 0, Message: "ok", Data: { Items: [{ id: 1 }], Total: 1 } },
      }),
    });

    const result = await client.hotList({ limit: 1 });

    expect(result.Data?.Items).toEqual([{ id: 1 }]);
    expect(client.getKeyStatus()).toEqual([
      { keyIndex: 0, exhausted: true },
      { keyIndex: 1, exhausted: false },
    ]);
  });

  it("throws if all keys are exhausted", async () => {
    const client = new RotatingOfficialApiClient(["k1", "k2"], {
      createHttp: makeCreateHttp({ k1: RATE_LIMIT, k2: RATE_LIMIT }),
    });

    await expect(client.hotList({ limit: 1 })).rejects.toThrow(OfficialApiError);
    await expect(client.hotList({ limit: 1 })).rejects.toMatchObject({
      message: "day limit exceeded",
    });
  });

  it("skips exhausted keys in round-robin", async () => {
    const calls: string[] = [];
    const client = new RotatingOfficialApiClient(["k1", "k2", "k3"], {
      createHttp: makeCreateHttp({
        k1: () => { calls.push("k1"); return OK_EMPTY; },
        k2: () => { calls.push("k2"); return RATE_LIMIT; },
        k3: () => { calls.push("k3"); return OK_EMPTY; },
      }),
    });

    // round-robin 0 -> k1, succeeds
    await client.hotList({ limit: 1 });
    expect(calls).toEqual(["k1"]);

    // round-robin 1 -> k2, fails, retry k3
    await client.hotList({ limit: 1 });
    expect(calls).toEqual(["k1", "k2", "k3"]);

    // round-robin 0 -> k1 (k2 skipped)
    await client.hotList({ limit: 1 });
    expect(calls).toEqual(["k1", "k2", "k3", "k1"]);
  });

  it("isConfigured returns true if any key is provided", () => {
    expect(new RotatingOfficialApiClient(["k"]).isConfigured()).toBe(true);
    expect(new RotatingOfficialApiClient([]).isConfigured()).toBe(false);
  });

  it("verifyAccess returns true if any key works", async () => {
    const client = new RotatingOfficialApiClient(["key-bad", "key-good"], {
      createHttp: makeCreateHttp({ "key-bad": RATE_LIMIT, "key-good": OK_EMPTY }),
    });
    expect((await client.verifyAccess()).valid).toBe(true);
  });

  it("verifyAccess returns false if all keys fail", async () => {
    const client = new RotatingOfficialApiClient(["k1"], {
      createHttp: makeCreateHttp({ k1: RATE_LIMIT }),
    });
    expect((await client.verifyAccess()).valid).toBe(false);
  });

  it("resets exhausted keys after cooldown", async () => {
    vi.useFakeTimers();
    const calls: string[] = [];
    const client = new RotatingOfficialApiClient(["k1", "k2"], {
      createHttp: makeCreateHttp({
        k1: () => {
          calls.push("k1");
          if (calls.filter((c) => c === "k1").length <= 1) return RATE_LIMIT;
          return OK_EMPTY;
        },
        k2: () => { calls.push("k2"); return OK_EMPTY; },
      }),
      exhaustedCooldownMs: 60_000,
    });

    // k1 fails (round-robin 0), retry k2
    await client.hotList({ limit: 1 });
    expect(calls).toEqual(["k1", "k2"]);

    // k1 exhausted, k2 used directly
    await client.hotList({ limit: 1 });
    expect(calls).toEqual(["k1", "k2", "k2"]);

    // Advance past cooldown
    vi.advanceTimersByTime(61_000);

    // k1 retried and succeeds this time
    await client.hotList({ limit: 1 });
    expect(calls).toEqual(["k1", "k2", "k2", "k1"]);

    vi.useRealTimers();
  });
});
