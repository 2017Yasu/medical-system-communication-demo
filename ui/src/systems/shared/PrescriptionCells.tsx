// 処方の一覧に共通の表示部品（電子カルテの医師・看護師 F・薬剤部門システム）。業務用語を主に、FHIR のコード値を併記する（FR-031）。
import { businessStatusCode, businessStatusLabel, statusLabel } from "../../fhir/labels";
import { Coded } from "./StatusBadges";
import type { StampedChange } from "./rowChanges";
import { prescriptionOwnerLabel, type PrescriptionRow } from "./prescriptions";

export function RequestStatus({ status }: { status: string }) {
  const cls = status === "completed" ? "ok" : status === "revoked" ? "error" : "";
  return (
    <span className={`badge ${cls}`}>
      <Coded label={statusLabel("medicationRequest", status)} code={status} />
    </span>
  );
}

/** 作業の状態・業務上の状態・担当。 */
export function PrescriptionTask({ row }: { row: PrescriptionRow }) {
  const task = row.task?.resource;
  if (!task) return <span className="muted">作業なし</span>;
  const business = businessStatusCode(task.businessStatus);
  const cls = task.status === "completed" ? "ok" : task.status === "cancelled" || task.status === "rejected" ? "error" : "";
  return (
    <span>
      <span className={`badge ${cls}`}>
        <Coded label={statusLabel("task", task.status)} code={task.status} />
      </span>
      {business && (
        <>
          {" "}
          <span className="badge">
            <Coded label={businessStatusLabel(business)} code={business} />
          </span>
        </>
      )}
      <div className="muted">担当：{prescriptionOwnerLabel(task.owner?.reference)}</div>
    </span>
  );
}

const FIELD_LABEL: Record<string, string> = {
  requestStatus: "処方",
  status: "作業の状態",
  businessStatus: "業務上の状態",
  owner: "担当",
  dispense: "お渡し・払出",
};

/** 通知で変わった項目の「変更前 → 変更後」（D-28。強調であって、エラーではない）。 */
export function PrescriptionChange({ id, changes }: { id: string; changes: StampedChange[] }) {
  const change = changes.find((c) => c.srId === id);
  if (!change) return null;
  return (
    <div className="row-change" data-testid={`row-change-${id}`}>
      {change.fields.map((f) => (
        <div key={f.field}>
          {FIELD_LABEL[f.field] ?? f.field}：{f.before} → {f.after}
        </div>
      ))}
    </div>
  );
}
