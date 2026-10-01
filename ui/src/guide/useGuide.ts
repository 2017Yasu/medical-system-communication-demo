// 自習モードの案内：次に操作する画面とボタンの特定、強調表示、案内と違う操作への促し（FR-029、US4）。
import { useEffect, useState } from "react";
import { useScenario } from "../scenario/ScenarioProvider";
import type { ScenarioStep } from "../scenario/types";

export interface Guide {
  /** 次に行うステップ。全ステップが完了していれば null。 */
  step: ScenarioStep | null;
  /** 直前に完了したステップ（解説の表示用）。まだ無ければ null。 */
  doneStep: ScenarioStep | null;
  total: number;
  completed: number;
  /** 案内と違う操作をしたときの促し（数秒で消える）。 */
  nudge: string | null;
  finished: boolean;
  restart: () => void;
}

const REGION_NAME = { ehr: "電子カルテ", lis: "検体検査システム" } as const;

export function controlsOf(step: ScenarioStep | null): string[] {
  return step?.target.control?.split(",").filter(Boolean) ?? [];
}

/** 強調表示する要素に付ける属性。CSS（[data-guide-active="true"]）が枠を点滅させる。 */
export function applyHighlight(root: ParentNode, step: ScenarioStep | null): void {
  root.querySelectorAll("[data-guide-active]").forEach((el) => el.removeAttribute("data-guide-active"));
  if (!step) return;
  const controls = controlsOf(step);
  if (controls.length === 0) {
    // 自動のステップ：利用者の操作は無いので、画面の領域を強調する
    root.querySelector(`[data-guide-region="${step.target.screen}"]`)?.setAttribute("data-guide-active", "true");
    return;
  }
  for (const c of controls) {
    root.querySelectorAll(`[data-guide="${c}"]`).forEach((el) => {
      if (!(el as HTMLButtonElement).disabled) el.setAttribute("data-guide-active", "true");
    });
  }
}

export function useGuide(): Guide {
  const { runner, view } = useScenario();
  const steps = view.scenario?.steps ?? [];
  const step = steps[view.completed] ?? null;
  const doneStep = view.completed > 0 ? steps[view.completed - 1] : null;
  const [nudge, setNudge] = useState<string | null>(null);

  // 次に操作する場所を強調する。要素は状態に応じて現れるので、短い間隔で付け直す。
  useEffect(() => {
    const apply = () => applyHighlight(document, step);
    apply();
    const timer = setInterval(apply, 250);
    return () => {
      clearInterval(timer);
      applyHighlight(document, null);
    };
  }, [step]);

  // 案内と違う操作（案内の対象ではない data-guide 要素の操作）をしたら、案内に戻るよう促す
  useEffect(() => {
    if (!step) return;
    const allowed = new Set([...controlsOf(step), "reset"]);
    let timer: ReturnType<typeof setTimeout> | undefined;
    const onClick = (e: MouseEvent) => {
      const guided = (e.target as Element | null)?.closest("[data-guide]");
      if (!guided) return;
      const id = guided.getAttribute("data-guide") ?? "";
      if (allowed.has(id)) return;
      const where = REGION_NAME[step.target.screen];
      setNudge(`いまは「${step.title}」の場面です。${where}の、強調表示されている部分を操作してください。`);
      clearTimeout(timer);
      timer = setTimeout(() => setNudge(null), 6000);
    };
    document.addEventListener("click", onClick, true);
    return () => {
      document.removeEventListener("click", onClick, true);
      clearTimeout(timer);
    };
  }, [step]);

  // 正しい操作に戻ったら促しを消す
  useEffect(() => setNudge(null), [view.completed]);

  return {
    step,
    doneStep,
    total: steps.length,
    completed: view.completed,
    nudge,
    finished: view.scenario !== null && view.completed >= steps.length,
    restart: () => void runner.reset(),
  };
}
