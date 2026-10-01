// 画面共通：依頼（ServiceRequest）・作業（Task）・患者を取得して 1 行にまとめる。
import type { Patient, ServiceRequest, Task } from "fhir/r4";
import type { FhirClient, Versioned } from "../../fhir/client";
import { businessStatusCode } from "../../fhir/labels";

export interface OrderRow {
  sr: Versioned<ServiceRequest>;
  task: Versioned<Task> | null;
  patientName: string;
}

export const LIS_OWNERS = "Organization/lab-dept,PractitionerRole/tech-a,PractitionerRole/tech-b";

export function patientName(p: Patient | undefined): string {
  return p?.name?.[0]?.text ?? p?.id ?? "不明な患者";
}

export function orderNumber(sr: ServiceRequest): string {
  return sr.identifier?.[0]?.value ?? `ServiceRequest/${sr.id}`;
}

export function orderedSetNames(sr: ServiceRequest): string {
  return (sr.orderDetail ?? []).map((d) => d.text ?? d.coding?.[0]?.display ?? "").join("・");
}

export function taskBusinessStatus(task: Task | undefined | null): string | undefined {
  return businessStatusCode(task?.businessStatus);
}

/** 依頼と作業を結び付けて行にする。作業は focus（ServiceRequest/{id}）で対応付ける。 */
export function joinOrders(
  srs: Versioned<ServiceRequest>[],
  tasks: Versioned<Task>[],
  patients: Versioned<Patient>[],
): OrderRow[] {
  const taskByFocus = new Map(tasks.map((t) => [t.resource.focus?.reference ?? "", t]));
  const patientById = new Map(patients.map((p) => [`Patient/${p.resource.id}`, p.resource]));
  return srs.map((sr) => ({
    sr,
    task: taskByFocus.get(`ServiceRequest/${sr.resource.id}`) ?? null,
    patientName: patientName(patientById.get(sr.resource.subject?.reference ?? "")),
  }));
}

/** 患者番号の昇順（サーバーの検索結果は更新日時の新しい順なので、画面で並べ直す）。 */
export async function loadPatients(client: FhirClient): Promise<Versioned<Patient>[]> {
  const list = await client.search<Patient>("Patient");
  const number = (p: Versioned<Patient>) => p.resource.identifier?.[0]?.value ?? p.resource.id ?? "";
  return [...list].sort((a, b) => number(a).localeCompare(number(b)));
}

/** 電子カルテ（医師）：自分が出した依頼。 */
export async function loadDoctorOrders(client: FhirClient): Promise<{ rows: OrderRow[]; patients: Versioned<Patient>[] }> {
  const [srs, tasks, patients] = await Promise.all([
    client.search<ServiceRequest>("ServiceRequest", { requester: "Practitioner/dr-x" }),
    client.search<Task>("Task", { requester: "Practitioner/dr-x" }),
    loadPatients(client),
  ]);
  return { rows: joinOrders(srs, tasks, patients), patients };
}

/** 検査部宛て・検査部の技師が担当する作業と、その依頼（看護師・技師の画面共通）。 */
export async function loadLabOrders(client: FhirClient): Promise<OrderRow[]> {
  const [tasks, srs, patients] = await Promise.all([
    client.search<Task>("Task", { owner: LIS_OWNERS }),
    client.search<ServiceRequest>("ServiceRequest"),
    loadPatients(client),
  ]);
  const taskFocus = new Set(tasks.map((t) => t.resource.focus?.reference));
  return joinOrders(
    srs.filter((s) => taskFocus.has(`ServiceRequest/${s.resource.id}`)),
    tasks,
    patients,
  );
}
