// 処方・調剤の各操作が送る FHIR リソース・要求の組み立て（specs/004 data-model.md §2、contracts/fhir-api.md）。
// 薬剤・コードは FHIR マスタ（src/master/fhir-master.json）から読む。サーバーの統合テスト（PharmacyFlow）と同じ内容になるようにする。
import type {
  Bundle,
  BundleEntry,
  CodeableConcept,
  Coding,
  Dosage,
  Identifier,
  MedicationDispense,
  MedicationRequest,
  Quantity,
  Task,
} from "fhir/r4";
import master from "../../master/fhir-master.json";
import type { JsonPatchOp } from "../client";

export type PrescriberId = "dr-x" | "dr-y";
export type PharmacistId = "ph-c" | "ph-e";
export type Medication = (typeof master.medications)[number];

export const PRESCRIBERS: Record<PrescriberId, { name: string; clientId: "ehr-doctor" | "ehr-doctor-y" }> = {
  "dr-x": { name: "医師 X", clientId: "ehr-doctor" },
  "dr-y": { name: "医師 Y", clientId: "ehr-doctor-y" },
};
export const PHARMACISTS: Record<PharmacistId, { name: string; clientId: "pharmacy-ph-c" | "pharmacy-ph-e" }> = {
  "ph-c": { name: "薬剤師 C", clientId: "pharmacy-ph-c" },
  "ph-e": { name: "薬剤師 E", clientId: "pharmacy-ph-e" },
};
export const PHARMACY_DEPT = "Organization/pharmacy-dept";
export const WARD_LOCATION = "Location/ward-surgery";
export const MEDICATIONS = master.medications;
export const PRESCRIPTION_DEFAULTS = master.prescriptionDefaults;

const iso = (d: Date) => d.toISOString();
const DAYS_UNIT = { system: master.systems.ucum, code: "d", unit: "日" };

type Codings = typeof master.codings;
function coding(key: keyof Codings): Coding {
  const c = master.codings[key];
  return { system: c.system, code: c.code, display: c.display };
}

export function medication(key: string): Medication {
  const m = master.medications.find((x) => x.key === key);
  if (!m) throw new Error(`未知の薬剤: ${key}`);
  return m;
}

export function pharmBusinessStatus(code: "dispensing" | "auditing"): CodeableConcept {
  const display = master.pharmBusinessStatuses.find((b) => b.code === code)?.display ?? code;
  return { coding: [{ system: master.systems.pharmBusinessStatus, code, display }], text: display };
}

/** オーダー番号：`P-{yyyyMMdd（日本時間）}-{4 桁}`。 */
export function nextPrescriptionOrderNumber(now: Date, existingCount: number): string {
  const ymd = new Intl.DateTimeFormat("en-CA", { timeZone: "Asia/Tokyo", year: "numeric", month: "2-digit", day: "2-digit" })
    .format(now)
    .replaceAll("-", "");
  return `P-${ymd}-${String(existingCount + 1).padStart(4, "0")}`;
}

function post(fullUrl: string, resource: BundleEntry["resource"] & { resourceType: string }): BundleEntry {
  return { fullUrl, resource, request: { method: "POST", url: resource.resourceType } };
}

function put(resource: BundleEntry["resource"] & { resourceType: string; id?: string }, ifMatch: string | null): BundleEntry {
  return { resource, request: { method: "PUT", url: `${resource.resourceType}/${resource.id}`, ...(ifMatch ? { ifMatch } : {}) } };
}

function rpIdentifiers(): Identifier[] {
  return [
    { system: master.systems.rpNumber, value: "1" },
    { system: master.systems.orderInRp, value: "1" },
  ];
}

// ---- 医師：処方 ----

export interface PrescriptionParams {
  doctor: PrescriberId;
  patientId: string;
  /** 入院中の患者の入院（Encounter）の id。外来は null（D-44）。 */
  encounterId: string | null;
  medicationKey: string;
  /** 1 回量（錠）。 */
  doseValue: number;
  days: number;
  orderNumber: string;
  now: Date;
}

/** MedicationRequest + Task を 1 つの Transaction で作る（FR-006）。区分は入院の有無で決まる。 */
export function buildPrescriptionTransaction({ doctor, patientId, encounterId, medicationKey, doseValue, days, orderNumber, now }: PrescriptionParams): Bundle {
  const med = medication(medicationKey);
  const patient = { reference: `Patient/${patientId}` };
  const requester = { reference: `Practitioner/${doctor}` };
  const encounter = encounterId ? { reference: `Encounter/${encounterId}` } : undefined;
  const mrUrl = "urn:uuid:medication-request";
  const unit = med.doseUnit;
  const dose: Quantity = { value: doseValue, unit: unit.display, system: unit.system, code: unit.code };
  const quantity: Quantity = { value: doseValue * med.timesPerDay * days, unit: unit.display, system: unit.system, code: unit.code };

  const dosage: Dosage = {
    extension: [
      {
        url: "http://jpfhir.jp/fhir/core/Extension/StructureDefinition/JP_MedicationDosage_UsageDuration",
        valueDuration: { value: days, ...DAYS_UNIT },
      },
    ],
    text: med.usageText,
    timing: { code: { coding: [med.usage] } },
    route: { coding: [coding("routeOral")] },
    method: { coding: [coding("methodOral")] },
    doseAndRate: [{ type: { coding: [coding("strengthProduct")] }, doseQuantity: dose }],
  };

  const medicationRequest: MedicationRequest = {
    resourceType: "MedicationRequest",
    meta: { profile: [master.profiles.MedicationRequest] },
    identifier: [...rpIdentifiers(), { system: master.systems.orderNumber, value: orderNumber }],
    status: "active",
    intent: "order",
    category: (encounterId ? (["categoryInpatient", "categoryTemporary"] as const) : (["categoryOutpatient", "categoryInHospital"] as const)).map(
      (k) => ({ coding: [coding(k)] }),
    ),
    medicationCodeableConcept: { coding: [med.coding] },
    subject: patient,
    ...(encounter ? { encounter } : {}),
    authoredOn: iso(now),
    requester,
    dosageInstruction: [dosage],
    dispenseRequest: { quantity, expectedSupplyDuration: { value: days, ...DAYS_UNIT } },
  };
  const task: Task = {
    resourceType: "Task",
    status: "requested",
    intent: "order",
    code: { coding: [{ system: "http://hl7.org/fhir/CodeSystem/task-code", code: "fulfill", display: "Fulfill the focal request" }] },
    focus: { reference: mrUrl },
    for: patient,
    ...(encounter ? { encounter } : {}),
    requester,
    owner: { reference: PHARMACY_DEPT },
    authoredOn: iso(now),
    lastModified: iso(now),
  };
  return { resourceType: "Bundle", type: "transaction", entry: [post(mrUrl, medicationRequest), post("urn:uuid:task", task)] };
}

// ---- 薬剤師：受付・調剤開始、監査開始（Task の PATCH） ----

/** 受付と調剤開始：status = in-progress、業務上の状態 = 調剤中、owner = 調剤する薬剤師を 1 回で更新する。 */
export function buildAcceptPatch(pharmacist: PharmacistId, now: Date): JsonPatchOp[] {
  return [
    { op: "replace", path: "/status", value: "in-progress" },
    { op: "add", path: "/businessStatus", value: pharmBusinessStatus("dispensing") },
    { op: "replace", path: "/owner", value: { reference: `PractitionerRole/${pharmacist}` } },
    { op: "add", path: "/lastModified", value: iso(now) },
  ];
}

/** 監査開始：業務上の状態 = 監査中、owner = 監査する薬剤師（status は in-progress のまま）。 */
export function buildAuditPatch(pharmacist: PharmacistId, now: Date): JsonPatchOp[] {
  return [
    { op: "add", path: "/businessStatus", value: pharmBusinessStatus("auditing") },
    { op: "replace", path: "/owner", value: { reference: `PractitionerRole/${pharmacist}` } },
    { op: "add", path: "/lastModified", value: iso(now) },
  ];
}

// ---- 薬剤師：お渡し（外来）・払出（入院） ----

export interface DispenseParams {
  mr: MedicationRequest;
  task: Task;
  taskEtag: string | null;
  /** 調剤した薬剤師（Task の版の履歴から読み取る。D-51）。 */
  packager: PharmacistId;
  /** 監査した薬剤師（操作する薬剤師）。 */
  checker: PharmacistId;
  now: Date;
}

function performer(code: "performerPackager" | "performerChecker", pharmacist: PharmacistId) {
  return { function: { coding: [coding(code)] }, actor: { reference: `PractitionerRole/${pharmacist}` } };
}

function buildDispense(p: DispenseParams, destination: "patient" | "ward"): { md: MedicationDispense; task: Task } {
  const { mr, task } = p;
  const md: MedicationDispense = {
    resourceType: "MedicationDispense",
    meta: { profile: [master.profiles.MedicationDispense] },
    identifier: rpIdentifiers(),
    status: "completed",
    medicationCodeableConcept: mr.medicationCodeableConcept!,
    subject: mr.subject,
    ...(destination === "ward" && mr.encounter ? { context: mr.encounter } : {}),
    performer: [performer("performerPackager", p.packager), performer("performerChecker", p.checker)],
    authorizingPrescription: [{ reference: `MedicationRequest/${mr.id}` }],
    ...(mr.dispenseRequest?.quantity ? { quantity: mr.dispenseRequest.quantity } : {}),
    ...(mr.dispenseRequest?.expectedSupplyDuration ? { daysSupply: mr.dispenseRequest.expectedSupplyDuration } : {}),
    whenHandedOver: iso(p.now),
    ...(destination === "patient" ? { receiver: [mr.subject] } : { destination: { reference: WARD_LOCATION } }),
    ...(mr.dosageInstruction ? { dosageInstruction: mr.dosageInstruction } : {}),
  };
  const { businessStatus: _dropped, ...rest } = task;
  const completed: Task = {
    ...rest,
    status: "completed",
    owner: { reference: `PractitionerRole/${p.checker}` },
    output: [{ type: { text: "調剤の記録" }, valueReference: { reference: MD_URL } }],
    lastModified: iso(p.now),
  };
  return { md, task: completed };
}

const MD_URL = "urn:uuid:medication-dispense";

/**
 * 外来のお渡し：MedicationDispense（POST）+ Task（PUT、ifMatch、completed、output）+ MedicationRequest（PUT、ifMatch、completed）。
 * 作業・処方のどちらかが先に更新されていれば Transaction 全体が 412 になる（調剤の記録も作られない）。
 */
export function buildHandOverTransaction(p: DispenseParams & { mrEtag: string | null }): Bundle {
  const { md, task } = buildDispense(p, "patient");
  const mr: MedicationRequest = { ...p.mr, status: "completed" };
  return { resourceType: "Bundle", type: "transaction", entry: [post(MD_URL, md), put(task, p.taskEtag), put(mr, p.mrEtag)] };
}

/** 入院の払出：MedicationDispense（POST）+ Task（PUT、ifMatch、completed、output）。処方は更新しない（active のまま。D-43）。 */
export function buildWardDispenseTransaction(p: DispenseParams): Bundle {
  const { md, task } = buildDispense(p, "ward");
  return { resourceType: "Bundle", type: "transaction", entry: [post(MD_URL, md), put(task, p.taskEtag)] };
}
