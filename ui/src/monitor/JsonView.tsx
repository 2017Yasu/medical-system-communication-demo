import { useMemo, useState } from "react";

/** JSON 本文の整形表示。JSON でなければそのまま表示する。長い本文は折りたたむ。 */
export function JsonView({ text, truncated = false }: { text: string; truncated?: boolean }) {
  const [expanded, setExpanded] = useState(false);
  const pretty = useMemo(() => {
    if (!text) return "";
    try {
      return JSON.stringify(JSON.parse(text), null, 2);
    } catch {
      return text;
    }
  }, [text]);
  if (!pretty) return <span className="muted">（本文なし）</span>;
  const lines = pretty.split("\n");
  const long = lines.length > 24;
  const shown = long && !expanded ? lines.slice(0, 24).join("\n") + "\n…" : pretty;
  return (
    <div>
      <pre style={{ margin: 0, padding: "var(--sp-2)", background: "#f0f3f7", borderRadius: "var(--radius)", overflow: "auto", fontSize: 14, maxHeight: expanded ? 480 : undefined }}>
        {shown}
      </pre>
      {long && (
        <button type="button" onClick={() => setExpanded(!expanded)}>
          {expanded ? "折りたたむ" : `全体を表示（${lines.length} 行）`}
        </button>
      )}
      {truncated && <div className="muted">※ 本文が大きいため一部のみ記録されています</div>}
    </div>
  );
}
