import { describe, expect, it } from "vitest";
import {
  businessStatusLabel,
  categoryLabel,
  dispenseLabel,
  pharmBusinessStatusLabel,
  prescriptionKind,
  formatSlotTime,
  formatStatus,
  holderName,
  radBusinessStatusLabel,
  statusLabel,
} from "../../src/fhir/labels";

// docs/04-design-rules.md「表示ラベル」の表
describe("status labels", () => {
  it("Task.status", () => {
    const expected: Record<string, string> = {
      requested: "依頼済み",
      accepted: "受付済み",
      rejected: "受付不可",
      "in-progress": "実施中",
      "on-hold": "保留",
      completed: "完了",
      failed: "中断（失敗）",
      cancelled: "取消",
    };
    for (const [code, label] of Object.entries(expected)) {
      expect(statusLabel("task", code)).toBe(label);
    }
  });

  it("ServiceRequest.status", () => {
    expect(statusLabel("serviceRequest", "active")).toBe("有効（依頼中）");
    expect(statusLabel("serviceRequest", "revoked")).toBe("取消");
    expect(statusLabel("serviceRequest", "completed")).toBe("完了");
    expect(statusLabel("serviceRequest", "on-hold")).toBe("保留");
  });

  it("DiagnosticReport.status", () => {
    expect(statusLabel("diagnosticReport", "partial")).toBe("一部報告");
    expect(statusLabel("diagnosticReport", "final")).toBe("確定");
  });

  it("Slot / Appointment.status", () => {
    expect(statusLabel("slot", "free")).toBe("空き");
    expect(statusLabel("slot", "busy-tentative")).toBe("仮押さえ中");
    expect(statusLabel("slot", "busy")).toBe("予約済み");
    expect(statusLabel("appointment", "booked")).toBe("予約確定");
    expect(statusLabel("appointment", "cancelled")).toBe("予約取消");
  });

  it("falls back to the code for unknown values", () => {
    expect(statusLabel("task", "mystery")).toBe("mystery");
  });

  it("formatStatus puts the FHIR code next to the business label", () => {
    expect(formatStatus("task", "accepted")).toBe("受付済み accepted");
    expect(formatStatus("serviceRequest", "active")).toBe("有効（依頼中） active");
  });
});

describe("businessStatus labels (data-model.md §3.3)", () => {
  it("maps the seven codes", () => {
    expect(businessStatusLabel("not-collected")).toBe("未採取");
    expect(businessStatusLabel("collected")).toBe("採取済");
    expect(businessStatusLabel("received")).toBe("検体到着");
    expect(businessStatusLabel("measuring")).toBe("測定中");
    expect(businessStatusLabel("rerun")).toBe("再検中");
    expect(businessStatusLabel("partial-reported")).toBe("一部報告済");
    expect(businessStatusLabel("reported")).toBe("報告済");
  });
});

describe("S3 labels (specs/003)", () => {
  it("radiology business status", () => {
    expect(radBusinessStatusLabel("booked")).toBe("予約済み");
    expect(radBusinessStatusLabel("unknown")).toBe("unknown");
  });

  it("slot and appointment status labels (docs/04)", () => {
    expect(formatStatus("slot", "free")).toBe("空き free");
    expect(formatStatus("slot", "busy-tentative")).toBe("仮押さえ中 busy-tentative");
    expect(formatStatus("slot", "busy")).toBe("予約済み busy");
    expect(formatStatus("appointment", "booked")).toBe("予約確定 booked");
  });

  it("formats slot times in Japan time regardless of the process time zone", () => {
    const original = process.env.TZ;
    for (const tz of ["UTC", "America/Los_Angeles", "Asia/Tokyo"]) {
      process.env.TZ = tz;
      expect(formatSlotTime("2026-10-03T10:00:00+09:00", "2026-10-03T10:30:00+09:00")).toBe("10/3（土）10:00–10:30");
      // UTC では前日になる時刻でも、日本時間の日付で表示する
      expect(formatSlotTime("2026-10-04T09:00:00+09:00", "2026-10-04T09:30:00+09:00")).toBe("10/4（日）09:00–09:30");
    }
    process.env.TZ = original;
  });

  it("takes the holder's name from the display-only comment (D-35)", () => {
    expect(holderName("仮押さえ：医師 X")).toBe("医師 X");
    expect(holderName("仮押さえ：医師 Y")).toBe("医師 Y");
    expect(holderName(undefined)).toBeNull();
    expect(holderName("")).toBeNull();
    expect(holderName("別の備考")).toBeNull();
  });

  it("labels prescriptions like service requests (S4)", () => {
    expect(formatStatus("medicationRequest", "active")).toBe("有効（依頼中） active");
    expect(formatStatus("medicationRequest", "completed")).toBe("完了 completed");
  });

  it("labels the dispense record as handed over (outpatient) or dispatched (inpatient)", () => {
    expect(dispenseLabel({ resourceType: "MedicationDispense", status: "completed", medicationCodeableConcept: {}, receiver: [{ reference: "Patient/demo-taro" }] })).toBe("お渡し済み");
    expect(dispenseLabel({ resourceType: "MedicationDispense", status: "completed", medicationCodeableConcept: {}, destination: { reference: "Location/ward-surgery" } })).toBe("払出済み");
  });

  it("labels the pharmacy business statuses", () => {
    expect(pharmBusinessStatusLabel("dispensing")).toBe("調剤中");
    expect(pharmBusinessStatusLabel("auditing")).toBe("監査中");
    expect(pharmBusinessStatusLabel("x")).toBe("x");
    expect(businessStatusLabel("auditing")).toBe("監査中");
  });

  it("tells outpatient from inpatient by the MERIT9 category and joins its display names", () => {
    const c = (code: string, display: string) => ({ coding: [{ system: "http://jpfhir.jp/fhir/core/CodeSystem/JP_MedicationCategoryMERIT9_CS", code, display }] });
    const out = { resourceType: "MedicationRequest", status: "active", intent: "order", subject: {}, category: [c("OHP", "外来処方"), c("OHI", "院内処方")] } as never;
    const inn = { resourceType: "MedicationRequest", status: "active", intent: "order", subject: {}, category: [c("IHP", "入院処方"), c("XTR", "臨時処方")] } as never;
    expect(prescriptionKind(out)).toBe("outpatient");
    expect(prescriptionKind(inn)).toBe("inpatient");
    expect(categoryLabel(out)).toBe("外来処方・院内処方");
    expect(categoryLabel(inn)).toBe("入院処方・臨時処方");
  });
});
