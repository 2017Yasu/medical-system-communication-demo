import { useState } from "react";
import { Link, useSearchParams } from "react-router";
import { MonitorScreen } from "../monitor/MonitorScreen";
import { ScenarioProvider } from "../scenario/ScenarioProvider";
import { EhrScreen, type EhrRole } from "../systems/ehr/EhrScreen";
import { LisScreen } from "../systems/lis/LisScreen";
import { ProgressPanel } from "./ProgressPanel";
import styles from "./stage.module.css";

/** ステージビュー：電子カルテ・検体検査システム・通信モニタを 1 画面に並べる（FR-028）。 */
export function StageView() {
  const [params] = useSearchParams();
  const mode = params.get("mode") === "self-study" ? "self-study" : "presentation";
  const [role, setRole] = useState<EhrRole>("doctor");

  return (
    <ScenarioProvider>
      <div className={styles.stage}>
        <div className={styles.top}>
          <div className={styles.header}>
            <h1>{mode === "presentation" ? "講演モード" : "自習モード"}</h1>
            <span className="spacer" style={{ flex: 1 }} />
            <Link to="/">入口へ</Link>
          </div>
          <ProgressPanel />
        </div>
        <div className={styles.grid}>
          <section className={styles.region} aria-label="電子カルテ">
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
              <EhrScreen role={role} embedded />
            </div>
          </section>
          <section className={styles.region} aria-label="検体検査システム">
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
    </ScenarioProvider>
  );
}
