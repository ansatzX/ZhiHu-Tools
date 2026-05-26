import { describe, expect, it } from "vitest";
import {
  normalizeOfficialHotList,
  normalizeOfficialSearch,
  normalizeOfficialZhida,
  parseOfficialSseEvents,
  selectLastOfficialDataEvent,
} from "../src/core/official-api-schema";

describe("official API MCP schema normalization", () => {
  it("maps search envelope Data.Items into stable MCP fields and metadata", () => {
    const result = normalizeOfficialSearch({
      Code: 0,
      Message: "success",
      Data: {
        Items: [{ title: "AI", url: "https://www.zhihu.com/search/1" }],
        HasMore: true,
        SearchHashId: "hash-1",
      },
    });

    expect(result).toEqual({
      data: {
        items: [{ title: "AI", url: "https://www.zhihu.com/search/1" }],
        has_more: true,
        search_hash_id: "hash-1",
      },
      meta: {
        upstream_code: 0,
        upstream_message: "success",
        raw_data_keys: ["HasMore", "Items", "SearchHashId"],
      },
    });
  });

  it("can cap search items locally when upstream ignores the requested limit", () => {
    const result = normalizeOfficialSearch(
      {
        Code: 0,
        Message: "success",
        Data: {
          Items: [{ title: "1" }, { title: "2" }, { title: "3" }],
          HasMore: true,
        },
      },
      { limit: 2 }
    );

    expect(result.data.items).toEqual([{ title: "1" }, { title: "2" }]);
    expect(result.data.has_more).toBe(true);
  });

  it("maps hot list envelope Data.Items and Total into stable MCP fields", () => {
    const result = normalizeOfficialHotList({
      Code: 0,
      Message: "success",
      Data: {
        Items: [{ id: 1, title: "热榜标题" }],
        Total: 50,
      },
    });

    expect(result.data.items).toEqual([{ id: 1, title: "热榜标题" }]);
    expect(result.data.total).toBe(50);
    expect(result.meta.raw_data_keys).toEqual(["Items", "Total"]);
  });

  it("keeps backward compatibility for older lowercase search responses", () => {
    const result = normalizeOfficialSearch({
      data: [{ title: "旧字段", url: "https://www.zhihu.com/question/1" }],
      paging: { is_end: false, is_start: true, totals: 10 },
    });

    expect(result.data).toEqual({
      items: [{ title: "旧字段", url: "https://www.zhihu.com/question/1" }],
      total: 10,
      has_more: true,
    });
  });

  it("maps zhida envelope Data into answer, session_id, and sources", () => {
    const result = normalizeOfficialZhida({
      Code: 0,
      Message: "success",
      Data: {
        Answer: "直答内容",
        SessionId: "session-1",
        Sources: [{ title: "source" }],
      },
    });

    expect(result.data).toEqual({
      answer: "直答内容",
      session_id: "session-1",
      sources: [{ title: "source" }],
    });
  });

  it("parses zhida SSE data lines and ignores DONE sentinel", () => {
    const events = parseOfficialSseEvents([
      'data: {"Code":0,"Message":"success","Data":{"message":"答案片段","req_session_id":"s1"}}',
      "data: [DONE]",
    ].join("\n\n"));

    expect(events).toEqual([
      { Code: 0, Message: "success", Data: { message: "答案片段", req_session_id: "s1" } },
    ]);
  });

  it("selects the last SSE event with non-empty Data", () => {
    const event = selectLastOfficialDataEvent([
      { Code: 0, Message: "success", Data: { message: "有内容" } },
      { Code: 0, Message: "success", Data: {} },
    ]);

    expect(event).toEqual({ Code: 0, Message: "success", Data: { message: "有内容" } });
  });

  it("maps live zhida SSE-style fields into answer, session_id, and sources", () => {
    const result = normalizeOfficialZhida({
      Code: 0,
      Message: "success",
      Data: {
        message: { text: "最终答案" },
        req_session_id: "session-2",
        cards: [{ type: "source" }],
      },
    });

    expect(result.data).toEqual({
      answer: "最终答案",
      session_id: "session-2",
      sources: [{ type: "source" }],
    });
  });
});
