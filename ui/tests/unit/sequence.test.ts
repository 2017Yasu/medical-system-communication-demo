import { describe, expect, it } from "vitest";
import type { TrafficRecord } from "../../src/realtime/types";
import { buildSequence, clientName, laneOf, lanesFor, resultText, resourceRefsIn } from "../../src/monitor/sequenceModel";

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

describe("resultText for 400 (specs/002 R-07)", () => {
  it("tells a missing If-Match apart from other bad requests", () => {
    const body = '{"resourceType":"OperationOutcome","issue":[{"diagnostics":"更新の前提となる版（If-Match）が指定されていません"}]}';
    expect(resultText(400, body)).toBe("400 版の確認が必要");
    expect(resultText(400, '{"issue":[{"diagnostics":"Bundle.entry[1]: 参照を解決できません"}]}')).toBe("400 要求の形式が不正");
    expect(resultText(400)).toBe("400 要求の形式が不正");
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

describe("S3: radiology lane, doctor Y and Transaction annotations (specs/003 R-10)", () => {
  const tx = (seq: number, client: string, entries: unknown[], status = 200, responseBody = ""): TrafficRecord => ({
    ...http(seq, client, "POST", "/fhir", status),
    request: { method: "POST", url: "/fhir", headers: {}, body: JSON.stringify({ resourceType: "Bundle", type: "transaction", entry: entries }), truncated: false },
    response: { status, headers: {}, body: responseBody, durationMs: 5, truncated: false },
  });
  const slotPut = { resource: { resourceType: "Slot", id: "ct1-1000" }, request: { method: "PUT", url: "Slot/ct1-1000", ifMatch: 'W/"2"' } };
  const post = (type: string, resource: unknown = { resourceType: type }) => ({ resource, request: { method: "POST", url: type } });

  it("maps the new clients to lanes and names", () => {
    expect(laneOf("ris")).toBe("ris");
    expect(laneOf("ehr-doctor-y")).toBe("ehr");
    expect(laneOf("server-slot-expiry")).toBe("server");
    expect(clientName("ehr-doctor-y")).toBe("医師 Y");
    expect(clientName("ris")).toBe("放射線部門システム");
    expect(clientName("server-slot-expiry")).toBe("FHIR サーバー（仮押さえの期限切れ）");
  });

  it("annotates a Transaction that contains a slot update as version-checked", () => {
    const [withSlot] = buildSequence([tx(1, "ehr-doctor", [slotPut, post("Appointment"), post("ServiceRequest"), post("Task")])]);
    expect(withSlot.label).toBe("POST Transaction（一括登録・枠の版の確認あり）");
    const [direct] = buildSequence([tx(2, "ehr-doctor-y", [post("Appointment"), post("ServiceRequest"), post("Task")])]);
    expect(direct.label).toBe("POST Transaction（一括登録）");
  });

  it("keeps the plain label when the Transaction body is unreadable or truncated", () => {
    const record = tx(1, "ehr-doctor", []);
    record.request = { ...record.request!, body: "{ not json", truncated: true };
    expect(buildSequence([record])[0].label).toBe("POST Transaction（一括登録）");
  });

  it("chooses the lanes from the records that are shown", () => {
    const lis = buildSequence([http(1, "lis-tech-a", "GET", "/fhir/Task/1")]);
    const ris = buildSequence([http(2, "ris", "GET", "/fhir/Slot")]);
    expect(lanesFor([])).toEqual(["ehr", "server", "lis"]);
    expect(lanesFor(lis)).toEqual(["ehr", "server", "lis"]);
    expect(lanesFor(ris)).toEqual(["ehr", "server", "ris"]);
    expect(lanesFor([...lis, ...ris])).toEqual(["ehr", "server", "lis", "ris"]);
    // 通知の宛先も数える
    expect(lanesFor(buildSequence([note(3, "ris", "ris-slots", "Slot/ct1-1000/_history/2")]))).toEqual(["ehr", "server", "ris"]);
  });

  it("offers the resources updated in a Transaction, the locations in its response and the slot of an appointment as history targets", () => {
    const appointment = post("Appointment", { resourceType: "Appointment", slot: [{ reference: "Slot/ct1-1000" }] });
    const response = JSON.stringify({
      resourceType: "Bundle",
      type: "transaction-response",
      entry: [{ response: { status: "200 OK", location: "Slot/ct1-1000/_history/3" } }, { response: { status: "201 Created", location: "Appointment/1/_history/1" } }],
    });
    const refs = resourceRefsIn([tx(1, "ehr-doctor", [slotPut, appointment, post("Task")], 200, response)]);
    expect(refs).toEqual(["Appointment/1", "Slot/ct1-1000"]);
    // 直接予約：枠を一度も更新しなくても、予約が参照する枠を履歴の対象に選べる
    const direct = resourceRefsIn([tx(2, "ehr-doctor-y", [appointment, post("Task")])]);
    expect(direct).toContain("Slot/ct1-1000");
  });
});

describe("S3: the slot hold expiry as a server-side action (specs/003 R-06)", () => {
  const expiry = (seq: number): TrafficRecord => ({
    seq, timestamp: "2026-10-02T14:03:31.250+09:00", kind: "server", client: "server-slot-expiry",
    request: null, response: null, notification: null, demoEvent: null,
    serverAction: {
      action: "slot-hold-expired",
      resource: "Slot/ct1-1000/_history/3",
      before: { status: "busy-tentative", versionId: "2", comment: "仮押さえ：医師 X" },
      after: { status: "free", versionId: "3" },
      holdSeconds: 30,
    },
  });

  it("becomes a closed arrow at the FHIR server lane, named after the server rule", () => {
    const [item] = buildSequence([expiry(5)]);
    expect(item.kind).toBe("server");
    expect(item.from).toBe("server");
    expect(item.to).toBe("server");
    expect(item.operator).toBe("FHIR サーバー（仮押さえの期限切れ）");
    expect(item.label).toBe("仮押さえの期限切れ Slot/ct1-1000（仮押さえ中 → 空き、版 2 → 3）");
    expect(item.ok).toBe(true);
    expect(item.detail).toBe("サーバーの規則による自動の更新");
  });

  it("is ordered by seq together with the other records", () => {
    const items = buildSequence([note(7, "ehr-doctor", "ehr-ct-slots", "Slot/ct1-1000/_history/3"), expiry(5), http(4, "ehr-doctor", "PUT", "/fhir/Slot/ct1-1000")]);
    expect(items.map((i) => i.seq)).toEqual([4, 5, 7]);
    expect(items.map((i) => i.kind)).toEqual(["http", "server", "notification"]);
  });

  it("does not pull in the lis or ris lane by itself", () => {
    expect(lanesFor(buildSequence([expiry(5)]))).toEqual(["ehr", "server", "lis"]);
  });

  it("ignores a server record without an action", () => {
    expect(buildSequence([{ ...expiry(6), serverAction: null }])).toEqual([]);
  });

  it("puts the pharmacy department system in its own lane and names the S4 clients", () => {
    expect(laneOf("pharmacy")).toBe("pharmacy");
    expect(laneOf("pharmacy-ph-c")).toBe("pharmacy");
    expect(laneOf("ehr-nurse-f")).toBe("ehr");
    expect(clientName("pharmacy")).toBe("薬剤部門システム");
    expect(clientName("pharmacy-ph-c")).toBe("薬剤師 C");
    expect(clientName("pharmacy-ph-e")).toBe("薬剤師 E");
    expect(clientName("ehr-nurse-f")).toBe("看護師 F");
    const rx = buildSequence([http(1, "pharmacy-ph-c", "PATCH", "/fhir/Task/1")]);
    expect(lanesFor(rx)).toEqual(["ehr", "server", "pharmacy"]);
    const lab = buildSequence([http(2, "lis-tech-a", "GET", "/fhir/Task/1")]);
    expect(lanesFor([...lab, ...rx])).toEqual(["ehr", "server", "lis", "pharmacy"]);
  });
});
