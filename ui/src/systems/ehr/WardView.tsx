import { ErrorBanner } from "../../app/ErrorBanner";
import { useLiveData } from "../../realtime/useLiveData";
import { PrescriptionChange, PrescriptionTask, RequestStatus } from "../shared/PrescriptionCells";
import { WARD_ENCOUNTERS, diffPrescriptionRows, drugText, loadWardPrescriptions, progressText } from "../shared/prescriptions";
import { useRowChanges } from "../shared/rowChanges";

/**
 * 電子カルテ（看護師 F、外科病棟）：入院中の患者の処方と、払出済みの表示（FR-010、FR-011）。
 * 受領・与薬の操作は作らない（D-48）。通知で払出済みになったことを表示するだけ。
 */
export function WardView() {
  const live = useLiveData({
    clientId: "ehr-nurse-f",
    subscription: {
      id: "ehr-ward-surgery",
      criteria: `Task?encounter=${WARD_ENCOUNTERS}`,
      reason: "外科病棟の入院患者の処方の作業の通知",
    },
    load: loadWardPrescriptions,
  });
  const rows = live.data?.rows ?? [];
  const changes = useRowChanges(live.data?.rows, diffPrescriptionRows);

  return (
    <div className="screen">
      <ErrorBanner error={live.error} onDismiss={live.clearError} />
      <section className="panel" aria-label="病棟の処方" data-testid="ward-list">
        <h2>外科病棟の処方</h2>
        {rows.length === 0 ? (
          <p className="muted">処方はまだありません。</p>
        ) : (
          <table className="data">
            <thead>
              <tr>
                <th>処方</th>
                <th>処方の状態</th>
                <th>作業の状態</th>
                <th>払出</th>
              </tr>
            </thead>
            <tbody>
              {rows.map((row) => {
                const id = row.mr.resource.id!;
                return (
                  <tr key={id} data-testid={`ward-row-${id}`} className={changes.some((c) => c.srId === id) ? "row-changed" : undefined}>
                    <td>
                      <div>
                        <strong>{row.patientName}</strong>
                      </div>
                      <div>{drugText(row.mr.resource)}</div>
                    </td>
                    <td>
                      <RequestStatus status={row.mr.resource.status} />
                    </td>
                    <td>
                      <PrescriptionTask row={row} />
                      <PrescriptionChange id={id} changes={changes} />
                    </td>
                    <td>
                      <div data-testid={`ward-progress-${id}`}>{progressText(row)}</div>
                      {row.dispense && <div className="muted">病棟に届いています（処方は投与中のため有効のままです）</div>}
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
