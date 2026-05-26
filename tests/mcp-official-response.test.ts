import { describe, expect, it } from "vitest";
import {
  officialResourcePayload,
  officialSuccessPayload,
} from "../src/mcp/official-response";

describe("MCP official API response payloads", () => {
  it("returns normalized data and metadata at the top level for tool results", () => {
    const payload = officialSuccessPayload({
      data: { items: [{ title: "AI" }] },
      meta: { upstream_code: 0, upstream_message: "success", raw_data_keys: ["Items"] },
    });

    expect(payload).toEqual({
      ok: true,
      data: { items: [{ title: "AI" }] },
      meta: { upstream_code: 0, upstream_message: "success", raw_data_keys: ["Items"] },
    });
  });

  it("adds resource timestamps without nesting or dropping normalized data", () => {
    const payload = officialResourcePayload(
      {
        data: { items: [{ id: 1, title: "热榜" }], total: 50 },
        meta: { upstream_code: 0, upstream_message: "success", raw_data_keys: ["Items", "Total"] },
      },
      "2026-05-26T12:00:00.000Z"
    );

    expect(payload).toEqual({
      ok: true,
      data: { items: [{ id: 1, title: "热榜" }], total: 50 },
      meta: { upstream_code: 0, upstream_message: "success", raw_data_keys: ["Items", "Total"] },
      updated: "2026-05-26T12:00:00.000Z",
    });
  });
});
