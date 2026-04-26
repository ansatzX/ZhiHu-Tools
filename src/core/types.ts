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
