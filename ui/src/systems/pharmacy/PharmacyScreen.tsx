import { useEffect, useMemo, useState } from "react";
import { Link, useSearchParams } from "react-router";
import { ErrorBanner } from "../../app/ErrorBanner";
import { PHARMACISTS, type PharmacistId } from "../../fhir/builders/prescription";
import { FhirClient, FhirError } from "../../fhir/client";
import { categoryLabel, prescriptionKind } from "../../fhir/labels";
import { acceptPrescription, dispenseToWard, handOver, startAudit } from "../../fhir/prescriptionActions";
import { monitorSocket } from "../../realtime/monitorSocket";
import { useLiveData } from "../../realtime/useLiveData";
import { PrescriptionChange, PrescriptionTask, RequestStatus } from "../shared/PrescriptionCells";
import { PHARMACY_OWNERS, diffPrescriptionRows, drugText, loadPharmacyPrescriptions, orderNumberOf, type PrescriptionRow } from "../shared/prescriptions";
import { useRowChanges } from "../shared/rowChanges";
import { pharmacyAction, type PharmacyAction } from "./pharmacyRules";

function parsePharmacist(value: string | null | undefined): PharmacistId {
  return value === "ph-e" ? "ph-e" : "ph-c";
}

/**
 * 薬剤部門システム：薬剤部宛ての処方と、受付・調剤・監査・お渡し（外来）／払出（入院）（FR-012〜FR-019）。
 * 通知の受信と一覧の取得は 1 つの画面（pharmacy）で行い、更新は操作する薬剤師の送信元で送る（specs/004 research R-05）。
 */
export function PharmacyScreen({
  embedded = false,
  pharmacist,
  onPharmacistChange,
}: {
  embedded?: boolean;
  /** ステージビューから薬剤師を制御するとき。無ければ画面の中の状態（最初の値は `?pharmacist=`）。 */
  pharmacist?: PharmacistId;
  onPharmacistChange?: (p: PharmacistId) => void;
}) {
  const [params] = useSearchParams();
  const [internal, setInternal] = useState<PharmacistId>(parsePharmacist(params.get("pharmacist")));
  const me = pharmacist ?? internal;
  const choose = (p: PharmacistId) => {
    setInternal(p);
    onPharmacistChange?.(p);
  };

  const live = useLiveData({
    clientId: "pharmacy",
    subscription: {
      id: "pharmacy-dept",
      criteria: `Task?owner=${PHARMACY_OWNERS}`,
      reason: "薬剤部宛て・薬剤部の薬剤師が担当する作業の通知",
    },
    load: loadPharmacyPrescriptions,
  });
  const changes = useRowChanges(live.data?.rows, diffPrescriptionRows);
  const [busyId, setBusyId] = useState<string | null>(null);
  const clients = useMemo(
    () => ({ "ph-c": new FhirClient(PHARMACISTS["ph-c"].clientId), "ph-e": new FhirClient(PHARMACISTS["ph-e"].clientId) }),
    [],
  );

  // 初期化を受けたら薬剤師 C に戻す
  useEffect(
    () =>
      monitorSocket.subscribe((m) => {
        if (m.type === "demo.reset") choose("ph-c");
      }),
    // eslint-disable-next-line react-hooks/exhaustive-deps -- choose は毎回作り直されるが、購読は 1 回でよい
    [],
  );

  /** 版の確認つきで送る。競合は表示して最新を取り直し、自動ではやり直さない（FR-003）。 */
  const run = async (row: PrescriptionRow, action: PharmacyAction) => {
    const id = row.mr.resource.id!;
    const cur = { mr: row.mr, task: row.task! };
    const client = clients[me];
    setBusyId(id);
    try {
      if (action.kind === "accept") await acceptPrescription(client, cur, me);
      else if (action.kind === "audit") await startAudit(client, cur, me);
      else if (action.kind === "handover") await handOver(client, cur, me);
      else await dispenseToWard(client, cur, me);
      await live.reload();
    } catch (e) {
      if (e instanceof FhirError) {
        await live.reload();
        live.setError(e, action.label);
      } else throw e;
    } finally {
      setBusyId(null);
    }
  };

  const rows = live.data?.rows ?? [];
  return (
    <div>
      {!embedded && (
        <header className="screen-header" style={{ padding: "var(--sp-3)" }}>
          <h1>薬剤部門システム</h1>
          <span className="spacer" />
          <Link to="/">入口へ</Link>
        </header>
      )}
      <div className="screen">
        <ErrorBanner error={live.error} onDismiss={live.clearError} />
        <section className="panel" aria-label="操作する薬剤師">
          <div className="row">
            <span className="muted">操作する薬剤師</span>
            <button type="button" aria-pressed={me === "ph-c"} disabled={me === "ph-c"} onClick={() => choose("ph-c")} data-guide="pharmacist-ph-c">
              薬剤師 C
            </button>
            <button type="button" aria-pressed={me === "ph-e"} disabled={me === "ph-e"} onClick={() => choose("ph-e")} data-guide="pharmacist-ph-e">
              薬剤師 E
            </button>
          </div>
        </section>
        <section className="panel" aria-label="処方の一覧" data-testid="pharmacy-list">
          <h2>処方の一覧</h2>
          {rows.length === 0 ? (
            <p className="muted">処方はまだありません。</p>
          ) : (
            <table className="data">
              <thead>
                <tr>
                  <th>処方</th>
                  <th>区分</th>
                  <th>処方の状態</th>
                  <th>作業の状態・操作</th>
                </tr>
              </thead>
              <tbody>
                {rows.map((row) => {
                  const id = row.mr.resource.id!;
                  const action = pharmacyAction(row, me);
                  const inpatient = prescriptionKind(row.mr.resource) === "inpatient";
                  return (
                    <tr key={id} data-testid={`rx-pharmacy-row-${id}`} className={changes.some((c) => c.srId === id) ? "row-changed" : undefined}>
                      <td>
                        <div>
                          <strong>{row.patientName}</strong>
                        </div>
                        <div>{drugText(row.mr.resource)}</div>
                        <div className="muted">{orderNumberOf(row.mr.resource)}</div>
                      </td>
                      <td>
                        <div>{inpatient ? `入院${row.wardName ? `（${row.wardName}）` : ""}` : "外来"}</div>
                        <div className="muted">{categoryLabel(row.mr.resource)}</div>
                      </td>
                      <td>
                        <RequestStatus status={row.mr.resource.status} />
                      </td>
                      <td>
                        <PrescriptionTask row={row} />
                        <PrescriptionChange id={id} changes={changes} />
                        {action && (
                          <div style={{ marginTop: "var(--sp-1)" }}>
                            <button
                              type="button"
                              className={action.enabled ? "primary" : undefined}
                              disabled={!action.enabled || busyId === id}
                              onClick={() => void run(row, action)}
                              data-guide={
                                action.kind === "accept"
                                  ? `rx-accept-${id}`
                                  : action.kind === "audit"
                                    ? `rx-audit-${id}`
                                    : action.kind === "handover"
                                      ? `rx-handover-${id}`
                                      : `rx-ward-dispense-${id}`
                              }
                            >
                              {action.label}
                            </button>
                            {action.hint && (
                              <div className="muted" data-testid={`rx-hint-${id}`}>
                                {action.hint}
                              </div>
                            )}
                          </div>
                        )}
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          )}
        </section>
      </div>
    </div>
  );
}
