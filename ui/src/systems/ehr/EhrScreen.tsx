import { Link, useSearchParams } from "react-router";
import { DoctorView } from "./DoctorView";
import { NurseView } from "./NurseView";

export type EhrRole = "doctor" | "nurse";

/** 電子カルテ。`/ehr?role=doctor|nurse`（ステージビューからは props で役割を渡す）。 */
export function EhrScreen({ role, embedded = false }: { role?: EhrRole; embedded?: boolean }) {
  const [params] = useSearchParams();
  const current: EhrRole = role ?? (params.get("role") === "nurse" ? "nurse" : "doctor");
  return (
    <div>
      {!embedded && (
        <header className="screen-header" style={{ padding: "var(--sp-3)" }}>
          <h1>電子カルテ（{current === "doctor" ? "医師 X" : "看護師 D"}）</h1>
          <Link to="/ehr?role=doctor">医師</Link>
          <Link to="/ehr?role=nurse">看護師</Link>
          <Link to="/ehr/ct?doctor=dr-x">CT 予約</Link>
          <Link to="/ehr/rx?role=dr-x">処方</Link>
          <span className="spacer" />
          <Link to="/">入口へ</Link>
        </header>
      )}
      {current === "doctor" ? <DoctorView /> : <NurseView />}
    </div>
  );
}
