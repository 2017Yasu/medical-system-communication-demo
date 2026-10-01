import { describe, expect, it } from "vitest";
import { businessStatusLabel, formatStatus, statusLabel } from "../../src/fhir/labels";

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
