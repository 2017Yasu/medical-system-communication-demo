import { describe, expect, it, vi } from "vitest";
import { TrafficStore } from "../../src/realtime/trafficStore";
import type { TrafficRecord } from "../../src/realtime/types";

const rec = (seq: number): TrafficRecord => ({
  seq, timestamp: "t", kind: "demo", client: "demo", request: null, response: null, notification: null, demoEvent: { event: "x" },
});

describe("TrafficStore", () => {
  it("keeps records sorted by seq and drops duplicates", () => {
    const store = new TrafficStore();
    store.add(rec(3), rec(1));
    store.add(rec(2), rec(3));
    expect(store.getSnapshot().map((r) => r.seq)).toEqual([1, 2, 3]);
    expect(store.maxSeq()).toBe(3);
  });

  it("notifies only when something changed and returns a stable snapshot otherwise", () => {
    const store = new TrafficStore();
    const listener = vi.fn();
    store.subscribe(listener);
    store.add(rec(1));
    const first = store.getSnapshot();
    store.add(rec(1));
    expect(listener).toHaveBeenCalledTimes(1);
    expect(store.getSnapshot()).toBe(first);
  });

  it("clear empties the store", () => {
    const store = new TrafficStore();
    store.add(rec(1));
    store.clear();
    expect(store.getSnapshot()).toEqual([]);
    expect(store.maxSeq()).toBe(0);
  });
});
