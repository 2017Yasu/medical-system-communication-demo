// S2 の準備（D-30、contracts/demo-control-api.md）：初期化 → ポリシーの切り替え → 依頼 → 採血。
// 依頼・採血は電子カルテとして FHIR に送るので、通信モニタに通常の操作と同じく表示される（原則 III）。
import { FhirClient, FhirError } from "../fhir/client";
import { toDisplayError, type DisplayError } from "../fhir/errors";
import { fetchLatestOrder, placeOrder, recordCollection } from "../fhir/labActions";
import { putPolicy, resetDemo } from "../realtime/demoApi";
import type { DemoPolicy } from "../realtime/types";

export type S2ScenarioId = "s2-1" | "s2-2" | "s2-3";
export type PrepareStage = "reset" | "policy" | "order" | "collect" | "done";

/** シナリオの前提の設定（data-model.md §2）。 */
export const S2_PRESETS: Record<S2ScenarioId, Pick<DemoPolicy, "ifMatchRequired" | "labSendsIfMatch">> = {
  "s2-1": { ifMatchRequired: false, labSendsIfMatch: false },
  "s2-2": { ifMatchRequired: true, labSendsIfMatch: true },
  "s2-3": { ifMatchRequired: true, labSendsIfMatch: false },
};

export interface PrepareResult {
  /** 実行中に止まった段階（成功時は done）。 */
  stage: PrepareStage;
  error: DisplayError | null;
}

export interface PrepareDeps {
  resetDemo: () => Promise<unknown>;
  putPolicy: (policy: Partial<DemoPolicy>) => Promise<unknown>;
  placeOrder: () => Promise<void>;
  recordCollection: () => Promise<void>;
}

/** 実際の通信を行う依存。依頼は医師 X、採血は看護師 D として送る。 */
export function defaultPrepareDeps(): PrepareDeps {
  const doctor = new FhirClient("ehr-doctor");
  const nurse = new FhirClient("ehr-nurse");
  return {
    resetDemo,
    putPolicy,
    placeOrder: () => placeOrder(doctor, "demo-taro", ["CBC"]),
    recordCollection: async () => {
      const order = await fetchLatestOrder(nurse);
      if (!order) throw new Error("依頼が見つかりません（依頼の登録に失敗した可能性があります）");
      await recordCollection(nurse, order);
    },
  };
}

function toDisplay(e: unknown): DisplayError {
  if (e instanceof FhirError) return e.display;
  if (e instanceof Error) return { kind: "server", message: e.message, text: e.message };
  return toDisplayError({ network: true }, "準備");
}

export async function prepareScenario(
  id: S2ScenarioId,
  deps: PrepareDeps = defaultPrepareDeps(),
  onStage: (stage: PrepareStage) => void = () => {},
): Promise<PrepareResult> {
  const steps: [Exclude<PrepareStage, "done">, () => Promise<unknown>][] = [
    ["reset", () => deps.resetDemo()],
    ["policy", () => deps.putPolicy(S2_PRESETS[id])],
    ["order", () => deps.placeOrder()],
    ["collect", () => deps.recordCollection()],
  ];
  for (const [stage, run] of steps) {
    onStage(stage);
    try {
      await run();
    } catch (e) {
      return { stage, error: toDisplay(e) };
    }
  }
  onStage("done");
  return { stage: "done", error: null };
}
