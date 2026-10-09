// シナリオの進行（講演モード・自習モード共通。research.md R-13、contracts/ui-screens.md「ステップの判定」）。
//
// - 「次へ」は次のステップを、そのステップの画面と同じ FHIR 要求として実行する（自動ステップは何もせず、完了を待つ）。
// - 「戻る」は初期化して、1 つ前のステップまでを再実行して状態を再現する（FR-027）。
// - 手動で画面を操作したときは、通信記録とデータの状態から現在のステップを判定して追従する。
// - 自動ステップは数ミリ秒で完了してしまうため、「次へ」で進めている間は、利用者の操作（書き込み）があるまで
//   現在のステップを先へ進めない。講演者が各ステップを説明する時間を取れるようにするため。
import type { TrafficRecord } from "../realtime/types";
import { evaluateProgress } from "./progress";
import type { Scenario, ScenarioContext, ScenarioState } from "./types";
import type { ScenarioClient } from "./types";
import type { FhirClient } from "../fhir/client";

export interface RunnerDeps {
  clients: Record<ScenarioClient, FhirClient>;
  store: {
    getSnapshot: () => TrafficRecord[];
    maxSeq: () => number;
    subscribe: (listener: () => void) => () => void;
  };
  /** 現在のデータの状態（シナリオごとに取得の仕方が違う）。 */
  loadState: (scenario: Scenario) => Promise<ScenarioState>;
  /** サーバーを初期化し、通信記録の保持も空にする。 */
  resetServer: () => Promise<void>;
  /** 初期化の後、各画面の通知の再登録が落ち着くまで待つ。 */
  settle?: () => Promise<void>;
  now?: () => Date;
  /** 完了の判定を待つ最大時間（既定 5 秒）。 */
  completionTimeoutMs?: number;
  pollMs?: number;
}

export interface RunnerView {
  scenario: Scenario | null;
  /** 完了したステップの数。次に実行するステップは steps[completed]。 */
  completed: number;
  busy: boolean;
  /** 通知などの完了を待っているが、まだ満たされていない。 */
  waiting: boolean;
  error: string | null;
}

const IDLE: RunnerView = { scenario: null, completed: 0, busy: false, waiting: false, error: null };

const sleep = (ms: number) => new Promise<void>((r) => setTimeout(r, ms));

function isUserWrite(r: TrafficRecord): boolean {
  return (
    r.kind === "http" &&
    r.client !== "monitor" &&
    r.request !== null &&
    ["POST", "PUT", "PATCH"].includes(r.request.method) &&
    !r.request.url.includes("/Subscription/")
  );
}

export class ScenarioRunner {
  private view: RunnerView = IDLE;
  private listeners = new Set<() => void>();
  private startSeq = 0;
  private holdSeq: number | null = null;
  private ranIndex = -1;
  private unsubscribeStore: (() => void) | null = null;
  private refreshTimer: ReturnType<typeof setTimeout> | null = null;
  private lastUserSeq = 0;

  constructor(private readonly deps: RunnerDeps) {}

  getView = (): RunnerView => this.view;

  subscribe = (listener: () => void): (() => void) => {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  };

  /** シナリオを開始する。これ以前の通信は判定の対象にしない。 */
  start(scenario: Scenario): void {
    this.startSeq = this.deps.store.maxSeq();
    this.holdSeq = null;
    this.ranIndex = -1;
    this.update({ scenario, completed: 0, busy: false, waiting: false, error: null });
    this.unsubscribeStore?.();
    this.lastUserSeq = this.deps.store.maxSeq();
    this.unsubscribeStore = this.deps.store.subscribe(() => this.scheduleRefresh());
  }

  dispose(): void {
    this.unsubscribeStore?.();
    this.unsubscribeStore = null;
    if (this.refreshTimer) clearTimeout(this.refreshTimer);
    this.listeners.clear();
  }

  /** 通信記録とデータの状態から、現在のステップを判定し直す（手動操作への追従）。 */
  async refresh(): Promise<void> {
    const scenario = this.view.scenario;
    if (!scenario) return;
    const state = await this.deps.loadState(scenario);
    const records = this.deps.store.getSnapshot();
    const evaluated = evaluateProgress(scenario, state, records, this.startSeq).completed;
    let completed = this.view.completed;
    if (this.holdSeq === null || records.some((r) => r.seq > this.holdSeq! && isUserWrite(r))) {
      completed = evaluated;
      this.holdSeq = null;
    } else {
      completed = Math.min(completed, evaluated);
    }
    if (completed !== this.view.completed) this.update({ ...this.view, completed });
  }

  async next(): Promise<void> {
    if (!this.view.scenario || this.view.busy) return;
    if (this.view.completed >= this.view.scenario.steps.length) return;
    this.update({ ...this.view, busy: true, waiting: false, error: null });
    try {
      await this.advance();
    } finally {
      this.update({ ...this.view, busy: false });
    }
  }

  /** 初期化して、1 つ前のステップまでを再実行する（FR-027）。 */
  async back(): Promise<void> {
    const scenario = this.view.scenario;
    if (!scenario || this.view.busy) return;
    const target = Math.max(0, this.view.completed - 1);
    this.update({ ...this.view, busy: true, waiting: false, error: null });
    try {
      await this.restart();
      for (let i = 0; i < target; i++) {
        const ok = await this.advance();
        if (!ok) break;
      }
    } finally {
      this.update({ ...this.view, busy: false });
    }
  }

  async reset(): Promise<void> {
    if (!this.view.scenario || this.view.busy) return;
    this.update({ ...this.view, busy: true, waiting: false, error: null });
    try {
      await this.restart();
    } finally {
      this.update({ ...this.view, busy: false });
    }
  }

  private async restart(): Promise<void> {
    await this.deps.resetServer();
    await this.deps.settle?.();
    this.startSeq = this.deps.store.maxSeq();
    this.holdSeq = null;
    this.ranIndex = -1;
    this.update({ ...this.view, completed: 0 });
  }

  /** 次のステップを 1 つ実行して完了を待つ。完了したら true。 */
  private async advance(): Promise<boolean> {
    const scenario = this.view.scenario!;
    const index = this.view.completed;
    const step = scenario.steps[index];
    if (step.run && this.ranIndex !== index) {
      const ctx: ScenarioContext = { clients: this.deps.clients, now: this.deps.now ?? (() => new Date()) };
      this.ranIndex = index;
      try {
        await step.run(ctx);
      } catch (e) {
        this.update({ ...this.view, error: e instanceof Error ? e.message : String(e) });
        return false;
      }
    }
    const deadline = Date.now() + (this.deps.completionTimeoutMs ?? 5000);
    const poll = this.deps.pollMs ?? 250;
    for (;;) {
      const state = await this.deps.loadState(scenario);
      const evaluated = evaluateProgress(scenario, state, this.deps.store.getSnapshot(), this.startSeq).completed;
      if (evaluated > index) {
        this.holdSeq = this.deps.store.maxSeq();
        this.update({ ...this.view, completed: index + 1, waiting: false });
        return true;
      }
      if (Date.now() >= deadline) {
        this.update({ ...this.view, waiting: true });
        return false;
      }
      await sleep(poll);
    }
  }

  private scheduleRefresh(): void {
    if (this.refreshTimer) return;
    // 通信モニタ自身の通信（状態の取得）では判定し直さない（無限ループの防止）
    const records = this.deps.store.getSnapshot();
    const newest = records.filter((r) => r.client !== "monitor").reduce((m, r) => Math.max(m, r.seq), 0);
    if (newest <= this.lastUserSeq) return;
    this.lastUserSeq = newest;
    this.refreshTimer = setTimeout(() => {
      this.refreshTimer = null;
      if (!this.view.busy) void this.refresh().catch(() => undefined);
    }, 150);
  }

  private update(view: RunnerView): void {
    this.view = view;
    for (const l of [...this.listeners]) l();
  }
}
