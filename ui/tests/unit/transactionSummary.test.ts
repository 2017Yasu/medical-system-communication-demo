import { describe, expect, it } from "vitest";
import { summarizeTransaction } from "../../src/monitor/transactionSummary";

const request = JSON.stringify({
  resourceType: "Bundle",
  type: "transaction",
  entry: [
    { resource: { resourceType: "Slot", id: "ct1-1000" }, request: { method: "PUT", url: "Slot/ct1-1000", ifMatch: 'W/"2"' } },
    { resource: { resourceType: "Appointment" }, request: { method: "POST", url: "Appointment" } },
    { resource: { resourceType: "ServiceRequest" }, request: { method: "POST", url: "ServiceRequest" } },
    { resource: { resourceType: "Task" }, request: { method: "POST", url: "Task" } },
  ],
});

const success = JSON.stringify({
  resourceType: "Bundle",
  type: "transaction-response",
  entry: [
    { response: { status: "200 OK", location: "Slot/ct1-1000/_history/3" } },
    { response: { status: "201 Created", location: "Appointment/1/_history/1" } },
    { response: { status: "201 Created", location: "ServiceRequest/1/_history/1" } },
    { response: { status: "201 Created", location: "Task/1/_history/1" } },
  ],
});

const failure = JSON.stringify({
  resourceType: "OperationOutcome",
  issue: [
    {
      severity: "error",
      code: "processing",
      diagnostics: "Bundle.entry[0]（PUT Slot/ct1-1000）: 他の利用者が先に更新しました（Slot/ct1-1000 の現在の版: 3、指定された版: 2）",
      expression: ["Bundle.entry[0]"],
    },
  ],
});

describe("summarizeTransaction", () => {
  it("lists each entry of a successful transaction with its version check and result", () => {
    const s = summarizeTransaction(request, 200, success)!;
    expect(s.cancelledAll).toBe(false);
    expect(s.failedIndex).toBeNull();
    expect(s.rows).toEqual([
      { index: 0, request: "PUT Slot/ct1-1000", ifMatch: 'W/"2"', result: "200 OK → Slot/ct1-1000", state: "ok" },
      { index: 1, request: "POST Appointment", ifMatch: null, result: "201 Created → Appointment/1", state: "ok" },
      { index: 2, request: "POST ServiceRequest", ifMatch: null, result: "201 Created → ServiceRequest/1", state: "ok" },
      { index: 3, request: "POST Task", ifMatch: null, result: "201 Created → Task/1", state: "ok" },
    ]);
  });

  it("marks the failed entry and cancels the others when the transaction fails (412)", () => {
    const s = summarizeTransaction(request, 412, failure)!;
    expect(s.cancelledAll).toBe(true);
    expect(s.failedIndex).toBe(0);
    expect(s.rows.map((r) => r.state)).toEqual(["failed", "cancelled", "cancelled", "cancelled"]);
    expect(s.rows[0].result).toBe("失敗（412）");
    expect(s.rows[1].result).toBe("取り消し（登録されていない）");
  });

  it("cancels every entry when the failed entry cannot be identified", () => {
    const s = summarizeTransaction(request, 400, JSON.stringify({ resourceType: "OperationOutcome", issue: [{ severity: "error", code: "invalid" }] }))!;
    expect(s.cancelledAll).toBe(true);
    expect(s.failedIndex).toBeNull();
    expect(s.rows.every((r) => r.state === "cancelled")).toBe(true);
  });

  it("returns null for anything that is not a transaction request (or a truncated body)", () => {
    expect(summarizeTransaction("", 200, "")).toBeNull();
    expect(summarizeTransaction("{not json", 200, success)).toBeNull();
    expect(summarizeTransaction(JSON.stringify({ resourceType: "Task" }), 200, "{}")).toBeNull();
    expect(summarizeTransaction(JSON.stringify({ resourceType: "Bundle", type: "searchset" }), 200, "{}")).toBeNull();
  });

  it("falls back to the entry's own status when the response body cannot be read", () => {
    const s = summarizeTransaction(request, 200, "")!;
    expect(s.rows[0].result).toBe("—");
    expect(s.cancelledAll).toBe(false);
  });
});
