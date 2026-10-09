import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState, useSyncExternalStore, type ReactNode } from "react";
import { FhirClient } from "../fhir/client";
import { resetDemo } from "../realtime/demoApi";
import { startTrafficSync, trafficStore } from "../realtime/trafficStore";
import { ScenarioRunner, type RunnerView } from "./runner";
import { s1Main } from "./s1Main";
import { s4Inpatient, s4Outpatient } from "./s4Prescription";
import { VARIATIONS } from "./variations";
import { loadScenarioState } from "./state";
import type { Scenario } from "./types";

export const SCENARIOS: Scenario[] = [s1Main, ...VARIATIONS, s4Outpatient, s4Inpatient];

interface ScenarioContextValue {
  runner: ScenarioRunner;
  scenarios: Scenario[];
  scenarioId: string;
  /** シナリオを切り替える。サーバーを初期化して、そのシナリオを最初から始める。 */
  selectScenario: (id: string) => void;
}

const RunnerContext = createContext<ScenarioContextValue | null>(null);

/** 通信記録が一定時間変化しなくなるまで待つ（初期化の後、各画面の通知の再登録が落ち着くのを待つ）。 */
async function settleTraffic(quietMs = 600, maxMs = 4000): Promise<void> {
  const end = Date.now() + maxMs;
  let lastLen = -1;
  let lastChange = Date.now();
  while (Date.now() < end) {
    const len = trafficStore.getSnapshot().length;
    if (len !== lastLen) {
      lastLen = len;
      lastChange = Date.now();
    } else if (Date.now() - lastChange >= quietMs) {
      return;
    }
    await new Promise((r) => setTimeout(r, 100));
  }
}

/** ステージビューの間だけシナリオの進行（ScenarioRunner）を保持し、通信記録の同期を開始する。 */
export function ScenarioProvider({ children, scenarioId: initialId = "s1-main" }: { children: ReactNode; scenarioId?: string }) {
  const [scenarioId, setScenarioId] = useState(initialId);
  const first = useRef(true);
  const runner = useMemo(() => {
    const monitor = new FhirClient("monitor");
    return new ScenarioRunner({
      clients: {
        "ehr-doctor": new FhirClient("ehr-doctor"),
        "ehr-doctor-y": new FhirClient("ehr-doctor-y"),
        "ehr-nurse": new FhirClient("ehr-nurse"),
        "ehr-nurse-f": new FhirClient("ehr-nurse-f"),
        "lis-tech-a": new FhirClient("lis-tech-a"),
        "lis-tech-b": new FhirClient("lis-tech-b"),
        pharmacy: new FhirClient("pharmacy"),
        "pharmacy-ph-c": new FhirClient("pharmacy-ph-c"),
        "pharmacy-ph-e": new FhirClient("pharmacy-ph-e"),
      },
      store: trafficStore,
      loadState: (scenario) => (scenario.loadState ?? loadScenarioState)(monitor),
      resetServer: async () => {
        await resetDemo();
        trafficStore.clear();
      },
      settle: () => settleTraffic(),
    });
  }, []);

  useEffect(() => {
    const stopSync = startTrafficSync();
    return stopSync;
  }, []);

  useEffect(() => {
    const scenario = SCENARIOS.find((s) => s.id === scenarioId) ?? SCENARIOS[0];
    const isFirst = first.current;
    first.current = false;
    // 通信記録の取得が済んでから開始する（それ以前の通信は判定の対象にしない）
    const timer = setTimeout(
      () => {
        runner.start(scenario);
        // シナリオを切り替えたときは、前のシナリオの状態が残らないよう初期化する
        void (isFirst ? runner.refresh() : runner.reset()).catch(() => undefined);
      },
      isFirst ? 300 : 0,
    );
    return () => clearTimeout(timer);
  }, [runner, scenarioId]);

  useEffect(() => () => runner.dispose(), [runner]);

  const selectScenario = useCallback((id: string) => setScenarioId(id), []);
  const value = useMemo(() => ({ runner, scenarios: SCENARIOS, scenarioId, selectScenario }), [runner, scenarioId, selectScenario]);
  return <RunnerContext.Provider value={value}>{children}</RunnerContext.Provider>;
}

export function useScenario(): ScenarioContextValue & { view: RunnerView } {
  const ctx = useContext(RunnerContext);
  if (!ctx) throw new Error("ScenarioProvider の外では使えません");
  const view = useSyncExternalStore(ctx.runner.subscribe, ctx.runner.getView);
  return { ...ctx, view };
}
