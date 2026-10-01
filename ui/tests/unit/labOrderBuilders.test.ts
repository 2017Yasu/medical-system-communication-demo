import type { Bundle, DiagnosticReport, Observation, ServiceRequest, Specimen, Task } from "fhir/r4";
import { describe, expect, it } from "vitest";
import {
  allItemKeys,
  buildAcceptPatch,
  buildCollectionTransaction,
  buildFinalReportTransaction,
  buildOrderTransaction,
  buildStartPatch,
  judgeInterpretation,
  nextOrderNumber,
} from "../../src/fhir/builders/labOrder";

const NOW = new Date("2026-10-01T10:00:00+09:00");

function entryResource<T>(bundle: Bundle, index: number): T {
  return bundle.entry![index].resource as T;
}

function task(): Task {
  return {
    resourceType: "Task",
    id: "1",
    status: "requested",
    intent: "order",
    focus: { reference: "ServiceRequest/1" },
    businessStatus: { coding: [{ code: "collected" }] },
  };
}

describe("buildOrderTransaction (data-model.md §4)", () => {
  const bundle = buildOrderTransaction({ patientId: "demo-taro", sets: ["CBC", "BIO"], orderNumber: "L-20261001-0001", now: NOW });

  it("is a transaction of three POSTs with urn:uuid cross references", () => {
    expect(bundle.type).toBe("transaction");
    expect(bundle.entry).toHaveLength(3);
    expect(bundle.entry!.map((e) => e.request?.method)).toEqual(["POST", "POST", "POST"]);
    expect(bundle.entry!.map((e) => e.request?.url)).toEqual(["ServiceRequest", "Task", "Specimen"]);
    const sr = entryResource<ServiceRequest>(bundle, 0);
    const t = entryResource<Task>(bundle, 1);
    const sp = entryResource<Specimen>(bundle, 2);
    expect(t.focus?.reference).toBe(bundle.entry![0].fullUrl);
    expect(sr.specimen?.[0].reference).toBe(bundle.entry![2].fullUrl);
    expect(sp.request?.[0].reference).toBe(bundle.entry![0].fullUrl);
  });

  it("ServiceRequest is active, an order, with the selected sets and the order number", () => {
    const sr = entryResource<ServiceRequest>(bundle, 0);
    expect(sr.status).toBe("active");
    expect(sr.intent).toBe("order");
    expect(sr.subject?.reference).toBe("Patient/demo-taro");
    expect(sr.requester?.reference).toBe("Practitioner/dr-x");
    expect(sr.orderDetail?.map((d) => d.coding?.[0].code)).toEqual(["CBC", "BIO"]);
    expect(sr.identifier?.[0].value).toBe("L-20261001-0001");
    expect(sr.meta?.profile).toEqual(["http://jpfhir.jp/fhir/core/StructureDefinition/JP_ServiceRequest_Common"]);
  });

  it("Task is requested, owned by the lab department and not collected yet", () => {
    const t = entryResource<Task>(bundle, 1);
    expect(t.status).toBe("requested");
    expect(t.intent).toBe("order");
    expect(t.owner?.reference).toBe("Organization/lab-dept");
    expect(t.requester?.reference).toBe("Practitioner/dr-x");
    expect(t.for?.reference).toBe("Patient/demo-taro");
    expect(t.businessStatus?.coding?.[0].code).toBe("not-collected");
    expect(t.lastModified).toBeDefined();
  });

  it("Specimen has no status (not collected) and is blood", () => {
    const sp = entryResource<Specimen>(bundle, 2);
    expect(sp.status).toBeUndefined();
    expect(sp.type?.coding?.[0].code).toBe("BLD");
    expect(sp.collection?.collector).toBeUndefined();
  });

  it("requires at least one set (FR-005)", () => {
    expect(() => buildOrderTransaction({ patientId: "demo-taro", sets: [], orderNumber: "x", now: NOW })).toThrow();
  });

  it("generates order numbers like L-yyyyMMdd-####", () => {
    expect(nextOrderNumber(NOW, 0)).toBe("L-20261001-0001");
    expect(nextOrderNumber(NOW, 11)).toBe("L-20261001-0012");
  });
});

describe("buildCollectionTransaction", () => {
  it("updates the specimen and the task businessStatus with If-Match, leaving Task.status alone", () => {
    const specimen: Specimen = { resourceType: "Specimen", id: "1", subject: { reference: "Patient/demo-taro" } };
    const t: Task = { ...task(), businessStatus: { coding: [{ code: "not-collected" }] } };
    const bundle = buildCollectionTransaction({ specimen, specimenEtag: 'W/"1"', task: t, taskEtag: 'W/"1"', now: NOW });
    expect(bundle.entry!.map((e) => [e.request?.method, e.request?.url, e.request?.ifMatch])).toEqual([
      ["PUT", "Specimen/1", 'W/"1"'],
      ["PUT", "Task/1", 'W/"1"'],
    ]);
    const sp = entryResource<Specimen>(bundle, 0);
    expect(sp.status).toBe("available");
    expect(sp.collection?.collector?.reference).toBe("Practitioner/ns-d");
    expect(sp.collection?.collectedDateTime).toBeDefined();
    const nt = entryResource<Task>(bundle, 1);
    expect(nt.status).toBe("requested");
    expect(nt.businessStatus?.coding?.[0].code).toBe("collected");
  });
});

describe("patches", () => {
  it("accept changes status, businessStatus, owner and lastModified in one patch", () => {
    const ops = buildAcceptPatch("tech-a", NOW);
    expect(ops.map((o) => `${o.op} ${o.path}`)).toEqual(["replace /status", "add /businessStatus", "add /owner", "add /lastModified"]);
    expect(ops[0].value).toBe("accepted");
    expect((ops[1].value as { coding: { code: string }[] }).coding[0].code).toBe("received");
    expect(ops[2].value).toEqual({ reference: "PractitionerRole/tech-a" });
  });

  it("start moves to in-progress / measuring", () => {
    const ops = buildStartPatch(NOW);
    expect(ops[0]).toEqual({ op: "replace", path: "/status", value: "in-progress" });
    expect((ops[1].value as { coding: { code: string }[] }).coding[0].code).toBe("measuring");
  });
});

describe("buildFinalReportTransaction", () => {
  const sr: ServiceRequest = {
    resourceType: "ServiceRequest",
    id: "1",
    status: "active",
    intent: "order",
    subject: { reference: "Patient/demo-taro" },
    orderDetail: [{ coding: [{ code: "CBC" }] }, { coding: [{ code: "BIO" }] }],
  };
  const sp: Specimen = { resourceType: "Specimen", id: "1", collection: { collectedDateTime: "2026-10-01T09:00:00+09:00" } };
  const t: Task = { ...task(), status: "in-progress" };

  it("covers all ordered items: observations, final report, completed task and completed request", () => {
    expect(allItemKeys(sr)).toEqual(["WBC", "RBC", "Hb", "Ht", "PLT", "AST", "ALT", "Cre"]);
    const bundle = buildFinalReportTransaction({
      serviceRequest: sr, serviceRequestEtag: 'W/"1"', task: t, taskEtag: 'W/"3"', specimen: sp, techRoleId: "tech-a", now: NOW,
    });
    const obs = bundle.entry!.filter((e) => e.request?.url === "Observation");
    expect(obs).toHaveLength(8);
    const dr = bundle.entry!.find((e) => e.request?.url === "DiagnosticReport")!.resource as DiagnosticReport;
    expect(dr.status).toBe("final");
    expect(dr.result).toHaveLength(8);
    expect(dr.result![0].reference).toBe(obs[0].fullUrl);
    expect(dr.basedOn?.[0].reference).toBe("ServiceRequest/1");
    expect(dr.code?.coding?.[0].code).toBe("11502-2");

    const taskEntry = bundle.entry!.find((e) => e.request?.url === "Task/1")!;
    expect(taskEntry.request?.method).toBe("PUT");
    expect(taskEntry.request?.ifMatch).toBe('W/"3"');
    const nt = taskEntry.resource as Task;
    expect(nt.status).toBe("completed");
    expect(nt.businessStatus?.coding?.[0].code).toBe("reported");
    expect(nt.output?.[0].valueReference?.reference).toBe(bundle.entry!.find((e) => e.request?.url === "DiagnosticReport")!.fullUrl);

    const srEntry = bundle.entry!.find((e) => e.request?.url === "ServiceRequest/1")!;
    expect(srEntry.request?.ifMatch).toBe('W/"1"');
    expect((srEntry.resource as ServiceRequest).status).toBe("completed");
  });

  it("marks H / L / N from the reference range using the default values", () => {
    const bundle = buildFinalReportTransaction({
      serviceRequest: sr, serviceRequestEtag: 'W/"1"', task: t, taskEtag: 'W/"3"', specimen: sp, techRoleId: "tech-a", now: NOW,
    });
    const byName = (name: string) =>
      bundle.entry!.map((e) => e.resource as Observation).find((o) => o.resourceType === "Observation" && o.code?.text === name)!;
    expect(byName("白血球数").interpretation?.[0].coding?.[0].code).toBe("H");
    expect(byName("ALT").interpretation?.[0].coding?.[0].code).toBe("H");
    expect(byName("ヘモグロビン").interpretation?.[0].coding?.[0].code).toBe("N");
    const wbc = byName("白血球数");
    expect(wbc.valueQuantity).toMatchObject({ value: 9.8, code: "10*3/uL", system: "http://unitsofmeasure.org" });
    expect(wbc.referenceRange?.[0]).toMatchObject({ low: { value: 3.3 }, high: { value: 8.6 } });
  });

  it("uses entered values instead of the defaults", () => {
    const bundle = buildFinalReportTransaction({
      serviceRequest: sr, serviceRequestEtag: 'W/"1"', task: t, taskEtag: 'W/"3"', specimen: sp, techRoleId: "tech-a", now: NOW,
      values: { WBC: 5.0 },
    });
    const wbc = bundle.entry!.map((e) => e.resource as Observation).find((o) => o.code?.text === "白血球数")!;
    expect(wbc.valueQuantity?.value).toBe(5);
    expect(wbc.interpretation?.[0].coding?.[0].code).toBe("N");
  });

  it("updates an existing partial report to final with If-Match instead of creating a second one", () => {
    const partial: DiagnosticReport = {
      resourceType: "DiagnosticReport", id: "7", status: "partial", code: { text: "x" },
      result: [{ reference: "Observation/1" }, { reference: "Observation/2" }],
    };
    const bundle = buildFinalReportTransaction({
      serviceRequest: sr, serviceRequestEtag: 'W/"1"', task: t, taskEtag: 'W/"3"', specimen: sp, techRoleId: "tech-a", now: NOW,
      existingReport: partial, existingReportEtag: 'W/"2"', itemKeys: ["AST", "ALT", "Cre"],
    });
    const drEntry = bundle.entry!.find((e) => e.request?.url === "DiagnosticReport/7")!;
    expect(drEntry.request).toMatchObject({ method: "PUT", ifMatch: 'W/"2"' });
    const dr = drEntry.resource as DiagnosticReport;
    expect(dr.status).toBe("final");
    expect(dr.result).toHaveLength(5); // 先行の 2 件 + 今回の 3 件
    expect(bundle.entry!.filter((e) => e.request?.url === "DiagnosticReport")).toHaveLength(0);
    const nt = bundle.entry!.find((e) => e.request?.url === "Task/1")!.resource as Task;
    expect(nt.output?.[0].valueReference?.reference).toBe("DiagnosticReport/7");
  });
});

describe("judgeInterpretation", () => {
  it("compares with the reference range", () => {
    expect(judgeInterpretation(9.8, 3.3, 8.6)).toBe("H");
    expect(judgeInterpretation(2.0, 3.3, 8.6)).toBe("L");
    expect(judgeInterpretation(5, 3.3, 8.6)).toBe("N");
    expect(judgeInterpretation(8.6, 3.3, 8.6)).toBe("N");
    expect(judgeInterpretation(3.3, 3.3, 8.6)).toBe("N");
  });
});
