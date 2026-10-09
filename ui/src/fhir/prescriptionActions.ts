// 画面の操作とシナリオの自動実行が共有する、処方・調剤の操作（FHIR への要求の送信。specs/004 research R-04）。
import type { Encounter, MedicationRequest, Task } from "fhir/r4";
import { FhirError, type FhirClient, type Versioned } from "./client";
import {
  buildAcceptPatch,
  buildAuditPatch,
  buildHandOverTransaction,
  buildPrescriptionTransaction,
  buildWardDispenseTransaction,
  nextPrescriptionOrderNumber,
  type DispenseParams,
  type PharmacistId,
  type PrescriberId,
} from "./builders/prescription";
import { dispenseConflictError, dispenserUnknownError } from "./errors";
import { businessStatusCode } from "./labels";

/** 処方とその作業（一覧の行の版を持つ）。 */
export interface CurrentPrescription {
  mr: Versioned<MedicationRequest>;
  task: Versioned<Task>;
}

export interface PrescriptionInput {
  patientId: string;
  medicationKey: string;
  /** 1 回量（錠）。 */
  doseValue: number;
  days: number;
}

const roleId = (reference?: string) => reference?.replace(/^PractitionerRole\//, "");

/**
 * 調剤した薬剤師：作業の版の履歴のうち、業務上の状態が調剤中だった**最後の版**の担当者（D-51）。
 * 監査の開始で担当者が監査する薬剤師に変わるため、現在の版からは分からない。履歴の並びには依存しない。
 */
export function dispenserOf(history: Versioned<Task>[]): PharmacistId | null {
  const version = (t: Versioned<Task>) => Number(t.resource.meta?.versionId ?? 0);
  const dispensing = history
    .filter((t) => businessStatusCode(t.resource.businessStatus) === "dispensing")
    .sort((a, b) => version(b) - version(a));
  const id = roleId(dispensing[0]?.resource.owner?.reference);
  return id === "ph-c" || id === "ph-e" ? id : null;
}

/** 医師が出した最新の処方とその作業。無ければ null。 */
export async function fetchLatestPrescription(client: FhirClient, doctorRef: string): Promise<CurrentPrescription | null> {
  const mrs = await client.search<MedicationRequest>("MedicationRequest", { requester: doctorRef });
  const mr = mrs[0];
  if (!mr) return null;
  const tasks = await client.search<Task>("Task", { focus: `MedicationRequest/${mr.resource.id}` });
  return tasks[0] ? { mr, task: tasks[0] } : null;
}

/** 処方する：患者に入院中の入院（Encounter）があれば入院の臨時処方、無ければ外来の院内処方（D-44）。 */
export async function placePrescription(client: FhirClient, doctor: PrescriberId, input: PrescriptionInput, now = new Date()): Promise<void> {
  const [existing, encounters] = await Promise.all([
    client.search<MedicationRequest>("MedicationRequest", { requester: `Practitioner/${doctor}` }),
    client.search<Encounter>("Encounter", { patient: `Patient/${input.patientId}`, status: "in-progress" }),
  ]);
  await client.transaction(
    buildPrescriptionTransaction({
      doctor,
      ...input,
      encounterId: encounters[0]?.resource.id ?? null,
      orderNumber: nextPrescriptionOrderNumber(now, existing.length),
      now,
    }),
    "処方",
  );
}

/** 受付・調剤開始：一覧の行の版で If-Match を付けた 1 回の PATCH（S1 の受付の 2 段階（D-27）にはしない）。 */
export async function acceptPrescription(client: FhirClient, cur: CurrentPrescription, pharmacist: PharmacistId, now = new Date()): Promise<void> {
  await client.patch("Task", cur.task.resource.id!, buildAcceptPatch(pharmacist, now), cur.task.etag, "受付・調剤開始");
}

export async function startAudit(client: FhirClient, cur: CurrentPrescription, pharmacist: PharmacistId, now = new Date()): Promise<void> {
  await client.patch("Task", cur.task.resource.id!, buildAuditPatch(pharmacist, now), cur.task.etag, "監査開始");
}

async function dispenseParams(client: FhirClient, cur: CurrentPrescription, checker: PharmacistId, now: Date): Promise<DispenseParams> {
  const history = await client.history<Task>("Task", cur.task.resource.id!);
  const packager = dispenserOf(history);
  if (!packager) throw new FhirError(dispenserUnknownError(), null, null);
  return { mr: cur.mr.resource, task: cur.task.resource, taskEtag: cur.task.etag, packager, checker, now };
}

/** Transaction の 412 は「お渡し（払出）は取り消された」という表示にして投げ直す。自動ではやり直さない。 */
async function sendDispense(send: () => Promise<unknown>, operation: "お渡し" | "払出"): Promise<void> {
  try {
    await send();
  } catch (e) {
    if (e instanceof FhirError && e.status === 412) throw new FhirError(dispenseConflictError(operation), 412, e.outcome);
    throw e;
  }
}

/** 外来のお渡し：調剤した薬剤師を版の履歴から読み、MedicationDispense + Task 完了 + 処方の完了を一括で送る。 */
export async function handOver(client: FhirClient, cur: CurrentPrescription, checker: PharmacistId, now = new Date()): Promise<void> {
  const params = await dispenseParams(client, cur, checker, now);
  await sendDispense(() => client.transaction(buildHandOverTransaction({ ...params, mrEtag: cur.mr.etag }), "お渡し"), "お渡し");
}

/** 入院の払出：MedicationDispense + Task 完了を一括で送る。処方は更新しない（active のまま。D-43）。 */
export async function dispenseToWard(client: FhirClient, cur: CurrentPrescription, checker: PharmacistId, now = new Date()): Promise<void> {
  const params = await dispenseParams(client, cur, checker, now);
  await sendDispense(() => client.transaction(buildWardDispenseTransaction(params), "払出"), "払出");
}
