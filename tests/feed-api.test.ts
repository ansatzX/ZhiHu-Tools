import { describe, it, expect, vi } from "vitest";
import { FeedService } from "../src/core/feed";

describe("FeedService browser API paths", () => {
  it("gets the requested number of answers from the API before falling back to DOM", async () => {
    const get = vi.fn().mockResolvedValue({
      data: Array.from({ length: 29 }, (_, i) => ({
        id: i + 1,
        content: `<p>回答 ${i + 1} 的完整内容</p>`,
        excerpt: `回答 ${i + 1}`,
        voteup_count: i,
        author: { name: `作者 ${i + 1}` },
      })),
    });
    const service = new FeedService({ session: {}, get });

    const answers = await service.getQuestionAnswers("546859351", 0, 29);

    expect(answers).toHaveLength(29);
    expect(answers[28].id).toBe(29);
    expect(get).toHaveBeenCalledWith(
      "https://www.zhihu.com/api/v4/questions/546859351/answers",
      expect.objectContaining({
        params: expect.objectContaining({ offset: 0, limit: 20 }),
      })
    );
  });

  it("paginates answer API results until the requested answer count is reached", async () => {
    const page = (start: number, length: number) => ({
      data: Array.from({ length }, (_, i) => ({
        id: start + i,
        content: `<p>回答 ${start + i}</p>`,
        excerpt: `回答 ${start + i}`,
        voteup_count: start + i,
        author: { name: `作者 ${start + i}` },
      })),
    });
    const get = vi.fn()
      .mockResolvedValueOnce(page(1, 5))
      .mockResolvedValueOnce(page(6, 5))
      .mockResolvedValueOnce(page(11, 2));
    const service = new FeedService({ session: {}, get });

    const answers = await service.getQuestionAnswers("546859351", 0, 12);

    expect(answers.map((a) => a.id)).toEqual([1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12]);
    expect(get).toHaveBeenCalledTimes(3);
    expect(get.mock.calls.map((call) => call[1].params.offset)).toEqual([0, 5, 10]);
  });

  it("gets full article content and clean author fields from the API before falling back to DOM", async () => {
    const longContent = "全文".repeat(600);
    const get = vi.fn().mockResolvedValue({
      id: "1995787568894202157",
      title: "文章标题",
      content: longContent,
      excerpt: "摘要",
      voteup_count: 123,
      comment_count: 64,
      author: { name: "真实作者", url_token: "author-token", avatar_url: "avatar" },
    });
    const service = new FeedService({ session: {}, get });

    const article = await service.getArticleDetail("1995787568894202157");

    expect(article.content).toBe(longContent);
    expect(article.content.length).toBeGreaterThan(500);
    expect(article.content_truncated).toBe(false);
    expect(article.author.name).toBe("真实作者");
    expect(get).toHaveBeenCalledWith(
      "https://www.zhihu.com/api/v4/articles/1995787568894202157",
      expect.objectContaining({ params: expect.objectContaining({ include: expect.stringContaining("content") }) })
    );
  });
});

// Regression tests for answer/article metadata normalization.
describe("FeedService metadata normalization", () => {
  it("adds answer URLs and keeps comments/votes for question answer summaries", async () => {
    const get = vi.fn().mockResolvedValue({
      data: [{
        id: 987654321,
        content: "<p>完整回答</p>",
        excerpt: "摘要",
        voteup_count: 42,
        comment_count: 7,
        author: { name: "作者" },
      }],
    });
    const service = new FeedService({ session: {}, get });

    const answers = await service.getQuestionAnswers("546859351", 0, 1);

    expect(answers[0]).toMatchObject({
      id: 987654321,
      question_id: "546859351",
      url: "https://www.zhihu.com/question/546859351/answer/987654321",
      voteup_count: 42,
      comment_count: 7,
    });
  });

  it("sanitizes article API content that contains injected CSS text", async () => {
    const get = vi.fn().mockResolvedValue({
      id: "2030369875114336526",
      title: "影视行业AI化有利宅男",
      content: "影视行业AI化有利宅男.css-83b4ar{dynamic-range-limit:standard;border-radius:50%;}卢诗翰 正文开始",
      author: { name: "卢诗翰" },
      comment_count: 10,
    });
    const service = new FeedService({ session: {}, get });

    const article = await service.getArticleDetail("2030369875114336526");

    expect(article.content).not.toContain(".css-");
    expect(article.content).not.toContain("dynamic-range-limit");
    expect(article.content).toContain("正文开始");
    expect(article.author.name).toBe("卢诗翰");
  });
});
