import {
  OfficialApiClient,
  OfficialApiError,
  type CreateHttpFn,
} from "./official-api";
import type {
  OfficialSearchParams,
  OfficialSearchResponse,
  OfficialHotListParams,
  OfficialHotListResponse,
  OfficialZhidaParams,
  OfficialZhidaResponse,
  OfficialGlobalSearchParams,
  OfficialGlobalSearchResponse,
} from "./types";

const RATE_LIMIT_CODE = "30001";
const DEFAULT_COOLDOWN_MS = 5 * 60 * 1000; // 5 minutes

export interface KeyStatus {
  keyIndex: number;
  exhausted: boolean;
}

export class RotatingOfficialApiClient {
  private clients: OfficialApiClient[];
  private exhaustedUntil: Map<number, number> = new Map();
  private roundRobinIndex = 0;
  private cooldownMs: number;

  constructor(
    keys: string[],
    options?: { createHttp?: CreateHttpFn; exhaustedCooldownMs?: number }
  ) {
    this.cooldownMs = options?.exhaustedCooldownMs ?? DEFAULT_COOLDOWN_MS;
    this.clients = keys.map(
      (key) =>
        new OfficialApiClient({ accessSecret: key, createHttp: options?.createHttp })
    );
  }

  isConfigured(): boolean {
    return this.clients.length > 0 && this.clients.some((c) => c.isConfigured());
  }

  getKeyStatus(): KeyStatus[] {
    const now = Date.now();
    return this.clients.map((_, i) => ({
      keyIndex: i,
      exhausted: this.isExhausted(i, now),
    }));
  }

  async hotList(params: OfficialHotListParams = {}): Promise<OfficialHotListResponse> {
    return this.withRotation((client) => client.hotList(params));
  }

  async zhihuSearch(params: OfficialSearchParams): Promise<OfficialSearchResponse> {
    return this.withRotation((client) => client.zhihuSearch(params));
  }

  async zhida(params: OfficialZhidaParams): Promise<OfficialZhidaResponse> {
    return this.withRotation((client) => client.zhida(params));
  }

  async globalSearch(params: OfficialGlobalSearchParams): Promise<OfficialGlobalSearchResponse> {
    return this.withRotation((client) => client.globalSearch(params));
  }

  async verifyAccess(): Promise<{ valid: boolean; error?: string }> {
    // Try each available key; return true on first success
    for (let i = 0; i < this.clients.length; i++) {
      const idx = this.nextAvailableIndex();
      if (idx === -1) break;
      const result = await this.clients[idx].verifyAccess();
      if (result.valid) return result;
    }
    return { valid: false, error: "all keys exhausted or invalid" };
  }

  // ---- internals ----

  private async withRotation<T>(fn: (client: OfficialApiClient) => Promise<T>): Promise<T> {
    const tried = new Set<number>();
    let lastError: unknown;

    // First pass: prefer non-exhausted keys. Second pass: if no non-exhausted
    // key was found, try exhausted ones so the caller always gets a real error.
    let allowExhausted = false;
    while (tried.size < this.clients.length) {
      const idx = allowExhausted ? this.pickAny(tried) : this.pickIndex(tried);
      if (idx === -1) {
        if (!allowExhausted && tried.size === 0) {
          allowExhausted = true;
          continue;
        }
        break;
      }
      tried.add(idx);

      try {
        return await fn(this.clients[idx]);
      } catch (err: unknown) {
        if (this.isRateLimitError(err)) {
          this.markExhausted(idx);
          lastError = err;
          continue;
        }
        throw err;
      }
    }

    // All keys exhausted — throw the last rate-limit error
    throw lastError;
  }

  /** Pick any untried index regardless of exhaustion (fallback). */
  private pickAny(tried: Set<number>): number {
    const len = this.clients.length;
    for (let step = 0; step < len; step++) {
      const idx = (this.roundRobinIndex + step) % len;
      if (tried.has(idx)) continue;
      this.roundRobinIndex = (idx + 1) % len;
      return idx;
    }
    return -1;
  }

  private pickIndex(tried: Set<number>): number {
    const now = Date.now();
    const len = this.clients.length;
    for (let step = 0; step < len; step++) {
      const idx = (this.roundRobinIndex + step) % len;
      if (tried.has(idx)) continue;
      if (this.isExhausted(idx, now)) continue;
      this.roundRobinIndex = (idx + 1) % len;
      return idx;
    }
    return -1;
  }

  /** Pick next available index without advancing round-robin (for verifyAccess). */
  private nextAvailableIndex(): number {
    const now = Date.now();
    const len = this.clients.length;
    for (let step = 0; step < len; step++) {
      const idx = (this.roundRobinIndex + step) % len;
      if (!this.isExhausted(idx, now)) {
        this.roundRobinIndex = (idx + 1) % len;
        return idx;
      }
    }
    return -1;
  }

  private isExhausted(idx: number, now: number): boolean {
    const until = this.exhaustedUntil.get(idx);
    if (until === undefined) return false;
    if (now >= until) {
      this.exhaustedUntil.delete(idx);
      return false;
    }
    return true;
  }

  private markExhausted(idx: number): void {
    this.exhaustedUntil.set(idx, Date.now() + this.cooldownMs);
  }

  private isRateLimitError(err: unknown): boolean {
    return (
      err instanceof OfficialApiError &&
      err.code === RATE_LIMIT_CODE
    );
  }
}

export default RotatingOfficialApiClient;
