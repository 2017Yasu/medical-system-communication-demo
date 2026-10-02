// 画面の操作と E2E の補助が共有する、CT 予約の操作（FHIR への要求の送信。specs/003 research R-04）。
import type { Slot } from "fhir/r4";
import type { FhirClient, Versioned } from "./client";
import {
  buildBookingTransaction,
  buildHoldSlot,
  buildReleaseSlot,
  CT_DOCTORS,
  IMAGING_CATEGORY_CODE,
  nextCtOrderNumber,
  type CtDoctorId,
} from "./builders/ctBooking";

/** 予約の対象：枠（仮押さえを使う方式では仮押さえの応答、直接予約では枠を選んだときの応答）、医師、患者、検査内容。 */
export interface BookingTarget {
  slot: Versioned<Slot>;
  doctor: CtDoctorId;
  patientId: string;
  procedureCode: string;
}

/** 枠を選ぶ：枠を取得し、その版（ETag）を仮押さえまで保持できるようにして返す。 */
export async function selectSlot(client: FhirClient, slotId: string): Promise<Versioned<Slot>> {
  return client.read<Slot>("Slot", slotId);
}

/** 仮押さえする：枠を選んだ時点の版（selected の ETag）で If-Match を付けて `busy-tentative` にする。 */
export async function holdSlot(client: FhirClient, selected: Versioned<Slot>, doctor: CtDoctorId): Promise<Versioned<Slot>> {
  const next = buildHoldSlot(selected.resource, CT_DOCTORS[doctor].name);
  return client.update<Slot>("Slot", selected.resource.id!, next, selected.etag, "仮押さえ");
}

/** 取りやめる：仮押さえの応答の版で If-Match を付けて、枠を空きに戻す。 */
export async function releaseSlot(client: FhirClient, held: Versioned<Slot>): Promise<Versioned<Slot>> {
  return client.update<Slot>("Slot", held.resource.id!, buildReleaseSlot(held.resource), held.etag, "仮押さえの取りやめ");
}

async function nextOrderNumber(client: FhirClient, doctor: CtDoctorId, now: Date): Promise<string> {
  const existing = await client.search("ServiceRequest", { requester: `Practitioner/${doctor}`, category: IMAGING_CATEGORY_CODE });
  return nextCtOrderNumber(now, doctor, existing.length);
}

/** 予約を確定する（仮押さえを使う方式）：枠の `busy` への更新（仮押さえの版で ifMatch）+ 予約・依頼・作業の Transaction。 */
export async function confirmBooking(client: FhirClient, target: BookingTarget, now = new Date()): Promise<{ orderNumber: string }> {
  const orderNumber = await nextOrderNumber(client, target.doctor, now);
  await client.transaction(
    buildBookingTransaction({ ...target, slot: target.slot.resource, heldEtag: target.slot.etag, orderNumber, now }),
    "予約",
  );
  return { orderNumber };
}

/** 直接予約する（デモ専用の方式）：枠の状態を確認・更新せずに、予約・依頼・作業だけを送る（D-40）。 */
export async function bookDirect(client: FhirClient, target: BookingTarget, now = new Date()): Promise<{ orderNumber: string }> {
  const orderNumber = await nextOrderNumber(client, target.doctor, now);
  await client.transaction(
    buildBookingTransaction({ ...target, slot: target.slot.resource, heldEtag: null, orderNumber, now }),
    "予約",
  );
  return { orderNumber };
}
