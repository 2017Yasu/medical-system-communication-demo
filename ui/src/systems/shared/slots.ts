// CT の枠・予約・依頼・作業の結合と、二重予約の判定（電子カルテの CT 予約と放射線部門システムが共有。specs/003 research R-07）。
import type { Appointment, Patient, ServiceRequest, Slot, Task } from "fhir/r4";
import type { FhirClient, Versioned } from "../../fhir/client";
import { CT_DOCTORS, CT_SCHEDULE, IMAGING_CATEGORY_CODE, RAD_DEPT, type CtDoctorId } from "../../fhir/builders/ctBooking";
import { formatStatus, holderName } from "../../fhir/labels";
import { loadPatients, patientName } from "./orders";
import type { RowChange } from "./rowChanges";

/** 枠に入っている予約（Appointment）1 件と、それに結び付く依頼・作業。 */
export interface BookingRow {
  appointment: Versioned<Appointment>;
  patientName: string;
  sr: Versioned<ServiceRequest> | null;
  task: Versioned<Task> | null;
  /** 依頼した医師（「医師 X」）。初期データの予約（依頼なし）は null。 */
  doctor: string | null;
  procedure: string | null;
  orderNumber: string | null;
  /** 初期データの予約（ServiceRequest・Task が無い）。 */
  seed: boolean;
}

export interface SlotRow {
  slot: Versioned<Slot>;
  /** 有効（booked）な予約。 */
  bookings: BookingRow[];
  /** 同じ枠に有効な予約が 2 件以上ある（S3-1 の二重予約）。表示の強調であり、サーバーの判定ではない。 */
  doubleBooked: boolean;
  /** 有効な予約があるのに枠が `free` のまま（枠を確認せずに予約した）。 */
  bookedButFree: boolean;
  /** 仮押さえ中の押さえた人（Slot.comment から。表示用）。 */
  holder: string | null;
}

const refId = (reference?: string) => reference?.split("/")[1] ?? "";

function doctorLabel(requester?: string): string | null {
  const id = refId(requester) as CtDoctorId;
  return CT_DOCTORS[id]?.name ?? null;
}

/** 枠を開始時刻の昇順に並べ、枠ごとの有効な予約と、予約に結び付く依頼・作業・患者をまとめる。 */
export function joinSlots(
  slots: Versioned<Slot>[],
  appointments: Versioned<Appointment>[],
  serviceRequests: Versioned<ServiceRequest>[],
  tasks: Versioned<Task>[],
  patients: Versioned<Patient>[],
): SlotRow[] {
  const patientById = new Map(patients.map((p) => [p.resource.id ?? "", p.resource]));
  const srById = new Map(serviceRequests.map((s) => [s.resource.id ?? "", s]));
  const taskByFocus = new Map(tasks.map((t) => [refId(t.resource.focus?.reference), t]));

  const bySlot = new Map<string, BookingRow[]>();
  for (const a of appointments) {
    if (a.resource.status !== "booked") continue;
    const actorPatient = a.resource.participant?.map((p) => p.actor?.reference ?? "").find((r) => r.startsWith("Patient/"));
    const srId = refId(a.resource.basedOn?.find((b) => b.reference?.startsWith("ServiceRequest/"))?.reference);
    const sr = srById.get(srId) ?? null;
    const row: BookingRow = {
      appointment: a,
      patientName: patientName(patientById.get(refId(actorPatient))),
      sr,
      task: sr ? (taskByFocus.get(srId) ?? null) : null,
      doctor: sr ? doctorLabel(sr.resource.requester?.reference) : null,
      procedure: sr ? (sr.resource.code?.coding?.[0]?.display ?? sr.resource.code?.text ?? null) : null,
      orderNumber: sr?.resource.identifier?.[0]?.value ?? null,
      seed: !sr,
    };
    for (const slotRef of a.resource.slot ?? []) {
      const id = refId(slotRef.reference);
      bySlot.set(id, [...(bySlot.get(id) ?? []), row]);
    }
  }

  return [...slots]
    .sort((a, b) => (a.resource.start ?? "").localeCompare(b.resource.start ?? ""))
    .map((slot) => {
      const bookings = bySlot.get(slot.resource.id ?? "") ?? [];
      return {
        slot,
        bookings,
        doubleBooked: bookings.length >= 2,
        bookedButFree: bookings.length > 0 && slot.resource.status === "free",
        holder: slot.resource.status === "busy-tentative" ? holderName(slot.resource.comment) : null,
      };
    });
}

function valuesOf(row: SlotRow) {
  return {
    status: formatStatus("slot", row.slot.resource.status),
    holder: row.holder ?? "—",
    bookings: row.bookings.length === 0 ? "予約なし" : row.bookings.map((b) => b.patientName).join("・"),
  };
}

const FIELDS = ["status", "holder", "bookings"] as const;

/** 直前の表示と取り直した結果を枠の id で突き合わせる。prev が無いとき（初回・初期化の直後）は比べない。 */
export function diffSlotRows(prev: SlotRow[] | null, next: SlotRow[]): RowChange[] {
  if (!prev) return [];
  const before = new Map(prev.map((r) => [r.slot.resource.id ?? "", r]));
  const changes: RowChange[] = [];
  for (const row of next) {
    const old = before.get(row.slot.resource.id ?? "");
    if (!old) continue;
    const a = valuesOf(old);
    const b = valuesOf(row);
    const fields = FIELDS.filter((f) => a[f] !== b[f]).map((field) => ({ field, before: a[field], after: b[field] }));
    if (fields.length > 0) changes.push({ srId: row.slot.resource.id ?? "", fields });
  }
  return changes;
}

export interface SlotData {
  rows: SlotRow[];
  patients: Versioned<Patient>[];
}

/** 電子カルテの CT 予約：枠・有効な予約・患者（依頼・作業は取得しない）。 */
export async function loadCtSlots(client: FhirClient): Promise<SlotData> {
  const [slots, appointments, patients] = await Promise.all([
    client.search<Slot>("Slot", { schedule: CT_SCHEDULE }),
    client.search<Appointment>("Appointment", { status: "booked" }),
    loadPatients(client),
  ]);
  return { rows: joinSlots(slots, appointments, [], [], patients), patients };
}

/** 放射線部門システム：枠・有効な予約・画像検査の依頼・放射線部宛ての作業・患者。 */
export async function loadRisData(client: FhirClient): Promise<SlotData> {
  const [slots, appointments, srs, tasks, patients] = await Promise.all([
    client.search<Slot>("Slot", { schedule: CT_SCHEDULE }),
    client.search<Appointment>("Appointment", { status: "booked" }),
    client.search<ServiceRequest>("ServiceRequest", { category: IMAGING_CATEGORY_CODE }),
    client.search<Task>("Task", { owner: RAD_DEPT }),
    loadPatients(client),
  ]);
  return { rows: joinSlots(slots, appointments, srs, tasks, patients), patients };
}
