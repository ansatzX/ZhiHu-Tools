/**
 * 知乎开放平台官方 API 客户端
 *
 * 基于 https://developer.zhihu.com/ 提供的四个接口：
 *   - zhihu_search  知乎站内搜索
 *   - hot_list      知乎热榜
 *   - zhida         直答 Agent（AI 问答）
 *   - global_search 全网搜索
 *
 * 鉴权方式: Bearer Token
 *   Authorization: Bearer <access_secret>
 *   X-Request-Timestamp: <Unix秒级时间戳>
 *   Content-Type: application/json
 *
 * 这是知乎当前推荐的官方接入方式，取代旧的内部 API 抓取和浏览器 DOM 提取。
 */

import axios, { AxiosInstance, AxiosRequestConfig } from "axios";
import {
  parseOfficialSseEvents,
  selectLastOfficialDataEvent,
} from "./official-api-schema";
import {
  OfficialSearchParams,
  OfficialSearchResponse,
  OfficialHotListParams,
  OfficialHotListResponse,
  OfficialZhidaParams,
  OfficialZhidaResponse,
  OfficialGlobalSearchParams,
  OfficialGlobalSearchResponse,
} from "./types";

const BASE_URL = "https://developer.zhihu.com/api/v1/content";
const DEFAULT_TIMEOUT_MS = 30_000;

export class OfficialApiError extends Error {
  public code: string;
  public status: number;
  public raw: unknown;

  constructor(message: string, code: string, status: number, raw?: unknown) {
    super(message);
    this.name = "OfficialApiError";
    this.code = code;
    this.status = status;
    this.raw = raw;
  }
}

export function assertOfficialSuccess(raw: unknown): void {
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) return;
  const envelope = raw as Record<string, unknown>;
  const code = envelope.Code ?? envelope.code;
  if (typeof code === "number" && code !== 0) {
    const message =
      typeof envelope.Message === "string"
        ? envelope.Message
        : typeof envelope.message === "string"
          ? envelope.message
          : `知乎开放平台返回业务错误: ${code}`;
    throw new OfficialApiError(message, String(code), 200, raw);
  }
}

/**
 * 知乎开放平台官方 API 客户端
 *
 * 使用方式:
 *   const api = new OfficialApiClient({ accessSecret: "your-secret" });
 *   const results = await api.zhihuSearch({ query: "量子计算" });
 *
 * accessSecret 可以从以下方式获取:
 *   1. 构造函数参数
 *   2. 环境变量 ZHIHU_ACCESS_SECRET
 */
export type CreateHttpFn = (secret: string) => AxiosInstance;

export class OfficialApiClient {
  private http: AxiosInstance;
  private accessSecret: string;

  constructor(options: { accessSecret?: string; createHttp?: CreateHttpFn } = {}) {
    this.accessSecret =
      options.accessSecret ||
      process.env.ZHIHU_ACCESS_SECRET ||
      "";

    this.http = options.createHttp
      ? options.createHttp(this.accessSecret)
      : axios.create({
      baseURL: BASE_URL,
      timeout: DEFAULT_TIMEOUT_MS,
      headers: {
        "Content-Type": "application/json",
        "User-Agent": "zhihu-tools/0.1.0",
      },
    });

    // 请求拦截器: 自动附加鉴权头
    this.http.interceptors.request.use((config) => {
      if (!this.accessSecret) {
        return Promise.reject(
          new OfficialApiError(
            "未配置 access_secret。请设置环境变量 ZHIHU_ACCESS_SECRET 或传入构造函数",
            "NO_ACCESS_SECRET",
            0
          )
        );
      }
      config.headers = config.headers || {};
      config.headers["Authorization"] = `Bearer ${this.accessSecret}`;
      config.headers["X-Request-Timestamp"] = String(Math.floor(Date.now() / 1000));
      return config;
    });

    // 响应拦截器: 统一错误处理
    this.http.interceptors.response.use(
      (response) => {
        assertOfficialSuccess(response.data);
        return response;
      },
      (error) => {
        // Preserve OfficialApiError from request interceptor (e.g., NO_ACCESS_SECRET)
        if (error instanceof OfficialApiError) {
          throw error;
        }
        if (error.response) {
          const data = error.response.data;
          const message =
            data?.error?.message || data?.Message || data?.message || error.message;
          const code = data?.error?.code || data?.Code || data?.code || String(error.response.status);
          throw new OfficialApiError(
            message,
            code,
            error.response.status,
            data
          );
        }
        throw new OfficialApiError(
          error.message || "网络请求失败",
          "NETWORK_ERROR",
          0
        );
      }
    );
  }

  /** 检查是否已配置 access_secret */
  isConfigured(): boolean {
    return !!this.accessSecret;
  }

  /** 设置 access_secret（运行时更新） */
  setAccessSecret(secret: string): void {
    this.accessSecret = secret;
  }

  // ==========================================
  // zhihu_search — 知乎站内搜索
  // ==========================================

  /**
   * 知乎站内搜索
   *
   * @param params.query - 搜索关键词
   * @param params.limit - 返回数量 (1-20)
   * @param params.offset - 分页偏移
   * @param params.type - 搜索类型: general | question | answer | article
   */
  async zhihuSearch(
    params: OfficialSearchParams
  ): Promise<OfficialSearchResponse> {
    const resp = await this.http.get<OfficialSearchResponse>(
      "/zhihu_search",
      {
        params: {
          Query: params.query,
          ...(params.limit != null && { Limit: params.limit }),
          ...(params.offset != null && { Offset: params.offset }),
          ...(params.type != null && { Type: params.type }),
        },
      }
    );
    return resp.data;
  }

  // ==========================================
  // hot_list — 知乎热榜
  // ==========================================

  /**
   * 知乎热榜
   *
   * @param params.limit - 返回数量 (1-50)
   * @param params.offset - 分页偏移
   */
  async hotList(
    params: OfficialHotListParams = {}
  ): Promise<OfficialHotListResponse> {
    const resp = await this.http.get<OfficialHotListResponse>(
      "/hot_list",
      {
        params: {
          ...(params.limit != null && { Limit: params.limit }),
          ...(params.offset != null && { Offset: params.offset }),
        },
      }
    );
    return resp.data;
  }

  // ==========================================
  // zhida — 直答 Agent
  // ==========================================

  /**
   * 直答 Agent — 知乎 AI 问答
   *
   * @param params.query - 提问内容
   * @param params.stream - 是否流式返回 (默认 false)
   */
  async zhida(
    params: OfficialZhidaParams
  ): Promise<OfficialZhidaResponse> {
    const resp = await this.http.get<string | OfficialZhidaResponse>(
      "/zhida",
      {
        params: {
          Query: params.query,
          ...(params.stream != null && { Stream: params.stream }),
        },
        responseType: "text",
      }
    );
    if (typeof resp.data !== "string") {
      return resp.data;
    }
    const events = parseOfficialSseEvents(resp.data) as OfficialZhidaResponse[];
    const last = selectLastOfficialDataEvent(events) as OfficialZhidaResponse | undefined;
    if (!last) {
      throw new OfficialApiError("直答 API 返回空事件流", "EMPTY_ZHIDA_STREAM", 200, resp.data);
    }
    assertOfficialSuccess(last);
    return last;
  }

  // ==========================================
  // global_search — 全网搜索
  // ==========================================

  /**
   * 全网搜索（不限于知乎站内）
   *
   * @param params.query - 搜索关键词
   * @param params.limit - 返回数量 (1-20)
   * @param params.offset - 分页偏移
   */
  async globalSearch(
    params: OfficialGlobalSearchParams
  ): Promise<OfficialGlobalSearchResponse> {
    const resp = await this.http.get<OfficialGlobalSearchResponse>(
      "/global_search",
      {
        params: {
          Query: params.query,
          ...(params.limit != null && { Limit: params.limit }),
          ...(params.offset != null && { Offset: params.offset }),
        },
      }
    );
    return resp.data;
  }

  // ==========================================
  // 健康检查
  // ==========================================

  /**
   * 验证 access_secret 是否有效
   * 调用 zhihu_search 探测，避免热榜日额度耗尽时误判鉴权失败。
   */
  async verifyAccess(): Promise<{ valid: boolean; error?: string }> {
    try {
      await this.zhihuSearch({ query: "test", limit: 1 });
      return { valid: true };
    } catch (err: unknown) {
      const msg =
        err instanceof OfficialApiError
          ? `${err.code}: ${err.message}`
          : String(err);
      return { valid: false, error: msg };
    }
  }
}

// ==========================================
// 便捷工厂
// ==========================================

let defaultClient: OfficialApiClient | null = null;

/** 获取默认单例客户端 */
export function getOfficialClient(
  options?: { accessSecret?: string }
): OfficialApiClient {
  if (!defaultClient) {
    defaultClient = new OfficialApiClient(options);
  }
  return defaultClient;
}

/** 重置默认客户端 */
export function resetOfficialClient(): void {
  defaultClient = null;
}

export default OfficialApiClient;
