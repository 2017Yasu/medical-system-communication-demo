import { Route, Routes } from "react-router";
import { EhrScreen } from "../systems/ehr/EhrScreen";
import { LisScreen } from "../systems/lis/LisScreen";

// 電子カルテ・検体検査システムは実装済み。ステージビュー・通信モニタ・入口は後続のタスク（T064・T071・T072）で実装する。
function Placeholder({ title }: { title: string }) {
  return (
    <main style={{ padding: "var(--sp-4)" }}>
      <h1>{title}</h1>
      <p>この画面はまだ実装されていません。</p>
    </main>
  );
}

export function AppRoutes() {
  return (
    <Routes>
      <Route path="/" element={<Placeholder title="医療システム連携デモ" />} />
      <Route path="/stage" element={<Placeholder title="ステージビュー" />} />
      <Route path="/ehr" element={<EhrScreen />} />
      <Route path="/lis" element={<LisScreen />} />
      <Route path="/monitor" element={<Placeholder title="通信モニタ" />} />
      <Route path="*" element={<Placeholder title="ページが見つかりません" />} />
    </Routes>
  );
}
