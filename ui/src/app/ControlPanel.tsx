import { useState } from "react";
import { Link } from "react-router";
import { usePolicy } from "../demo/usePolicy";
import { putPolicy } from "../realtime/demoApi";
import { prepareScenario, type PrepareStage, type S2ScenarioId } from "../demo/prepare";
import { ResetButton } from "./ResetButton";

const PREPARE: { id: S2ScenarioId; name: string; label: string }[] = [
  { id: "s2-1", name: "S2-1", label: "S2-1 の準備（ルール無し）" },
  { id: "s2-2", name: "S2-2", label: "S2-2 の準備（版の確認あり）" },
  { id: "s2-3", name: "S2-3", label: "S2-3 の準備（必須化）" },
];

const STAGE_TEXT: Record<Exclude<PrepareStage, "done">, string> = {
  reset: "初期化しています",
  policy: "設定を切り替えています",
  order: "依頼を登録しています",
  collect: "採血を記録しています",
};

/** デモ制御パネル：初期化、S2 の準備ボタン、版の確認の設定（D-30、contracts/ui-screens.md）。画面上の案内は出さない（D-29）。 */
export function ControlPanel() {
  const { policy, error: policyError } = usePolicy();
  const [running, setRunning] = useState<S2ScenarioId | null>(null);
  const [status, setStatus] = useState<string | null>(null);
  const [switchError, setSwitchError] = useState<string | null>(null);

  const change = async (partial: Parameters<typeof putPolicy>[0]) => {
    setSwitchError(null);
    try {
      await putPolicy(partial);
    } catch (e) {
      setSwitchError(e instanceof Error ? e.message : "設定を変更できません");
    }
  };
  const choice = (label: string, selected: boolean, onClick: () => void, testId: string) => (
    <button type="button" className={selected ? "primary" : undefined} aria-pressed={selected} disabled={running !== null || !policy} onClick={onClick} data-testid={testId}>
      {label}
    </button>
  );

  const prepare = async (id: S2ScenarioId, name: string) => {
    setRunning(id);
    setStatus(null);
    const result = await prepareScenario(id, undefined, (stage) => stage !== "done" && setStatus(`${STAGE_TEXT[stage]}…`));
    setStatus(
      result.error
        ? `${name} の準備に失敗しました（${STAGE_TEXT[result.stage as Exclude<PrepareStage, "done">]}の段階）：${result.error.text}`
        : `${name} の準備ができました`,
    );
    setRunning(null);
  };

  return (
    <main className="screen" style={{ maxWidth: 900, margin: "0 auto" }}>
      <header className="screen-header">
        <h1>デモ制御パネル</h1>
        <span className="spacer" />
        <Link to="/">入口へ</Link>
      </header>

      <section className="panel" aria-label="初期化">
        <h2>初期化</h2>
        <ResetButton />
      </section>

      <section className="panel" aria-label="S2 同時受付の準備">
        <h2>S2 同時受付の準備</h2>
        <p className="muted">押すと、初期化し、依頼と採血を電子カルテとして登録し、版の確認の設定を切り替えます。</p>
        <div className="row">
          {PREPARE.map((p) => (
            <button
              key={p.id}
              type="button"
              className="primary"
              disabled={running !== null}
              onClick={() => prepare(p.id, p.name)}
              data-testid={`btn-prepare-${p.id}`}
            >
              {p.label}
            </button>
          ))}
        </div>
        <p role="status" data-testid="prepare-status">
          {status}
        </p>
      </section>

      <section className="panel" aria-label="版の確認の設定">
        <h2>版の確認の設定</h2>
        {policyError && <p role="alert">{policyError}</p>}
        {switchError && <p role="alert">{switchError}</p>}
        <div className="row" data-testid="policy-if-match-required">
          <span>サーバーの版の確認：</span>
          {choice("必須", policy?.ifMatchRequired === true, () => change({ ifMatchRequired: true }), "policy-if-match-required-on")}
          {choice("任意", policy?.ifMatchRequired === false, () => change({ ifMatchRequired: false }), "policy-if-match-required-off")}
        </div>
        <div className="row" data-testid="policy-lab-sends-if-match" style={{ marginTop: "var(--sp-2)" }}>
          <span>検体検査システムの版の確認：</span>
          {choice("付ける", policy?.labSendsIfMatch === true, () => change({ labSendsIfMatch: true }), "policy-lab-sends-on")}
          {choice("付けない（デモ専用）", policy?.labSendsIfMatch === false, () => change({ labSendsIfMatch: false }), "policy-lab-sends-off")}
        </div>
      </section>
    </main>
  );
}
