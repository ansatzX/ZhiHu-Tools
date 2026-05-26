export interface OfficialMcpResult<TData> {
  data: TData;
  meta: {
    upstream_code?: number;
    upstream_message?: string;
    raw_data_keys: string[];
  };
}

export interface OfficialListData<TItem = unknown> {
  items: TItem[];
  total?: number;
  has_more?: boolean;
  search_hash_id?: string;
}

export interface OfficialZhidaData {
  answer?: string;
  session_id?: string;
  sources?: unknown[];
}

export interface NormalizeListOptions {
  limit?: number;
}

interface EnvelopeParts {
  body: unknown;
  upstreamCode?: number;
  upstreamMessage?: string;
  rawDataKeys: string[];
}

export function normalizeOfficialSearch(
  raw: unknown,
  options: NormalizeListOptions = {}
): OfficialMcpResult<OfficialListData> {
  const { body, upstreamCode, upstreamMessage, rawDataKeys } = unwrapEnvelope(raw);
  const bodyObj = asRecord(body);
  const rawObj = asRecord(raw);
  const paging = asRecord(rawObj?.paging);
  const items = capItems(
    arrayValue(bodyObj?.Items) ?? arrayValue(bodyObj?.items) ?? arrayValue(rawObj?.data) ?? [],
    options.limit
  );
  const total = numberValue(bodyObj?.Total) ?? numberValue(bodyObj?.total) ?? numberValue(paging?.totals);
  const hasMore =
    booleanValue(bodyObj?.HasMore) ??
    booleanValue(bodyObj?.has_more) ??
    (typeof paging?.is_end === "boolean" ? !paging.is_end : undefined);
  const searchHashId = stringValue(bodyObj?.SearchHashId) ?? stringValue(bodyObj?.search_hash_id);

  return withMeta(
    pruneUndefined({
      items,
      total,
      has_more: hasMore,
      search_hash_id: searchHashId,
    }),
    upstreamCode,
    upstreamMessage,
    rawDataKeys
  );
}

export function normalizeOfficialHotList(
  raw: unknown,
  options: NormalizeListOptions = {}
): OfficialMcpResult<OfficialListData> {
  const { body, upstreamCode, upstreamMessage, rawDataKeys } = unwrapEnvelope(raw);
  const bodyObj = asRecord(body);
  const rawObj = asRecord(raw);
  const items = capItems(
    arrayValue(bodyObj?.Items) ?? arrayValue(bodyObj?.items) ?? arrayValue(rawObj?.data) ?? [],
    options.limit
  );
  const total = numberValue(bodyObj?.Total) ?? numberValue(bodyObj?.total);

  return withMeta(
    pruneUndefined({
      items,
      total,
    }),
    upstreamCode,
    upstreamMessage,
    rawDataKeys
  );
}

export function normalizeOfficialZhida(raw: unknown): OfficialMcpResult<OfficialZhidaData> {
  const { body, upstreamCode, upstreamMessage, rawDataKeys } = unwrapEnvelope(raw);
  const bodyObj = asRecord(body) ?? {};
  return withMeta(
    pruneUndefined({
      answer:
        stringValue(bodyObj.Answer) ??
        stringValue(bodyObj.answer) ??
        stringValue(bodyObj.message) ??
        stringValue(asRecord(bodyObj.message)?.text),
      session_id:
        stringValue(bodyObj.SessionId) ??
        stringValue(bodyObj.session_id) ??
        stringValue(bodyObj.req_session_id),
      sources: arrayValue(bodyObj.Sources) ?? arrayValue(bodyObj.sources) ?? arrayValue(bodyObj.cards),
    }),
    upstreamCode,
    upstreamMessage,
    rawDataKeys
  );
}

export function parseOfficialSseEvents(text: string): unknown[] {
  return text
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter((line) => line.startsWith("data: "))
    .map((line) => line.slice("data: ".length).trim())
    .filter((payload) => payload && payload !== "[DONE]")
    .map((payload) => JSON.parse(payload));
}

export function selectLastOfficialDataEvent(events: unknown[]): unknown | undefined {
  for (let i = events.length - 1; i >= 0; i -= 1) {
    const event = asRecord(events[i]);
    const data = asRecord(event?.Data) ?? asRecord(event?.data);
    if (data && Object.keys(data).length > 0) {
      return events[i];
    }
  }
  return events.at(-1);
}

function unwrapEnvelope(raw: unknown): EnvelopeParts {
  const rawObj = asRecord(raw);
  const hasOfficialEnvelope = rawObj && ("Data" in rawObj || "Code" in rawObj || "Message" in rawObj);
  const body = hasOfficialEnvelope ? rawObj.Data : raw;
  return {
    body,
    upstreamCode: numberValue(rawObj?.Code) ?? numberValue(rawObj?.code),
    upstreamMessage: stringValue(rawObj?.Message) ?? stringValue(rawObj?.message),
    rawDataKeys: objectKeys(body),
  };
}

function withMeta<TData>(
  data: TData,
  upstreamCode: number | undefined,
  upstreamMessage: string | undefined,
  rawDataKeys: string[]
): OfficialMcpResult<TData> {
  return {
    data,
    meta: pruneUndefined({
      upstream_code: upstreamCode,
      upstream_message: upstreamMessage,
      raw_data_keys: rawDataKeys,
    }),
  };
}

function asRecord(value: unknown): Record<string, unknown> | undefined {
  return value !== null && typeof value === "object" && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : undefined;
}

function arrayValue(value: unknown): unknown[] | undefined {
  return Array.isArray(value) ? value : undefined;
}

function booleanValue(value: unknown): boolean | undefined {
  return typeof value === "boolean" ? value : undefined;
}

function numberValue(value: unknown): number | undefined {
  return typeof value === "number" ? value : undefined;
}

function stringValue(value: unknown): string | undefined {
  return typeof value === "string" ? value : undefined;
}

function objectKeys(value: unknown): string[] {
  return Object.keys(asRecord(value) ?? {}).sort();
}

function capItems(items: unknown[], limit?: number): unknown[] {
  return typeof limit === "number" && Number.isInteger(limit) && limit >= 0
    ? items.slice(0, limit)
    : items;
}

function pruneUndefined<T extends Record<string, unknown>>(value: T): T {
  return Object.fromEntries(
    Object.entries(value).filter(([, entry]) => entry !== undefined)
  ) as T;
}
