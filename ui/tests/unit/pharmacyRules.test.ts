import type { MedicationRequest, Task } from "fhir/r4";
import { describe, expect, it } from "vitest";
import type { Versioned } from "../../src/fhir/client";
import { pharmacyAction } from "../../src/systems/pharmacy/pharmacyRules";
import type { PrescriptionRow } from "../../src/systems/shared/prescriptions";

const MERIT9 = "http://jpfhir.jp/fhir/core/CodeSystem/JP_MedicationCategoryMERIT9_CS";
const v = <T>(resource: T): Versioned<T> => ({ resource, etag: 'W/"1"' });

function row(kind: "outpatient" | "inpatient", task: Partial<Task> | null, business?: string): PrescriptionRow {
  const mr: MedicationRequest = {
    resourceType: "MedicationRequest",
    id: "1",
    status: "active",
    intent: "order",
    subject: { reference: "Patient/demo-taro" },
    category: [{ coding: [{ system: MERIT9, code: kind === "inpatient" ? "IHP" : "OHP" }] }],
  };
  return {
    mr: v(mr),
    task: task
      ? v({
          resourceType: "Task",
          id: "1",
          status: "requested",
          intent: "order",
          ...(business ? { businessStatus: { coding: [{ code: business }] } } : {}),
          ...task,
        } as Task)
      : null,
    dispense: null,
    patientName: "デモ 太郎",
    wardName: null,
  };
}

describe("pharmacyAction (screen-side restrictions, D-46)", () => {
  it("offers to accept a requested task to anyone", () => {
    for (const me of ["ph-c", "ph-e"] as const) {
      expect(pharmacyAction(row("outpatient", { status: "requested", owner: { reference: "Organization/pharmacy-dept" } }), me)).toMatchObject({
        kind: "accept",
        label: "受付・調剤開始",
        enabled: true,
      });
    }
  });

  it("does not let the pharmacist who dispensed start the audit", () => {
    const dispensing = row("outpatient", { status: "in-progress", owner: { reference: "PractitionerRole/ph-c" } }, "dispensing");
    expect(pharmacyAction(dispensing, "ph-c")).toMatchObject({
      kind: "audit",
      label: "監査を開始",
      enabled: false,
      hint: "調剤した薬剤師とは別の薬剤師が監査します（薬剤師 E に切り替えてください）",
    });
    expect(pharmacyAction(dispensing, "ph-e")).toMatchObject({ kind: "audit", enabled: true });
  });

  it("lets only the pharmacist who started the audit hand over (outpatient)", () => {
    const auditing = row("outpatient", { status: "in-progress", owner: { reference: "PractitionerRole/ph-e" } }, "auditing");
    expect(pharmacyAction(auditing, "ph-e")).toMatchObject({ kind: "handover", label: "監査を終えてお渡し", enabled: true });
    expect(pharmacyAction(auditing, "ph-c")).toMatchObject({
      kind: "handover",
      enabled: false,
      hint: "監査を始めた薬剤師（薬剤師 E）が操作します",
    });
  });

  it("dispatches to the ward for an inpatient", () => {
    const auditing = row("inpatient", { status: "in-progress", owner: { reference: "PractitionerRole/ph-e" } }, "auditing");
    expect(pharmacyAction(auditing, "ph-e")).toMatchObject({ kind: "ward-dispense", label: "監査を終えて払出", enabled: true });
    expect(pharmacyAction(auditing, "ph-c")?.enabled).toBe(false);
  });

  it("offers nothing for a completed task or a row without a task", () => {
    expect(pharmacyAction(row("outpatient", { status: "completed", owner: { reference: "PractitionerRole/ph-e" } }), "ph-e")).toBeNull();
    expect(pharmacyAction(row("outpatient", null), "ph-e")).toBeNull();
  });
});
