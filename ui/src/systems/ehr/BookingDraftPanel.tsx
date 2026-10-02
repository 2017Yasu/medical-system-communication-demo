import type { Patient } from "fhir/r4";
import type { Versioned } from "../../fhir/client";
import { CT_PROCEDURES } from "../../fhir/builders/ctBooking";
import { formatSlotTime, formatStatus } from "../../fhir/labels";
import { patientName } from "../shared/orders";
import { remainingSeconds, type BookingDraft } from "./bookingDraft";

/**
 * 予約欄：「枠を選ぶ」で取得した版を、仮押さえ・確定まで保持して表示する（specs/003 contracts/ui-screens.md）。
 * 通知で一覧が取り直されて枠の状態が変わっても、この欄の内容は変わらない（行の状態ではなく draft の有無で表示する）。
 */
export function BookingDraftPanel({
  draft,
  patients,
  now,
  busy,
  onEdit,
  onHold,
  onConfirm,
  onCancel,
}: {
  draft: BookingDraft;
  patients: Versioned<Patient>[];
  now: number;
  busy: boolean;
  onEdit: (change: { patientId?: string; procedureCode?: string }) => void;
  onHold: () => void;
  onConfirm: () => void;
  onCancel: () => void;
}) {
  const slot = draft.slot.resource;
  const remaining = remainingSeconds(draft, now);
  const holding = draft.held !== null;
  return (
    <section className="panel" aria-label="予約欄" data-testid="booking-draft">
      <h2>予約する枠</h2>
      <p data-testid="booking-slot">
        <strong>{formatSlotTime(slot.start, slot.end)}</strong>　選んだ時点の状態：{formatStatus("slot", slot.status)}　
        版 {slot.meta?.versionId}（{draft.slot.etag}）をもとに予約します
      </p>
      <div className="row">
        <div className="field">
          <label htmlFor="booking-patient">患者</label>
          <select id="booking-patient" value={draft.patientId} onChange={(e) => onEdit({ patientId: e.target.value })} data-testid="booking-patient">
            {patients.map((p) => (
              <option key={p.resource.id} value={p.resource.id}>
                {patientName(p.resource)}（{p.resource.identifier?.[0]?.value}）
              </option>
            ))}
          </select>
        </div>
        <div className="field">
          <label htmlFor="booking-procedure">検査内容</label>
          <select
            id="booking-procedure"
            value={draft.procedureCode}
            onChange={(e) => onEdit({ procedureCode: e.target.value })}
            data-testid="booking-procedure"
          >
            {CT_PROCEDURES.map((p) => (
              <option key={p.code} value={p.code}>
                {p.display}
              </option>
            ))}
          </select>
        </div>
      </div>
      {draft.mode === "hold" && holding && (
        <p role="status" data-testid="booking-remaining">
          {remaining === 0 ? "期限切れ（サーバーの処理を待っています）" : `確定までの残り ${remaining} 秒`}
        </p>
      )}
      <div className="row">
        {draft.mode === "hold" && !holding && (
          <button type="button" className="primary" disabled={busy} onClick={onHold} data-testid="booking-hold">
            仮押さえする
          </button>
        )}
        {draft.mode === "hold" && holding && (
          <button type="button" className="primary" disabled={busy} onClick={onConfirm} data-testid="booking-confirm">
            確定する
          </button>
        )}
        {draft.mode === "direct" && (
          <button type="button" className="primary" disabled={busy} onClick={onConfirm} data-testid="booking-confirm-direct">
            予約を確定する
          </button>
        )}
        <button type="button" disabled={busy} onClick={onCancel} data-testid="booking-cancel">
          取りやめる
        </button>
      </div>
    </section>
  );
}
