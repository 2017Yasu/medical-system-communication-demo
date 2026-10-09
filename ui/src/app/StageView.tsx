import { useEffect, useState } from "react";
import { Link, useSearchParams } from "react-router";
import { MonitorScreen } from "../monitor/MonitorScreen";
import { SCENARIOS, ScenarioProvider, useScenario } from "../scenario/ScenarioProvider";
import type { PharmacistId } from "../fhir/builders/prescription";
import { EhrScreen, type EhrRole } from "../systems/ehr/EhrScreen";
import { PrescriptionScreen, type RxRole } from "../systems/ehr/PrescriptionScreen";
import { LisScreen } from "../systems/lis/LisScreen";
import { PharmacyScreen } from "../systems/pharmacy/PharmacyScreen";
import { GuideOverlay } from "../guide/GuideOverlay";
import { stageTargets } from "./stageRoles";
import { ProgressPanel } from "./ProgressPanel";
import styles from "./stage.module.css";

/**
 * ステージビュー：電子カルテ・部門システム（検体検査システム、S4 は薬剤部門システム）・通信モニタを 1 画面に並べる（FR-028）。
 * `?scenario=` で最初のシナリオを選ぶ（無い・不正なら S1）。
 */
export function StageView() {
  const [params] = useSearchParams();
  const requested = params.get("scenario");
  const scenarioId = SCENARIOS.some((s) => s.id === requested) ? (requested as string) : "s1-main";
  return (
    <ScenarioProvider scenarioId={scenarioId}>
      <Stage />
    </ScenarioProvider>
  );
}

const RX_TAB_LABEL: Record<RxRole, string> = { "dr-x": "医師 X", "dr-y": "医師 Y", "ns-f": "看護師 F（外科病棟）" };

function Stage() {
  const [params] = useSearchParams();
  const mode = params.get("mode") === "self-study" ? "self-study" : "presentation";
  const [role, setRole] = useState<EhrRole>("doctor");
  const { view, scenarios, scenarioId } = useScenario();
  const scenario = scenarios.find((s) => s.id === scenarioId);
  const pharmacy = scenario?.stage === "pharmacy";

  // S4：ステップに合わせて電子カルテの役割・薬剤師を切り替える。値が変わったときだけ切り替える（手で切り替えた後は、次に値が変わるまで手の操作を優先する）
  const rxRoles = [...new Set((scenario?.steps ?? []).flatMap((st) => (st.target.screen === "ehr" && st.target.role ? [st.target.role as RxRole] : [])))];
  const [rxRole, setRxRole] = useState<RxRole>("dr-x");
  const [pharmacist, setPharmacist] = useState<PharmacistId>("ph-c");
  const targets = scenario ? stageTargets(scenario, view.scenario === scenario ? view.completed : 0, mode) : {};
  useEffect(() => {
    if (targets.role === "dr-x" || targets.role === "dr-y" || targets.role === "ns-f") setRxRole(targets.role);
  }, [targets.role]);
  useEffect(() => {
    if (targets.pharmacist) setPharmacist(targets.pharmacist);
  }, [targets.pharmacist]);
  const shownRxRole = rxRoles.includes(rxRole) ? rxRole : (rxRoles[0] ?? "dr-x");

  // 自習モード：案内する次のステップが指定する電子カルテの役割（医師／看護師）へ切り替える
  const nextRole = view.scenario?.steps[view.completed]?.target.role;
  useEffect(() => {
    if (pharmacy) return;
    if (mode === "self-study" && (nextRole === "doctor" || nextRole === "nurse")) setRole(nextRole);
  }, [mode, nextRole, pharmacy]);

  return (
      <div className={styles.stage}>
        <div className={styles.top}>
          <div className={styles.header}>
            <h1>{mode === "presentation" ? "講演モード" : "自習モード"}</h1>
            <span className="spacer" style={{ flex: 1 }} />
            <Link to="/">入口へ</Link>
          </div>
          {mode === "self-study" ? <GuideOverlay currentPharmacist={pharmacist} /> : <ProgressPanel />}
        </div>
        {pharmacy ? (
        <div className={styles.grid}>
          <section className={styles.region} aria-label="電子カルテ" data-guide-region="ehr">
            <div className={styles.regionTitle}>
              電子カルテ
              <span className={styles.tabs}>
                {rxRoles.map((r) => (
                  <button key={r} type="button" aria-pressed={shownRxRole === r} onClick={() => setRxRole(r)}>
                    {RX_TAB_LABEL[r]}
                  </button>
                ))}
              </span>
            </div>
            <div className={styles.regionBody}>
              {/* 切り替えても通知の受信（Subscription の bind）が外れないよう、すべて配置して表示だけを切り替える */}
              {rxRoles.map((r) => (
                <div key={`${scenarioId}-${r}`} hidden={shownRxRole !== r}>
                  <PrescriptionScreen role={r} embedded />
                </div>
              ))}
            </div>
          </section>
          <section className={styles.region} aria-label="薬剤部門システム" data-guide-region="pharmacy">
            <div className={styles.regionTitle}>薬剤部門システム（薬剤師 C / 薬剤師 E）</div>
            <div className={styles.regionBody}>
              <PharmacyScreen embedded pharmacist={pharmacist} onPharmacistChange={setPharmacist} />
            </div>
          </section>
          <section className={styles.region} aria-label="通信モニタ">
            <div className={styles.regionTitle}>通信モニタ</div>
            <div className={styles.regionBody}>
              <MonitorScreen embedded />
            </div>
          </section>
        </div>
        ) : (
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
        )}
      </div>
  );
}
