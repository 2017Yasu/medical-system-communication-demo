import { describe, expect, it } from "vitest";
import { stageTargets } from "../../src/app/stageRoles";
import type { Scenario, ScenarioStep } from "../../src/scenario/types";

const noop = { business: "b", fhir: "f" };
const step = (no: number, target: ScenarioStep["target"], actor: ScenarioStep["actor"] = "auto"): ScenarioStep => ({
  no,
  title: `s${no}`,
  actor,
  target,
  expected: {},
  explanation: noop,
});

function s4(kind: "outpatient" | "inpatient"): Scenario {
  return {
    id: kind === "outpatient" ? "s4-outpatient" : "s4-inpatient",
    title: "s4",
    stage: "pharmacy",
    steps: [
      step(1, { screen: "ehr", role: kind === "outpatient" ? "dr-x" : "dr-y" }),
      step(2, { screen: "pharmacy" }),
      step(3, { screen: "pharmacy", pharmacist: "ph-c" }),
      step(4, { screen: "pharmacy", pharmacist: "ph-e" }),
      step(5, { screen: "pharmacy", pharmacist: "ph-e" }),
      step(6, { screen: "ehr", role: kind === "outpatient" ? "dr-x" : "ns-f" }),
    ],
  };
}

describe("stageTargets (specs/004 data-model.md §5)", () => {
  it("presentation mode follows the step being explained (the last completed one)", () => {
    const out = s4("outpatient");
    expect(stageTargets(out, 0, "presentation")).toEqual({ role: "dr-x", pharmacist: undefined });
    expect(stageTargets(out, 3, "presentation")).toEqual({ role: "dr-x", pharmacist: "ph-c" });
    expect(stageTargets(out, 4, "presentation")).toEqual({ role: "dr-x", pharmacist: "ph-e" });
    expect(stageTargets(out, 6, "presentation")).toEqual({ role: "dr-x", pharmacist: "ph-e" });
  });

  it("switches the inpatient electronic record to nurse F once the ward step has completed", () => {
    const inn = s4("inpatient");
    expect(stageTargets(inn, 5, "presentation").role).toBe("dr-y");
    expect(stageTargets(inn, 6, "presentation").role).toBe("ns-f");
  });

  it("self-study follows the next step but never switches the pharmacist (the learner does)", () => {
    const inn = s4("inpatient");
    expect(stageTargets(inn, 4, "self-study")).toEqual({ role: "dr-y", pharmacist: undefined });
    expect(stageTargets(inn, 5, "self-study")).toEqual({ role: "ns-f", pharmacist: undefined });
    expect(stageTargets(inn, 6, "self-study").role).toBe("ns-f");
  });

  it("does not touch the lab stage in presentation mode (S1 is unchanged)", () => {
    const lab: Scenario = { id: "s1-main", title: "s1", steps: [step(1, { screen: "ehr", role: "nurse" })] };
    expect(stageTargets(lab, 0, "presentation")).toEqual({});
    expect(stageTargets({ ...lab, stage: "lab" }, 1, "presentation")).toEqual({});
  });
});
