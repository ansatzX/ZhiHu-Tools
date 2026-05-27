# AGENTS.md

## Architecture

This project is a Zhihu (知乎) MCP Server using the official Open Platform API (`developer.zhihu.com`).

### Active Code Path

```text
MCP Client
  -> src/mcp/index.ts          (MCP tools, resources, prompts)
  -> src/core/rotating-client.ts  (multi-key rotation, retry)
  -> src/core/official-api.ts     (single-key HTTP client)
  -> developer.zhihu.com/api/v1/content
```

Key files:
- `src/core/official-api.ts` — OfficialApiClient, Bearer auth, upstream error handling
- `src/core/official-api-schema.ts` — `Code/Message/Data` envelope normalization
- `src/core/rotating-client.ts` — RotatingOfficialApiClient, round-robin + rate-limit failover + transient retry
- `src/core/types.ts` — TypeScript types for official API responses
- `src/mcp/index.ts` — MCP server entry, tool/resource/prompt registration
- `src/mcp/official-response.ts` — success payload helpers
- `src/mcp/jsonl-logger.ts` — JSONL log persistence to `~/.zhihu-tools/logs/`
- `src/mcp/errors.ts` — MCP standard error codes
- `src/cli/index.ts` — CLI entry (uses same official API client)

### MCP Schema

All tools return `{ ok, data, meta }` on success, `{ ok: false, error }` on failure.
The `meta` field preserves upstream `Code`/`Message` and `raw_data_keys` for debugging.
`Code !== 0` from upstream is treated as a business error and thrown as `OfficialApiError`.

### API Key Rotation

`ZHIHU_ACCESS_SECRET` supports comma-separated multiple keys.
`RotatingOfficialApiClient` distributes requests round-robin across keys.
On `Code: 30001` (day limit exceeded), the key is marked exhausted for 5 minutes.
Transient network errors (`NETWORK_ERROR`, `ECONNRESET`, etc.) trigger automatic retry with backoff.

## Deprecated / Legacy Code

The following files are **NOT used by the current MCP mainline or CLI**.
They are preserved for reference only and must NOT be imported by new code.

### Legacy browser/CDP path (pre-official-API)

These files implement the old approach of controlling Chrome via CDP to scrape Zhihu pages.
They are completely unused by the current MCP server and CLI.

- `src/core/http-client.ts` — old axios/cookie HTTP client
- `src/core/browser-http-client.ts` — CDP-based HTTP client
- `src/core/browser/` — Chrome session management, CDP client, chrome-path
- `src/core/auth.ts` — browser-based login/auth
- `src/core/feed.ts` — old feed/question/article API via browser
- `src/core/search.ts` — old search via browser DOM
- `src/core/cache.ts` — request caching (not used by official API path)
- `src/core/cookie-store.ts` — deprecated cookie file storage
- `src/mcp/tool-runner.ts` — old MCP tool runner with browser verification handling
- `src/mcp/error-handler.ts` — old error handler with browser openVisiblePage logic
- `src/util/` — encryption and captcha utilities

### Legacy test files

These test files cover the deprecated code paths:

- `tests/browser-session.test.ts`
- `tests/feed-api.test.ts`
- `tests/search-normalization.test.ts`
- `tests/mcp-human-verification.test.ts`
- `tests/auth-browser.test.ts`
- `tests/cache.test.ts`

### Rules

1. **Do NOT import from deprecated files** in new code (`src/mcp/index.ts`, `src/cli/index.ts`, `src/core/official-api*`, `src/core/rotating-client*`).
2. **Do NOT delete deprecated files** — they are kept for reference.
3. If a deprecated file causes a build error, fix it with minimal changes (e.g., change `import type` to `any`).
4. New features should only use `OfficialApiClient`, `RotatingOfficialApiClient`, and the schema normalization layer.
