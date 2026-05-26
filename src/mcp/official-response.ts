import type { OfficialMcpResult } from "../core/official-api-schema";

export interface OfficialMcpSuccess<TData> {
  ok: true;
  data: TData;
  meta: OfficialMcpResult<TData>["meta"];
}

export interface OfficialMcpResource<TData> extends OfficialMcpSuccess<TData> {
  updated: string;
}

export function officialSuccessPayload<TData>(
  result: OfficialMcpResult<TData>
): OfficialMcpSuccess<TData> {
  return {
    ok: true,
    data: result.data,
    meta: result.meta,
  };
}

export function officialResourcePayload<TData>(
  result: OfficialMcpResult<TData>,
  updated: string
): OfficialMcpResource<TData> {
  return {
    ...officialSuccessPayload(result),
    updated,
  };
}
