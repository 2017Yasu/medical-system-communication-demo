import type { SequenceItem } from "./sequenceModel";
import { JsonView } from "./JsonView";

const KEY_HEADERS = ["If-Match", "If-None-Exist", "ETag"];

function Headers({ headers }: { headers: Record<string, string> }) {
  const entries = Object.entries(headers);
  if (entries.length === 0) return <span className="muted">（主要なヘッダなし）</span>;
  return (
    <table className="data">
      <tbody>
        {entries.map(([k, v]) => (
          <tr key={k}>
            <th style={{ width: "30%" }}>{k}</th>
            <td>
              <code style={KEY_HEADERS.includes(k) ? { fontWeight: 700, background: "#fff3b0" } : undefined}>{v}</code>
              {k === "If-Match" && <span className="muted">　← 自分が読んだ版から変わっていなければ更新する</span>}
              {k === "ETag" && <span className="muted">　← このリソースの現在の版</span>}
            </td>
          </tr>
        ))}
      </tbody>
    </table>
  );
}

/** 選んだ通信の詳細：要求と応答の本文、主要なヘッダ、応答の業務上の意味（FR-024）。 */
export function TrafficDetail({ item }: { item: SequenceItem | null }) {
  if (!item) {
    return (
      <section className="panel" aria-label="通信の詳細">
        <h2>通信の詳細</h2>
        <p className="muted">シーケンス図の矢印を選ぶと、要求と応答の内容が表示されます。</p>
      </section>
    );
  }
  const r = item.record;
  return (
    <section className="panel" aria-label="通信の詳細" data-testid="traffic-detail">
      <h2>
        通信 {item.seq}：{item.label}
      </h2>
      {r.kind === "http" && r.request && r.response && (
        <>
          <p>
            <strong>{item.operator}</strong> → FHIR サーバー　
            <span className={`badge ${item.ok ? "ok" : "error"}`}>{item.result}</span>　
            <span className="muted">{r.response.durationMs} ms</span>
          </p>
          <h3>要求 <code className="code">{r.request.method} {r.request.url}</code></h3>
          <Headers headers={r.request.headers} />
          <JsonView text={r.request.body} truncated={r.request.truncated} />
          <h3>応答 <code className="code">{r.response.status}</code></h3>
          <Headers headers={r.response.headers} />
          <JsonView text={r.response.body} truncated={r.response.truncated} />
        </>
      )}
      {r.kind === "notification" && r.notification && (
        <>
          <p>
            FHIR サーバー → <strong>{item.operator}</strong> の画面へ通知（<code>{r.notification.subscriptionId}</code>）
          </p>
          <p>
            きっかけ：<code>{r.notification.resource}</code>
          </p>
          <p className="muted">
            通知は「変更があった」という合図だけで、中身は含みません。受け取った画面が、最新の内容を取りに行きます。
          </p>
        </>
      )}
      {r.kind === "demo" && <p>デモの進行のための操作です：{item.label}</p>}
    </section>
  );
}
