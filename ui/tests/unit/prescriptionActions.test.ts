import type { Bundle, MedicationRequest, Task } from "fhir/r4";
import { describe, expect, it, vi } from "vitest";
import { FhirClient, FhirError } from "../../src/fhir/client";
import {
  acceptPrescription,
  dispenseToWard,
  dispenserOf,
  handOver,
  placePrescription,
  startAudit,
  type CurrentPrescription,
} from "../../src/fhir/prescriptionActions";

const NOW = new Date("2026-10-09T10:00:00+09:00");
const phStatus = (code: string) => ({ coding: [{ system: "https://demo.example.jp/fhir/CodeSystem/pharm-business-status", code }], text: code });

const task = (version: number, status: Task["status"], owner: string, business?: string): Task => ({
  resourceType: "Task",
  id: "1",
  meta: { versionId: String(version) },
  status,
  intent: "order",
  focus: { reference: "MedicationRequest/1" },
  owner: { reference: owner },
  ...(business ? { businessStatus: phStatus(business) } : {}),
});

const mr = (status: MedicationRequest["status"] = "active", encounter?: string): MedicationRequest => ({
  resourceType: "MedicationRequest",
  id: "1",
  meta: { versionId: "1" },
  status,
  intent: "order",
  subject: { reference: encounter ? "Patient/demo-saburo" : "Patient/demo-taro" },
  ...(encounter ? { encounter: { reference: encounter } } : {}),
  medicationCodeableConcept: { text: "x" },
  dispenseRequest: { quantity: { value: 14, code: "TAB" } },
});

const versioned = <T>(resource: T, etag: string) => ({ resource, etag });

describe("dispenserOf", () => {
  const history = [
    versioned(task(4, "in-progress", "PractitionerRole/ph-e", "auditing"), 'W/"4"'),
    versioned(task(3, "in-progress", "PractitionerRole/ph-c", "dispensing"), 'W/"3"'),
    versioned(task(1, "requested", "Organization/pharmacy-dept"), 'W/"1"'),
  ];

  it("reads the owner of the last version whose business status was dispensing", () => {
    expect(dispenserOf(history)).toBe("ph-c");
  });

  it("does not depend on the order of the history", () => {
    expect(dispenserOf([...history].reverse())).toBe("ph-c");
  });

  it("returns null when nobody was dispensing", () => {
    expect(dispenserOf(history.slice(2))).toBeNull();
    expect(dispenserOf([])).toBeNull();
  });
});

interface Call {
  method: string;
  url: string;
  headers: Record<string, string>;
  body: unknown;
}

function server(options: { orders?: number; encounters?: string[]; history?: Task[]; transactionStatus?: number } = {}) {
  const calls: Call[] = [];
  const fetchFn = vi.fn(async (url: string, init: RequestInit) => {
    const method = init.method ?? "GET";
    const body = init.body ? JSON.parse(String(init.body)) : undefined;
    calls.push({ method, url, headers: init.headers as Record<string, string>, body });
    const bundle = (entries: unknown[]) => new Response(JSON.stringify({ resourceType: "Bundle", type: "searchset", entry: entries }), { status: 200 });
    if (method === "GET" && url.includes("/MedicationRequest?")) {
      return bundle(Array.from({ length: options.orders ?? 0 }, (_, i) => ({ resource: { resourceType: "MedicationRequest", id: String(i + 1) } })));
    }
    if (method === "GET" && url.includes("/Encounter?")) {
      return bundle((options.encounters ?? []).map((id) => ({ resource: { resourceType: "Encounter", id } })));
    }
    if (method === "GET" && url.includes("/_history")) {
      return bundle((options.history ?? []).map((t) => ({ resource: t })));
    }
    if (method === "PATCH") return new Response(JSON.stringify(task(2, "in-progress", "PractitionerRole/ph-c")), { status: 200, headers: { ETag: 'W/"2"' } });
    const status = options.transactionStatus ?? 200;
    if (status !== 200) {
      return new Response(JSON.stringify({ resourceType: "OperationOutcome", issue: [{ severity: "error", code: "processing", diagnostics: "x" }] }), { status });
    }
    return new Response(JSON.stringify({ resourceType: "Bundle", type: "transaction-response", entry: [] }), { status: 200 });
  });
  return { calls, client: new FhirClient("pharmacy-ph-e", "/fhir", fetchFn as unknown as typeof fetch) };
}

const current = (kind: "outpatient" | "inpatient" = "outpatient"): CurrentPrescription => ({
  mr: versioned(mr("active", kind === "inpatient" ? "Encounter/adm-saburo" : undefined), 'W/"1"'),
  task: versioned(task(3, "in-progress", "PractitionerRole/ph-e", "auditing"), 'W/"3"'),
});

const REQUIRED_HISTORY = [
  task(4, "in-progress", "PractitionerRole/ph-e", "auditing"),
  task(3, "in-progress", "PractitionerRole/ph-c", "dispensing"),
  task(1, "requested", "Organization/pharmacy-dept"),
];

describe("placePrescription", () => {
  it("numbers the order from the doctor's existing prescriptions and sends one transaction (outpatient)", async () => {
    const s = server({ orders: 2 });
    await placePrescription(s.client, "dr-x", { patientId: "demo-taro", medicationKey: "amlodipine", doseValue: 1, days: 14 }, NOW);
    const tx = s.calls.find((c) => c.method === "POST")!;
    const entries = (tx.body as Bundle).entry!;
    expect(entries.map((e) => e.request?.url)).toEqual(["MedicationRequest", "Task"]);
    expect((entries[0].resource as MedicationRequest).identifier?.[2].value).toBe("P-20261009-0003");
    expect((entries[0].resource as MedicationRequest).encounter).toBeUndefined();
    expect(s.calls.some((c) => c.url.includes("/MedicationRequest?requester=Practitioner%2Fdr-x") || c.url.includes("/MedicationRequest?requester=Practitioner/dr-x"))).toBe(true);
  });

  it("links an inpatient to the admission found for the patient", async () => {
    const s = server({ encounters: ["adm-saburo"] });
    await placePrescription(s.client, "dr-y", { patientId: "demo-saburo", medicationKey: "loxoprofen", doseValue: 1, days: 3 }, NOW);
    const entries = (s.calls.find((c) => c.method === "POST")!.body as Bundle).entry!;
    expect((entries[0].resource as MedicationRequest).encounter?.reference).toBe("Encounter/adm-saburo");
    expect((entries[0].resource as MedicationRequest).category?.[0].coding?.[0].code).toBe("IHP");
  });
});

describe("accept and audit", () => {
  it("patch the task with the version of the row (one operation, no extra GET)", async () => {
    const s = server();
    const cur: CurrentPrescription = { ...current(), task: versioned(task(1, "requested", "Organization/pharmacy-dept"), 'W/"1"') };
    await acceptPrescription(s.client, cur, "ph-c", NOW);
    expect(s.calls).toHaveLength(1);
    expect(s.calls[0]).toMatchObject({ method: "PATCH" });
    expect(s.calls[0].url).toBe("/fhir/Task/1");
    expect(s.calls[0].headers["If-Match"]).toBe('W/"1"');
    await startAudit(s.client, current(), "ph-e", NOW);
    expect(s.calls[1].headers["If-Match"]).toBe('W/"3"');
    expect((s.calls[1].body as { path: string }[]).map((o) => o.path)).toEqual(["/businessStatus", "/owner", "/lastModified"]);
  });
});

describe("handOver and dispenseToWard", () => {
  it("reads the task history first, then sends the 3-entry transaction (outpatient)", async () => {
    const s = server({ history: REQUIRED_HISTORY });
    await handOver(s.client, current(), "ph-e", NOW);
    expect(s.calls.map((c) => `${c.method} ${c.url}`)).toEqual(["GET /fhir/Task/1/_history", "POST /fhir"]);
    const entries = (s.calls[1].body as Bundle).entry!;
    expect(entries.map((e) => `${e.request?.method} ${e.request?.url}`)).toEqual(["POST MedicationDispense", "PUT Task/1", "PUT MedicationRequest/1"]);
    expect(entries[1].request?.ifMatch).toBe('W/"3"');
    expect(JSON.stringify(entries[0].resource)).toContain("PractitionerRole/ph-c");
  });

  it("sends the 2-entry transaction for an inpatient", async () => {
    const s = server({ history: REQUIRED_HISTORY });
    await dispenseToWard(s.client, current("inpatient"), "ph-e", NOW);
    const entries = (s.calls[1].body as Bundle).entry!;
    expect(entries.map((e) => `${e.request?.method} ${e.request?.url}`)).toEqual(["POST MedicationDispense", "PUT Task/1"]);
  });

  it("does not send the transaction when the dispensing pharmacist cannot be read", async () => {
    const s = server({ history: [task(1, "requested", "Organization/pharmacy-dept")] });
    await expect(handOver(s.client, current(), "ph-e", NOW)).rejects.toMatchObject({
      display: { text: "調剤した薬剤師が分かりません（作業の版の履歴に調剤中の記録がありません）" },
    });
    expect(s.calls.every((c) => c.method === "GET")).toBe(true);
  });

  it("turns a 412 into the cancelled-as-a-whole message", async () => {
    const s = server({ history: REQUIRED_HISTORY, transactionStatus: 412 });
    const error = await handOver(s.client, current(), "ph-e", NOW).catch((e) => e);
    expect(error).toBeInstanceOf(FhirError);
    expect(error.status).toBe(412);
    expect(error.display.message).toContain("お渡しは取り消されました");
    const ward = await dispenseToWard(s.client, current("inpatient"), "ph-e", NOW).catch((e) => e);
    expect(ward.display.message).toContain("払出は取り消されました");
  });

  it("keeps the server's 422 as it is", async () => {
    const s = server({ history: REQUIRED_HISTORY, transactionStatus: 422 });
    const error = await handOver(s.client, current(), "ph-e", NOW).catch((e) => e);
    expect(error.display.message).toBe("この状態からはお渡しできません");
  });
});
