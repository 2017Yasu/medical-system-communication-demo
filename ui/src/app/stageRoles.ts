// ステージビューの電子カルテの役割・薬剤部門システムの薬剤師を、シナリオのステップから決める（specs/004 data-model.md §5）。
// S1（stage = lab）は今までどおり変えない。
import type { Scenario, ScenarioStep } from "../scenario/types";

export interface StageTargets {
  role?: ScenarioStep["target"]["role"];
  pharmacist?: ScenarioStep["target"]["pharmacist"];
}

/**
 * 基準のステップまでのうち、最後に指定された役割・薬剤師。
 * 基準のステップは、講演モードは解説中のステップ（完了した最後のステップ。始める前は 1 つ目）、自習モードは次に操作するステップ。
 * 自習モードでは薬剤師を自動で切り替えない（利用者が切り替える。US4 シナリオ 3）。
 */
export function stageTargets(scenario: Scenario, completed: number, mode: "presentation" | "self-study"): StageTargets {
  if (scenario.stage !== "pharmacy") return {};
  const last = scenario.steps.length - 1;
  const k = mode === "presentation" ? Math.max(0, completed - 1) : Math.min(completed, last);
  let role: StageTargets["role"];
  let pharmacist: StageTargets["pharmacist"];
  for (const step of scenario.steps.slice(0, k + 1)) {
    if (step.target.role) role = step.target.role;
    if (step.target.pharmacist) pharmacist = step.target.pharmacist;
  }
  return { role, pharmacist: mode === "presentation" ? pharmacist : undefined };
}
