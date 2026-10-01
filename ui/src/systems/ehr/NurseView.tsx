import { useState } from "react";
import type { Specimen } from "fhir/r4";
import { ErrorBanner } from "../../app/ErrorBanner";
import { FhirError } from "../../fhir/client";
import { buildCollectionTransaction } from "../../fhir/builders/labOrder";
import { useLiveData } from "../../realtime/useLiveData";
import { LIS_OWNERS, loadLabOrders, orderNumber, orderedSetNames, taskBusinessStatus, type OrderRow } from "../shared/orders";

/** 電子カルテ（看護師 D）：未採取の依頼から採血を記録する（FR-011）。 */
export function NurseView() {
  const live = useLiveData({
    clientId: "ehr-nurse",
    subscription: {
      id: "ehr-nurse",
      criteria: `Task?owner=${LIS_OWNERS}`,
      reason: "採血待ちの依頼を知るための通知",
    },
    load: loadLabOrders,
  });
  const [busyId, setBusyId] = useState<string | null>(null);
  // 採血待ち：Task.status が requested で、業務上の状態が未採取のもの
  const waiting = (live.data ?? []).filter(
    (r) => r.task?.resource.status === "requested" && taskBusinessStatus(r.task.resource) === "not-collected",
  );

  const collect = async (row: OrderRow) => {
    const id = row.sr.resource.id!;
    setBusyId(id);
    try {
      const specimenId = row.sr.resource.specimen?.[0]?.reference?.split("/")[1];
      const specimen = await live.client.read<Specimen>("Specimen", specimenId ?? "");
      await live.client.transaction(
        buildCollectionTransaction({
          specimen: specimen.resource,
          specimenEtag: specimen.etag,
          task: row.task!.resource,
          taskEtag: row.task!.etag,
          now: new Date(),
        }),
        "採血の記録",
      );
      await live.reload();
    } catch (e) {
      if (e instanceof FhirError) {
        live.setError(e, "採血の記録");
        await live.reload(); // 最新の状態を取り直す（自動でやり直さない）
      } else throw e;
    } finally {
      setBusyId(null);
    }
  };

  return (
    <div className="screen">
      <ErrorBanner error={live.error} onDismiss={live.clearError} />
      <section className="panel" aria-label="採血待ち">
        <h2>採血待ちの依頼</h2>
        {waiting.length === 0 ? (
          <p className="muted">採血待ちの依頼はありません。</p>
        ) : (
          <table className="data">
            <thead>
              <tr>
                <th>依頼</th>
                <th />
              </tr>
            </thead>
            <tbody>
              {waiting.map((row) => {
                const id = row.sr.resource.id!;
                return (
                  <tr key={id} data-testid={`collect-${id}`}>
                    <td>
                      <div>
                        <strong>{row.patientName}</strong>
                      </div>
                      <div>{orderedSetNames(row.sr.resource)}</div>
                      <div className="muted">{orderNumber(row.sr.resource)}</div>
                    </td>
                    <td>
                      <button type="button" className="primary" disabled={busyId === id} onClick={() => collect(row)} data-guide={`collect-${id}`}>
                        {busyId === id ? "記録中…" : "採血を記録"}
                      </button>
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        )}
      </section>
    </div>
  );
}
