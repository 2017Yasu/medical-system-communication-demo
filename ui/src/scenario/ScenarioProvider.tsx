import { createContext, useContext, useEffect, useMemo, useSyncExternalStore, type ReactNode } from "react";
import { FhirClient } from "../fhir/client";
import { resetDemo } from "../realtime/demoApi";
import { startTrafficSync, trafficStore } from "../realtime/trafficStore";
import { ScenarioRunner, type RunnerView } from "./runner";
import { s1Main } from "./s1Main";
import { loadScenarioState } from "./state";
import type { Scenario } from "./types";

export const SCENARIOS: Scenario[] = [s1Main];

const RunnerContext = createContext<ScenarioRunner | null>(null);

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
export function ScenarioProvider({ children, scenarioId = "s1-main" }: { children: ReactNode; scenarioId?: string }) {
  const runner = useMemo(() => {
    const monitor = new FhirClient("monitor");
    return new ScenarioRunner({
      clients: {
        "ehr-doctor": new FhirClient("ehr-doctor"),
        "ehr-nurse": new FhirClient("ehr-nurse"),
        "lis-tech-a": new FhirClient("lis-tech-a"),
        "lis-tech-b": new FhirClient("lis-tech-b"),
      },
      store: trafficStore,
      loadState: () => loadScenarioState(monitor),
      resetServer: async () => {
        await resetDemo();
        trafficStore.clear();
      },
      settle: () => settleTraffic(),
    });
  }, []);

  useEffect(() => {
    const stopSync = startTrafficSync();
    const scenario = SCENARIOS.find((s) => s.id === scenarioId) ?? SCENARIOS[0];
    // 通信記録の取得が済んでから開始する（それ以前の通信は判定の対象にしない）
    const timer = setTimeout(() => {
      runner.start(scenario);
      void runner.refresh().catch(() => undefined);
    }, 300);
    return () => {
      clearTimeout(timer);
      runner.dispose();
      stopSync();
    };
  }, [runner, scenarioId]);

  return <RunnerContext.Provider value={runner}>{children}</RunnerContext.Provider>;
}

export function useScenario(): { runner: ScenarioRunner; view: RunnerView } {
  const runner = useContext(RunnerContext);
  if (!runner) throw new Error("ScenarioProvider の外では使えません");
  const view = useSyncExternalStore(runner.subscribe, runner.getView);
  return { runner, view };
}
