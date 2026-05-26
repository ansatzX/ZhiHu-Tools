# State Node

Node ID: codex-main
Parent Nodes:
- none
Working Directory: /Users/ansatz/data/code/zhihu-tools
Object: Zhihu Tools MCP project readiness audit
Current State: DISCOVERED
State Owner Role: observer/verifier
Last Updated: 2026-05-26 20:51:46 CST

## Child Nodes

- None

## Open Gaps

- Design intent has not yet been mapped to implementation evidence.
- Runtime behavior under the configured API key has not yet been verified.

## Evidence Register

- E001: `pwd`, `ls -la`, `git status --short --branch`, `git log --oneline -8`, and `rg --files` output gathered on 2026-05-26.
- E002: `package.json`, `README.md`, `src/mcp/index.ts`, `src/core/official-api.ts`, and selected tests inspected on 2026-05-26.
- E003: `npm run build` succeeded on 2026-05-26.
- E004: `npm test` failed: 6/8 test files passed, 34/41 tests passed; failures are in old browser-session and human-verification paths.
- E005: `ZHIHU_ACCESS_SECRET` was present in the shell environment without printing its value.
- E006: `.scripts/20260526-2054-verify-official-api.js` verified official API key validity and observed response envelope shape (`Code`, `Data`, `Message`).
- E007: `.scripts/20260526-2056-verify-mcp-stdio.js` verified MCP stdio startup, tool/resource listing, `zhihu_verify_access`, and `zhihu_hot_list`.
- E008: `npx vitest run tests/official-api.test.ts tests/mcp-errors.test.ts` passed: 2 files, 18 tests.
- E009: Re-running `.scripts/20260526-2056-verify-mcp-stdio.js` with `readResource` showed `zhihu://hot` returns `{ ok, updated }` without a `data` payload because code reads `result.data` while live API returns `Data.Items`.
- E010: Final `git status --short` shows only audit artifacts under `.scripts/` and `.state-machine/` are untracked.
- E011: `npm run build && npm test` passed after redesign: 10 test files, 51 tests.
- E012: MCP stdio smoke script verified `zhihu_verify_access` returns valid true and `zhihu_search` returns normalized `{ ok, data.items, meta }` with local limit capping to 2.
- E013: Live `zhihu_hot_list` currently returns upstream business error `30001: day limit exceeded`; MCP surfaces it as an error rather than an empty success payload.
- E014: Expanded MCP stdio smoke verified `zhihu_global_search` for `OpenAI`, `人工智能`, and `RAG`; all returned `ok: true`, 3 locally capped items, and normalized `data/meta`.
- E015: `zhihu_zhida` was corrected from POST JSON to GET SSE parsing; live smoke verified success before daily quota was exhausted, then subsequent calls returned upstream `30001: day limit exceeded`.
- E016: Latest verification passed: `npm run build && npm test` with 10 test files and 54 tests.

## Transitions

## T001 - Initial Repository Inventory

Before State: User requested progress and design-function audit.
Action: Selected the current working directory, git state, recent commits, and file inventory as initial authority/proxy evidence.
After State: Project identified as a clean `main` branch TypeScript/Node MCP repository with source, tests, README, and existing build artifacts.
Implicit Claim: The repository is suitable for read-only progress inspection.
Authority: Shell command output in current working directory.
Representation / Proxy: File tree and git metadata.
Lost Information: File contents and runtime behavior not yet inspected.
Evidence IDs: E001
Evidence Quality: mixed
Failure Mode: File inventory can miss hidden design intent in README/tests/source.
Verification: Pending deeper source and test inspection.
Object Drift: none
Status: exploratory

## T003 - Build, Test, and Live MCP Verification

Before State: Source indicated official API MCP implementation, but compiled output and runtime behavior were unverified.
Action: Ran TypeScript build, full test suite, targeted official API/error tests, direct official API smoke test, and MCP stdio smoke test.
After State: Build succeeds; official API and MCP stdio startup work with configured secret; full test suite fails due to legacy browser/CDP test expectations; API response shape differs from current TS type assumptions.
Implicit Claim: The MCP server is runnable and authenticated, but not yet fully aligned with its tests/docs/schema expectations.
Authority: Build/test command output and durable verification scripts.
Representation / Proxy: Local shell execution against compiled `dist` and live official API.
Lost Information: Full semantic correctness of all official API fields and `zhihu_zhida`/global search behavior not exhaustively tested.
Evidence IDs: E003, E004, E005, E006, E007, E008
Evidence Quality: mixed
Failure Mode: Passing smoke tests can miss downstream consumer breakage caused by unnormalized response envelopes.
Verification: Direct MCP stdio call returned expected server/tool/resource metadata and valid access result.
Object Drift: possible
Status: verified

## T008 - Global Search and Zhida Follow-Up Verification

Before State: User requested heavier global-search testing and said to treat hot list as acceptable for now.
Action: Expanded MCP smoke script to run `zhihu_global_search` across three keywords; diagnosed `zhihu_zhida` 405 as method mismatch; changed zhida to GET SSE parsing and normalized `message.text`, `req_session_id`, and `cards`.
After State: Global search has multi-keyword live evidence; zhida schema and method are fixed, with live evidence constrained by current daily quota exhaustion.
Implicit Claim: Global search is usable under the current MCP schema; zhida implementation now matches observed official API transport/shape, but live availability depends on quota.
Authority: Live MCP stdio smoke output and automated tests.
Representation / Proxy: Shape summaries, item counts, upstream status/code summaries.
Lost Information: Full semantic quality of returned search results and zhida answer text was not judged.
Evidence IDs: E014, E015, E016
Evidence Quality: mixed
Failure Mode: Open platform quota can make live zhida/hot-list unavailable despite correct transport/schema handling.
Verification: `npm run build && npm test && node .scripts/20260526-2056-verify-mcp-stdio.js`.
Object Drift: no
Status: verified

## T005 - Audit Summary Prepared

Before State: Verification evidence existed but no final project-readiness claim had been recorded.
Action: Checked final working tree status and prepared a bounded completion claim.
After State: Audit can report partial MCP readiness with explicit gaps.
Implicit Claim: The audit is complete; implementation repair is not complete because this turn did not request/perform fixes.
Authority: Evidence register and final git status.
Representation / Proxy: Command outputs and inspected files.
Lost Information: User's original external design spec, if any, was not present in the repo.
Evidence IDs: E001, E002, E003, E004, E005, E006, E007, E008, E009, E010
Evidence Quality: mixed
Failure Mode: If an external design document exists outside this repo, this audit only compares against repository evidence and live behavior.
Verification: Build/test/API/MCP smoke outputs recorded above.
Object Drift: possible
Status: verified

## T006 - Redesign Scope Selected

Before State: User accepted audit findings and requested schema, README, and tests be redesigned around the real official API behavior.
Action: Inspected legacy browser/CDP tests, MCP error handler, deprecated `ZhihuClient` export, and existing official API/MCP entrypoints.
After State: Redesign scope is bounded to official API MCP schema/normalization, README update, and test-suite realignment; old CLI/browser modules remain present but should no longer define MCP readiness.
Implicit Claim: Implementation should treat live official API envelope (`Code`, `Message`, `Data.Items`) as the authority source.
Authority: User request plus inspected tests/source.
Representation / Proxy: Source and test files.
Lost Information: Exact desired public field names still require a final design choice.
Evidence IDs: E002, E006, E009
Evidence Quality: mixed
Failure Mode: Preserving raw API shape only would be easy but poor for agent consumers; over-normalizing could hide useful upstream fields.
Verification: Pending user design approval and implementation.
Object Drift: changed
Status: proposed

## T007 - Official API MCP Redesign Implemented

Before State: MCP returned raw official API envelopes and README/tests described a stale browser/CDP MCP design.
Action: Added official API normalization tests, MCP success payload tests, official business error tests, and local limit-capping test; implemented schema normalization, MCP payload helpers, business error detection, search-based access verification, README rewrite, and legacy test stabilization.
After State: MCP tools/resources use stable `{ ok, data, meta }` success schema; `Code !== 0` upstream envelopes become errors; README documents the official API MCP surface; full build/test pass.
Implicit Claim: The repository now matches the official API MCP design within the verified scope.
Authority: Source diff, tests, build output, and live MCP stdio smoke output.
Representation / Proxy: Automated tests plus limited live calls to `zhihu_verify_access`, `zhihu_search`, and `zhihu_hot_list`.
Lost Information: `zhihu_zhida` and `zhihu_global_search` were covered by shared normalization/schema code but not live-smoked in this run.
Evidence IDs: E011, E012, E013
Evidence Quality: mixed
Failure Mode: Upstream field names can still change; `meta.raw_data_keys` exists to make drift visible.
Verification: `npm run build && npm test && node .scripts/20260526-2056-verify-mcp-stdio.js`.
Object Drift: no
Status: verified

## T004 - Resource Payload Bug Confirmed

Before State: Static source suggested `zhihu://hot` may drop data because of response envelope mismatch.
Action: Read `zhihu://hot` and `zhihu://health` through MCP stdio.
After State: `zhihu://health` returns usable status data; `zhihu://hot` omits the hot-list payload.
Implicit Claim: At least one declared MCP resource is currently not functionally complete.
Authority: Live MCP stdio resource read output.
Representation / Proxy: Parsed JSON shape, not full content.
Lost Information: Exact hot-list item field mapping still needs a normalization decision.
Evidence IDs: E009
Evidence Quality: direct
Failure Mode: Tool calls still return raw `Data.Items`, so this bug affects the resource path specifically.
Verification: Direct resource read.
Object Drift: none
Status: verified

## T002 - Design/Implementation Drift Identified

Before State: Repository structure was known, but design intent and implementation behavior were unmapped.
Action: Read README, MCP entry point, official API client, and tests.
After State: Current implementation appears centered on official Zhihu Open API (`ZHIHU_ACCESS_SECRET`, 5 tools, 2 resources, 3 prompts), while README still primarily documents the older browser/CDP profile workflow and older tool/resource names.
Implicit Claim: Documentation is not a reliable authority for current MCP behavior without source/test corroboration.
Authority: Direct source and README inspection.
Representation / Proxy: TypeScript entrypoint and README prose.
Lost Information: Build output, test status, and live API behavior not yet verified.
Evidence IDs: E002
Evidence Quality: direct
Failure Mode: Source may compile differently than inspected TypeScript if `dist` is stale or build fails.
Verification: Pending `npm run build`, `npm test`, and configured API verification.
Object Drift: changed
Status: exploratory
