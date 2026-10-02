import { describe, expect, it } from "vitest";
import type { TrafficRecord } from "../../src/realtime/types";
import { buildSequence, clientName, laneOf, resultText, resourceRefsIn } from "../../src/monitor/sequenceModel";

function http(seq: number, client: string, method: string, url: string, status = 200, extra: Partial<TrafficRecord> = {}): TrafficRecord {
  return {
    seq,
    timestamp: "2026-10-01T10:00:00+09:00",
    kind: "http",
    client,
    request: { method, url, headers: {}, body: "", truncated: false },
    response: { status, headers: {}, body: "", durationMs: 5, truncated: false },
    notification: null,
    demoEvent: null,
    ...extra,
  };
}

function note(seq: number, target: string, sub: string, resource = "Task/1/_history/2"): TrafficRecord {
  return {
    seq, timestamp: "t", kind: "notification", client: "server", request: null, response: null,
    notification: { subscriptionId: sub, targetClient: target, resource }, demoEvent: null,
  };
}

describe("lanes and names (contracts/ui-screens.md)", () => {
  it("maps clients to lanes", () => {
    expect(laneOf("ehr-doctor")).toBe("ehr");
    expect(laneOf("ehr-nurse")).toBe("ehr");
    expect(laneOf("lis-tech-a")).toBe("lis");
    expect(laneOf("lis-tech-b")).toBe("lis");
    expect(laneOf("monitor")).toBe("monitor");
    expect(laneOf("unknown")).toBe("other");
  });

  it("names the operator", () => {
    expect(clientName("ehr-doctor")).toBe("医師 X");
    expect(clientName("ehr-nurse")).toBe("看護師 D");
    expect(clientName("lis-tech-a")).toBe("技師 A");
    expect(clientName("lis-tech-b")).toBe("技師 B");
  });
});

describe("buildSequence", () => {
  it("draws a request as an arrow from the client lane to the server with the result", () => {
    const [item] = buildSequence([http(1, "ehr-doctor", "POST", "/fhir")]);
    expect(item.from).toBe("ehr");
    expect(item.to).toBe("server");
    expect(item.label).toBe("POST Transaction（一括登録）");
    expect(item.operator).toBe("医師 X");
    expect(item.ok).toBe(true);
    expect(item.result).toBe("200 成功");
  });

  it("labels the common operations", () => {
    const labels = buildSequence([
      http(1, "lis-tech-a", "PATCH", "/fhir/Task/1"),
      http(2, "ehr-doctor", "GET", "/fhir/Task?requester=Practitioner%2Fdr-x"),
      http(3, "ehr-doctor", "GET", "/fhir/Task/1"),
      http(4, "monitor", "GET", "/fhir/Task/1/_history"),
      http(5, "lis-tech-a", "PUT", "/fhir/Subscription/lis-lab-dept", 201),
    ], { showMonitor: true }).map((i) => i.label);
    expect(labels).toEqual(["PATCH Task/1（If-Match なし）", "GET Task を検索", "GET Task/1", "GET Task/1 の履歴", "PUT Subscription/lis-lab-dept（通知の登録）"]);
  });

  it("draws a notification from the server to the target screen's lane", () => {
    const [item] = buildSequence([note(2, "lis-tech-a", "lis-lab-dept")]);
    expect(item.from).toBe("server");
    expect(item.to).toBe("lis");
    expect(item.label).toBe("ping lis-lab-dept");
    expect(item.operator).toBe("技師 A");
    expect(item.detail).toBe("Task/1/_history/2");
  });

  it("sorts by seq even if the input is out of order (a ping can be delivered before its cause)", () => {
    const items = buildSequence([note(2, "lis-tech-a", "lis-lab-dept"), http(1, "ehr-doctor", "POST", "/fhir")]);
    expect(items.map((i) => i.seq)).toEqual([1, 2]);
  });

  it("hides the monitor's own traffic by default but keeps it when asked", () => {
    const records = [http(1, "ehr-doctor", "GET", "/fhir/Task/1"), http(2, "monitor", "GET", "/fhir/Task/1/_history")];
    expect(buildSequence(records)).toHaveLength(1);
    expect(buildSequence(records, { showMonitor: true })).toHaveLength(2);
  });

  it("marks failures and uses the business meaning of the result", () => {
    const items = buildSequence([http(1, "lis-tech-b", "PATCH", "/fhir/Task/1", 412), http(2, "lis-tech-b", "PATCH", "/fhir/Task/1", 400)]);
    expect(items[0].ok).toBe(false);
    expect(items[0].result).toBe("412 他の利用者が先に更新済み");
    expect(items[1].result).toBe("400 要求の形式が不正");
  });

  it("shows reset and policy events as full-width markers", () => {
    const reset: TrafficRecord = { seq: 1, timestamp: "t", kind: "demo", client: "demo", request: null, response: null, notification: null, demoEvent: { event: "reset" } };
    const [item] = buildSequence([reset]);
    expect(item.kind).toBe("demo");
    expect(item.label).toBe("初期化");
  });
});

describe("resultText", () => {
  it("maps statuses (docs/04 HTTP ステータス)", () => {
    expect(resultText(200)).toBe("200 成功");
    expect(resultText(201)).toBe("201 成功");
    expect(resultText(404)).toBe("404 対象が見つからない");
    expect(resultText(422)).toBe("422 業務ルール違反");
    expect(resultText(500)).toBe("500 サーバーエラー");
  });
});

describe("resourceRefsIn", () => {
  it("collects the resources that appeared in requests, without duplicates", () => {
    const refs = resourceRefsIn([
      http(1, "ehr-doctor", "GET", "/fhir/Task/1"),
      http(2, "lis-tech-a", "PATCH", "/fhir/Task/1"),
      http(3, "ehr-doctor", "GET", "/fhir/ServiceRequest/2/_history"),
      http(4, "ehr-doctor", "GET", "/fhir/Task?status=requested"),
    ]);
    expect(refs).toEqual(["ServiceRequest/2", "Task/1"]);
  });
});

describe("version check annotations and 400/412 results (specs/002 R-07)", () => {
  const withHeaders = (r: TrafficRecord, headers: Record<string, string>): TrafficRecord => ({ ...r, request: { ...r.request!, headers } });

  it("shows the If-Match value on PATCH and PUT", () => {
    const [item] = buildSequence([withHeaders(http(1, "lis-tech-a", "PATCH", "/fhir/Task/1"), { "If-Match": 'W/"2"' })]);
    expect(item.label).toBe('PATCH Task/1（If-Match: W/"2"）');
  });

  it("shows when there is no If-Match", () => {
    const [item] = buildSequence([http(1, "lis-tech-a", "PATCH", "/fhir/Task/1")]);
    expect(item.label).toBe("PATCH Task/1（If-Match なし）");
    const [put] = buildSequence([http(2, "lis-tech-a", "PUT", "/fhir/Task/1")]);
    expect(put.label).toBe("PUT Task/1（If-Match なし）");
  });

  it("looks the header up regardless of case and leaves GET and Transaction alone", () => {
    const [item] = buildSequence([withHeaders(http(1, "lis-tech-b", "PATCH", "/fhir/Task/1"), { "if-match": 'W/"7"' })]);
    expect(item.label).toContain('If-Match: W/"7"');
    expect(buildSequence([http(2, "lis-tech-a", "GET", "/fhir/Task/1")])[0].label).toBe("GET Task/1");
    expect(buildSequence([http(3, "ehr-doctor", "POST", "/fhir")])[0].label).toBe("POST Transaction（一括登録）");
  });
});
