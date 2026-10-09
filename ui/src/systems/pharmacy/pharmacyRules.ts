// 薬剤部門システムの画面側の制限（specs/004 data-model.md §3.2、D-46）。
// 調剤した薬剤師は監査を始められない、監査を始めた薬剤師だけがお渡し・払出できる。サーバーはこれを判定しない。
import { PHARMACISTS, type PharmacistId } from "../../fhir/builders/prescription";
import { businessStatusCode, prescriptionKind } from "../../fhir/labels";
import type { PrescriptionRow } from "../shared/prescriptions";

export type PharmacyActionKind = "accept" | "audit" | "handover" | "ward-dispense";

export interface PharmacyAction {
  kind: PharmacyActionKind;
  label: string;
  enabled: boolean;
  /** 押せない理由。 */
  hint?: string;
}

const other = (me: PharmacistId): PharmacistId => (me === "ph-c" ? "ph-e" : "ph-c");

/** 行の状態と操作する薬剤師から、表示する操作を決める。操作が無い行（完了・作業なし）は null。 */
export function pharmacyAction(row: PrescriptionRow, me: PharmacistId): PharmacyAction | null {
  const task = row.task?.resource;
  if (!task) return null;
  const owner = task.owner?.reference?.replace("PractitionerRole/", "");
  if (task.status === "requested") return { kind: "accept", label: "受付・調剤開始", enabled: true };
  if (task.status !== "in-progress") return null;
  const business = businessStatusCode(task.businessStatus);
  if (business === "dispensing") {
    if (owner === me) {
      return {
        kind: "audit",
        label: "監査を開始",
        enabled: false,
        hint: `調剤した薬剤師とは別の薬剤師が監査します（${PHARMACISTS[other(me)].name} に切り替えてください）`,
      };
    }
    return { kind: "audit", label: "監査を開始", enabled: true };
  }
  if (business === "auditing") {
    const inpatient = prescriptionKind(row.mr.resource) === "inpatient";
    const base = inpatient
      ? ({ kind: "ward-dispense", label: "監査を終えて払出" } as const)
      : ({ kind: "handover", label: "監査を終えてお渡し" } as const);
    if (owner === me) return { ...base, enabled: true };
    const name = PHARMACISTS[owner as PharmacistId]?.name ?? "監査を始めた薬剤師";
    return { ...base, enabled: false, hint: `監査を始めた薬剤師（${name}）が操作します` };
  }
  return null;
}
