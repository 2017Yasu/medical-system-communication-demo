import { holderName, statusLabel } from "../fhir/labels";
import type { SequenceItem } from "./sequenceModel";
import { JsonView } from "./JsonView";
import { summarizeTransaction, type TransactionSummary } from "./transactionSummary";

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

const STATE_BADGE: Record<string, string> = { ok: "ok", failed: "error", cancelled: "" };

/** 「一括送信の中身」：Transaction の各エントリの要求・版の確認・結果。失敗したときは全体が取り消されたことを示す（specs/003 FR-023）。 */
function TransactionEntries({ summary }: { summary: TransactionSummary }) {
  return (
    <section aria-label="一括送信の中身" data-testid="transaction-entries">
      <h3>一括送信の中身</h3>
      <table className="data">
        <thead>
          <tr>
            <th>#</th>
            <th>要求</th>
            <th>版の確認</th>
            <th>結果</th>
          </tr>
        </thead>
        <tbody>
          {summary.rows.map((row) => (
            <tr key={row.index} data-testid={`transaction-entry-${row.index}`} data-state={row.state}>
              <td>{row.index}</td>
              <td>
                <code>{row.request}</code>
              </td>
              <td>{row.ifMatch ? <code>ifMatch: {row.ifMatch}</code> : "—"}</td>
              <td>
                <span className={`badge ${STATE_BADGE[row.state]}`}>{row.result}</span>
              </td>
            </tr>
          ))}
        </tbody>
      </table>
      {summary.cancelledAll && <p role="status">一括送信の全体が取り消されました（何も登録されていません）</p>}
    </section>
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
          {r.request.method === "POST" && /^\/fhir\/?$/.test(r.request.url) && !r.request.truncated && (() => {
            const summary = summarizeTransaction(r.request.body, r.response.status, r.response.body);
            return summary ? <TransactionEntries summary={summary} /> : null;
          })()}
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
      {r.kind === "server" && r.serverAction && (
        <section aria-label="サーバー内の処理" data-testid="server-action-detail">
          <p>
            <strong>{item.operator}</strong>：サーバーの規則による自動の更新です（期限 {r.serverAction.holdSeconds} 秒）。HTTP の要求ではありません。
          </p>
          <table className="data">
            <tbody>
              <tr>
                <th>対象</th>
                <td>
                  <code>{r.serverAction.resource}</code>
                </td>
              </tr>
              <tr>
                <th>変更前</th>
                <td>
                  {statusLabel("slot", r.serverAction.before.status)} <span className="code">{r.serverAction.before.status}</span>・版{" "}
                  {r.serverAction.before.versionId}
                  {r.serverAction.before.comment && <>・押さえた人：{holderName(r.serverAction.before.comment) ?? r.serverAction.before.comment}</>}
                </td>
              </tr>
              <tr>
                <th>変更後</th>
                <td>
                  {statusLabel("slot", r.serverAction.after.status)} <span className="code">{r.serverAction.after.status}</span>・版{" "}
                  {r.serverAction.after.versionId}
                </td>
              </tr>
            </tbody>
          </table>
          <p className="muted">仮押さえのまま期限を過ぎた枠を、サーバーが空きに戻しました。通常の更新と同じく版が上がり、通知（ping）が送られます。</p>
        </section>
      )}
      {r.kind === "demo" && <p>デモの進行のための操作です：{item.label}</p>}
    </section>
  );
}
