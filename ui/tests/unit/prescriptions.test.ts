import type { Encounter, MedicationDispense, MedicationRequest, Patient, Task } from "fhir/r4";
import { describe, expect, it } from "vitest";
import type { Versioned } from "../../src/fhir/client";
import {
  PHARMACY_OWNERS,
  WARD_ENCOUNTERS,
  diffPrescriptionRows,
  drugText,
  joinPrescriptions,
} from "../../src/systems/shared/prescriptions";

const v = <T>(resource: T, etag = 'W/"1"'): Versioned<T> => ({ resource, etag });

const mr = (id: string, subject: string, extra: Partial<MedicationRequest> = {}): MedicationRequest => ({
  resourceType: "MedicationRequest",
  id,
  status: "active",
  intent: "order",
  subject: { reference: subject },
  medicationCodeableConcept: { coding: [{ code: "103299401", display: "ノルバスク錠５ｍｇ" }] },
  dosageInstruction: [
    {
      text: "内服・経口・１日１回朝食後",
      doseAndRate: [{ doseQuantity: { value: 1, unit: "錠" } }],
      extension: [{ url: "http://jpfhir.jp/fhir/core/Extension/StructureDefinition/JP_MedicationDosage_UsageDuration", valueDuration: { value: 14, unit: "日" } }],
    },
  ],
  ...extra,
});

const task = (id: string, focus: string, extra: Partial<Task> = {}): Task => ({
  resourceType: "Task",
  id,
  status: "requested",
  intent: "order",
  focus: { reference: focus },
  owner: { reference: "Organization/pharmacy-dept" },
  ...extra,
});

const dispense = (id: string, prescription: string, extra: Partial<MedicationDispense> = {}): MedicationDispense => ({
  resourceType: "MedicationDispense",
  id,
  status: "completed",
  medicationCodeableConcept: {},
  authorizingPrescription: [{ reference: prescription }],
  ...extra,
});

const patient = (id: string, name: string): Patient => ({ resourceType: "Patient", id, name: [{ text: name }] });
const admission: Encounter = {
  resourceType: "Encounter",
  id: "adm-saburo",
  status: "in-progress",
  class: { code: "IMP" },
  location: [{ location: { reference: "Location/ward-surgery", display: "外科病棟" } }],
};

describe("constants", () => {
  it("lists the pharmacy owners and the ward admission", () => {
    expect(PHARMACY_OWNERS).toBe("Organization/pharmacy-dept,PractitionerRole/ph-c,PractitionerRole/ph-e");
    expect(WARD_ENCOUNTERS).toBe("Encounter/adm-saburo");
  });
});

describe("joinPrescriptions", () => {
  const rows = joinPrescriptions(
    [v(mr("1", "Patient/demo-taro")), v(mr("2", "Patient/demo-saburo", { encounter: { reference: "Encounter/adm-saburo" } })), v(mr("3", "Patient/demo-taro"))],
    [v(task("10", "MedicationRequest/1")), v(task("20", "MedicationRequest/2"))],
    [v(dispense("100", "MedicationRequest/1", { receiver: [{ reference: "Patient/demo-taro" }] }))],
    [v(patient("demo-taro", "デモ 太郎")), v(patient("demo-saburo", "デモ 三郎"))],
    [v(admission)],
  );

  it("is newest first and joins task, dispense, patient name and ward name by reference", () => {
    expect(rows.map((r) => r.mr.resource.id)).toEqual(["3", "2", "1"]);
    const byId = Object.fromEntries(rows.map((r) => [r.mr.resource.id, r]));
    expect(byId["1"].task?.resource.id).toBe("10");
    expect(byId["1"].dispense?.resource.id).toBe("100");
    expect(byId["1"].patientName).toBe("デモ 太郎");
    expect(byId["1"].wardName).toBeNull();
    expect(byId["2"].patientName).toBe("デモ 三郎");
    expect(byId["2"].wardName).toBe("外科病棟");
    expect(byId["2"].dispense).toBeNull();
  });

  it("keeps a prescription without a task or a dispense as a row", () => {
    const row = rows.find((r) => r.mr.resource.id === "3")!;
    expect(row.task).toBeNull();
    expect(row.dispense).toBeNull();
  });
});

describe("drugText", () => {
  it("summarises drug, dose, usage and days", () => {
    expect(drugText(mr("1", "Patient/demo-taro"))).toBe("ノルバスク錠５ｍｇ 1 錠 内服・経口・１日１回朝食後 14 日分");
  });
});

describe("diffPrescriptionRows", () => {
  const base = (t: Partial<Task>, d?: MedicationDispense, m: Partial<MedicationRequest> = {}) =>
    joinPrescriptions([v(mr("1", "Patient/demo-taro", m))], [v(task("10", "MedicationRequest/1", t))], d ? [v(d)] : [], [v(patient("demo-taro", "デモ 太郎"))], []);

  it("does not compare without a previous list", () => {
    expect(diffPrescriptionRows(null, base({}))).toEqual([]);
  });

  it("reports task status, business status, owner, request status and the hand-over", () => {
    const before = base({});
    const accepted = base({
      status: "in-progress",
      owner: { reference: "PractitionerRole/ph-c" },
      businessStatus: { coding: [{ code: "dispensing" }] },
    });
    const changes = diffPrescriptionRows(before, accepted);
    expect(changes).toHaveLength(1);
    expect(changes[0].srId).toBe("1");
    expect(changes[0].fields.map((f) => f.field)).toEqual(["status", "businessStatus", "owner"]);
    expect(changes[0].fields.find((f) => f.field === "owner")).toMatchObject({ before: "薬剤部", after: "薬剤師 C" });
    expect(changes[0].fields.find((f) => f.field === "businessStatus")).toMatchObject({ before: "—", after: "調剤中" });

    const done = base({ status: "completed", owner: { reference: "PractitionerRole/ph-e" } }, dispense("100", "MedicationRequest/1", { receiver: [{ reference: "Patient/demo-taro" }] }), { status: "completed" });
    const last = diffPrescriptionRows(base({ status: "in-progress", owner: { reference: "PractitionerRole/ph-e" } }), done);
    expect(last[0].fields.map((f) => f.field)).toEqual(["requestStatus", "status", "dispense"]);
    expect(last[0].fields.find((f) => f.field === "dispense")).toMatchObject({ before: "—", after: "お渡し済み" });
  });

  it("reports nothing when nothing changed", () => {
    expect(diffPrescriptionRows(base({}), base({}))).toEqual([]);
  });
});
