import { describe, expect, it } from "vitest";
import { DEFAULT_POLICY, parseHoldSeconds, reducePolicy, type PolicyState } from "../../src/demo/policyState";

const loaded = (labSendsIfMatch: boolean, ifMatchRequired = true): PolicyState => ({
  policy: { ifMatchRequired, taskTransitionCheck: true, labSendsIfMatch, ehrUsesSlotHold: true, slotHoldSeconds: 30 },
  stale: false,
});

describe("reducePolicy", () => {
  it("takes the new value from demo.policy", () => {
    const next = reducePolicy(loaded(true), {
      type: "demo.policy",
      policy: { ifMatchRequired: false, taskTransitionCheck: true, labSendsIfMatch: false, ehrUsesSlotHold: false, slotHoldSeconds: 60 },
    });
    expect(next).toEqual({
      policy: { ifMatchRequired: false, taskTransitionCheck: true, labSendsIfMatch: false, ehrUsesSlotHold: false, slotHoldSeconds: 60 },
      stale: false,
    });
  });

  it("returns to the defaults on demo.reset", () => {
    const next = reducePolicy(loaded(false, false), { type: "demo.reset", timestamp: "2026-10-02T10:00:00+09:00" });
    expect(next.policy).toEqual(DEFAULT_POLICY);
    expect(DEFAULT_POLICY).toEqual({
      ifMatchRequired: true,
      taskTransitionCheck: true,
      labSendsIfMatch: true,
      ehrUsesSlotHold: true,
      slotHoldSeconds: 30,
    });
    expect(next.stale).toBe(false);
  });

  it("takes the defaults the server reports with demo.reset (the default hold seconds can come from its environment)", () => {
    const reported = { ifMatchRequired: true, taskTransitionCheck: true, labSendsIfMatch: true, ehrUsesSlotHold: true, slotHoldSeconds: 45 };
    const next = reducePolicy(loaded(false, false), { type: "demo.reset", timestamp: "2026-10-02T10:00:00+09:00", policy: reported });
    expect(next).toEqual({ policy: reported, stale: false });
  });

  it("asks for a refetch when the socket reconnects", () => {
    expect(reducePolicy(loaded(false), { type: "socket.open", reconnect: true }).stale).toBe(true);
    expect(reducePolicy(loaded(false), { type: "socket.open", reconnect: false }).stale).toBe(false);
  });

  it("ignores traffic", () => {
    const state = loaded(false);
    const next = reducePolicy(state, { type: "traffic", record: {} as never });
    expect(next).toBe(state);
  });
});

describe("parseHoldSeconds (the control panel accepts 10〜300 seconds; specs/003 FR-003)", () => {
  it("accepts integers from 10 to 300", () => {
    expect(parseHoldSeconds("10")).toBe(10);
    expect(parseHoldSeconds("30")).toBe(30);
    expect(parseHoldSeconds(" 300 ")).toBe(300);
  });

  it("rejects everything else", () => {
    for (const bad of ["9", "5", "0", "301", "1000", "-10", "30.5", "abc", "", "  ", "1e2", "０３０"]) {
      expect(parseHoldSeconds(bad), bad).toBeNull();
    }
  });
});
