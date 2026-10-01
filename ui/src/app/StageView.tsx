import { useEffect, useState } from "react";
import { Link, useSearchParams } from "react-router";
import { MonitorScreen } from "../monitor/MonitorScreen";
import { ScenarioProvider } from "../scenario/ScenarioProvider";
import { EhrScreen, type EhrRole } from "../systems/ehr/EhrScreen";
import { LisScreen } from "../systems/lis/LisScreen";
import { GuideOverlay } from "../guide/GuideOverlay";
import { useScenario } from "../scenario/ScenarioProvider";
import { ProgressPanel } from "./ProgressPanel";
import styles from "./stage.module.css";

/** ステージビュー：電子カルテ・検体検査システム・通信モニタを 1 画面に並べる（FR-028）。 */
export function StageView() {
  return (
    <ScenarioProvider>
      <Stage />
    </ScenarioProvider>
  );
}

function Stage() {
  const [params] = useSearchParams();
  const mode = params.get("mode") === "self-study" ? "self-study" : "presentation";
  const [role, setRole] = useState<EhrRole>("doctor");
  const { view } = useScenario();

  // 自習モード：案内する次のステップが指定する電子カルテの役割（医師／看護師）へ切り替える
  const nextRole = view.scenario?.steps[view.completed]?.target.role;
  useEffect(() => {
    if (mode === "self-study" && nextRole) setRole(nextRole);
  }, [mode, nextRole]);

  return (
      <div className={styles.stage}>
        <div className={styles.top}>
          <div className={styles.header}>
            <h1>{mode === "presentation" ? "講演モード" : "自習モード"}</h1>
            <span className="spacer" style={{ flex: 1 }} />
            <Link to="/">入口へ</Link>
          </div>
          {mode === "self-study" ? <GuideOverlay /> : <ProgressPanel />}
        </div>
        <div className={styles.grid}>
          <section className={styles.region} aria-label="電子カルテ" data-guide-region="ehr">
            <div className={styles.regionTitle}>
              電子カルテ
              <span className={styles.tabs}>
                <button type="button" aria-pressed={role === "doctor"} onClick={() => setRole("doctor")}>
                  医師 X
                </button>
                <button type="button" aria-pressed={role === "nurse"} onClick={() => setRole("nurse")}>
                  看護師 D
                </button>
              </span>
            </div>
            <div className={styles.regionBody}>
              {/* 切り替えても通知の受信（Subscription の bind）が外れないよう、両方を配置して表示だけを切り替える */}
              <div hidden={role !== "doctor"}>
                <EhrScreen role="doctor" embedded />
              </div>
              <div hidden={role !== "nurse"}>
                <EhrScreen role="nurse" embedded />
              </div>
            </div>
          </section>
          <section className={styles.region} aria-label="検体検査システム" data-guide-region="lis">
            <div className={styles.regionTitle}>検体検査システム（技師 A）</div>
            <div className={styles.regionBody}>
              <LisScreen tech="tech-a" embedded />
            </div>
          </section>
          <section className={styles.region} aria-label="通信モニタ">
            <div className={styles.regionTitle}>通信モニタ</div>
            <div className={styles.regionBody}>
              <MonitorScreen embedded />
            </div>
          </section>
        </div>
      </div>
  );
}
