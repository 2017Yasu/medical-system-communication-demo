import { describe, expect, it } from "vitest";
import { diffVersions, findCause } from "../../src/monitor/history";
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

describe("diffVersions", () => {
  const task = (versionId: string, status: string, owner: string, business = "received") => ({
    resource: { resourceType: "Task", id: "1", status, owner: { reference: owner }, businessStatus: { coding: [{ code: business }] }, meta: { versionId } },
    etag: `W/"${versionId}"`,
  });
  const records = [
    { ...rec(10, "PATCH", "/fhir/Task/1", 200, "{}", { ETag: 'W/"3"' }), client: "lis-tech-a" },
    { ...rec(11, "PATCH", "/fhir/Task/1", 200, "{}", { ETag: 'W/"4"' }), client: "lis-tech-b" },
  ];
  const versions = [
    task("4", "accepted", "PractitionerRole/tech-b"),
    task("3", "accepted", "PractitionerRole/tech-a"),
    task("2", "requested", "Organization/lab-dept", "collected"),
  ] as never;

  it("marks the fields that changed from the previous version, newest first", () => {
    const diffs = diffVersions(versions, records);
    expect(diffs.map((d) => d.versionId)).toEqual(["4", "3", "2"]);
    expect(diffs[0].changed).toEqual(["owner"]);
    expect(diffs[1].changed).toEqual(["status", "businessStatus", "owner"]);
    expect(diffs[2].changed).toEqual([]); // 最古の版
  });

  it("names the screen that made each version", () => {
    const diffs = diffVersions(versions, records);
    expect(diffs[0].causeClient).toBe("lis-tech-b");
    expect(diffs[1].causeClient).toBe("lis-tech-a");
    expect(diffs[2].causeClient).toBeNull();
  });
});
