import { describe, expect, it } from "vitest";
import { DEFAULT_POLICY, reducePolicy, type PolicyState } from "../../src/demo/policyState";

const loaded = (labSendsIfMatch: boolean, ifMatchRequired = true): PolicyState => ({
  policy: { ifMatchRequired, taskTransitionCheck: true, labSendsIfMatch },
  stale: false,
});

describe("reducePolicy", () => {
  it("takes the new value from demo.policy", () => {
    const next = reducePolicy(loaded(true), {
      type: "demo.policy",
      policy: { ifMatchRequired: false, taskTransitionCheck: true, labSendsIfMatch: false },
    });
    expect(next).toEqual({ policy: { ifMatchRequired: false, taskTransitionCheck: true, labSendsIfMatch: false }, stale: false });
  });

  it("returns to the defaults on demo.reset", () => {
    const next = reducePolicy(loaded(false, false), { type: "demo.reset", timestamp: "2026-10-02T10:00:00+09:00" });
    expect(next.policy).toEqual(DEFAULT_POLICY);
    expect(DEFAULT_POLICY).toEqual({ ifMatchRequired: true, taskTransitionCheck: true, labSendsIfMatch: true });
    expect(next.stale).toBe(false);
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
