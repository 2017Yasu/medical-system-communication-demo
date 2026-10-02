// 版の履歴と、その版を作った通信の対応付け（FR-025、US2 シナリオ 4）。
import type { FhirResource } from "fhir/r4";
import type { Versioned } from "../fhir/client";
import type { TrafficRecord } from "../realtime/types";

/**
 * `type/id` の版 `versionId` を作った通信（応答に含まれる `Type/id/_history/n`、または PUT・PATCH・POST の ETag）の最初の記録。
 * Transaction の中で更新された場合は、その Transaction の記録が返る。
 */
export function findCause(records: TrafficRecord[], type: string, id: string, versionId: string): TrafficRecord | undefined {
  const marker = `${type}/${id}/_history/${versionId}`;
  return [...records]
    .sort((a, b) => a.seq - b.seq)
    .find((r) => {
      // サーバー内の処理（仮押さえの期限切れ）が作った版（specs/003 R-06）
      if (r.kind === "server") return r.serverAction?.resource === marker;
      if (r.kind !== "http" || !r.request || !r.response || r.response.status >= 300) return false;
      if (r.request.method === "GET") return false;
      if (r.response.body.includes(marker)) return true;
      return r.request.url.includes(`/${type}/${id}`) && r.response.headers["ETag"] === `W/"${versionId}"`;
    });
}

/** 版の履歴で比べる項目。Task は status・businessStatus・owner、Slot は status・comment（押さえた人。表示用）。 */
export type VersionField = "status" | "businessStatus" | "owner" | "comment";

/** 版の履歴の 1 行分：1 つ前の版から変わった項目と、その版を作った通信の送信元（data-model.md §6）。 */
export interface VersionDiff {
  versionId: string;
  changed: VersionField[];
  causeClient: string | null;
}

type Comparable = FhirResource & {
  status?: string;
  businessStatus?: { coding?: { code?: string }[] };
  owner?: { reference?: string };
  comment?: string;
  meta?: { versionId?: string };
};

const FIELD_ORDER: VersionField[] = ["status", "businessStatus", "owner", "comment"];

function valueOf(r: Comparable, field: VersionField): string {
  if (field === "status") return r.status ?? "";
  if (field === "businessStatus") return r.businessStatus?.coding?.[0]?.code ?? "";
  if (field === "comment") return r.comment ?? "";
  return r.owner?.reference ?? "";
}

/** 版の履歴（新しい版が先頭）から、各版の差分と作成元を求める。最古の版の changed は空。 */
export function diffVersions(versions: Versioned<FhirResource>[], records: TrafficRecord[]): VersionDiff[] {
  return versions.map((v, i) => {
    const res = v.resource as Comparable;
    const older = versions[i + 1]?.resource as Comparable | undefined;
    const versionId = res.meta?.versionId ?? "";
    const changed = older ? FIELD_ORDER.filter((f) => valueOf(res, f) !== valueOf(older, f)) : [];
    const cause = res.id ? findCause(records, res.resourceType, res.id, versionId) : undefined;
    return { versionId, changed, causeClient: cause?.client ?? null };
  });
}
