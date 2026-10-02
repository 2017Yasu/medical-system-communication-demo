import { describe, expect, it, vi } from "vitest";
import { FhirError } from "../../src/fhir/client";
import { toDisplayError } from "../../src/fhir/errors";
import { prepareScenario, S2_PRESETS, S3_PRESETS, type PrepareDeps, type PrepareStage } from "../../src/demo/prepare";

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

describe("prepareScenario for S3 (specs/003 research R-11)", () => {
  it("resets and switches the booking method, without sending any FHIR request", async () => {
    const log: string[] = [];
    const stages: PrepareStage[] = [];
    const result = await prepareScenario("s3-1", deps(log), (s) => stages.push(s));
    expect(log).toEqual(["reset", `policy:${JSON.stringify({ ehrUsesSlotHold: false })}`]);
    expect(stages).toEqual(["reset", "policy", "done"]);
    expect(result).toEqual({ stage: "done", error: null });
  });

  it("uses the booking method of each scenario (data-model.md §4)", () => {
    expect(S3_PRESETS["s3-1"]).toEqual({ ehrUsesSlotHold: false });
    expect(S3_PRESETS["s3-2"]).toEqual({ ehrUsesSlotHold: true });
    expect(S3_PRESETS["s3-3"]).toEqual({ ehrUsesSlotHold: true });
  });

  it("does not send the order or the collection for s3-2 and s3-3", async () => {
    for (const id of ["s3-2", "s3-3"] as const) {
      const log: string[] = [];
      await prepareScenario(id, deps(log));
      expect(log).toEqual(["reset", `policy:${JSON.stringify({ ehrUsesSlotHold: true })}`]);
    }
  });

  it("stops at reset without switching the setting when the reset fails", async () => {
    const log: string[] = [];
    const result = await prepareScenario("s3-2", deps(log, { resetDemo: async () => { throw new Error("初期化に失敗しました（500）"); } }));
    expect(result.stage).toBe("reset");
    expect(result.error?.text).toContain("初期化に失敗しました");
    expect(log).toEqual([]);
  });

  it("keeps the S2 behaviour unchanged", async () => {
    const log: string[] = [];
    await prepareScenario("s2-2", deps(log));
    expect(log).toEqual(["reset", `policy:${JSON.stringify(S2_PRESETS["s2-2"])}`, "order", "collect"]);
  });
});
