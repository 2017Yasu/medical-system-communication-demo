import { useEffect, useMemo, useState } from "react";
import type { FhirResource, Task } from "fhir/r4";
import { FhirClient, type Versioned } from "../fhir/client";
import { businessStatusCode, businessStatusLabel, holderName, statusLabel, type StatusKind } from "../fhir/labels";
import type { TrafficRecord } from "../realtime/types";
import { diffVersions, findCause, type VersionField } from "./history";
import { clientName, resourceRefsIn } from "./sequenceModel";

const KIND: Record<string, StatusKind> = {
  Task: "task",
  ServiceRequest: "serviceRequest",
  DiagnosticReport: "diagnosticReport",
  Slot: "slot",
  Appointment: "appointment",
};

/** リソースの版の履歴（FR-025）：版ごとの状態・担当者・更新日時と、その版を作った通信へのリンク。 */
export function HistoryView({
  records,
  onJumpToTraffic,
}: {
  records: TrafficRecord[];
  onJumpToTraffic: (seq: number) => void;
}) {
  const refs = useMemo(() => resourceRefsIn(records), [records]);
  const [ref, setRef] = useState<string>("");
  const [versions, setVersions] = useState<Versioned<FhirResource>[]>([]);
  const [error, setError] = useState<string | null>(null);
  const current = ref || refs.find((r) => r.startsWith("Task/")) || refs[0] || "";
  // 通信が増えたら（更新があったら）取り直す。自分自身の取得（monitor）で増えた分は数えない（無限ループの防止）
  const trafficCount = records.filter((r) => r.client !== "monitor").length;

  useEffect(() => {
    if (!current) return;
    const [type, id] = current.split("/");
    let cancelled = false;
    new FhirClient("monitor")
      .history(type, id)
      .then((v) => {
        if (!cancelled) {
          setVersions(v);
          setError(null);
        }
      })
      .catch((e) => !cancelled && setError(e instanceof Error ? e.message : "履歴を取得できません"));
    return () => {
      cancelled = true;
    };
  }, [current, trafficCount]);

  const [type, id] = current.split("/");
  const diffs = useMemo(() => new Map(diffVersions(versions, records).map((d) => [d.versionId, d])), [versions, records]);
  return (
    <section className="panel" aria-label="版の履歴" data-testid="history-view">
      <h2>リソースの版の履歴</h2>
      {refs.length === 0 ? (
        <p className="muted">通信がまだありません。</p>
      ) : (
        <>
          <div className="field">
            <label htmlFor="history-ref">リソース</label>
            <select id="history-ref" value={current} onChange={(e) => setRef(e.target.value)}>
              {refs.map((r) => (
                <option key={r} value={r}>
                  {r}
                </option>
              ))}
            </select>
          </div>
          {error && <p role="alert">{error}</p>}
          <table className="data">
            <thead>
              <tr>
                <th>版</th>
                <th>状態</th>
                <th>{type === "Slot" ? "押さえた人" : "担当"}</th>
                <th>更新日時</th>
                <th>この版を作った通信</th>
              </tr>
            </thead>
            <tbody>
              {versions.map((v) => {
                const res = v.resource as FhirResource & { status?: string; meta?: { versionId?: string; lastUpdated?: string } };
                const vid = res.meta?.versionId ?? "";
                const task = type === "Task" ? (v.resource as Task) : undefined;
                const biz = businessStatusCode(task?.businessStatus);
                const slot = type === "Slot" ? (v.resource as { comment?: string }) : undefined;
                const owner = slot ? (holderName(slot.comment) ?? "—") : (task?.owner?.reference ?? "—");
                const cause = findCause(records, type, id, vid);
                const diff = diffs.get(vid);
                const changed = (f: VersionField) => diff?.changed.includes(f) ?? false;
                const mark = (f: VersionField) => ({
                  "data-testid": `history-changed-${vid}-${f}`,
                  style: { background: "var(--c-highlight)", fontWeight: 700 },
                });
                return (
                  <tr key={vid}>
                    <td>{vid}</td>
                    <td {...(changed("status") || changed("businessStatus") ? mark(changed("status") ? "status" : "businessStatus") : {})}>
                      {res.status ? `${KIND[type] ? statusLabel(KIND[type], res.status) : res.status} ` : ""}
                      {res.status && <span className="code">{res.status}</span>}
                      {biz && (
                        <>
                          {" "}
                          <span className="badge">{businessStatusLabel(biz)}</span>
                        </>
                      )}
                    </td>
                    <td {...(slot ? (changed("comment") ? mark("comment") : {}) : changed("owner") ? mark("owner") : {})}>{owner}</td>
                    <td>{res.meta?.lastUpdated ? new Date(res.meta.lastUpdated).toLocaleTimeString("ja-JP") : ""}</td>
                    <td>
                      {cause ? (
                        <>
                          <button type="button" onClick={() => onJumpToTraffic(cause.seq)}>
                            通信 {cause.seq}
                          </button>{" "}
                          <span data-testid={`history-cause-${vid}`}>{clientName(cause.client)}</span>
                        </>
                      ) : (
                        <span className="muted">—</span>
                      )}
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </>
      )}
    </section>
  );
}
