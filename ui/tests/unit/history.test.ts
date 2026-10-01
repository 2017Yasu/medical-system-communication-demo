import { describe, expect, it } from "vitest";
import { findCause } from "../../src/monitor/history";
import type { TrafficRecord } from "../../src/realtime/types";

function rec(seq: number, method: string, url: string, status: number, body = "", headers: Record<string, string> = {}): TrafficRecord {
  return {
    seq, timestamp: "t", kind: "http", client: "lis-tech-a",
    request: { method, url, headers: {}, body: "", truncated: false },
    response: { status, headers, body, durationMs: 1, truncated: false },
    notification: null, demoEvent: null,
  };
}

describe("findCause", () => {
  const records = [
    rec(1, "POST", "/fhir", 200, '{"entry":[{"response":{"location":"Task/1/_history/1"}},{"response":{"location":"ServiceRequest/1/_history/1"}}]}'),
    rec(2, "PATCH", "/fhir/Task/1", 200, "{}", { ETag: 'W/"2"' }),
    rec(3, "PATCH", "/fhir/Task/1", 412, "{}"),
    rec(4, "POST", "/fhir", 200, '{"entry":[{"response":{"location":"ServiceRequest/1/_history/2"}},{"response":{"location":"Task/1/_history/3"}}]}'),
    rec(5, "GET", "/fhir/Task/1", 200, '{"meta":{"versionId":"3"}}', { ETag: 'W/"3"' }),
  ];

  it("finds the transaction that created or updated a version", () => {
    expect(findCause(records, "Task", "1", "1")?.seq).toBe(1);
    expect(findCause(records, "ServiceRequest", "1", "2")?.seq).toBe(4);
  });

  it("finds a single PATCH by its ETag", () => {
    expect(findCause(records, "Task", "1", "2")?.seq).toBe(2);
  });

  it("ignores failed requests and reads", () => {
    expect(findCause(records, "Task", "1", "9")).toBeUndefined();
    expect(findCause(records, "Task", "1", "3")?.seq).toBe(4);
  });
});
