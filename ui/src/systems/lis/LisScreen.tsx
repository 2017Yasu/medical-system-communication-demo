import { useState } from "react";
import { Link, useSearchParams } from "react-router";
import { ErrorBanner } from "../../app/ErrorBanner";
import { FhirError, type ClientId } from "../../fhir/client";
import { buildAcceptPatch, buildStartPatch } from "../../fhir/builders/labOrder";
import { useLiveData } from "../../realtime/useLiveData";
import { LIS_OWNERS, loadLabOrders, orderNumber, orderedSetNames, taskBusinessStatus, type OrderRow } from "../shared/orders";
import { SrStatus, TaskStatus, ownerLabel } from "../shared/StatusBadges";
import { ResultEntry } from "./ResultEntry";

export type Tech = "tech-a" | "tech-b";

/** 検体検査システム：検査部の作業一覧と、受付・測定開始・結果報告（FR-012〜FR-015）。 */
export function LisScreen({ tech, embedded = false }: { tech?: Tech; embedded?: boolean }) {
  const [params] = useSearchParams();
  const current: Tech = tech ?? (params.get("tech") === "tech-b" ? "tech-b" : "tech-a");
  const clientId: ClientId = current === "tech-a" ? "lis-tech-a" : "lis-tech-b";
  const techName = current === "tech-a" ? "技師 A" : "技師 B";

  const live = useLiveData({
    clientId,
    subscription: {
      id: "lis-lab-dept",
      criteria: `Task?owner=${LIS_OWNERS}`,
      reason: "検査部宛て・検査部の技師が担当する作業の通知",
    },
    load: loadLabOrders,
  });
  const [busyId, setBusyId] = useState<string | null>(null);
  const [entryId, setEntryId] = useState<string | null>(null);

  /** 版の確認つき（If-Match）で Task を更新する。競合は表示して最新を取り直し、自動ではやり直さない（FR-004）。 */
  const act = async (row: OrderRow, operation: string, run: () => Promise<unknown>) => {
    setBusyId(row.sr.resource.id!);
    try {
      await run();
      await live.reload();
    } catch (e) {
      if (e instanceof FhirError) {
        live.setError(e, operation);
        await live.reload();
      } else throw e;
    } finally {
      setBusyId(null);
    }
  };

  const accept = (row: OrderRow) =>
    act(row, "受付", () => live.client.patch("Task", row.task!.resource.id!, buildAcceptPatch(current, new Date()), row.task!.etag, "受付"));
  const start = (row: OrderRow) =>
    act(row, "測定開始", () => live.client.patch("Task", row.task!.resource.id!, buildStartPatch(new Date()), row.task!.etag, "測定開始"));

  const rows = live.data ?? [];
  const entryRow = rows.find((r) => r.sr.resource.id === entryId) ?? null;

  return (
    <div>
      {!embedded && (
        <header className="screen-header" style={{ padding: "var(--sp-3)" }}>
          <h1>検体検査システム（{techName}）</h1>
          <Link to="/lis?tech=tech-a">技師 A</Link>
          <Link to="/lis?tech=tech-b">技師 B</Link>
          <span className="spacer" />
          <Link to="/">入口へ</Link>
        </header>
      )}
      <div className="screen">
        <ErrorBanner error={live.error} onDismiss={live.clearError} />
        <section className="panel" aria-label="作業の一覧">
          <h2>検査部の作業</h2>
          {rows.length === 0 ? (
            <p className="muted">作業はありません。</p>
          ) : (
            <table className="data">
              <thead>
                <tr>
                  <th>依頼</th>
                  <th>依頼の状態</th>
                  <th>作業の状態</th>
                  <th />
                </tr>
              </thead>
              <tbody>
                {rows.map((row) => {
                  const id = row.sr.resource.id!;
                  const task = row.task?.resource;
                  const biz = taskBusinessStatus(task);
                  const busy = busyId === id;
                  return (
                    <tr key={id} data-testid={`task-${id}`}>
                      <td>
                        <div>
                          <strong>{row.patientName}</strong>
                        </div>
                        <div>{orderedSetNames(row.sr.resource)}</div>
                        <div className="muted">{orderNumber(row.sr.resource)}</div>
                      </td>
                      <td>
                        <SrStatus status={row.sr.resource.status} />
                      </td>
                      <td>
                        <TaskStatus task={task} />
                        <div className="muted">担当：{ownerLabel(row)}</div>
                      </td>
                      <td>
                        {task?.status === "requested" && biz === "not-collected" && (
                          <>
                            <button type="button" disabled data-guide={`accept-${id}`}>
                              受付
                            </button>
                            <div className="muted">採血の記録後に受付できます</div>
                          </>
                        )}
                        {task?.status === "requested" && biz !== "not-collected" && (
                          <button type="button" className="primary" disabled={busy} onClick={() => accept(row)} data-guide={`accept-${id}`}>
                            受付
                          </button>
                        )}
                        {task?.status === "accepted" && (
                          <button type="button" className="primary" disabled={busy} onClick={() => start(row)} data-guide={`start-${id}`}>
                            測定開始
                          </button>
                        )}
                        {task?.status === "in-progress" && (
                          <button type="button" className="primary" onClick={() => setEntryId(entryId === id ? null : id)} data-guide={`entry-${id}`}>
                            結果入力
                          </button>
                        )}
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          )}
        </section>
        {entryRow && entryRow.task?.resource.status === "in-progress" && (
          <ResultEntry
            client={live.client}
            row={entryRow}
            techRoleId={current}
            onDone={() => {
              setEntryId(null);
              void live.reload();
            }}
            onError={(e, op) => {
              live.setError(e, op);
              void live.reload();
            }}
          />
        )}
      </div>
    </div>
  );
}
