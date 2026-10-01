import type { Bundle, DiagnosticReport, ServiceRequest, Specimen, Task } from "fhir/r4";
import { describe, expect, it } from "vitest";
import {
  buildCancelTransaction,
  buildPartialReportTransaction,
  buildRejectPatch,
  buildRerunPatch,
  buildStartPatch,
} from "../../src/fhir/builders/labOrder";

const NOW = new Date("2026-10-01T10:00:00+09:00");

const sr: ServiceRequest = {
  resourceType: "ServiceRequest", id: "1", status: "active", intent: "order",
  subject: { reference: "Patient/demo-taro" },
  orderDetail: [{ coding: [{ code: "CBC" }] }, { coding: [{ code: "BIO" }] }],
};
const task: Task = { resourceType: "Task", id: "1", status: "in-progress", intent: "order", focus: { reference: "ServiceRequest/1" } };
const specimen: Specimen = { resourceType: "Specimen", id: "1", collection: { collectedDateTime: "2026-10-01T09:00:00+09:00" } };
const resource = <T>(b: Bundle, url: string) => b.entry!.find((e) => e.request?.url === url)!.resource as T;

describe("buildCancelTransaction (FR-010)", () => {
  const bundle = buildCancelTransaction({ serviceRequest: sr, serviceRequestEtag: 'W/"1"', task, taskEtag: 'W/"3"', now: NOW });

  it("revokes the request and cancels the task together, each with If-Match", () => {
    expect(bundle.type).toBe("transaction");
    expect(bundle.entry!.map((e) => [e.request?.method, e.request?.url, e.request?.ifMatch])).toEqual([
      ["PUT", "ServiceRequest/1", 'W/"1"'],
      ["PUT", "Task/1", 'W/"3"'],
    ]);
    expect(resource<ServiceRequest>(bundle, "ServiceRequest/1").status).toBe("revoked");
    expect(resource<Task>(bundle, "Task/1").status).toBe("cancelled");
  });

  it("leaves the businessStatus and the rest of the request untouched", () => {
    const t = { ...task, businessStatus: { coding: [{ code: "received" }] } };
    const b = buildCancelTransaction({ serviceRequest: sr, serviceRequestEtag: null, task: t, taskEtag: null, now: NOW });
    expect(resource<Task>(b, "Task/1").businessStatus?.coding?.[0].code).toBe("received");
    expect(resource<ServiceRequest>(b, "ServiceRequest/1").orderDetail).toHaveLength(2);
  });
});

describe("buildRejectPatch (FR-017)", () => {
  it("sets rejected and records the reason", () => {
    const ops = buildRejectPatch("溶血のため再採血が必要", NOW);
    expect(ops[0]).toEqual({ op: "replace", path: "/status", value: "rejected" });
    expect(ops[1]).toEqual({ op: "add", path: "/statusReason", value: { text: "溶血のため再採血が必要" } });
    expect(ops.map((o) => o.path)).toContain("/lastModified");
  });

  it("requires a reason", () => {
    expect(() => buildRejectPatch("", NOW)).toThrow();
    expect(() => buildRejectPatch("   ", NOW)).toThrow();
  });
});

describe("rerun (FR-018)", () => {
  it("puts the task on hold as 'rerun' and resumes with the start patch", () => {
    const hold = buildRerunPatch(NOW);
    expect(hold[0]).toEqual({ op: "replace", path: "/status", value: "on-hold" });
    expect((hold[1].value as { coding: { code: string }[] }).coding[0].code).toBe("rerun");
    const resume = buildStartPatch(NOW);
    expect(resume[0].value).toBe("in-progress");
    expect((resume[1].value as { coding: { code: string }[] }).coding[0].code).toBe("measuring");
  });
});

describe("buildPartialReportTransaction (FR-016)", () => {
  const base = {
    serviceRequest: sr, serviceRequestEtag: 'W/"1"', task, taskEtag: 'W/"3"', specimen, techRoleId: "tech-a", now: NOW,
  };

  it("reports only the chosen items as a partial report and leaves the task status and the request alone", () => {
    const bundle = buildPartialReportTransaction({ ...base, itemKeys: ["WBC", "RBC", "Hb", "Ht", "PLT"] });
    expect(bundle.entry!.filter((e) => e.request?.url === "Observation")).toHaveLength(5);
    const dr = resource<DiagnosticReport>(bundle, "DiagnosticReport");
    expect(dr.status).toBe("partial");
    expect(dr.result).toHaveLength(5);
    const nt = resource<Task>(bundle, "Task/1");
    expect(nt.status).toBe("in-progress");
    expect(nt.businessStatus?.coding?.[0].code).toBe("partial-reported");
    expect(nt.output?.[0].valueReference?.reference).toBe(bundle.entry!.find((e) => e.request?.url === "DiagnosticReport")!.fullUrl);
    expect(bundle.entry!.some((e) => e.request?.url === "ServiceRequest/1")).toBe(false);
  });

  it("must be at least one item and fewer than all the remaining items", () => {
    expect(() => buildPartialReportTransaction({ ...base, itemKeys: [] })).toThrow();
    expect(() => buildPartialReportTransaction({ ...base, itemKeys: ["WBC", "RBC", "Hb", "Ht", "PLT", "AST", "ALT", "Cre"] })).toThrow();
    expect(() => buildPartialReportTransaction({ ...base, itemKeys: ["XXX"] })).toThrow();
  });

  it("counts the items already reported", () => {
    // 既に 5 件報告済みなら、残り 3 件の全部を「一部報告」にすることはできない
    expect(() =>
      buildPartialReportTransaction({ ...base, reportedKeys: ["WBC", "RBC", "Hb", "Ht", "PLT"], itemKeys: ["AST", "ALT", "Cre"] }),
    ).toThrow();
    // 報告済みの項目を再び選ぶこともできない
    expect(() => buildPartialReportTransaction({ ...base, reportedKeys: ["WBC"], itemKeys: ["WBC"] })).toThrow();
    const ok = buildPartialReportTransaction({ ...base, reportedKeys: ["WBC", "RBC", "Hb", "Ht", "PLT"], itemKeys: ["AST", "ALT"] });
    expect(ok.entry!.filter((e) => e.request?.url === "Observation")).toHaveLength(2);
  });

  it("updates an existing partial report (PUT with If-Match) instead of creating another", () => {
    const existing: DiagnosticReport = { resourceType: "DiagnosticReport", id: "7", status: "partial", code: { text: "x" }, result: [{ reference: "Observation/1" }] };
    const bundle = buildPartialReportTransaction({ ...base, reportedKeys: ["WBC"], itemKeys: ["RBC"], existingReport: existing, existingReportEtag: 'W/"1"' });
    const drEntry = bundle.entry!.find((e) => e.request?.url === "DiagnosticReport/7")!;
    expect(drEntry.request).toMatchObject({ method: "PUT", ifMatch: 'W/"1"' });
    expect((drEntry.resource as DiagnosticReport).result).toHaveLength(2);
  });
});
