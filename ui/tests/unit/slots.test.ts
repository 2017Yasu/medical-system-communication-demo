import type { Appointment, Patient, ServiceRequest, Slot, Task } from "fhir/r4";
import { describe, expect, it } from "vitest";
import type { Versioned } from "../../src/fhir/client";
import { diffSlotRows, joinSlots } from "../../src/systems/shared/slots";

const v = <T>(resource: T, version = 1): Versioned<T> => ({ resource, etag: `W/"${version}"` });

const slot = (id: string, hhmm: string, status: Slot["status"] = "free", comment?: string, version = 1): Versioned<Slot> =>
  v<Slot>(
    {
      resourceType: "Slot",
      id,
      schedule: { reference: "Schedule/ct-1" },
      status,
      start: `2026-10-03T${hhmm}:00+09:00`,
      end: `2026-10-03T${hhmm}:00+09:00`,
      ...(comment ? { comment } : {}),
    },
    version,
  );

const patient = (id: string, name: string): Versioned<Patient> => v<Patient>({ resourceType: "Patient", id, name: [{ text: name }] });

const appointment = (id: string, slotId: string, patientId: string, srId?: string): Versioned<Appointment> =>
  v<Appointment>({
    resourceType: "Appointment",
    id,
    status: "booked",
    slot: [{ reference: `Slot/${slotId}` }],
    ...(srId ? { basedOn: [{ reference: `ServiceRequest/${srId}` }] } : {}),
    participant: [{ actor: { reference: `Patient/${patientId}` }, status: "accepted" }],
  });

const sr = (id: string, doctor: string, code = "CT-CHEST", display = "胸部 CT（単純）", orderNumber = "R-20261002-X001"): Versioned<ServiceRequest> =>
  v<ServiceRequest>({
    resourceType: "ServiceRequest",
    id,
    status: "active",
    intent: "order",
    subject: { reference: "Patient/demo-taro" },
    requester: { reference: `Practitioner/${doctor}` },
    code: { coding: [{ code, display }] },
    identifier: [{ value: orderNumber }],
  });

const task = (id: string, srId: string): Versioned<Task> =>
  v<Task>({
    resourceType: "Task",
    id,
    status: "requested",
    intent: "order",
    focus: { reference: `ServiceRequest/${srId}` },
    businessStatus: { coding: [{ code: "booked" }] },
  });

const patients = [patient("demo-taro", "デモ 太郎"), patient("demo-hanako", "デモ 花子"), patient("demo-jiro", "デモ 次郎")];

describe("joinSlots", () => {
  const slots = [slot("ct1-1030", "10:30"), slot("ct1-0900", "09:00", "busy"), slot("ct1-1000", "10:00")];

  it("orders rows by start time", () => {
    const rows = joinSlots(slots, [], [], [], patients);
    expect(rows.map((r) => r.slot.resource.id)).toEqual(["ct1-0900", "ct1-1000", "ct1-1030"]);
  });

  it("collects the booked appointments of each slot with patient, order and task", () => {
    const rows = joinSlots(slots, [appointment("1", "ct1-1000", "demo-taro", "1")], [sr("1", "dr-x")], [task("1", "1")], patients);
    const row = rows.find((r) => r.slot.resource.id === "ct1-1000")!;
    expect(row.bookings).toHaveLength(1);
    expect(row.bookings[0]).toMatchObject({
      patientName: "デモ 太郎",
      doctor: "医師 X",
      procedure: "胸部 CT（単純）",
      orderNumber: "R-20261002-X001",
      seed: false,
    });
    expect(row.bookings[0].task?.resource.id).toBe("1");
    expect(row.doubleBooked).toBe(false);
  });

  it("flags a slot booked twice (S3-1) and a slot that is booked but still free", () => {
    const rows = joinSlots(
      slots,
      [appointment("1", "ct1-1000", "demo-taro", "1"), appointment("2", "ct1-1000", "demo-hanako", "2")],
      [sr("1", "dr-x"), sr("2", "dr-y", "CT-CHEST", "胸部 CT（単純）", "R-20261002-Y001")],
      [task("1", "1"), task("2", "2")],
      patients,
    );
    const row = rows.find((r) => r.slot.resource.id === "ct1-1000")!;
    expect(row.bookings.map((b) => b.patientName)).toEqual(["デモ 太郎", "デモ 花子"]);
    expect(row.doubleBooked).toBe(true);
    expect(row.bookedButFree).toBe(true);
    expect(row.bookings.map((b) => b.doctor)).toEqual(["医師 X", "医師 Y"]);
  });

  it("does not count cancelled appointments", () => {
    const cancelled = appointment("9", "ct1-1000", "demo-taro", "1");
    cancelled.resource.status = "cancelled";
    const row = joinSlots(slots, [cancelled], [sr("1", "dr-x")], [task("1", "1")], patients).find((r) => r.slot.resource.id === "ct1-1000")!;
    expect(row.bookings).toHaveLength(0);
  });

  it("marks appointments without a service request as initial data", () => {
    const row = joinSlots(slots, [appointment("seed-0900", "ct1-0900", "demo-jiro")], [], [], patients).find((r) => r.slot.resource.id === "ct1-0900")!;
    expect(row.bookings[0].seed).toBe(true);
    expect(row.bookings[0].patientName).toBe("デモ 次郎");
    expect(row.bookedButFree).toBe(false);
    expect(row.doubleBooked).toBe(false);
  });

  it("takes the holder's name from the display-only comment", () => {
    const held = [slot("ct1-1000", "10:00", "busy-tentative", "仮押さえ：医師 X")];
    expect(joinSlots(held, [], [], [], patients)[0].holder).toBe("医師 X");
    expect(joinSlots([slot("ct1-1000", "10:00")], [], [], [], patients)[0].holder).toBeNull();
  });
});

describe("diffSlotRows", () => {
  const before = joinSlots([slot("ct1-1000", "10:00")], [], [], [], patients);

  it("is empty without a previous list (first display or right after a reset)", () => {
    expect(diffSlotRows(null, before)).toEqual([]);
  });

  it("reports the status and the holder when a slot is held", () => {
    const after = joinSlots([slot("ct1-1000", "10:00", "busy-tentative", "仮押さえ：医師 X", 2)], [], [], [], patients);
    expect(diffSlotRows(before, after)).toEqual([
      {
        srId: "ct1-1000",
        fields: [
          { field: "status", before: "空き free", after: "仮押さえ中 busy-tentative" },
          { field: "holder", before: "—", after: "医師 X" },
        ],
      },
    ]);
  });

  it("reports the bookings when an appointment is added without a slot update (S3-1)", () => {
    const after = joinSlots([slot("ct1-1000", "10:00")], [appointment("1", "ct1-1000", "demo-taro", "1")], [sr("1", "dr-x")], [task("1", "1")], patients);
    expect(diffSlotRows(before, after)).toEqual([{ srId: "ct1-1000", fields: [{ field: "bookings", before: "予約なし", after: "デモ 太郎" }] }]);
  });

  it("reports nothing when nothing changed", () => {
    expect(diffSlotRows(before, before)).toEqual([]);
  });
});
