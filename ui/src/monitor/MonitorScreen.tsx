import { useMemo, useState } from "react";
import { Link } from "react-router";
import { ResetButton } from "../app/ResetButton";
import { HistoryView } from "./HistoryView";
import { SequenceDiagram } from "./SequenceDiagram";
import { buildSequence } from "./sequenceModel";
import { TrafficDetail } from "./TrafficDetail";
import { useTraffic } from "./useTraffic";

/** 通信モニタ：全通信のシーケンス図、個々の通信の詳細、リソースの版の履歴（US2）。 */
export function MonitorScreen({ embedded = false }: { embedded?: boolean }) {
  const records = useTraffic();
  const [showMonitor, setShowMonitor] = useState(false);
  const [selectedSeq, setSelectedSeq] = useState<number | null>(null);
  const items = useMemo(() => buildSequence(records, { showMonitor }), [records, showMonitor]);
  const selected = items.find((i) => i.seq === selectedSeq) ?? null;
  const detailItem = selected ?? buildSequence(records, { showMonitor: true }).find((i) => i.seq === selectedSeq) ?? null;

  return (
    <div className="screen" style={{ height: embedded ? "100%" : undefined }}>
      {!embedded && (
        <header className="screen-header">
          <h1>通信モニタ</h1>
          <span className="spacer" />
          <ResetButton />
          <Link to="/">入口へ</Link>
        </header>
      )}
      <div className="row" style={{ justifyContent: "space-between" }}>
        <span className="muted" data-testid="traffic-count">
          通信 {items.length} 件
        </span>
        <label>
          <input type="checkbox" checked={showMonitor} onChange={(e) => setShowMonitor(e.target.checked)} /> 通信モニタ自身の通信も表示する
        </label>
      </div>
      <section className="panel" aria-label="シーケンス図" style={{ flex: "1 1 auto", minHeight: 240 }}>
        {items.length === 0 ? (
          <p className="muted">通信はまだありません。画面を操作すると、ここに表示されます。</p>
        ) : (
          <SequenceDiagram items={items} selectedSeq={selectedSeq} onSelect={(i) => setSelectedSeq(i.seq)} />
        )}
      </section>
      <TrafficDetail item={detailItem} />
      <HistoryView records={records} onJumpToTraffic={setSelectedSeq} />
    </div>
  );
}
