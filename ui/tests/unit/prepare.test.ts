import { describe, expect, it, vi } from "vitest";
import { FhirError } from "../../src/fhir/client";
import { toDisplayError } from "../../src/fhir/errors";
import { prepareScenario, S2_PRESETS, type PrepareDeps, type PrepareStage } from "../../src/demo/prepare";

function deps(log: string[], overrides: Partial<PrepareDeps> = {}): PrepareDeps {
  return {
    resetDemo: async () => void log.push("reset"),
    putPolicy: async (p) => void log.push(`policy:${JSON.stringify(p)}`),
    placeOrder: async () => void log.push("order"),
    recordCollection: async () => void log.push("collect"),
    ...overrides,
  };
}

describe("prepareScenario", () => {
  it("resets, sets the policy, orders and collects in this order, reporting each stage", async () => {
    const log: string[] = [];
    const stages: PrepareStage[] = [];
    const result = await prepareScenario("s2-1", deps(log), (s) => stages.push(s));
    expect(log).toEqual(["reset", `policy:${JSON.stringify({ ifMatchRequired: false, labSendsIfMatch: false })}`, "order", "collect"]);
    expect(stages).toEqual(["reset", "policy", "order", "collect", "done"]);
    expect(result).toEqual({ stage: "done", error: null });
  });

  it("uses the policy of each scenario", () => {
    expect(S2_PRESETS["s2-1"]).toEqual({ ifMatchRequired: false, labSendsIfMatch: false });
    expect(S2_PRESETS["s2-2"]).toEqual({ ifMatchRequired: true, labSendsIfMatch: true });
    expect(S2_PRESETS["s2-3"]).toEqual({ ifMatchRequired: true, labSendsIfMatch: false });
  });

  it("stops at the failed stage without sending the later requests", async () => {
    const log: string[] = [];
    const failure = new FhirError(toDisplayError({ status: 422 }, "検査の依頼"), 422, null);
    const result = await prepareScenario("s2-2", deps(log, { placeOrder: vi.fn(async () => { throw failure; }) }));
    expect(result.stage).toBe("order");
    expect(result.error?.kind).toBe("rule");
    expect(log).not.toContain("collect");
  });

  it("reports a network-style error for failures that are not FHIR errors", async () => {
    const result = await prepareScenario("s2-3", deps([], { resetDemo: async () => { throw new Error("初期化に失敗しました（500）"); } }));
    expect(result.stage).toBe("reset");
    expect(result.error?.text).toContain("初期化に失敗しました");
  });
});
