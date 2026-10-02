// 画面の操作とシナリオの自動実行が共有する、検体検査の操作（FHIR への要求の送信）。
import type { DiagnosticReport, Observation, ServiceRequest, Specimen, Task } from "fhir/r4";
import type { FhirClient, Versioned } from "./client";
import {
  allItemKeys,
  buildAcceptPatch,
  buildCancelTransaction,
  buildCollectionTransaction,
  buildFinalReportTransaction,
  buildOrderTransaction,
  buildPartialReportTransaction,
  buildRejectPatch,
  buildRerunPatch,
  buildStartPatch,
  LAB_CATEGORY_CODE,
  labItem,
  nextOrderNumber,
  ORDERING_DOCTOR,
} from "./builders/labOrder";

export interface CurrentOrder {
  sr: Versioned<ServiceRequest>;
  task: Versioned<Task>;
}

const refOf = (reference?: string) => reference?.split("/")[1] ?? "";

/** 医師 X が出した最新の依頼と、その作業。無ければ null。 */
export async function fetchLatestOrder(client: FhirClient): Promise<CurrentOrder | null> {
  const srs = await client.search<ServiceRequest>("ServiceRequest", { requester: ORDERING_DOCTOR, category: LAB_CATEGORY_CODE });
  const sr = srs[0];
  if (!sr) return null;
  const tasks = await client.search<Task>("Task", { focus: `ServiceRequest/${sr.resource.id}` });
  return tasks[0] ? { sr, task: tasks[0] } : null;
}

export async function placeOrder(client: FhirClient, patientId: string, sets: string[], now = new Date()): Promise<void> {
  const existing = await client.search<ServiceRequest>("ServiceRequest", { requester: ORDERING_DOCTOR, category: LAB_CATEGORY_CODE });
  await client.transaction(
    buildOrderTransaction({ patientId, sets, orderNumber: nextOrderNumber(now, existing.length), now }),
    "検査の依頼",
  );
}

export async function recordCollection(client: FhirClient, order: CurrentOrder, now = new Date()): Promise<void> {
  const specimen = await client.read<Specimen>("Specimen", refOf(order.sr.resource.specimen?.[0]?.reference));
  await client.transaction(
    buildCollectionTransaction({
      specimen: specimen.resource,
      specimenEtag: specimen.etag,
      task: order.task.resource,
      taskEtag: order.task.etag,
      now,
    }),
    "採血の記録",
  );
}

/** 受付を始める：作業を取得し、その版（ETag）を確定まで保持できるようにして返す（D-27）。 */
export async function beginAccept(client: FhirClient, taskId: string): Promise<Versioned<Task>> {
  return client.read<Task>("Task", taskId);
}

/**
 * 受付を確定する。受付を始めた時点の版（draft の ETag）で If-Match を付ける。
 * sendIfMatch が false のときは付けない（版の確認をしない作りの検体検査システムを模す、デモ専用）。
 */
export async function confirmAccept(
  client: FhirClient,
  draft: Versioned<Task>,
  techRoleId: string,
  sendIfMatch: boolean,
  now = new Date(),
): Promise<void> {
  await client.patch("Task", draft.resource.id!, buildAcceptPatch(techRoleId, now), sendIfMatch ? draft.etag : null, "受付");
}

/** 受付を始めて、すぐ確定する（シナリオの自動実行用。画面と同じ GET → PATCH を送る）。 */
export async function acceptTask(client: FhirClient, order: CurrentOrder, techRoleId: string, now = new Date()): Promise<void> {
  const draft = await beginAccept(client, order.task.resource.id!);
  await confirmAccept(client, draft, techRoleId, true, now);
}

export async function startTask(client: FhirClient, order: CurrentOrder, now = new Date()): Promise<void> {
  await client.patch("Task", order.task.resource.id!, buildStartPatch(now), order.task.etag, "測定開始");
}

/**
 * 結果の承認・報告。先行報告済みの項目は除き、残りを報告する（全項目が揃うので依頼まで完了にする）。
 * values を省略した項目は FHIR マスタの既定値。
 */
export async function submitFinalReport(
  client: FhirClient,
  order: CurrentOrder,
  techRoleId: string,
  values?: Record<string, number>,
  now = new Date(),
): Promise<void> {
  const srId = order.sr.resource.id!;
  const [specimen, reports, observations] = await Promise.all([
    client.read<Specimen>("Specimen", refOf(order.sr.resource.specimen?.[0]?.reference)),
    client.search<DiagnosticReport>("DiagnosticReport", { "based-on": `ServiceRequest/${srId}` }),
    client.search<Observation>("Observation", { "based-on": `ServiceRequest/${srId}` }),
  ]);
  const keys = allItemKeys(order.sr.resource);
  const reported = new Set(observations.map((o) => o.resource.code?.coding?.[0]?.code));
  await client.transaction(
    buildFinalReportTransaction({
      serviceRequest: order.sr.resource,
      serviceRequestEtag: order.sr.etag,
      task: order.task.resource,
      taskEtag: order.task.etag,
      specimen: specimen.resource,
      techRoleId,
      now,
      values,
      itemKeys: keys.filter((k) => !reported.has(labItem(k).coding.code)),
      existingReport: reports[0]?.resource,
      existingReportEtag: reports[0]?.etag,
    }),
    "結果の報告",
  );
}

/** 医師による取消（結果報告前）。 */
export async function cancelOrder(client: FhirClient, order: CurrentOrder, now = new Date()): Promise<void> {
  await client.transaction(
    buildCancelTransaction({
      serviceRequest: order.sr.resource,
      serviceRequestEtag: order.sr.etag,
      task: order.task.resource,
      taskEtag: order.task.etag,
      now,
    }),
    "依頼の取消",
  );
}

/** 技師による受付不可（検体不備など。理由が必須）。 */
export async function rejectTask(client: FhirClient, order: CurrentOrder, reason: string, now = new Date()): Promise<void> {
  await client.patch("Task", order.task.resource.id!, buildRejectPatch(reason, now), order.task.etag, "受付不可");
}

/** 再検：測定中の作業を保留・再検中にする。再開は {@link startTask}。 */
export async function rerunTask(client: FhirClient, order: CurrentOrder, now = new Date()): Promise<void> {
  await client.patch("Task", order.task.resource.id!, buildRerunPatch(now), order.task.etag, "再検");
}

/** 既に報告済みの項目のキー。 */
export async function reportedItemKeys(client: FhirClient, order: CurrentOrder): Promise<string[]> {
  const observations = await client.search<Observation>("Observation", { "based-on": `ServiceRequest/${order.sr.resource.id}` });
  const reported = new Set(observations.map((o) => o.resource.code?.coding?.[0]?.code));
  return allItemKeys(order.sr.resource).filter((k) => reported.has(labItem(k).coding.code));
}

/** 選んだ項目だけを先に報告する（DiagnosticReport は一部報告。作業の状態と依頼は変えない）。 */
export async function submitPartialReport(
  client: FhirClient,
  order: CurrentOrder,
  techRoleId: string,
  itemKeys: string[],
  values?: Record<string, number>,
  now = new Date(),
): Promise<void> {
  const srId = order.sr.resource.id!;
  const [specimen, reports, reportedKeys] = await Promise.all([
    client.read<Specimen>("Specimen", refOf(order.sr.resource.specimen?.[0]?.reference)),
    client.search<DiagnosticReport>("DiagnosticReport", { "based-on": `ServiceRequest/${srId}` }),
    reportedItemKeys(client, order),
  ]);
  await client.transaction(
    buildPartialReportTransaction({
      serviceRequest: order.sr.resource,
      serviceRequestEtag: order.sr.etag,
      task: order.task.resource,
      taskEtag: order.task.etag,
      specimen: specimen.resource,
      techRoleId,
      now,
      values,
      itemKeys,
      reportedKeys,
      existingReport: reports[0]?.resource,
      existingReportEtag: reports[0]?.etag,
    }),
    "一部の結果の報告",
  );
}
