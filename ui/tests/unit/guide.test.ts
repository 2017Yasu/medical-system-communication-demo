import { beforeEach, describe, expect, it } from "vitest";
import { applyHighlight, controlsOf, guideInstruction } from "../../src/guide/useGuide";
import { s1Main } from "../../src/scenario/s1Main";
import { s4Inpatient, s4Outpatient } from "../../src/scenario/s4Prescription";

const step = (no: number) => s1Main.steps[no - 1];

beforeEach(() => {
  document.body.innerHTML = `
    <section data-guide-region="ehr">
      <select data-guide="order-patient"></select>
      <input type="checkbox" data-guide="order-set-CBC" />
      <input type="checkbox" data-guide="order-set-BIO" />
      <button data-guide="order-submit" disabled>依頼する</button>
      <button data-guide="collect-1">採血を記録</button>
    </section>
    <section data-guide-region="lis"><button data-guide="accept-1">受付</button></section>`;
});

const active = () => [...document.querySelectorAll('[data-guide-active="true"]')].map((e) => e.getAttribute("data-guide") ?? e.getAttribute("data-guide-region"));

describe("guide highlighting", () => {
  it("parses the comma-separated controls of a step", () => {
    expect(controlsOf(step(1))).toEqual(["order-patient", "order-set-CBC", "order-set-BIO", "order-submit"]);
    expect(controlsOf(step(2))).toEqual([]);
  });

  it("highlights the controls of the next step, but not disabled ones", () => {
    applyHighlight(document, step(1));
    expect(active()).toEqual(["order-patient", "order-set-CBC", "order-set-BIO"]);
    (document.querySelector('[data-guide="order-submit"]') as HTMLButtonElement).disabled = false;
    applyHighlight(document, step(1));
    expect(active()).toContain("order-submit");
  });

  it("moves the highlight when the step changes", () => {
    applyHighlight(document, step(1));
    applyHighlight(document, step(3));
    expect(active()).toEqual(["collect-1"]);
  });

  it("highlights the screen region for automatic steps", () => {
    applyHighlight(document, step(2));
    expect(active()).toEqual(["lis"]);
    applyHighlight(document, step(5));
    expect(active()).toEqual(["ehr"]);
  });

  it("clears everything when there is no step", () => {
    applyHighlight(document, step(1));
    applyHighlight(document, null);
    expect(active()).toEqual([]);
  });

  it("every control named by a step exists as data-guide in the screens' source", async () => {
    // シナリオの target.control が、画面の data-guide 属性と食い違わないこと
    const { readFileSync, readdirSync, statSync } = await import("node:fs");
    const { join } = await import("node:path");
    const walk = (d: string): string[] => readdirSync(d).flatMap((f) => (statSync(join(d, f)).isDirectory() ? walk(join(d, f)) : [join(d, f)]));
    const source = walk("src").filter((f) => f.endsWith(".tsx")).map((f) => readFileSync(f, "utf8")).join("\n");
    for (const s of s1Main.steps) {
      for (const c of controlsOf(s)) {
        const pattern = c.replace(/-\d+$/, "-"); // collect-1 は data-guide={`collect-${id}`} と対応する
        expect(source.includes(`data-guide="${c}"`) || source.includes(`data-guide={\`${pattern}`) || source.includes(`data-guide={\`${c.replace(/-(CBC|BIO)$/, "-")}`), c).toBe(true);
      }
    }
  });
});

describe("guide instruction (S4, specs/004 contracts/ui-screens.md)", () => {
  it("keeps the S1 wording", () => {
    expect(guideInstruction(step(1))).toBe("電子カルテ（医師 X）の、枠が点滅している部分を操作してください。");
    expect(guideInstruction(step(3))).toBe("電子カルテ（看護師 D）の、枠が点滅している部分を操作してください。");
    expect(guideInstruction(step(4))).toBe("検体検査システムの、枠が点滅している部分を操作してください。");
    expect(guideInstruction(step(2))).toBe("検体検査システムに、通知が届くのを待っています。何も操作しなくても、画面が自動で更新されます。");
  });

  it("names the pharmacy system with the pharmacist and the electronic record with the role", () => {
    expect(guideInstruction(s4Outpatient.steps[2], "ph-c")).toBe("薬剤部門システム（薬剤師 C）の、枠が点滅している部分を操作してください。");
    expect(guideInstruction(s4Outpatient.steps[0])).toBe("電子カルテ（医師 X）の、枠が点滅している部分を操作してください。");
    expect(guideInstruction(s4Inpatient.steps[0])).toBe("電子カルテ（医師 Y）の、枠が点滅している部分を操作してください。");
    expect(guideInstruction(s4Inpatient.steps[5])).toContain("電子カルテ");
  });

  it("asks to switch the pharmacist when the selected one differs from the guided one", () => {
    expect(guideInstruction(s4Inpatient.steps[3], "ph-c")).toBe(
      "薬剤部門システム（薬剤師 E）の、枠が点滅している部分を操作してください。薬剤師 E に切り替えてください。",
    );
    expect(guideInstruction(s4Inpatient.steps[3], "ph-e")).toBe("薬剤部門システム（薬剤師 E）の、枠が点滅している部分を操作してください。");
  });

  it("highlights the pharmacist switch only while that pharmacist is not selected", () => {
    document.body.innerHTML = `
      <section data-guide-region="pharmacy">
        <button data-guide="pharmacist-ph-c" disabled>薬剤師 C</button>
        <button data-guide="pharmacist-ph-e">薬剤師 E</button>
        <button data-guide="rx-audit-1">監査を開始</button>
      </section>`;
    applyHighlight(document, s4Inpatient.steps[3]);
    expect(active()).toEqual(["pharmacist-ph-e", "rx-audit-1"]);
    (document.querySelector('[data-guide="pharmacist-ph-e"]') as HTMLButtonElement).disabled = true;
    applyHighlight(document, s4Inpatient.steps[3]);
    expect(active()).toEqual(["rx-audit-1"]);
  });
});

