import { describe, expect, it } from "vitest";
import { CHANGE_TTL_MS, diffRows, mergeChanges, pruneChanges } from "../../src/systems/shared/rowChanges";
import type { OrderRow } from "../../src/systems/shared/orders";

function row(srId: string, status: string, business: string, owner: string): OrderRow {
  return {
    sr: { resource: { resourceType: "ServiceRequest", id: srId, status: "active", intent: "order", subject: {} }, etag: 'W/"1"' },
    task: {
      resource: {
        resourceType: "Task",
        id: `t${srId}`,
        status,
        intent: "order",
        businessStatus: { coding: [{ system: "http://example.jp/CodeSystem/lab-business-status", code: business }] },
        owner: { reference: owner },
      } as never,
      etag: 'W/"2"',
    },
    patientName: "デモ 太郎",
  };
}

const collected = (owner = "Organization/lab-dept") => row("1", "requested", "collected", owner);

describe("diffRows", () => {
  it("reports only the owner when only the owner changed", () => {
    const prev = [row("1", "accepted", "received", "PractitionerRole/tech-a")];
    const next = [row("1", "accepted", "received", "PractitionerRole/tech-b")];
    expect(diffRows(prev, next)).toEqual([{ srId: "1", fields: [{ field: "owner", before: "技師 A", after: "技師 B" }] }]);
  });

  it("reports status, business status and owner with display labels", () => {
    const changes = diffRows([collected()], [row("1", "accepted", "received", "PractitionerRole/tech-a")]);
    expect(changes).toHaveLength(1);
    const byField = Object.fromEntries(changes[0].fields.map((f) => [f.field, f]));
    expect(byField.status).toEqual({ field: "status", before: "依頼済み requested", after: "受付済み accepted" });
    expect(byField.businessStatus.before).toBe("採取済");
    expect(byField.businessStatus.after).toBe("検体到着");
    expect(byField.owner).toEqual({ field: "owner", before: "検査部", after: "技師 A" });
  });

  it("does not compare on the first display (no previous rows)", () => {
    expect(diffRows(null, [collected()])).toEqual([]);
  });

  it("ignores rows that appeared or disappeared", () => {
    expect(diffRows([collected()], [row("2", "requested", "collected", "Organization/lab-dept")])).toEqual([]);
  });

  it("reports nothing when nothing changed", () => {
    expect(diffRows([collected()], [collected()])).toEqual([]);
  });
});

describe("change retention", () => {
  const change = (srId: string) => ({ srId, fields: [{ field: "owner" as const, before: "技師 A", after: "技師 B" }] });

  it("keeps a change for 10 seconds and then drops it", () => {
    expect(CHANGE_TTL_MS).toBe(10_000);
    const kept = mergeChanges([], [change("1")], 1_000);
    expect(pruneChanges(kept, 1_000 + 9_999)).toHaveLength(1);
    expect(pruneChanges(kept, 1_000 + 10_000)).toHaveLength(0);
  });

  it("replaces the earlier change of the same row with the newer one", () => {
    const first = mergeChanges([], [change("1")], 0);
    const second = mergeChanges(first, [{ srId: "1", fields: [{ field: "status", before: "a", after: "b" }] }], 5_000);
    expect(second).toHaveLength(1);
    expect(second[0].fields[0].field).toBe("status");
    expect(second[0].detectedAt).toBe(5_000);
  });
});
