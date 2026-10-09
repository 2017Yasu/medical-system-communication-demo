import { useScenario } from "../scenario/ScenarioProvider";
import type { PharmacistId } from "../fhir/builders/prescription";
import { guideInstruction, useGuide } from "./useGuide";

/** 自習モードのガイド：次に操作する画面とボタンの案内、各ステップの解説、「最初から」（FR-029）。 */
export function GuideOverlay({ currentPharmacist }: { currentPharmacist?: PharmacistId } = {}) {
  const guide = useGuide();
  const { view, scenarios, scenarioId, selectScenario } = useScenario();
  if (!view.scenario) return <section className="panel">ガイドを準備しています…</section>;
  const { step, doneStep } = guide;

  return (
    <section className="panel" aria-label="ガイド" data-testid="guide-panel">
      <div className="row" style={{ justifyContent: "space-between" }}>
        <strong style={{ fontSize: "var(--fs-large)" }}>
          {guide.finished ? "最後まで完了しました" : `ステップ ${guide.completed + 1} / ${guide.total}`}
        </strong>
        <span className="row">
          <select
            value={scenarioId}
            onChange={(e) => selectScenario(e.target.value)}
            disabled={view.busy}
            aria-label="シナリオ"
            data-testid="scenario-select"
          >
            {scenarios.map((sc) => (
              <option key={sc.id} value={sc.id}>
                {sc.title}
              </option>
            ))}
          </select>
          <button type="button" onClick={guide.restart} disabled={view.busy} data-testid="btn-restart">
            最初から
          </button>
        </span>
      </div>

      {step && (
        <div data-testid="guide-instruction" style={{ margin: "var(--sp-2) 0" }}>
          <p style={{ margin: 0, fontSize: "var(--fs-large)" }}>
            <strong>{step.title}</strong>
          </p>
          <p role={step.actor === "auto" ? "status" : undefined} style={{ margin: "var(--sp-1) 0" }}>
            {guideInstruction(step, currentPharmacist)}
          </p>
          <p className="muted" style={{ margin: 0 }}>
            {step.explanation.business}
          </p>
        </div>
      )}

      {guide.nudge && (
        <p role="alert" className="badge warn" data-testid="guide-nudge" style={{ whiteSpace: "normal" }}>
          {guide.nudge}
        </p>
      )}

      {doneStep && (
        <div data-testid="guide-done" style={{ borderTop: "1px solid var(--c-border)", paddingTop: "var(--sp-2)" }}>
          <p style={{ margin: 0 }}>
            <strong>できました（ステップ {doneStep.no}）：</strong>
            {doneStep.explanation.business}
          </p>
          <p className="muted" style={{ margin: "var(--sp-1) 0 0" }}>
            <strong>FHIR 上の意味：</strong>
            {doneStep.explanation.fhir}
          </p>
        </div>
      )}
      {guide.finished && (
        <p>
          <button type="button" className="primary" onClick={guide.restart} disabled={view.busy}>
            最初からやり直す
          </button>
        </p>
      )}
    </section>
  );
}
