import type { BundleEntry, MedicationDispense, MedicationRequest, Task } from "fhir/r4";
import { describe, expect, it } from "vitest";
import {
  buildAuditPatch,
  buildAcceptPatch,
  buildHandOverTransaction,
  buildPrescriptionTransaction,
  buildWardDispenseTransaction,
  nextPrescriptionOrderNumber,
} from "../../src/fhir/builders/prescription";

const NOW = new Date("2026-10-09T01:00:00Z");
const MERIT9 = "http://jpfhir.jp/fhir/core/CodeSystem/JP_MedicationCategoryMERIT9_CS";

const outpatient = () =>
  buildPrescriptionTransaction({
    doctor: "dr-x",
    patientId: "demo-taro",
    encounterId: null,
    medicationKey: "amlodipine",
    doseValue: 1,
    days: 14,
    orderNumber: "P-20261009-0001",
    now: NOW,
  });

const inpatient = () =>
  buildPrescriptionTransaction({
    doctor: "dr-y",
    patientId: "demo-saburo",
    encounterId: "adm-saburo",
    medicationKey: "loxoprofen",
    doseValue: 1,
    days: 3,
    orderNumber: "P-20261009-0001",
    now: NOW,
  });

const entryOf = (entries: BundleEntry[], type: string) => entries.find((e) => e.resource?.resourceType === type)!;

describe("buildPrescriptionTransaction", () => {
  it("creates the prescription and the pharmacy task in one transaction (outpatient)", () => {
    const entries = outpatient().entry!;
    expect(entries.map((e) => `${e.request?.method} ${e.request?.url}`)).toEqual(["POST MedicationRequest", "POST Task"]);
    const mr = entryOf(entries, "MedicationRequest").resource as MedicationRequest;
    expect(mr.meta?.profile).toEqual(["http://jpfhir.jp/fhir/core/StructureDefinition/JP_MedicationRequest"]);
    expect(mr.status).toBe("active");
    expect(mr.intent).toBe("order");
    expect(mr.category?.map((c) => c.coding?.[0].code)).toEqual(["OHP", "OHI"]);
    expect(mr.category?.every((c) => c.coding?.[0].system === MERIT9)).toBe(true);
    expect(mr.medicationCodeableConcept?.coding?.[0]).toMatchObject({ system: "http://medis.or.jp/CodeSystem/master-HOT9", code: "103299401" });
    expect(mr.subject.reference).toBe("Patient/demo-taro");
    expect(mr.requester?.reference).toBe("Practitioner/dr-x");
    expect(mr.encounter).toBeUndefined();
    expect(mr.identifier?.map((i) => i.value)).toEqual(["1", "1", "P-20261009-0001"]);
    expect(mr.identifier?.[2].system).toBe("https://demo.example.jp/fhir/sid/order-number");
    const dosage = mr.dosageInstruction![0];
    expect(dosage.timing?.code?.coding?.[0].code).toBe("1011000400000000");
    expect(dosage.route?.coding?.[0].code).toBe("PO");
    expect(dosage.method?.coding?.[0].code).toBe("10");
    expect(dosage.doseAndRate?.[0].doseQuantity).toMatchObject({ value: 1, code: "TAB" });
    expect(dosage.extension?.[0]).toMatchObject({
      url: "http://jpfhir.jp/fhir/core/Extension/StructureDefinition/JP_MedicationDosage_UsageDuration",
      valueDuration: { value: 14, code: "d" },
    });
    expect(mr.dispenseRequest?.quantity).toMatchObject({ value: 14, code: "TAB" });
    expect(mr.dispenseRequest?.expectedSupplyDuration).toMatchObject({ value: 14, code: "d" });

    const task = entryOf(entries, "Task").resource as Task;
    expect(task.status).toBe("requested");
    expect(task.intent).toBe("order");
    expect(task.focus?.reference).toBe(entryOf(entries, "MedicationRequest").fullUrl);
    expect(task.for?.reference).toBe("Patient/demo-taro");
    expect(task.requester?.reference).toBe("Practitioner/dr-x");
    expect(task.owner?.reference).toBe("Organization/pharmacy-dept");
    expect(task.businessStatus).toBeUndefined();
    expect(task.encounter).toBeUndefined();
  });

  it("links the inpatient prescription and task to the admission and uses the inpatient category", () => {
    const entries = inpatient().entry!;
    const mr = entryOf(entries, "MedicationRequest").resource as MedicationRequest;
    expect(mr.category?.map((c) => c.coding?.[0].code)).toEqual(["IHP", "XTR"]);
    expect(mr.encounter?.reference).toBe("Encounter/adm-saburo");
    expect(mr.dispenseRequest?.quantity?.value).toBe(9); // 1 錠 × 1 日 3 回 × 3 日
    expect((entryOf(entries, "Task").resource as Task).encounter?.reference).toBe("Encounter/adm-saburo");
  });

  it("never sends ifNoneExist", () => {
    for (const e of [...outpatient().entry!, ...inpatient().entry!]) expect(e.request?.ifNoneExist).toBeUndefined();
  });
});

describe("pharmacy task patches", () => {
  it("accepts and starts dispensing in one patch (status, business status, owner)", () => {
    const ops = buildAcceptPatch("ph-c", NOW);
    expect(ops.map((o) => `${o.op} ${o.path}`)).toEqual(["replace /status", "add /businessStatus", "replace /owner", "add /lastModified"]);
    expect(ops[0].value).toBe("in-progress");
    expect(ops[1].value).toMatchObject({
      coding: [{ system: "https://demo.example.jp/fhir/CodeSystem/pharm-business-status", code: "dispensing", display: "調剤中" }],
      text: "調剤中",
    });
    expect(ops[2].value).toEqual({ reference: "PractitionerRole/ph-c" });
  });

  it("starts the audit without touching the status", () => {
    const ops = buildAuditPatch("ph-e", NOW);
    expect(ops.map((o) => o.path)).toEqual(["/businessStatus", "/owner", "/lastModified"]);
    expect(ops[0].value).toMatchObject({ coding: [{ code: "auditing", display: "監査中" }], text: "監査中" });
    expect(ops[1].value).toEqual({ reference: "PractitionerRole/ph-e" });
  });
});

function stored(kind: "outpatient" | "inpatient") {
  const entries = (kind === "outpatient" ? outpatient() : inpatient()).entry!;
  const mr = { ...(entryOf(entries, "MedicationRequest").resource as MedicationRequest), id: "1" };
  const task = {
    ...(entryOf(entries, "Task").resource as Task),
    id: "1",
    status: "in-progress",
    owner: { reference: "PractitionerRole/ph-e" },
    businessStatus: { text: "監査中", coding: [{ code: "auditing" }] },
  } as Task;
  task.focus = { reference: "MedicationRequest/1" };
  return { mr, task };
}

describe("buildHandOverTransaction (outpatient)", () => {
  const { mr, task } = stored("outpatient");
  const bundle = buildHandOverTransaction({ mr, mrEtag: 'W/"1"', task, taskEtag: 'W/"3"', packager: "ph-c", checker: "ph-e", now: NOW });
  const entries = bundle.entry!;

  it("posts the dispense and updates the task and the prescription, both with ifMatch", () => {
    expect(entries.map((e) => `${e.request?.method} ${e.request?.url}`)).toEqual(["POST MedicationDispense", "PUT Task/1", "PUT MedicationRequest/1"]);
    expect(entries[1].request?.ifMatch).toBe('W/"3"');
    expect(entries[2].request?.ifMatch).toBe('W/"1"');
    expect((entries[2].resource as MedicationRequest).status).toBe("completed");
  });

  it("records the packager, the checker and the receiver", () => {
    const md = entries[0].resource as MedicationDispense;
    expect(md.meta?.profile).toEqual(["http://jpfhir.jp/fhir/core/StructureDefinition/JP_MedicationDispense"]);
    expect(md.status).toBe("completed");
    expect(md.performer?.map((p) => [p.function?.coding?.[0].code, p.actor.reference])).toEqual([
      ["packager", "PractitionerRole/ph-c"],
      ["checker", "PractitionerRole/ph-e"],
    ]);
    expect(md.authorizingPrescription?.[0].reference).toBe("MedicationRequest/1");
    expect(md.receiver?.[0].reference).toBe("Patient/demo-taro");
    expect(md.destination).toBeUndefined();
    expect(md.context).toBeUndefined();
    expect(md.quantity).toMatchObject({ value: 14, code: "TAB" });
    expect(md.daysSupply).toMatchObject({ value: 14, code: "d" });
    expect(md.whenHandedOver).toBe(NOW.toISOString());
    expect(md.identifier?.map((i) => i.value)).toEqual(["1", "1"]);
  });

  it("completes the task with the dispense as its output and drops the business status", () => {
    const t = entries[1].resource as Task;
    expect(t.status).toBe("completed");
    expect(t.businessStatus).toBeUndefined();
    expect(t.output?.[0]).toMatchObject({ type: { text: "調剤の記録" }, valueReference: { reference: entries[0].fullUrl } });
  });

  it("never sends ifNoneExist", () => {
    for (const e of entries) expect(e.request?.ifNoneExist).toBeUndefined();
  });
});

describe("buildWardDispenseTransaction (inpatient)", () => {
  const { mr, task } = stored("inpatient");
  const bundle = buildWardDispenseTransaction({ mr, task, taskEtag: 'W/"3"', packager: "ph-c", checker: "ph-e", now: NOW });
  const entries = bundle.entry!;

  it("does not touch the prescription", () => {
    expect(entries.map((e) => `${e.request?.method} ${e.request?.url}`)).toEqual(["POST MedicationDispense", "PUT Task/1"]);
  });

  it("records the ward as the destination and the admission as the context, without a receiver", () => {
    const md = entries[0].resource as MedicationDispense;
    expect(md.destination?.reference).toBe("Location/ward-surgery");
    expect(md.context?.reference).toBe("Encounter/adm-saburo");
    expect(md.receiver).toBeUndefined();
    expect(md.quantity?.value).toBe(9);
    expect((entries[1].resource as Task).status).toBe("completed");
  });
});

describe("nextPrescriptionOrderNumber", () => {
  it("uses the date in Japan time and a 4-digit sequence", () => {
    expect(nextPrescriptionOrderNumber(new Date("2026-10-08T16:00:00Z"), 0)).toBe("P-20261009-0001");
    expect(nextPrescriptionOrderNumber(new Date("2026-10-09T01:00:00Z"), 11)).toBe("P-20261009-0012");
  });
});
