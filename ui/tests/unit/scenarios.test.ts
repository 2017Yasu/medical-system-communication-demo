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
  return source.includes(`data-guide={\`${prefix}$`);
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
    expect(scenario.steps[0].actor).toBe("ehr-doctor");
  });
});

describe("scenario list", () => {
  it("offers the main flow and the four variations (FR-030)", () => {
    expect(SCENARIOS.map((s) => s.id)).toEqual(["s1-main", "s1-cancel", "s1-reject", "s1-rerun", "s1-partial"]);
  });
});
