import type { Task } from "fhir/r4";
import type { Versioned } from "../../fhir/client";
import { businessStatusLabel, formatStatus } from "../../fhir/labels";
import { orderNumber, orderedSetNames, taskBusinessStatus, type OrderRow } from "../shared/orders";
import { ownerLabel } from "../shared/StatusBadges";

/** 受付を始めた時点で読み込んだ作業（確定まで保持する。サーバーには保存しない。data-model.md §4）。 */
export interface AcceptDraft {
  srId: string;
  task: Versioned<Task>;
  openedAt: string;
}

/**
 * 受付の確認欄（D-27）。読み込んだ時点の内容と版を表示する。通知で一覧が更新されても、ここは変わらない。
 * 確定は読み込んだ版で If-Match を付ける（デモ設定で付けないこともある）。
 */
export function AcceptDraftPanel({
  row,
  draft,
  busy,
  canConfirm,
  onConfirm,
  onCancel,
}: {
  row: OrderRow;
  draft: AcceptDraft;
  busy: boolean;
  canConfirm: boolean;
  onConfirm: () => void;
  onCancel: () => void;
}) {
  const id = draft.srId;
  const t = draft.task.resource;
  const version = t.meta?.versionId ?? "?";
  const loaded = { ...row, task: draft.task };
  return (
    <div className="panel" role="dialog" aria-label="受付の確認" data-testid={`accept-draft-${id}`} style={{ marginTop: "var(--sp-1)" }}>
      <div>
        <strong>{row.patientName}</strong>　{orderedSetNames(row.sr.resource)}　<span className="muted">{orderNumber(row.sr.resource)}</span>
      </div>
      <div className="muted">受付を始めた時刻：{new Date(draft.openedAt).toLocaleTimeString("ja-JP")}</div>
      <div>
        読み込んだ作業の状態：{formatStatus("task", t.status)}
        {taskBusinessStatus(t) ? `（${businessStatusLabel(taskBusinessStatus(t)!)}）` : ""}　担当：{ownerLabel(loaded)}
      </div>
      <div data-testid={`accept-draft-version-${id}`}>
        版 {version}（{draft.task.etag ?? "ETag なし"}）をもとに受付します
      </div>
      <div className="row" style={{ marginTop: "var(--sp-1)" }}>
        <button
          type="button"
          className="primary"
          disabled={busy || !canConfirm}
          onClick={onConfirm}
          data-guide={`accept-confirm-${id}`}
          data-testid={`accept-confirm-${id}`}
        >
          受付を確定
        </button>
        <button type="button" disabled={busy} onClick={onCancel} data-testid={`accept-cancel-${id}`}>
          取りやめ
        </button>
      </div>
    </div>
  );
}
