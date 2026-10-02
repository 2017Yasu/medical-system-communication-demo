import type { Appointment, Bundle, ServiceRequest, Slot, Task } from "fhir/r4";
import { describe, expect, it } from "vitest";
import {
  buildBookingTransaction,
  buildHoldSlot,
  buildReleaseSlot,
  CT_PROCEDURES,
  nextCtOrderNumber,
} from "../../src/fhir/builders/ctBooking";

const NOW = new Date("2026-10-02T10:00:00+09:00");

const slot = (over: Partial<Slot> = {}): Slot => ({
  resourceType: "Slot",
  id: "ct1-1000",
  meta: { versionId: "1" },
  schedule: { reference: "Schedule/ct-1" },
  status: "free",
  start: "2026-10-03T10:00:00+09:00",
  end: "2026-10-03T10:30:00+09:00",
  ...over,
});

function entry<T>(bundle: Bundle, i: number): T {
  return bundle.entry![i].resource as T;
}

describe("buildHoldSlot / buildReleaseSlot", () => {
  it("holds the slot and records the holder in the display-only comment (D-35)", () => {
    const held = buildHoldSlot(slot(), "医師 X");
    expect(held.status).toBe("busy-tentative");
    expect(held.comment).toBe("仮押さえ：医師 X");
    expect(held.schedule).toEqual({ reference: "Schedule/ct-1" });
    expect(held.start).toBe("2026-10-03T10:00:00+09:00");
    expect(held.id).toBe("ct1-1000");
  });

  it("does not change the input", () => {
    const original = slot();
    buildHoldSlot(original, "医師 X");
    expect(original.status).toBe("free");
    expect(original.comment).toBeUndefined();
  });

  it("releases the slot and clears the comment", () => {
    const released = buildReleaseSlot(slot({ status: "busy-tentative", comment: "仮押さえ：医師 X" }));
    expect(released.status).toBe("free");
    expect("comment" in released).toBe(false);
  });
});

describe("buildBookingTransaction (data-model.md §2, D-40)", () => {
  const params = { slot: slot({ status: "busy-tentative", comment: "仮押さえ：医師 X" }), patientId: "demo-taro", procedureCode: "CT-CHEST", doctor: "dr-x" as const, orderNumber: "R-20261002-X001", now: NOW };
  const held = buildBookingTransaction({ ...params, heldEtag: 'W/"2"' });
  const direct = buildBookingTransaction({ ...params, slot: slot(), heldEtag: null });

  it("confirms with a version-checked PUT of the slot followed by three POSTs", () => {
    expect(held.type).toBe("transaction");
    expect(held.entry!.map((e) => `${e.request?.method} ${e.request?.url}`)).toEqual([
      "PUT Slot/ct1-1000",
      "POST Appointment",
      "POST ServiceRequest",
      "POST Task",
    ]);
    expect(held.entry![0].request?.ifMatch).toBe('W/"2"');
    const busy = entry<Slot>(held, 0);
    expect(busy.status).toBe("busy");
    expect("comment" in busy).toBe(false);
  });

  it("books directly without touching the slot", () => {
    expect(direct.entry!.map((e) => `${e.request?.method} ${e.request?.url}`)).toEqual([
      "POST Appointment",
      "POST ServiceRequest",
      "POST Task",
    ]);
    expect(direct.entry!.some((e) => e.resource?.resourceType === "Slot")).toBe(false);
  });

  it("never sets ifNoneExist (D-40)", () => {
    for (const b of [held, direct]) {
      expect(b.entry!.every((e) => e.request?.ifNoneExist === undefined)).toBe(true);
      expect(JSON.stringify(b)).not.toContain("ifNoneExist");
    }
  });

  it("builds the appointment", () => {
    const a = entry<Appointment>(held, 1);
    expect(a.status).toBe("booked");
    expect(a.slot).toEqual([{ reference: "Slot/ct1-1000" }]);
    expect(a.start).toBe("2026-10-03T10:00:00+09:00");
    expect(a.end).toBe("2026-10-03T10:30:00+09:00");
    expect(a.basedOn).toEqual([{ reference: held.entry![2].fullUrl }]);
    expect(a.participant.map((p) => [p.actor?.reference, p.status])).toEqual([
      ["Patient/demo-taro", "accepted"],
      ["Practitioner/dr-x", "accepted"],
      ["Device/ct-1", "accepted"],
    ]);
    expect(a.serviceType?.[0].coding?.[0].code).toBe("CT-CHEST");
  });

  it("builds the imaging service request", () => {
    const sr = entry<ServiceRequest>(held, 2);
    expect(sr.meta?.profile).toEqual(["http://jpfhir.jp/fhir/core/StructureDefinition/JP_ServiceRequest_Common"]);
    expect(sr.identifier?.[0].value).toBe("R-20261002-X001");
    expect(sr.status).toBe("active");
    expect(sr.intent).toBe("order");
    expect(sr.category?.[0].coding?.[0]).toMatchObject({ system: "http://snomed.info/sct", code: "363679005" });
    expect(sr.category?.[0].text).toBe("画像検査");
    expect(sr.code?.coding?.[0]).toMatchObject({ code: "CT-CHEST", display: "胸部 CT（単純）" });
    expect(sr.orderDetail?.[0].coding?.[0]).toMatchObject({ system: "http://dicom.nema.org/resources/ontology/DCM", code: "CT" });
    expect(sr.subject).toEqual({ reference: "Patient/demo-taro" });
    expect(sr.requester).toEqual({ reference: "Practitioner/dr-x" });
    expect(sr.performer).toEqual([{ reference: "Organization/rad-dept" }]);
    expect(sr.occurrencePeriod).toEqual({ start: "2026-10-03T10:00:00+09:00", end: "2026-10-03T10:30:00+09:00" });
    expect(sr.authoredOn).toBe(NOW.toISOString());
  });

  it("builds the task for the radiology department", () => {
    const t = entry<Task>(held, 3);
    expect(t.status).toBe("requested");
    expect(t.intent).toBe("order");
    expect(t.businessStatus?.coding?.[0]).toMatchObject({ code: "booked", display: "予約済み" });
    expect(t.owner).toEqual({ reference: "Organization/rad-dept" });
    expect(t.requester).toEqual({ reference: "Practitioner/dr-x" });
    expect(t.focus).toEqual({ reference: held.entry![2].fullUrl });
    expect(t.for).toEqual({ reference: "Patient/demo-taro" });
  });

  it("uses the doctor given", () => {
    const y = buildBookingTransaction({ ...params, doctor: "dr-y", heldEtag: null, orderNumber: "R-20261002-Y001" });
    expect(entry<Task>(y, 2).requester).toEqual({ reference: "Practitioner/dr-y" });
    expect(entry<Appointment>(y, 0).participant[1].actor?.reference).toBe("Practitioner/dr-y");
  });
});

describe("nextCtOrderNumber", () => {
  it("numbers per doctor in Japan time", () => {
    expect(nextCtOrderNumber(NOW, "dr-x", 0)).toBe("R-20261002-X001");
    expect(nextCtOrderNumber(NOW, "dr-y", 2)).toBe("R-20261002-Y003");
    // UTC ではまだ前日（15:30Z = 日本時間の翌日 0:30）でも、日本時間の日付を使う
    expect(nextCtOrderNumber(new Date("2026-10-02T15:30:00Z"), "dr-x", 0)).toBe("R-20261003-X001");
  });
});

describe("CT_PROCEDURES", () => {
  it("lists the demo procedure codes", () => {
    expect(CT_PROCEDURES.map((p) => p.code)).toEqual(["CT-HEAD", "CT-CHEST", "CT-ABD-C"]);
  });
});
