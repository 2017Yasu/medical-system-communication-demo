import { useScenario } from "../scenario/ScenarioProvider";
import { useGuide } from "./useGuide";

const REGION = { ehr: "電子カルテ", lis: "検体検査システム" } as const;

/** 自習モードのガイド：次に操作する画面とボタンの案内、各ステップの解説、「最初から」（FR-029）。 */
export function GuideOverlay() {
  const guide = useGuide();
  const { view } = useScenario();
  if (!view.scenario) return <section className="panel">ガイドを準備しています…</section>;
  const { step, doneStep } = guide;

  return (
    <section className="panel" aria-label="ガイド" data-testid="guide-panel">
      <div className="row" style={{ justifyContent: "space-between" }}>
        <strong style={{ fontSize: "var(--fs-large)" }}>
          {guide.finished ? "最後まで完了しました" : `ステップ ${guide.completed + 1} / ${guide.total}`}
        </strong>
        <button type="button" onClick={guide.restart} disabled={view.busy} data-testid="btn-restart">
          最初から
        </button>
      </div>

      {step && (
        <div data-testid="guide-instruction" style={{ margin: "var(--sp-2) 0" }}>
          <p style={{ margin: 0, fontSize: "var(--fs-large)" }}>
            <strong>{step.title}</strong>
          </p>
          {step.actor === "auto" ? (
            <p role="status" style={{ margin: "var(--sp-1) 0" }}>
              {REGION[step.target.screen]}に、通知が届くのを待っています。何も操作しなくても、画面が自動で更新されます。
            </p>
          ) : (
            <p style={{ margin: "var(--sp-1) 0" }}>
              {REGION[step.target.screen]}
              {step.target.role === "nurse" ? "（看護師 D）" : step.target.role === "doctor" ? "（医師 X）" : ""}
              の、枠が点滅している部分を操作してください。
            </p>
          )}
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
