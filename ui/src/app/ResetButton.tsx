import { useState } from "react";
import { resetDemo } from "../realtime/demoApi";

/** 初期化ボタン（FR-003）：全データ・全画面・通信モニタの表示を初期状態に戻す。 */
export function ResetButton({ onDone }: { onDone?: () => void }) {
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState<string | null>(null);
  const run = async () => {
    setBusy(true);
    setMessage(null);
    try {
      await resetDemo();
      onDone?.();
    } catch (e) {
      setMessage(e instanceof Error ? e.message : "初期化に失敗しました");
    } finally {
      setBusy(false);
    }
  };
  return (
    <span>
      <button type="button" onClick={run} disabled={busy} data-guide="reset">
        {busy ? "初期化中…" : "初期化"}
      </button>
      {message && <span role="alert"> {message}</span>}
    </span>
  );
}
