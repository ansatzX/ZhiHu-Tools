export interface ZhihuProfile {
  id: string;
  url_token: string;
  name: string;
  avatar_url: string;
  headline: string;
  gender: number;
  uid: string;
  user_type: string;
}

export interface ZhihuHotStory {
  id: string;
  type: string;
  style_type?: string;
  detail_text?: string;
  trend?: number;
  target?: {
    id: number;
    title?: string;
    excerpt?: string;
    answer_count?: number;
    follower_count: number;
    created?: number;
    url?: string;
    type?: string;
  };
  attached_info: string;
  children?: Array<{
    type?: string;
    thumbnail?: string;
  }>;
}

export interface ZhihuFeedItem {
  id: string;
  type: string;
  verb: string;
  created_time: number;
  updated_time: number;
  target: ZhihuTarget;
}

export interface ZhihuTarget {
  id: number;
  type: string;
  title?: string;
  excerpt?: string;
  content?: string;
  url?: string;
  author?: {
    name?: string;
    url_token?: string;
    avatar_url?: string;
    headline?: string;
  };
  question?: {
    id: number;
    title?: string;
    url?: string;
  };
  voteup_count?: number;
  comment_count?: number;
  created_time?: number;
  updated_time?: number;
}

export interface ZhihuSearchResult {
  type: string;
  object: ZhihuTarget;
  highlight: {
    title?: string;
    description?: string;
  };
}

export interface ZhihuQuestion {
  id: number;
  title: string;
  detail: string;
  excerpt: string;
  answer_count: number;
  follower_count: number;
  created: number;
  updated_time: number;
}

export interface ZhihuAnswer {
  id: number;
  content: string;
  excerpt: string;
  voteup_count: number;
  comment_count: number;
  created_time: number;
  updated_time: number;
}

export interface ZhihuArticle {
  id: number;
  title: string;
  content: string;
  excerpt: string;
  voteup_count: number;
  comment_count: number;
  image_url: string;
  created: number;
  updated: number;
  author: {
    name: string;
    url_token: string;
    avatar_url: string;
  };
}

export interface ZhihuColumn {
  id: string;
  title: string;
  intro: string;
  url: string;
  followers: number;
  articles_count: number;
}

export interface LoginOptions {
  method?: 'qrcode' | 'password' | 'weixin' | 'sms';
  phone?: string;
  password?: string;
}

// ============================================================
// 知乎开放平台官方 API 类型 (developer.zhihu.com)
// ============================================================

/** 官方 API 通用分页/过滤参数 */
export interface OfficialBaseParams {
  limit?: number;
  offset?: number;
}

/** zhihu_search 请求参数 */
export interface OfficialSearchParams extends OfficialBaseParams {
  query: string;
  type?: "general" | "question" | "answer" | "article";
}

/** hot_list 请求参数 */
export interface OfficialHotListParams extends OfficialBaseParams {}

/** zhida 请求参数 */
export interface OfficialZhidaParams {
  query: string;
  stream?: boolean;
}

/** global_search 请求参数 */
export interface OfficialGlobalSearchParams extends OfficialBaseParams {
  query: string;
}

/** 官方 API 搜索结果条目 */
export interface OfficialSearchItem {
  type: string;
  title: string;
  url: string;
  excerpt?: string;
  created_time?: number;
  updated_time?: number;
  author?: {
    name?: string;
    url_token?: string;
    avatar_url?: string;
  };
  voteup_count?: number;
  comment_count?: number;
  answer_count?: number;
  follower_count?: number;
  highlight?: {
    title?: string;
    description?: string;
  };
  [key: string]: unknown;
}

/** 官方 API 分页信息 */
export interface OfficialPaging {
  is_end: boolean;
  is_start: boolean;
  next?: string;
  previous?: string;
  totals: number;
}

/** zhihu_search 响应 */
export interface OfficialSearchResponse {
  data: OfficialSearchItem[];
  paging: OfficialPaging;
}

/** hot_list 响应条目 */
export interface OfficialHotListItem {
  id: string | number;
  title: string;
  url: string;
  excerpt?: string;
  detail_text?: string;
  trend?: number;
  answer_count?: number;
  follower_count?: number;
  hot_metric?: number;
  [key: string]: unknown;
}

/** hot_list 响应 */
export interface OfficialHotListResponse {
  data: OfficialHotListItem[];
}

/** zhida 响应 */
export interface OfficialZhidaResponse {
  answer: string;
  session_id?: string;
  sources?: unknown[];
}

/** global_search 响应：复用 zhihu_search 结构 */
export type OfficialGlobalSearchResponse = OfficialSearchResponse;
