import { describe, expect, it } from "vitest";
import {
  normalizeOfficialSearch,
  normalizeOfficialHotList,
  normalizeOfficialZhida,
} from "../src/core/official-api-schema";
import { officialSuccessPayload, officialResourcePayload } from "../src/mcp/official-response";
import { upstreamError, notConfiguredError, ErrorCode } from "../src/mcp/errors";

/**
 * MCP layer tests: verify the full tool output schema after normalization
 * and response construction, matching what MCP clients actually receive.
 */

describe("MCP tool output schema: zhihu_search", () => {
  it("produces { ok, data: { items, has_more, search_hash_id }, meta } from upstream envelope", () => {
    const raw = {
      Code: 0,
      Message: "success",
      Data: {
        Items: [{ Title: "AI", Url: "https://example.com" }, { Title: "ML", Url: "https://example.com/2" }],
        HasMore: true,
        SearchHashId: "abc123",
      },
    };
    const normalized = normalizeOfficialSearch(raw, { limit: 2 });
    const output = officialSuccessPayload(normalized);

    expect(output.ok).toBe(true);
    expect(output.data.items).toHaveLength(2);
    expect(output.data.has_more).toBe(true);
    expect(output.data.search_hash_id).toBe("abc123");
    expect(output.meta.upstream_code).toBe(0);
    expect(output.meta.upstream_message).toBe("success");
    expect(output.meta.raw_data_keys).toEqual(["HasMore", "Items", "SearchHashId"]);
  });

  it("caps items to requested limit even if upstream returns more", () => {
    const raw = {
      Code: 0, Message: "success",
      Data: { Items: [{}, {}, {}, {}, {}], HasMore: true },
    };
    const output = officialSuccessPayload(normalizeOfficialSearch(raw, { limit: 3 }));
    expect(output.data.items).toHaveLength(3);
  });
});

describe("MCP tool output schema: zhihu_global_search", () => {
  it("uses the same normalization as zhihu_search", () => {
    const raw = {
      Code: 0,
      Message: "success",
      Data: {
        Items: [{ Title: "OpenAI", ContentType: "article" }],
        HasMore: false,
        SearchHashId: "global-hash",
      },
    };
    const output = officialSuccessPayload(normalizeOfficialSearch(raw, { limit: 10 }));

    expect(output.ok).toBe(true);
    expect(output.data.items).toHaveLength(1);
    expect(output.data.has_more).toBe(false);
    expect(output.data.search_hash_id).toBe("global-hash");
  });
});

describe("MCP tool output schema: zhihu_hot_list", () => {
  it("produces { ok, data: { items, total }, meta } from upstream envelope", () => {
    const raw = {
      Code: 0, Message: "success",
      Data: { Items: [{ id: 1, title: "热榜1" }], Total: 50 },
    };
    const output = officialSuccessPayload(normalizeOfficialHotList(raw, { limit: 50 }));

    expect(output.ok).toBe(true);
    expect(output.data.items).toHaveLength(1);
    expect(output.data.total).toBe(50);
    expect(output.meta.upstream_code).toBe(0);
  });

  it("hot resource includes updated timestamp", () => {
    const raw = { Code: 0, Message: "success", Data: { Items: [], Total: 0 } };
    const normalized = normalizeOfficialHotList(raw, { limit: 50 });
    const output = officialResourcePayload(normalized, "2026-05-27T12:00:00Z");

    expect(output.ok).toBe(true);
    expect(output.updated).toBe("2026-05-27T12:00:00Z");
    expect(output.data.items).toEqual([]);
  });
});

describe("MCP tool output schema: zhihu_zhida", () => {
  it("maps message.text, req_session_id, and cards to answer, session_id, sources", () => {
    const raw = {
      Code: 0, Message: "success",
      Data: {
        message: { text: "RAG 是检索增强生成" },
        req_session_id: "sess-123",
        cards: [{ CardContent: { ZhidaRelevantSource: {} } }],
      },
    };
    const output = officialSuccessPayload(normalizeOfficialZhida(raw));

    expect(output.ok).toBe(true);
    expect(output.data.answer).toBe("RAG 是检索增强生成");
    expect(output.data.session_id).toBe("sess-123");
    expect(output.data.sources).toHaveLength(1);
  });

  it("maps top-level Answer/SessionId/Sources fields", () => {
    const raw = {
      Code: 0, Message: "success",
      Data: { Answer: "直答内容", SessionId: "s1", Sources: [] },
    };
    const output = officialSuccessPayload(normalizeOfficialZhida(raw));

    expect(output.data.answer).toBe("直答内容");
    expect(output.data.session_id).toBe("s1");
    expect(output.data.sources).toEqual([]);
  });
});

describe("MCP error schema", () => {
  it("upstreamError produces { ok: false, error: { code, message, data } }", () => {
    const err = upstreamError(200, "day limit exceeded", { Code: 30001, Message: "day limit exceeded" });
    expect(err.ok).toBe(false);
    expect(err.error.code).toBe(ErrorCode.UPSTREAM_ERROR);
    expect(err.error.message).toBe("day limit exceeded");
    expect(err.error.data).toEqual({ status: 200, raw: { Code: 30001, Message: "day limit exceeded" } });
  });

  it("notConfiguredError produces NOT_CONFIGURED error", () => {
    const err = notConfiguredError();
    expect(err.ok).toBe(false);
    expect(err.error.code).toBe(ErrorCode.NOT_CONFIGURED);
    expect(err.error.message).toContain("ZHIHU_ACCESS_SECRET");
  });
});
