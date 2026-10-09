// シナリオ定義の形式（contracts/ui-screens.md「シナリオ定義の形式」）。講演モードと自習モードで共通。
import type { FhirClient } from "../fhir/client";

export type ScenarioClient =
  | "ehr-doctor"
  | "ehr-doctor-y"
  | "ehr-nurse"
  | "ehr-nurse-f"
  | "lis-tech-a"
  | "lis-tech-b"
  | "pharmacy"
  | "pharmacy-ph-c"
  | "pharmacy-ph-e";
export type ScenarioId = "s1-main" | "s1-cancel" | "s1-reject" | "s1-rerun" | "s1-partial" | "s4-outpatient" | "s4-inpatient";

/** 前のステップの完了後に通信記録に現れるべき通信。 */
export type TrafficCondition =
  /** その画面への ping */
  | { kind: "notification"; targetClient: ScenarioClient }
  /** その画面の要求。resourceType = "Bundle" は Transaction（POST /fhir）。 */
  | { kind: "http"; client: ScenarioClient; method: "GET" | "POST" | "PUT" | "PATCH"; resourceType: string };

/** シナリオが注目するデータの状態（FHIR から取得して判定する）。 */
export interface ScenarioState {
  serviceRequest?: string;
  task?: { status: string; businessStatus?: string; owner?: string };
  specimen?: "not-collected" | "collected";
  diagnosticReport?: "none" | "partial" | "final";
  /** S4：処方（MedicationRequest）の status。 */
  medicationRequest?: string;
  /** S4：調剤の記録（MedicationDispense）。お渡し・払出の前は none。 */
  medicationDispense?: "none" | "completed";
}

export interface ExpectedState extends ScenarioState {
  traffic?: TrafficCondition[];
}

export interface ScenarioContext {
  clients: Record<ScenarioClient, FhirClient>;
  now: () => Date;
}

export interface ScenarioStep {
  no: number;
  title: string;
  /** auto = 利用者の操作が無く、通知を受けた画面が自動で取り直すステップ */
  actor: ScenarioClient | "auto";
  /** 自習モードで強調する画面とボタン。control は data-guide 属性の値（カンマ区切りで複数）、role は電子カルテの役割。auto は画面のみ。 */
  target: {
    screen: "ehr" | "lis" | "pharmacy";
    control?: string;
    /** 電子カルテの役割。S1 は doctor / nurse、S4 は医師 X・医師 Y・看護師 F。 */
    role?: "doctor" | "nurse" | "dr-x" | "dr-y" | "ns-f";
    /** S4：操作する薬剤師（薬剤部門システムの切り替え）。 */
    pharmacist?: "ph-c" | "ph-e";
  };
  /** 自動実行の処理（画面と同じ FHIR 要求を送る）。auto のステップには無い。 */
  run?: (ctx: ScenarioContext) => Promise<void>;
  expected: ExpectedState;
  explanation: { business: string; fhir: string };
}

export interface Scenario {
  id: ScenarioId;
  title: string;
  steps: ScenarioStep[];
  /** ステージビューの列の構成。既定は lab（電子カルテ・検体検査システム・通信モニタ）。S4 は pharmacy。 */
  stage?: "lab" | "pharmacy";
  /** データの状態の取得。省略時は S1 の取得（loadScenarioState）。 */
  loadState?: (client: FhirClient) => Promise<ScenarioState>;
  /** 講演モードで、完了したステップが to 未満のとき、to まで続けて進めるボタン（入院のステップ 1〜4。D-52）。 */
  fastForward?: { to: number; label: string };
}
