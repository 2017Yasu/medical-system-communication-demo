import { Link, useSearchParams } from "react-router";
import { ErrorBanner } from "../../app/ErrorBanner";
import { PRESCRIBERS, type PrescriberId } from "../../fhir/builders/prescription";
import { categoryLabel, prescriptionKind } from "../../fhir/labels";
import { useLiveData } from "../../realtime/useLiveData";
import { PrescriptionChange, PrescriptionTask, RequestStatus } from "../shared/PrescriptionCells";
import { diffPrescriptionRows, drugText, loadDoctorPrescriptions, orderNumberOf, progressText } from "../shared/prescriptions";
import { useRowChanges } from "../shared/rowChanges";
import { PrescriptionForm } from "./PrescriptionForm";
import { WardView } from "./WardView";

export type RxRole = PrescriberId | "ns-f";

const TITLES: Record<RxRole, string> = {
  "dr-x": "電子カルテ（医師 X）処方",
  "dr-y": "電子カルテ（医師 Y）処方",
  "ns-f": "電子カルテ（看護師 F）外科病棟",
};

export function parseRxRole(value: string | null | undefined): RxRole {
  return value === "dr-y" || value === "ns-f" ? value : "dr-x";
}

/** 電子カルテの処方画面。`/ehr/rx?role=dr-x|dr-y|ns-f`（ステージビューからは props で役割を渡す）。 */
export function PrescriptionScreen({ role, embedded = false }: { role?: RxRole; embedded?: boolean }) {
  const [params] = useSearchParams();
  const current = role ?? parseRxRole(params.get("role"));
  return (
    <div>
      {!embedded && (
        <header className="screen-header" style={{ padding: "var(--sp-3)" }}>
          <h1>{TITLES[current]}</h1>
          {current === "dr-x" && <Link to="/ehr?role=doctor">検体検査</Link>}
          <span className="spacer" />
          <Link to="/">入口へ</Link>
        </header>
      )}
      {current === "ns-f" ? <WardView /> : <DoctorRxView doctor={current} />}
    </div>
  );
}

/** 電子カルテ（医師）：処方を出し、進捗とお渡し・払出の状況を見る。 */
function DoctorRxView({ doctor }: { doctor: PrescriberId }) {
  const live = useLiveData({
    clientId: PRESCRIBERS[doctor].clientId,
    subscription: {
      id: `ehr-rx-${doctor}`,
      criteria: `Task?requester=Practitioner/${doctor}`,
      reason: `${PRESCRIBERS[doctor].name}が出した処方の作業の通知`,
    },
    load: (client) => loadDoctorPrescriptions(client, doctor),
    deps: [doctor],
  });
  const rows = live.data?.rows ?? [];
  const changes = useRowChanges(live.data?.rows, diffPrescriptionRows);

  return (
    <div className="screen">
      <ErrorBanner error={live.error} onDismiss={live.clearError} />
      <PrescriptionForm
        key={doctor}
        client={live.client}
        doctor={doctor}
        patients={live.data?.patients ?? []}
        encounters={live.data?.encounters ?? []}
        onDone={() => void live.reload()}
        onError={(e, op) => live.setError(e, op)}
      />
      <section className="panel" aria-label="処方の一覧" data-testid="rx-list">
        <h2>処方の一覧</h2>
        {rows.length === 0 ? (
          <p className="muted">まだ処方がありません。</p>
        ) : (
          <table className="data">
            <thead>
              <tr>
                <th>処方</th>
                <th>区分</th>
                <th>処方の状態</th>
                <th>作業の状態</th>
                <th>お渡し・払出</th>
              </tr>
            </thead>
            <tbody>
              {rows.map((row) => {
                const id = row.mr.resource.id!;
                const inpatient = prescriptionKind(row.mr.resource) === "inpatient";
                return (
                  <tr key={id} data-testid={`rx-row-${id}`} className={changes.some((c) => c.srId === id) ? "row-changed" : undefined}>
                    <td>
                      <div>
                        <strong>{row.patientName}</strong>
                      </div>
                      <div>{drugText(row.mr.resource)}</div>
                      <div className="muted">{orderNumberOf(row.mr.resource)}</div>
                    </td>
                    <td>
                      <div>{inpatient ? "入院・臨時" : "外来・院内"}</div>
                      <div className="muted">{categoryLabel(row.mr.resource)}{row.wardName ? `（${row.wardName}）` : ""}</div>
                    </td>
                    <td>
                      <RequestStatus status={row.mr.resource.status} />
                    </td>
                    <td>
                      <PrescriptionTask row={row} />
                      <PrescriptionChange id={id} changes={changes} />
                    </td>
                    <td data-testid={`rx-progress-${id}`}>{progressText(row)}</td>
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
