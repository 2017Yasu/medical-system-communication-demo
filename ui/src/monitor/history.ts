// 版の履歴と、その版を作った通信の対応付け（FR-025、US2 シナリオ 4）。
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
      if (r.kind !== "http" || !r.request || !r.response || r.response.status >= 300) return false;
      if (r.request.method === "GET") return false;
      if (r.response.body.includes(marker)) return true;
      return r.request.url.includes(`/${type}/${id}`) && r.response.headers["ETag"] === `W/"${versionId}"`;
    });
}
