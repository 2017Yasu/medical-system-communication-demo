# Contract: WebSocket（S2 での変更）

S1 の [contracts/websocket.md](../../001-lab-order-workflow/contracts/websocket.md) に対する変更だけを書く。
`/ws/subscription`（`bind` / `ping`）と TrafficRecord の形式は S1 のまま。

## `/ws/monitor` — `demo.policy` の本文に `labSendsIfMatch` を追加

```jsonc
// ポリシーが変わった（PUT /demo/policy のたび。初期化では送らず demo.reset だけを送る）
{ "type": "demo.policy", "policy": { "ifMatchRequired": false, "taskTransitionCheck": true, "labSendsIfMatch": false } }
```

- 受け取る画面：
  - デモ制御パネル：現在の設定の表示を更新する。
  - 検体検査システム（技師 A・技師 B）：次の更新で If-Match を付けるかどうかを更新する。見出しの「版の確認：付ける／付けない（デモ設定）」も更新する。
  - 通信モニタ：S1 のまま（通信記録の「ポリシーの変更」イベントとして表示する）。
- `demo.reset` を受けた画面は、ポリシーが既定値（3 項目とも `true`）に戻ったものとして扱う（`GET /demo/policy` で取り直してもよい）。
- `/ws/monitor` に接続する前、または切断中に変更があった場合に備え、画面は開いたときと再接続（`socket.open` の `reconnect: true`）のときに
  `GET /demo/policy` で取り直す。
