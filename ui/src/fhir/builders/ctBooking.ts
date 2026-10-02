// CT 予約の各操作が送る FHIR リソース・要求の組み立て（specs/003 data-model.md §2、contracts/fhir-api.md）。
// 検査内容・コードは FHIR マスタ（src/master/fhir-master.json）から読む。サーバーの統合テスト（SlotFlow）と同じ内容になるようにする。
import type { Appointment, Bundle, BundleEntry, CodeableConcept, Coding, ServiceRequest, Slot, Task } from "fhir/r4";
import master from "../../master/fhir-master.json";
import { holdComment } from "../labels";

export type CtDoctorId = "dr-x" | "dr-y";

export const CT_DOCTORS: Record<CtDoctorId, { name: string; letter: "X" | "Y"; clientId: "ehr-doctor" | "ehr-doctor-y"; defaultPatientId: string }> = {
  "dr-x": { name: "医師 X", letter: "X", clientId: "ehr-doctor", defaultPatientId: "demo-taro" },
  "dr-y": { name: "医師 Y", letter: "Y", clientId: "ehr-doctor-y", defaultPatientId: "demo-hanako" },
};

export const CT_PROCEDURES = master.radiologyProcedures;
export const DEFAULT_CT_PROCEDURE = "CT-CHEST";
export const CT_SCHEDULE = "Schedule/ct-1";
export const CT_DEVICE = "Device/ct-1";
export const RAD_DEPT = "Organization/rad-dept";
/** ServiceRequest.category（画像検査）のコード。電子カルテの依頼一覧の検索に使う。 */
export const IMAGING_CATEGORY_CODE = master.codings.imagingCategory.code;

const iso = (d: Date) => d.toISOString();

function coding(key: keyof typeof master.codings): Coding {
  const c = master.codings[key];
  return { system: c.system, code: c.code, display: c.display };
}

export function procedure(code: string): { code: string; display: string } {
  const p = master.radiologyProcedures.find((x) => x.code === code);
  if (!p) throw new Error(`未知の検査内容: ${code}`);
  return p;
}

function procedureCoding(code: string): Coding {
  const p = procedure(code);
  return { system: master.systems.radiologyProcedure, code: p.code, display: p.display };
}

/** 仮押さえする Slot（`busy-tentative`、押さえた人を comment に表示用として記載）。元の Slot は変えない。 */
export function buildHoldSlot(slot: Slot, doctorName: string): Slot {
  return { ...slot, status: "busy-tentative", comment: holdComment(doctorName) };
}

/** 空きに戻す Slot（取りやめ）。comment を消す。 */
export function buildReleaseSlot(slot: Slot): Slot {
  const { comment: _comment, ...rest } = slot;
  return { ...rest, status: "free" };
}

/** オーダー番号：`R-{yyyyMMdd（日本時間）}-{X|Y}{3 桁}`。医師ごとに連番。 */
export function nextCtOrderNumber(now: Date, doctor: CtDoctorId, existingCount: number): string {
  const ymd = new Intl.DateTimeFormat("en-CA", { timeZone: "Asia/Tokyo", year: "numeric", month: "2-digit", day: "2-digit" })
    .format(now)
    .replaceAll("-", "");
  return `R-${ymd}-${CT_DOCTORS[doctor].letter}${String(existingCount + 1).padStart(3, "0")}`;
}

export interface BookingParams {
  /** 予約する枠（確定時点の内容。仮押さえを使う方式では仮押さえ中の枠）。 */
  slot: Slot;
  /** 仮押さえの応答の ETag。null なら直接予約する（Slot の更新を含めない。D-40）。 */
  heldEtag: string | null;
  patientId: string;
  procedureCode: string;
  doctor: CtDoctorId;
  orderNumber: string;
  now: Date;
}

/**
 * 予約の確定（仮押さえを使う方式）または直接予約の Transaction。
 * Slot の PUT（busy、ifMatch）+ Appointment + ServiceRequest + Task。予約の登録に ifNoneExist は付けない（D-40）。
 */
export function buildBookingTransaction({ slot, heldEtag, patientId, procedureCode, doctor, orderNumber, now }: BookingParams): Bundle {
  const slotRef = `Slot/${slot.id}`;
  const patient = { reference: `Patient/${patientId}` };
  const requester = { reference: `Practitioner/${doctor}` };
  const appointmentUrl = "urn:uuid:appointment";
  const srUrl = "urn:uuid:service-request";
  const taskUrl = "urn:uuid:task";
  const entries: BundleEntry[] = [];

  if (heldEtag !== null) {
    const { comment: _comment, ...rest } = slot;
    const busy: Slot = { ...rest, status: "busy" };
    entries.push({ resource: busy, request: { method: "PUT", url: slotRef, ifMatch: heldEtag } });
  }

  const appointment: Appointment = {
    resourceType: "Appointment",
    status: "booked",
    serviceType: [{ coding: [procedureCoding(procedureCode)], text: procedure(procedureCode).display }],
    start: slot.start,
    end: slot.end,
    slot: [{ reference: slotRef }],
    basedOn: [{ reference: srUrl }],
    created: iso(now),
    participant: [
      { actor: patient, status: "accepted" },
      { actor: requester, status: "accepted" },
      { actor: { reference: CT_DEVICE }, status: "accepted" },
    ],
  };
  const serviceRequest: ServiceRequest = {
    resourceType: "ServiceRequest",
    meta: { profile: [master.profiles.ServiceRequest] },
    identifier: [{ system: master.systems.orderNumber, value: orderNumber }],
    status: "active",
    intent: "order",
    category: [{ coding: [coding("imagingCategory")], text: "画像検査" } satisfies CodeableConcept],
    code: { coding: [procedureCoding(procedureCode)], text: procedure(procedureCode).display },
    orderDetail: [{ coding: [coding("modalityCT")] }],
    subject: patient,
    requester,
    performer: [{ reference: RAD_DEPT }],
    occurrencePeriod: { start: slot.start, end: slot.end },
    authoredOn: iso(now),
  };
  const bookedDisplay = master.radBusinessStatuses.find((b) => b.code === "booked")!.display;
  const task: Task = {
    resourceType: "Task",
    status: "requested",
    intent: "order",
    code: { coding: [coding("taskCode")] },
    focus: { reference: srUrl },
    for: patient,
    requester,
    owner: { reference: RAD_DEPT },
    businessStatus: { coding: [{ system: master.systems.radBusinessStatus, code: "booked", display: bookedDisplay }], text: bookedDisplay },
    authoredOn: iso(now),
    lastModified: iso(now),
  };
  entries.push(
    { fullUrl: appointmentUrl, resource: appointment, request: { method: "POST", url: "Appointment" } },
    { fullUrl: srUrl, resource: serviceRequest, request: { method: "POST", url: "ServiceRequest" } },
    { fullUrl: taskUrl, resource: task, request: { method: "POST", url: "Task" } },
  );
  return { resourceType: "Bundle", type: "transaction", entry: entries };
}
