// 画面共通：処方（MedicationRequest）・作業（Task）・調剤の記録（MedicationDispense）・患者・入院を取得して 1 行にまとめる
// （電子カルテの医師・看護師 F・薬剤部門システムの 3 画面。specs/004 research R-05・R-06）。
import type { Encounter, MedicationDispense, MedicationRequest, Patient, Task } from "fhir/r4";
import type { FhirClient, Versioned } from "../../fhir/client";
import { businessStatusCode, businessStatusLabel, dispenseLabel, formatStatus } from "../../fhir/labels";
import type { RowChange } from "./rowChanges";
import { loadPatients, patientName } from "./orders";

export interface PrescriptionRow {
  mr: Versioned<MedicationRequest>;
  task: Versioned<Task> | null;
  dispense: Versioned<MedicationDispense> | null;
  patientName: string;
  /** 入院の処方の病棟名（Encounter の location の表示名）。外来は null。 */
  wardName: string | null;
}

export const PHARMACY_OWNERS = "Organization/pharmacy-dept,PractitionerRole/ph-c,PractitionerRole/ph-e";
/** 病棟の画面が通知を受ける入院（病棟の画面は自病棟の入院を知っている前提。docs/04）。 */
export const WARD_ENCOUNTERS = "Encounter/adm-saburo";

const OWNERS: Record<string, string> = {
  "Organization/pharmacy-dept": "薬剤部",
  "PractitionerRole/ph-c": "薬剤師 C",
  "PractitionerRole/ph-e": "薬剤師 E",
};

export function prescriptionOwnerLabel(reference?: string): string {
  return reference ? (OWNERS[reference] ?? reference) : "—";
}

export function orderNumberOf(mr: MedicationRequest): string {
  return mr.identifier?.find((i) => i.system?.endsWith("/order-number"))?.value ?? `MedicationRequest/${mr.id}`;
}

/** 「ノルバスク錠５ｍｇ 1 錠 内服・経口・１日１回朝食後 14 日分」。 */
export function drugText(mr: MedicationRequest): string {
  const name = mr.medicationCodeableConcept?.coding?.[0]?.display ?? mr.medicationCodeableConcept?.text ?? "";
  const dosage = mr.dosageInstruction?.[0];
  const dose = dosage?.doseAndRate?.[0]?.doseQuantity;
  const days = dosage?.extension?.find((e) => e.url.endsWith("JP_MedicationDosage_UsageDuration"))?.valueDuration?.value;
  return [name, dose ? `${dose.value} ${dose.unit ?? ""}`.trim() : "", dosage?.text ?? "", days ? `${days} 日分` : ""].filter(Boolean).join(" ");
}

const refKey = (reference?: string) => reference ?? "";

/** 処方を起点に、作業（focus）・調剤の記録（authorizingPrescription）・患者（subject）・病棟（encounter）を結び付ける。新しい処方が先頭。 */
export function joinPrescriptions(
  mrs: Versioned<MedicationRequest>[],
  tasks: Versioned<Task>[],
  dispenses: Versioned<MedicationDispense>[],
  patients: Versioned<Patient>[],
  encounters: Versioned<Encounter>[],
): PrescriptionRow[] {
  const taskByFocus = new Map(tasks.map((t) => [refKey(t.resource.focus?.reference), t]));
  const dispenseByMr = new Map(dispenses.flatMap((d) => (d.resource.authorizingPrescription ?? []).map((r) => [refKey(r.reference), d] as const)));
  const patientById = new Map(patients.map((p) => [`Patient/${p.resource.id}`, p.resource]));
  const wardByEncounter = new Map(encounters.map((e) => [`Encounter/${e.resource.id}`, e.resource.location?.[0]?.location?.display ?? null]));
  const rows = mrs.map((mr) => ({
    mr,
    task: taskByFocus.get(`MedicationRequest/${mr.resource.id}`) ?? null,
    dispense: dispenseByMr.get(`MedicationRequest/${mr.resource.id}`) ?? null,
    patientName: patientName(patientById.get(refKey(mr.resource.subject?.reference))),
    wardName: mr.resource.encounter?.reference ? (wardByEncounter.get(mr.resource.encounter.reference) ?? null) : null,
  }));
  return rows.sort((a, b) => Number(b.mr.resource.id) - Number(a.mr.resource.id));
}

const JAPAN_TIME = new Intl.DateTimeFormat("ja-JP", { timeZone: "Asia/Tokyo", hour: "2-digit", minute: "2-digit", hourCycle: "h23" });

/**
 * 「お渡し・払出」の列の表示。調剤の記録があれば「お渡し済み 10:20」「払出済み 10:20・投与中」
 * （入院は払出の後も処方が有効のまま。未処理の処方に見せない）、無ければ薬剤部での進み具合。
 */
export function progressText(row: PrescriptionRow): string {
  if (row.dispense) {
    const md = row.dispense.resource;
    const time = md.whenHandedOver ? ` ${JAPAN_TIME.format(new Date(md.whenHandedOver))}` : "";
    const stillActive = md.destination && row.mr.resource.status === "active" ? "・投与中" : "";
    return `${dispenseLabel(md)}${time}${stillActive}`;
  }
  const task = row.task?.resource;
  if (!task) return "—";
  if (task.status === "requested") return "薬剤部で受付待ち";
  const business = businessStatusCode(task.businessStatus);
  return business ? `薬剤部で${businessStatusLabel(business)}` : "—";
}

// ---- 一覧の変化（D-28 と同じ見せ方） ----

const FIELDS = ["requestStatus", "status", "businessStatus", "owner", "dispense"] as const;
type Field = (typeof FIELDS)[number];

function valuesOf(row: PrescriptionRow): Record<Field, string> {
  const task = row.task?.resource;
  const business = businessStatusCode(task?.businessStatus);
  return {
    requestStatus: formatStatus("medicationRequest", row.mr.resource.status),
    status: task?.status ? formatStatus("task", task.status) : "—",
    businessStatus: business ? businessStatusLabel(business) : "—",
    owner: prescriptionOwnerLabel(task?.owner?.reference),
    dispense: row.dispense ? dispenseLabel(row.dispense.resource) : "—",
  };
}

/** 直前の表示と取り直した結果を処方の id で突き合わせる。prev が無いとき（初回・初期化の直後）は比べない。 */
export function diffPrescriptionRows(prev: PrescriptionRow[] | null, next: PrescriptionRow[]): RowChange[] {
  if (!prev) return [];
  const before = new Map(prev.map((r) => [r.mr.resource.id ?? "", r]));
  const changes: RowChange[] = [];
  for (const row of next) {
    const id = row.mr.resource.id ?? "";
    const old = before.get(id);
    if (!old) continue;
    const a = valuesOf(old);
    const b = valuesOf(row);
    const fields = FIELDS.filter((f) => a[f] !== b[f]).map((field) => ({ field, before: a[field], after: b[field] }));
    if (fields.length > 0) changes.push({ srId: id, fields });
  }
  return changes;
}

// ---- 取得 ----

export interface PrescriptionData {
  rows: PrescriptionRow[];
  patients: Versioned<Patient>[];
  encounters: Versioned<Encounter>[];
}

/** 電子カルテ（医師）：自分が出した処方。 */
export async function loadDoctorPrescriptions(client: FhirClient, doctor: "dr-x" | "dr-y"): Promise<PrescriptionData> {
  const [mrs, tasks, dispenses, patients, encounters] = await Promise.all([
    client.search<MedicationRequest>("MedicationRequest", { requester: `Practitioner/${doctor}` }),
    client.search<Task>("Task", { requester: `Practitioner/${doctor}` }),
    client.search<MedicationDispense>("MedicationDispense"),
    loadPatients(client),
    client.search<Encounter>("Encounter"),
  ]);
  return { rows: joinPrescriptions(mrs, tasks, dispenses, patients, encounters), patients, encounters };
}

/** 電子カルテ（看護師 F）：外科病棟に入院中の患者の処方。 */
export async function loadWardPrescriptions(client: FhirClient): Promise<PrescriptionData> {
  const [encounters, patients] = await Promise.all([
    client.search<Encounter>("Encounter", { location: "Location/ward-surgery", status: "in-progress" }),
    loadPatients(client),
  ]);
  if (encounters.length === 0) return { rows: [], patients, encounters };
  const refs = encounters.map((e) => `Encounter/${e.resource.id}`).join(",");
  const [mrs, tasks, dispenses] = await Promise.all([
    client.search<MedicationRequest>("MedicationRequest", { encounter: refs }),
    client.search<Task>("Task", { encounter: refs }),
    client.search<MedicationDispense>("MedicationDispense"),
  ]);
  return { rows: joinPrescriptions(mrs, tasks, dispenses, patients, encounters), patients, encounters };
}

/** 薬剤部門システム：薬剤部宛て・薬剤部の薬剤師が担当する作業と、その処方。 */
export async function loadPharmacyPrescriptions(client: FhirClient): Promise<PrescriptionData> {
  const [tasks, mrs, dispenses, patients, encounters] = await Promise.all([
    client.search<Task>("Task", { owner: PHARMACY_OWNERS }),
    client.search<MedicationRequest>("MedicationRequest"),
    client.search<MedicationDispense>("MedicationDispense"),
    loadPatients(client),
    client.search<Encounter>("Encounter"),
  ]);
  const focus = new Set(tasks.map((t) => t.resource.focus?.reference));
  const mine = mrs.filter((m) => focus.has(`MedicationRequest/${m.resource.id}`));
  return { rows: joinPrescriptions(mine, tasks, dispenses, patients, encounters), patients, encounters };
}
