import { useEffect, useReducer, useState } from "react";
import { Link, useSearchParams } from "react-router";
import { ErrorBanner } from "../../app/ErrorBanner";
import { usePolicy } from "../../demo/usePolicy";
import { CT_DOCTORS, DEFAULT_CT_PROCEDURE, procedure, type CtDoctorId } from "../../fhir/builders/ctBooking";
import { FhirError } from "../../fhir/client";
import { bookDirect, confirmBooking, holdSlot, releaseSlot, selectSlot } from "../../fhir/ctActions";
import { slotHoldConflictError, slotHoldExpiredError } from "../../fhir/errors";
import { formatSlotTime, formatStatus } from "../../fhir/labels";
import { monitorSocket } from "../../realtime/monitorSocket";
import { useLiveData } from "../../realtime/useLiveData";
import { patientName } from "../shared/orders";
import { useRowChanges, type ChangeField } from "../shared/rowChanges";
import { diffSlotRows, loadCtSlots, type SlotRow } from "../shared/slots";
import { BookingDraftPanel } from "./BookingDraftPanel";
import { reduceBookingDraft } from "./bookingDraft";

const FIELD_LABEL: Record<string, string> = { status: "状態", holder: "押さえた人", bookings: "予約" };

/** 1 秒ごとに現在時刻を返す（仮押さえ中の残り時間の表示用）。active が false の間は止める。 */
function useNow(active: boolean): number {
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    if (!active) return;
    setNow(Date.now());
    const timer = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(timer);
  }, [active]);
  return now;
}

/** 電子カルテ：CT の枠を選んで予約する（仮押さえ → 確定、または直接予約。specs/003 research R-04）。 */
export function CtBookingScreen({ doctor: doctorProp }: { doctor?: CtDoctorId }) {
  const [params] = useSearchParams();
  const doctor: CtDoctorId = doctorProp ?? (params.get("doctor") === "dr-y" ? "dr-y" : "dr-x");
  const info = CT_DOCTORS[doctor];

  const live = useLiveData({
    clientId: info.clientId,
    subscription: { id: "ehr-ct-slots", criteria: "Slot?schedule=Schedule/ct-1", reason: "CT-1 号機の予約枠の通知" },
    load: loadCtSlots,
  });
  const { policy } = usePolicy();
  const [draft, dispatch] = useReducer(reduceBookingDraft, null);
  const [busy, setBusy] = useState(false);
  const [result, setResult] = useState<string | null>(null);
  const now = useNow(draft?.held != null);
  const rows: SlotRow[] = live.data?.rows ?? [];
  const patients = live.data?.patients ?? [];
  const changes = useRowChanges(live.data ? live.data.rows : null, diffSlotRows);

  // 初期化を受けたら、予約中の枠を破棄する
  useEffect(
    () =>
      monitorSocket.subscribe((m) => {
        if (m.type === "demo.reset") {
          dispatch({ type: "reset" });
          setResult(null);
        }
      }),
    [],
  );
  // 通知で一覧が取り直されても、予約中の内容（選んだ版・仮押さえの版）は変えない：予約欄は一覧の行ではなく draft から表示する

  /** 失敗した操作の後始末：予約欄を閉じ、最新を取り直してからエラーを出す（自動ではやり直さない）。 */
  const fail = async (e: unknown, operation: string, display?: FhirError) => {
    dispatch({ type: "close", reason: "error" });
    await live.reload();
    if (display) live.setError(display, operation);
    else if (e instanceof FhirError) live.setError(e, operation);
    else throw e;
  };

  const run = async (operation: () => Promise<void>) => {
    setBusy(true);
    try {
      await operation();
    } finally {
      setBusy(false);
    }
  };

  const mode = policy?.ehrUsesSlotHold === false ? "direct" : "hold";

  const selectRow = (row: SlotRow) =>
    run(async () => {
      if (!policy) return;
      setResult(null);
      try {
        const slot = await selectSlot(live.client, row.slot.resource.id!);
        dispatch({ type: "select", slot, mode, patientId: info.defaultPatientId, procedureCode: DEFAULT_CT_PROCEDURE });
      } catch (e) {
        await fail(e, "枠の選択");
      }
    });

  const hold = () =>
    run(async () => {
      if (!draft || !policy) return;
      try {
        const held = await holdSlot(live.client, draft.slot, doctor);
        dispatch({ type: "held", held, holdSeconds: policy.slotHoldSeconds });
        live.clearError();
      } catch (e) {
        if (e instanceof FhirError && e.status === 412) {
          // 誰が先に押さえたかを最新の枠から示す。自動ではやり直さない（FR-012）
          const latest = await selectSlot(live.client, draft.slot.resource.id!).catch(() => null);
          await fail(e, "仮押さえ", new FhirError(latest ? slotHoldConflictError(latest.resource) : e.display, 412, e.outcome));
        } else {
          await fail(e, "仮押さえ");
        }
      }
    });

  const confirm = () =>
    run(async () => {
      if (!draft) return;
      const target = { slot: draft.held ?? draft.slot, doctor, patientId: draft.patientId, procedureCode: draft.procedureCode };
      try {
        const { orderNumber } = draft.mode === "direct" ? await bookDirect(live.client, target) : await confirmBooking(live.client, target);
        const patient = patients.find((p) => p.resource.id === draft.patientId);
        const slot = draft.slot.resource;
        setResult(
          `予約しました（オーダー番号 ${orderNumber}、${formatSlotTime(slot.start, slot.end)} ${procedure(draft.procedureCode).display} ${patientName(patient?.resource)}）`,
        );
        dispatch({ type: "close", reason: "booked" });
        live.clearError();
        await live.reload();
      } catch (e) {
        if (e instanceof FhirError && e.status === 412 && draft.mode === "hold") {
          await fail(e, "予約", new FhirError(slotHoldExpiredError(), 412, e.outcome));
        } else {
          await fail(e, "予約");
        }
      }
    });

  const cancel = () =>
    run(async () => {
      if (!draft) return;
      if (!draft.held) {
        dispatch({ type: "close", reason: "cancelled" });
        return;
      }
      try {
        await releaseSlot(live.client, draft.held);
        dispatch({ type: "close", reason: "released" });
        await live.reload();
      } catch (e) {
        if (e instanceof FhirError && e.status === 412) {
          // 期限切れで既に戻っている。エラーにはしない
          dispatch({ type: "close", reason: "expired" });
          setResult("仮押さえの期限が切れていました");
          await live.reload();
        } else {
          await fail(e, "仮押さえの取りやめ");
        }
      }
    });

  const selectable = (row: SlotRow) =>
    !draft && !busy && policy !== null && (mode === "direct" || row.slot.resource.status === "free");

  return (
    <div>
      <header className="screen-header" style={{ padding: "var(--sp-3)" }}>
        <h1>電子カルテ（{info.name}）CT 予約</h1>
        {doctor === "dr-x" && <Link to="/ehr?role=doctor">検体検査</Link>}
        <span className="spacer" />
        <Link to="/">入口へ</Link>
      </header>
      <div className="screen">
        <p className="muted" data-testid="ct-booking-mode">
          予約方式：{!policy ? "取得中…" : mode === "hold" ? `仮押さえを使う（期限 ${policy.slotHoldSeconds} 秒）` : "直接予約する（デモ設定）"}
        </p>
        <ErrorBanner error={live.error} onDismiss={live.clearError} />
        {result && (
          <p role="status" className="panel" data-testid="booking-result">
            {result}
          </p>
        )}
        <section className="panel" aria-label="CT-1 号機の予約枠">
          <h2>CT-1 号機の予約枠</h2>
          {rows.length === 0 ? (
            <p className="muted">予約枠はありません。</p>
          ) : (
            <table className="data" data-testid="ct-slots">
              <thead>
                <tr>
                  <th>日時</th>
                  <th>状態</th>
                  <th>予約</th>
                  <th>版</th>
                  <th>操作</th>
                </tr>
              </thead>
              <tbody>
                {rows.map((row) => {
                  const id = row.slot.resource.id!;
                  const change = changes.find((c) => c.srId === id);
                  return (
                    <tr key={id} className={change ? "row-changed" : undefined} data-testid={`slot-row-${id}`}>
                      <td>{formatSlotTime(row.slot.resource.start, row.slot.resource.end)}</td>
                      <td>
                        {formatStatus("slot", row.slot.resource.status)}
                        {row.holder && <span>（{row.holder}）</span>}
                        {change && (
                          <div className="row-change" data-testid={`row-change-${id}`}>
                            {change.fields.map((f) => (
                              <div key={f.field}>
                                {FIELD_LABEL[f.field as ChangeField] ?? f.field}：{f.before} → {f.after}
                              </div>
                            ))}
                          </div>
                        )}
                      </td>
                      <td>{row.bookings.length === 0 ? "—" : row.bookings.map((b) => b.patientName).join("・")}</td>
                      <td>
                        <code className="code">{row.slot.etag}</code>
                      </td>
                      <td>
                        <button type="button" disabled={!selectable(row)} onClick={() => selectRow(row)} data-testid={`slot-select-${id}`}>
                          枠を選ぶ
                        </button>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          )}
        </section>
        {draft && (
          <BookingDraftPanel
            draft={draft}
            patients={patients}
            now={now}
            busy={busy}
            onEdit={(change) => dispatch({ type: "edit", ...change })}
            onHold={hold}
            onConfirm={confirm}
            onCancel={cancel}
          />
        )}
      </div>
    </div>
  );
}
