// 検体検査の各操作が送る FHIR リソース・要求の組み立て（data-model.md §2・§4）。
// 検査項目・コードは FHIR マスタ（src/master/fhir-master.json）から読む。サーバーの統合テスト（LabFlow）と同じ内容になるようにする。
import type {
  Bundle,
  BundleEntry,
  CodeableConcept,
  Coding,
  DiagnosticReport,
  Observation,
  ServiceRequest,
  Specimen,
  Task,
} from "fhir/r4";
import master from "../../master/fhir-master.json";
import type { JsonPatchOp } from "../client";

type Master = typeof master;
export type LabItem = Master["labItems"][number];
export type Interpretation = "H" | "L" | "N";

export const ORDERING_DOCTOR = "Practitioner/dr-x";
export const NURSE = "Practitioner/ns-d";
export const LAB_DEPT = "Organization/lab-dept";

const iso = (d: Date) => d.toISOString();

function coding(key: keyof Master["codings"]): Coding {
  const c = master.codings[key];
  return { system: c.system, code: c.code, display: c.display };
}

function concept(key: keyof Master["codings"], text?: string): CodeableConcept {
  return { coding: [coding(key)], ...(text ? { text } : {}) };
}

export function businessStatus(code: string): CodeableConcept {
  const display = master.businessStatuses.find((b) => b.code === code)?.display ?? code;
  return { coding: [{ system: master.systems.businessStatus, code, display }], text: display };
}

export function labItem(key: string): LabItem {
  const item = master.labItems.find((i) => i.key === key);
  if (!item) throw new Error(`未知の検査項目: ${key}`);
  return item;
}

export function labSet(code: string) {
  const set = master.labSets.find((s) => s.code === code);
  if (!set) throw new Error(`未知の検査セット: ${code}`);
  return set;
}

export const LAB_SETS = master.labSets;

/** 依頼された検査セットに含まれる全項目のキー（セットの並び順）。 */
export function allItemKeys(serviceRequest: ServiceRequest): string[] {
  return (serviceRequest.orderDetail ?? []).flatMap((d) => labSet(d.coding?.[0].code ?? "").items);
}

export function judgeInterpretation(value: number, low: number, high: number): Interpretation {
  if (value > high) return "H";
  if (value < low) return "L";
  return "N";
}

export function nextOrderNumber(now: Date, existingCount: number): string {
  const ymd = `${now.getFullYear()}${String(now.getMonth() + 1).padStart(2, "0")}${String(now.getDate()).padStart(2, "0")}`;
  return `L-${ymd}-${String(existingCount + 1).padStart(4, "0")}`;
}

function post(fullUrl: string, resource: BundleEntry["resource"] & { resourceType: string }): BundleEntry {
  return { fullUrl, resource, request: { method: "POST", url: resource.resourceType } };
}

function put(resource: BundleEntry["resource"] & { resourceType: string; id?: string }, ifMatch: string | null): BundleEntry {
  return {
    resource,
    request: { method: "PUT", url: `${resource.resourceType}/${resource.id}`, ...(ifMatch ? { ifMatch } : {}) },
  };
}

function transaction(entry: BundleEntry[]): Bundle {
  return { resourceType: "Bundle", type: "transaction", entry };
}

// ---- 医師：依頼 ----

export interface OrderParams {
  patientId: string;
  sets: string[];
  orderNumber: string;
  now: Date;
}

/** ServiceRequest + Task + Specimen を 1 つの Transaction で作る（FR-006）。 */
export function buildOrderTransaction({ patientId, sets, orderNumber, now }: OrderParams): Bundle {
  if (sets.length === 0) throw new Error("検査セットを 1 つ以上選んでください");
  const patient = { reference: `Patient/${patientId}` };
  const srUrl = "urn:uuid:service-request";
  const taskUrl = "urn:uuid:task";
  const specimenUrl = "urn:uuid:specimen";

  const serviceRequest: ServiceRequest = {
    resourceType: "ServiceRequest",
    meta: { profile: [master.profiles.ServiceRequest] },
    identifier: [{ system: master.systems.orderNumber, value: orderNumber }],
    status: "active",
    intent: "order",
    category: [concept("serviceRequestCategory", "検体検査")],
    code: concept("serviceRequestCode", "検体検査"),
    orderDetail: sets.map((code) => {
      const s = labSet(code);
      return { coding: [{ system: master.systems.labSet, code, display: s.display }], text: s.display };
    }),
    subject: patient,
    requester: { reference: ORDERING_DOCTOR },
    performer: [{ reference: LAB_DEPT }],
    authoredOn: iso(now),
    specimen: [{ reference: specimenUrl }],
  };
  const task: Task = {
    resourceType: "Task",
    status: "requested",
    intent: "order",
    code: concept("taskCode"),
    focus: { reference: srUrl },
    for: patient,
    requester: { reference: ORDERING_DOCTOR },
    owner: { reference: LAB_DEPT },
    businessStatus: businessStatus("not-collected"),
    authoredOn: iso(now),
    lastModified: iso(now),
  };
  const specimen: Specimen = {
    resourceType: "Specimen",
    meta: { profile: [master.profiles.Specimen] },
    type: concept("specimenType", "血液"),
    subject: patient,
    request: [{ reference: srUrl }],
  };
  return transaction([post(srUrl, serviceRequest), post(taskUrl, task), post(specimenUrl, specimen)]);
}

// ---- 看護師：採血の記録 ----

export interface CollectionParams {
  specimen: Specimen;
  specimenEtag: string | null;
  task: Task;
  taskEtag: string | null;
  now: Date;
}

/** Specimen（採取者・採取日時）と Task（businessStatus = 採取済）を一括で更新する。Task.status は変えない（FR-011）。 */
export function buildCollectionTransaction({ specimen, specimenEtag, task, taskEtag, now }: CollectionParams): Bundle {
  const nextSpecimen: Specimen = {
    ...specimen,
    status: "available",
    collection: { ...specimen.collection, collector: { reference: NURSE }, collectedDateTime: iso(now) },
  };
  const nextTask: Task = { ...task, businessStatus: businessStatus("collected"), lastModified: iso(now) };
  return transaction([put(nextSpecimen, specimenEtag), put(nextTask, taskEtag)]);
}

// ---- 技師：受付・測定開始 ----

/** 受付：status・businessStatus・owner を 1 回の PATCH で更新する（FR-013）。 */
export function buildAcceptPatch(techRoleId: string, now: Date): JsonPatchOp[] {
  return [
    { op: "replace", path: "/status", value: "accepted" },
    { op: "add", path: "/businessStatus", value: businessStatus("received") },
    { op: "add", path: "/owner", value: { reference: `PractitionerRole/${techRoleId}` } },
    { op: "add", path: "/lastModified", value: iso(now) },
  ];
}

/** 測定開始（FR-014）。 */
export function buildStartPatch(now: Date): JsonPatchOp[] {
  return [
    { op: "replace", path: "/status", value: "in-progress" },
    { op: "add", path: "/businessStatus", value: businessStatus("measuring") },
    { op: "add", path: "/lastModified", value: iso(now) },
  ];
}

// ---- 技師：結果の報告 ----

export interface FinalReportParams {
  serviceRequest: ServiceRequest;
  serviceRequestEtag: string | null;
  task: Task;
  taskEtag: string | null;
  specimen: Specimen;
  techRoleId: string;
  now: Date;
  /** 項目キー → 結果値。省略した項目は FHIR マスタの既定値。 */
  values?: Record<string, number>;
  /** 今回報告する項目。省略すると依頼された全項目。 */
  itemKeys?: string[];
  /** 先行報告（partial）が既にある場合、その DiagnosticReport と ETag。 */
  existingReport?: DiagnosticReport;
  existingReportEtag?: string | null;
}

function buildObservation(item: LabItem, value: number, p: FinalReportParams): Observation {
  const interpretation = judgeInterpretation(value, item.low, item.high);
  const key = ({ H: "interpretationHigh", L: "interpretationLow", N: "interpretationNormal" } as const)[interpretation];
  return {
    resourceType: "Observation",
    meta: { profile: [master.profiles.Observation] },
    status: "final",
    category: [concept("observationCategory")],
    code: { coding: [{ ...item.coding, display: item.display }], text: item.display },
    subject: p.serviceRequest.subject,
    basedOn: [{ reference: `ServiceRequest/${p.serviceRequest.id}` }],
    specimen: { reference: `Specimen/${p.specimen.id}` },
    effectiveDateTime: p.specimen.collection?.collectedDateTime ?? iso(p.now),
    issued: iso(p.now),
    performer: [{ reference: `PractitionerRole/${p.techRoleId}` }],
    valueQuantity: { value, unit: item.unitDisplay, system: master.systems.ucum, code: item.unit },
    referenceRange: [{ low: { value: item.low }, high: { value: item.high } }],
    interpretation: [concept(key)],
  };
}

function reportEntries(p: FinalReportParams, status: "partial" | "final"): { entries: BundleEntry[]; reportRef: string } {
  const keys = p.itemKeys ?? allItemKeys(p.serviceRequest);
  const entries: BundleEntry[] = [];
  const results = [...(p.existingReport?.result ?? [])];
  keys.forEach((key, i) => {
    const item = labItem(key);
    const url = `urn:uuid:observation-${i}`;
    entries.push(post(url, buildObservation(item, p.values?.[key] ?? item.defaultValue, p)));
    results.push({ reference: url });
  });
  const report: DiagnosticReport = {
    ...(p.existingReport ?? {}),
    resourceType: "DiagnosticReport",
    meta: { profile: [master.profiles.DiagnosticReport] },
    status,
    category: [concept("diagnosticReportCategory")],
    code: concept("diagnosticReportCode", "検体検査報告書"),
    subject: p.serviceRequest.subject,
    basedOn: [{ reference: `ServiceRequest/${p.serviceRequest.id}` }],
    specimen: [{ reference: `Specimen/${p.specimen.id}` }],
    issued: iso(p.now),
    performer: [{ reference: LAB_DEPT }],
    result: results,
  };
  if (p.existingReport?.id) {
    entries.push(put(report, p.existingReportEtag ?? null));
    return { entries, reportRef: `DiagnosticReport/${p.existingReport.id}` };
  }
  entries.push(post("urn:uuid:diagnostic-report", report));
  return { entries, reportRef: "urn:uuid:diagnostic-report" };
}

/**
 * 全項目の結果報告：Observation × n、DiagnosticReport（final）、Task（completed、output）、ServiceRequest（completed）を
 * 1 つの Transaction で登録・更新する（FR-015、D-13）。先行報告があればその DiagnosticReport を final に更新する。
 */
export function buildFinalReportTransaction(p: FinalReportParams): Bundle {
  const { entries, reportRef } = reportEntries(p, "final");
  const task: Task = {
    ...p.task,
    status: "completed",
    businessStatus: businessStatus("reported"),
    lastModified: iso(p.now),
    output: [{ type: { text: "DiagnosticReport" }, valueReference: { reference: reportRef } }],
  };
  const serviceRequest: ServiceRequest = { ...p.serviceRequest, status: "completed" };
  return transaction([...entries, put(task, p.taskEtag), put(serviceRequest, p.serviceRequestEtag)]);
}
