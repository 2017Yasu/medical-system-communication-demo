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

describe("S3: slot history (specs/003 R-10)", () => {
  const slot = (versionId: string, status: string, comment?: string) => ({
    resource: { resourceType: "Slot", id: "ct1-1000", status, ...(comment ? { comment } : {}), meta: { versionId } },
    etag: `W/"${versionId}"`,
  });
  const expiry = (seq: number, resource: string): TrafficRecord => ({
    seq, timestamp: "t", kind: "server", client: "server-slot-expiry",
    request: null, response: null, notification: null, demoEvent: null,
    serverAction: {
      action: "slot-hold-expired",
      resource,
      before: { status: "busy-tentative", versionId: "2", comment: "仮押さえ：医師 X" },
      after: { status: "free", versionId: "3" },
      holdSeconds: 30,
    },
  });
  const records = [
    { ...rec(20, "PUT", "/fhir/Slot/ct1-1000", 200, "{}", { ETag: 'W/"2"' }), client: "ehr-doctor" },
    expiry(21, "Slot/ct1-1000/_history/3"),
  ];
  const versions = [slot("3", "free"), slot("2", "busy-tentative", "仮押さえ：医師 X"), slot("1", "free")] as never;

  it("reports status and comment (holder) changes of a slot", () => {
    const diffs = diffVersions(versions, records);
    expect(diffs.map((d) => d.changed)).toEqual([["status", "comment"], ["status", "comment"], []]);
  });

  it("does not report a comment change for tasks", () => {
    const task = (versionId: string, status: string) => ({
      resource: { resourceType: "Task", id: "1", status, meta: { versionId } },
      etag: `W/"${versionId}"`,
    });
    const diffs = diffVersions([task("2", "accepted"), task("1", "requested")] as never, []);
    expect(diffs[0].changed).toEqual(["status"]);
  });

  it("finds the server-side expiry as the cause of the version it created", () => {
    expect(findCause(records, "Slot", "ct1-1000", "3")?.kind).toBe("server");
    expect(findCause(records, "Slot", "ct1-1000", "3")?.client).toBe("server-slot-expiry");
    expect(findCause(records, "Slot", "ct1-1000", "2")?.client).toBe("ehr-doctor");
    const diffs = diffVersions(versions, records);
    expect(diffs[0].causeClient).toBe("server-slot-expiry");
    expect(diffs[1].causeClient).toBe("ehr-doctor");
  });
});
