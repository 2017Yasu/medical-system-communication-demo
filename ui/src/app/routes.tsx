import { Route, Routes } from "react-router";

// 各画面は後続のタスク（T053・T055・T064・T071・T072）で実装する。ここでは入口だけを用意する。
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
      <Route path="/ehr" element={<Placeholder title="電子カルテ" />} />
      <Route path="/lis" element={<Placeholder title="検体検査システム" />} />
      <Route path="/monitor" element={<Placeholder title="通信モニタ" />} />
      <Route path="*" element={<Placeholder title="ページが見つかりません" />} />
    </Routes>
  );
}
