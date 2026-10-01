import { useState } from "react";

/** 受付不可の理由を入力する（FR-017）。理由が空のときは確定できない。 */
export function RejectDialog({ onSubmit, onCancel }: { onSubmit: (reason: string) => void; onCancel: () => void }) {
  const [reason, setReason] = useState("");
  return (
    <div className="panel" role="dialog" aria-label="受付不可の理由" data-testid="reject-dialog" style={{ marginTop: "var(--sp-1)" }}>
      <div className="field">
        <label htmlFor="reject-reason">受付不可の理由</label>
        <input
          id="reject-reason"
          type="text"
          value={reason}
          placeholder="例：溶血のため再採血が必要"
          onChange={(e) => setReason(e.target.value)}
          data-guide="reject-reason"
        />
      </div>
      <div className="row">
        <button type="button" className="danger" disabled={reason.trim() === ""} onClick={() => onSubmit(reason.trim())} data-guide="reject-confirm">
          受付不可にする
        </button>
        <button type="button" onClick={onCancel}>
          やめる
        </button>
      </div>
    </div>
  );
}
