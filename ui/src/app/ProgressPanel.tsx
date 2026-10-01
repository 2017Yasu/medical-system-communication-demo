import { useScenario } from "../scenario/ScenarioProvider";

/** 講演モードの進行パネル：次へ / 戻る / 初期化、現在のステップ、業務上の意味と FHIR 上の意味の解説（FR-026）。 */
export function ProgressPanel() {
  const { runner, view, scenarios, scenarioId, selectScenario } = useScenario();
  const scenario = view.scenario;
  if (!scenario) return <section className="panel" aria-label="進行">シナリオを準備しています…</section>;
  const steps = scenario.steps;
  const done = view.completed >= steps.length;
  // 解説は「いま見せているステップ」：完了した最後のステップ（始める前は 1 つ目）
  const shown = steps[Math.max(0, Math.min(view.completed, steps.length) - 1)];
  const nextStep = steps[view.completed];

  return (
    <section className="panel" aria-label="進行" data-testid="progress-panel">
      <div className="row" style={{ justifyContent: "space-between" }}>
        <label className="row" style={{ gap: "var(--sp-2)" }}>
          <span className="muted">シナリオ</span>
          <select
            value={scenarioId}
            onChange={(e) => selectScenario(e.target.value)}
            disabled={view.busy}
            aria-label="シナリオ"
            data-testid="scenario-select"
            style={{ fontSize: "var(--fs-large)", fontWeight: 700 }}
          >
            {scenarios.map((s) => (
              <option key={s.id} value={s.id}>
                {s.title}
              </option>
            ))}
          </select>
        </label>
        <span className="row">
          <button type="button" onClick={() => void runner.back()} disabled={view.busy || view.completed === 0} data-testid="btn-back">
            ◀ 戻る
          </button>
          <button type="button" className="primary" onClick={() => void runner.next()} disabled={view.busy || done} data-testid="btn-next">
            {view.busy ? "実行中…" : done ? "完了" : `次へ ▶（${nextStep.no}. ${nextStep.title}）`}
          </button>
          <button type="button" onClick={() => void runner.reset()} disabled={view.busy} data-testid="btn-reset">
            初期化
          </button>
        </span>
      </div>
      <ol style={{ display: "flex", gap: "var(--sp-2)", flexWrap: "wrap", padding: 0, margin: "var(--sp-2) 0", listStyle: "none" }}>
        {steps.map((s, i) => (
          <li
            key={s.no}
            className={`badge ${i < view.completed ? "ok" : ""}`}
            style={i === view.completed ? { borderColor: "var(--c-primary)", borderWidth: 2 } : undefined}
            aria-current={i === view.completed ? "step" : undefined}
            data-testid={`step-${s.no}`}
          >
            {s.no}. {s.title}
          </li>
        ))}
      </ol>
      {view.waiting && (
        <p role="status" className="badge warn" data-testid="waiting">
          通知を待っています（画面が接続されていない可能性があります）
        </p>
      )}
      {view.error && <p role="alert" className="badge error">{view.error}</p>}
      {view.completed === 0 ? (
        <p className="muted">「次へ」を押すと、最初のステップを実行します。画面を直接操作しても、進み具合に追従します。</p>
      ) : (
        <div data-testid="explanation">
          <p style={{ margin: "var(--sp-1) 0" }}>
            <strong>
              ステップ {shown.no}：{shown.title}
            </strong>
          </p>
          <p style={{ margin: "var(--sp-1) 0" }}>
            <strong>業務上の意味：</strong>
            {shown.explanation.business}
          </p>
          <p style={{ margin: "var(--sp-1) 0" }} className="muted">
            <strong>FHIR 上の意味：</strong>
            {shown.explanation.fhir}
          </p>
        </div>
      )}
    </section>
  );
}
