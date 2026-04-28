/**
 * 内存缓存和速率限制
 * 防止频繁请求触发知乎风控，同时减少重复请求
 */

interface CacheEntry<T> {
  data: T;
  expiry: number;
}

const cache = new Map<string, CacheEntry<any>>();

const DEFAULT_TTL: Record<string, number> = {
  hot: 60_000,       // 热榜 1 分钟
  feed: 30_000,      // 推荐流 30 秒
  question: 120_000, // 问题 2 分钟
  article: 120_000,  // 文章 2 分钟
  search: 30_000,    // 搜索 30 秒
};

/**
 * 从缓存获取，未命中时执行 fn 获取并缓存
 */
export async function withCache<T>(
  key: string,
  category: string,
  fn: () => Promise<T>
): Promise<T> {
  const cached = cache.get(key);
  if (cached && cached.expiry > Date.now()) {
    return cached.data;
  }

  const data = await fn();

  const ttl = DEFAULT_TTL[category] || 30_000;
  cache.set(key, { data, expiry: Date.now() + ttl });

  return data;
}

/**
 * 清除指定 key 的缓存
 */
export function invalidateCache(key: string): void {
  cache.delete(key);
}

/**
 * 清除所有缓存
 */
export function clearAllCache(): void {
  cache.clear();
}

// -- 速率限制 --

let lastRequestTime = 0;
const MIN_INTERVAL_MS = 500; // 最小请求间隔 500ms

/**
 * 等待速率限制窗口，确保请求之间有最小间隔
 */
export async function rateLimit(): Promise<void> {
  const now = Date.now();
  const elapsed = now - lastRequestTime;
  if (elapsed < MIN_INTERVAL_MS) {
    await sleep(MIN_INTERVAL_MS - elapsed);
  }
  lastRequestTime = Date.now();
}

function sleep(ms: number): Promise<void> {
  return new Promise((r) => setTimeout(r, ms));
}
