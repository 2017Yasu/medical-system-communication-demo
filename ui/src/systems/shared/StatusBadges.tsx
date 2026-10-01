import type { Task } from "fhir/r4";
import { formatStatus, businessStatusLabel, statusLabel } from "../../fhir/labels";
import type { OrderRow } from "./orders";
import { taskBusinessStatus } from "./orders";

/** 業務用語を主に、FHIR のコード値を併記して表示する（FR-031）。 */
export function Coded({ label, code }: { label: string; code: string }) {
  return (
    <span>
      {label} <span className="code">{code}</span>
    </span>
  );
}

export function SrStatus({ status }: { status: string }) {
  const cls = status === "completed" ? "ok" : status === "revoked" ? "error" : "";
  return (
    <span className={`badge ${cls}`} title={formatStatus("serviceRequest", status)}>
      <Coded label={statusLabel("serviceRequest", status)} code={status} />
    </span>
  );
}

export function TaskStatus({ task }: { task: Task | null | undefined }) {
  if (!task) return <span className="muted">作業なし</span>;
  const biz = taskBusinessStatus(task);
  const cls = task.status === "completed" ? "ok" : task.status === "cancelled" || task.status === "rejected" ? "error" : "";
  return (
    <span>
      <span className={`badge ${cls}`}>
        <Coded label={statusLabel("task", task.status)} code={task.status} />
      </span>
      {biz && (
        <>
          {" "}
          <span className="badge">
            <Coded label={businessStatusLabel(biz)} code={biz} />
          </span>
        </>
      )}
    </span>
  );
}

export function ownerLabel(row: OrderRow): string {
  const ref = row.task?.resource.owner?.reference;
  if (!ref) return "—";
  if (ref === "Organization/lab-dept") return "検査部";
  if (ref === "PractitionerRole/tech-a") return "技師 A";
  if (ref === "PractitionerRole/tech-b") return "技師 B";
  return ref;
}
