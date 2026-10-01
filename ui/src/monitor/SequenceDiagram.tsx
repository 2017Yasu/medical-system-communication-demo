import { useEffect, useRef } from "react";
import type { Lane, SequenceItem } from "./sequenceModel";

const LANES: { lane: Lane; title: string }[] = [
  { lane: "ehr", title: "電子カルテ" },
  { lane: "server", title: "FHIR サーバー" },
  { lane: "lis", title: "検体検査システム" },
];
const WIDTH = 900;
const X: Record<Lane, number> = { ehr: 150, server: 450, lis: 750, monitor: 450, other: 450 };
const ROW = 64;
const TOP = 56;

/** シーケンス図（SVG）。新しい通信に自動でスクロールし、矢印の選択で詳細を開く（FR-023）。 */
export function SequenceDiagram({
  items,
  selectedSeq,
  onSelect,
}: {
  items: SequenceItem[];
  selectedSeq: number | null;
  onSelect: (item: SequenceItem) => void;
}) {
  const box = useRef<HTMLDivElement>(null);
  useEffect(() => {
    const el = box.current;
    if (el) el.scrollTop = el.scrollHeight;
  }, [items.length]);
  const height = TOP + items.length * ROW + 24;

  return (
    <div ref={box} style={{ overflow: "auto", maxHeight: "52vh" }} data-testid="sequence-diagram">
      <svg viewBox={`0 0 ${WIDTH} ${height}`} width="100%" role="img" aria-label="システム間の通信のシーケンス図" style={{ minWidth: 640, maxWidth: 1100, display: "block", margin: "0 auto" }}>
        <defs>
          <marker id="arrow" viewBox="0 0 10 10" refX="9" refY="5" markerUnits="userSpaceOnUse" markerWidth="12" markerHeight="12" orient="auto-start-reverse">
            <path d="M 0 0 L 10 5 L 0 10 z" fill="currentColor" />
          </marker>
        </defs>
        {LANES.map(({ lane, title }) => (
          <g key={lane}>
            <text x={X[lane]} y={28} textAnchor="middle" fontWeight={700} fontSize={20} fill="var(--c-text)">
              {title}
            </text>
            <line x1={X[lane]} x2={X[lane]} y1={40} y2={height - 8} stroke="var(--c-border)" strokeWidth={2} strokeDasharray="6 6" />
          </g>
        ))}
        {items.map((item, i) => {
          const y = TOP + i * ROW + 32;
          const selected = item.seq === selectedSeq;
          if (item.kind === "demo") {
            return (
              <g key={item.seq} onClick={() => onSelect(item)} style={{ cursor: "pointer" }} data-testid={`seq-${item.seq}`}>
                <rect x={20} y={y - 18} width={WIDTH - 40} height={32} rx={8} fill={selected ? "#fff3b0" : "#eef2f6"} stroke="var(--c-border)" />
                <text x={WIDTH / 2} y={y + 4} textAnchor="middle" fontSize={18} fill="var(--c-muted)">
                  {item.seq} ─ {item.label} ─
                </text>
              </g>
            );
          }
          const x1 = X[item.from];
          const x2 = X[item.to];
          const color = item.kind === "notification" ? "var(--c-primary)" : item.ok ? "var(--c-text)" : "var(--c-error)";
          const mid = (x1 + x2) / 2;
          return (
            <g
              key={item.seq}
              onClick={() => onSelect(item)}
              style={{ cursor: "pointer", color }}
              data-testid={`seq-${item.seq}`}
              role="button"
              aria-label={`${item.seq} ${item.operator} ${item.label}`}
            >
              {/* 行全体を押せるようにする（塗りのない部分はクリックを受けないため、透明な当たり判定を置く） */}
              <rect x={4} y={y - 34} width={WIDTH - 8} height={ROW - 4} rx={8} fill={selected ? "#fff3b0" : "transparent"} opacity={selected ? 0.6 : 1} />
              <line
                x1={x1}
                x2={x2 + (x2 > x1 ? -6 : 6)}
                y1={y}
                y2={y}
                stroke="currentColor"
                strokeWidth={2.5}
                strokeDasharray={item.kind === "notification" ? "8 5" : undefined}
                markerEnd="url(#arrow)"
              />
              <text x={mid} y={y - 12} textAnchor="middle" fontSize={17} fill="currentColor">
                {item.seq}　{item.operator}：{item.label}
              </text>
              {item.result && (
                <text x={mid} y={y + 22} textAnchor="middle" fontSize={15} fill={item.ok ? "var(--c-muted)" : "var(--c-error)"}>
                  {item.result}
                </text>
              )}
              {item.detail && (
                <text x={mid} y={y + 22} textAnchor="middle" fontSize={15} fill="var(--c-muted)">
                  {item.detail}
                </text>
              )}
            </g>
          );
        })}
      </svg>
    </div>
  );
}
