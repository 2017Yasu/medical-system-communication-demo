// ステップの判定（contracts/ui-screens.md「ステップの判定」、research.md R-13）。
// データの状態だけでは「データが変わらないステップ」（通知による反映、結果の確認）を区別できないため、
// データの条件と通信の条件の両方で判定する。
import type { TrafficRecord } from "../realtime/types";
import type { ExpectedState, Scenario, ScenarioState, TrafficCondition } from "./types";

/** expected のデータの項目（traffic 以外）が、現在の状態と一致するか。 */
export function matchesData(expected: ExpectedState, state: ScenarioState): boolean {
  if (expected.serviceRequest !== undefined && expected.serviceRequest !== state.serviceRequest) return false;
  if (expected.specimen !== undefined && expected.specimen !== state.specimen) return false;
  if (expected.diagnosticReport !== undefined && expected.diagnosticReport !== state.diagnosticReport) return false;
  if (expected.medicationRequest !== undefined && expected.medicationRequest !== state.medicationRequest) return false;
  if (expected.medicationDispense !== undefined && expected.medicationDispense !== state.medicationDispense) return false;
  if (expected.task) {
    const t = state.task;
    if (!t) return false;
    if (expected.task.status !== t.status) return false;
    if (expected.task.businessStatus !== undefined && expected.task.businessStatus !== t.businessStatus) return false;
    if (expected.task.owner !== undefined && expected.task.owner !== t.owner) return false;
  }
  return true;
}

function resourceTypeOf(url: string): string {
  const path = url.replace(/^\/fhir\/?/, "").split("?")[0];
  return path === "" ? "Bundle" : path.split("/")[0];
}

/**
 * 条件に一致する、基準 seq より後の**最初の**記録の seq。無ければ undefined。
 * 最後の記録ではなく最初のものを使う：後続のステップの操作で同じ種類の通知・取得が再び起きても、基準が先へずれないようにするため。
 */
export function matchTraffic(condition: TrafficCondition, records: TrafficRecord[], afterSeq: number): number | undefined {
  let found: number | undefined;
  for (const r of records) {
    if (r.seq <= afterSeq || r.client === "monitor") continue;
    if (condition.kind === "notification") {
      if (r.kind === "notification" && r.notification?.targetClient === condition.targetClient) found = Math.min(found ?? r.seq, r.seq);
    } else if (
      r.kind === "http" &&
      r.client === condition.client &&
      r.request?.method === condition.method &&
      (r.response?.status ?? 500) < 400 &&
      resourceTypeOf(r.request.url) === condition.resourceType
    ) {
      found = Math.min(found ?? r.seq, r.seq);
    }
  }
  return found;
}

export interface Progress {
  /** 完了したステップの数（0 〜 steps.length）。 */
  completed: number;
  /** 各完了ステップの基準 seq（次のステップの判定に使う）。 */
  baselines: number[];
}

/**
 * 通信の条件が先頭から順に満たされたステップ数 t を求め、最後のステップのデータ条件が現在の状態と一致するところまで戻して、
 * 完了したステップ数とする。
 */
export function evaluateProgress(scenario: Scenario, state: ScenarioState, records: TrafficRecord[], startSeq: number): Progress {
  const baselines: number[] = [];
  let baseline = startSeq;
  for (const step of scenario.steps) {
    const conditions = step.expected.traffic ?? [];
    let next = baseline;
    let ok = true;
    for (const c of conditions) {
      const seq = matchTraffic(c, records, baseline);
      if (seq === undefined) {
        ok = false;
        break;
      }
      next = Math.max(next, seq);
    }
    if (!ok) break;
    baselines.push(next);
    baseline = next;
  }
  let completed = baselines.length;
  while (completed > 0 && !matchesData(scenario.steps[completed - 1].expected, state)) {
    completed -= 1;
  }
  return { completed, baselines: baselines.slice(0, completed) };
}
