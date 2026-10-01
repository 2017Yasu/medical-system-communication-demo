// シナリオ定義の形式（contracts/ui-screens.md「シナリオ定義の形式」）。講演モードと自習モードで共通。
import type { FhirClient } from "../fhir/client";

export type ScenarioClient = "ehr-doctor" | "ehr-nurse" | "lis-tech-a" | "lis-tech-b";
export type ScenarioId = "s1-main" | "s1-cancel" | "s1-reject" | "s1-rerun" | "s1-partial";

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
  /** 自習モードで強調する画面とボタン（data-guide 属性の値）。auto は画面のみ。 */
  target: { screen: "ehr" | "lis"; control?: string };
  /** 自動実行の処理（画面と同じ FHIR 要求を送る）。auto のステップには無い。 */
  run?: (ctx: ScenarioContext) => Promise<void>;
  expected: ExpectedState;
  explanation: { business: string; fhir: string };
}

export interface Scenario {
  id: ScenarioId;
  title: string;
  steps: ScenarioStep[];
}
