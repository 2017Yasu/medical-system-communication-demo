import { readFileSync, readdirSync, statSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { controlsOf } from "../../src/guide/useGuide";
import { SCENARIOS } from "../../src/scenario/ScenarioProvider";

const walk = (d: string): string[] => readdirSync(d).flatMap((f) => (statSync(join(d, f)).isDirectory() ? walk(join(d, f)) : [join(d, f)]));
const source = walk("src").filter((f) => f.endsWith(".tsx")).map((f) => readFileSync(f, "utf8")).join("\n");

/** data-guide="x" または data-guide={`prefix-${...}`} として画面に存在するか。 */
function existsInScreens(control: string): boolean {
  if (source.includes(`data-guide="${control}"`)) return true;
  const prefix = control.replace(/-(\d+|CBC|BIO|AST|ALT|Cre)$/, "-");
  // 薬剤部門システムのように、操作の種類で data-guide を切り替える場合は、`prefix${id}` の形で式の中にある
  return source.includes(`data-guide={\`${prefix}$`) || source.includes(`\`${prefix}$` + "{");
}

describe.each(SCENARIOS)("scenario $id", (scenario) => {
  it("has sequential step numbers and a title", () => {
    expect(scenario.title).not.toBe("");
    expect(scenario.steps.map((s) => s.no)).toEqual(scenario.steps.map((_, i) => i + 1));
  });

  it("every step has a traffic condition and an explanation for both audiences", () => {
    for (const s of scenario.steps) {
      expect(s.expected.traffic?.length, `${scenario.id} step ${s.no} traffic`).toBeGreaterThan(0);
      expect(s.explanation.business.length).toBeGreaterThan(10);
      expect(s.explanation.fhir.length).toBeGreaterThan(10);
    }
  });

  it("automatic steps have no run; the others do", () => {
    for (const s of scenario.steps) {
      if (s.actor === "auto") expect(s.run, `step ${s.no}`).toBeUndefined();
      else expect(s.run, `step ${s.no}`).toBeTypeOf("function");
    }
  });

  it("automatic steps wait for a notification; acting steps expect a write by their actor", () => {
    for (const s of scenario.steps) {
      const kinds = (s.expected.traffic ?? []).map((t) => t.kind);
      if (s.actor === "auto") expect(kinds).toContain("notification");
      else if (s.no !== scenario.steps.length || scenario.id !== "s1-main") {
        expect(s.expected.traffic?.some((t) => t.kind === "http" && t.client === s.actor), `step ${s.no}`).toBe(true);
      }
    }
  });

  it("every guided control exists in the screens", () => {
    for (const s of scenario.steps) {
      for (const c of controlsOf(s)) expect(existsInScreens(c), `${scenario.id} step ${s.no}: ${c}`).toBe(true);
    }
  });

  it("starts from a state where the first step is not yet done", () => {
    expect(scenario.steps[0].expected.task?.status).toBe("requested");
    expect(["ehr-doctor", "ehr-doctor-y"]).toContain(scenario.steps[0].actor);
  });
});

describe("scenario list", () => {
  it("offers the main flow, the four variations (FR-030) and the two S4 scenarios", () => {
    expect(SCENARIOS.map((s) => s.id)).toEqual(["s1-main", "s1-cancel", "s1-reject", "s1-rerun", "s1-partial", "s4-outpatient", "s4-inpatient"]);
  });
});

// S4 処方調剤（specs/004 data-model.md §4）
describe("S4 scenarios", () => {
  const outpatient = SCENARIOS.find((s) => s.id === "s4-outpatient")!;
  const inpatient = SCENARIOS.find((s) => s.id === "s4-inpatient")!;

  it("use the pharmacy stage, six steps and their own state loader", () => {
    for (const s of [outpatient, inpatient]) {
      expect(s.stage).toBe("pharmacy");
      expect(s.steps).toHaveLength(6);
      expect(s.loadState).toBeTypeOf("function");
    }
  });

  it("only the inpatient scenario can fast-forward to step 4", () => {
    expect(outpatient.fastForward).toBeUndefined();
    expect(inpatient.fastForward).toMatchObject({ to: 4 });
    expect(inpatient.fastForward?.label).toContain("ステップ 4");
  });

  it("steps 2 to 4 are the same in both scenarios (same states and traffic)", () => {
    for (const i of [1, 2, 3]) {
      expect(inpatient.steps[i].title).toBe(outpatient.steps[i].title);
      expect(inpatient.steps[i].expected).toEqual(outpatient.steps[i].expected);
    }
  });

  it("differ in the last operation: the prescription is completed only for the outpatient", () => {
    expect(outpatient.steps[4].expected.medicationRequest).toBe("completed");
    expect(inpatient.steps[4].expected.medicationRequest).toBe("active");
    for (const s of [outpatient, inpatient]) {
      expect(s.steps[4].expected.task?.status).toBe("completed");
      expect(s.steps[4].expected.medicationDispense).toBe("completed");
    }
  });

  it("have the guided pharmacist switch and explanations that cover what the talk has to teach (FR-030)", () => {
    for (const s of [outpatient, inpatient]) {
      expect(controlsOf(s.steps[3])).toContain("pharmacist-ph-e");
      const text = s.steps.map((x) => x.explanation.business + x.explanation.fhir).join("");
      for (const word of ["ServiceRequest", "MedicationRequest", "Task", "作業", "依頼"]) expect(text, `${s.id}: ${word}`).toContain(word);
    }
    expect(inpatient.steps[4].explanation.fhir).toContain("active");
  });
});
