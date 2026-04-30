import { describe, expect, it } from "vitest";
import { SearchService } from "../src/core/search";

describe("SearchService result normalization", () => {
  it("drops empty search cards and fills title from excerpt when needed", async () => {
    const rawCards = [
      { title: "", link: "/question/1", excerpt: "" },
      { title: "", link: "/question/2", excerpt: "摘要可作为标题。后续内容" },
      { title: "正常标题", link: "//zhuanlan.zhihu.com/p/3", excerpt: "文章摘要" },
    ];
    const session = {
      async evaluate(expression: string) {
        if (expression.includes("document.querySelectorAll('.Card.SearchResult-Card').length")) return rawCards.length;
        if (expression.includes("window.location.href")) return "https://www.zhihu.com/search?q=test";
        if (expression.includes("Array.from(document.querySelectorAll('.Card.SearchResult-Card'))")) {
          return rawCards.map((card) => ({
            type: "question",
            title: card.title,
            link: card.link,
            excerpt: card.excerpt,
            highlight: { title: card.title, description: card.excerpt },
            object: { type: "question", title: card.title, excerpt: card.excerpt, url: card.link },
          }));
        }
        return null;
      },
    };
    const service = new SearchService({ session });

    const results = await service.search("test", "general", 3);

    expect(results).toHaveLength(2);
    expect(results[0].title).toBe("摘要可作为标题");
    expect(results[0].object.title).toBe("摘要可作为标题");
    expect(results[1].object.url).toBe("https://zhuanlan.zhihu.com/p/3");
  });
});
