# Contract: WebSocket

2 つのエンドポイントを提供する。どちらも同じ JAR・同じポートで配信する。

## `/ws/subscription` — Subscription 通知（R4 websocket チャネル）

FHIR R4 の websocket チャネルの方式に従うテキストメッセージ。

**接続**: `ws://{host}/ws/subscription?client={X-Demo-Client の値}`
（`client` は通信記録で通知先を表示するために使う。ブラウザの WebSocket は任意のヘッダを付けられないためクエリで渡す）

| 方向 | メッセージ | 意味 |
|---|---|---|
| 画面 → サーバー | `bind {Subscription id}` | この接続でその Subscription の通知を受ける。1 接続で複数 bind 可 |
| サーバー → 画面 | `bound {Subscription id}` | bind の成功 |
| サーバー → 画面 | `error {Subscription id} {理由}` | 存在しない、または `active` でない Subscription への bind |
| サーバー → 画面 | `ping {Subscription id}` | criteria に合うリソースが作成・更新された合図。本文は含まない |

- 通知の評価は、単一の create / update / patch、または Transaction の確定後に行う。1 つの Transaction で同じ Subscription に複数のリソースが該当しても ping は 1 回。
- ping を送るたびに通信記録に `notification` を 1 件追加する（通知先の接続ごと）。
- 画面は ping を受けたら、その画面が表示している一覧・詳細を FHIR の検索・read で取り直す（FR-022）。
- 接続が切れた場合、画面は再接続して bind し直し、表示中のデータを取り直す（spec Edge Cases）。
- 初期化（`/demo/reset`）で Subscription は消えるため、サーバーは全接続の bind を解除する。画面は `/ws/monitor` の `demo.reset` を受けて登録し直す。

## `/ws/monitor` — 通信記録とデモの合図

**接続**: `ws://{host}/ws/monitor`。サーバーからの一方向の JSON テキストメッセージ。

```jsonc
// 通信記録の追加
{ "type": "traffic", "record": { /* TrafficRecord（data-model.md §6） */ } }

// 初期化された（全画面は表示を初期状態に戻し、Subscription を登録し直す）
{ "type": "demo.reset", "timestamp": "2026-10-01T10:00:00+09:00" }

// ポリシーが変わった
{ "type": "demo.policy", "policy": { "ifMatchRequired": true, "taskTransitionCheck": true } }
```

### TrafficRecord の JSON 形式

```jsonc
{
  "seq": 12,
  "timestamp": "2026-10-01T10:15:00.123+09:00",
  "kind": "http",                         // "http" | "notification" | "demo"
  "client": "lis-tech-a",
  "request": {
    "method": "PATCH",
    "url": "/fhir/Task/123",
    "headers": { "If-Match": "W/\"2\"", "Content-Type": "application/json-patch+json" },
    "body": "[ ... ]"                       // 文字列のまま（表示時に整形）
  },
  "response": {
    "status": 200,
    "headers": { "ETag": "W/\"3\"" },
    "body": "{ ... }",
    "durationMs": 8
  },
  "notification": null,                   // kind = "notification" のとき
                                          // { "subscriptionId": "...", "targetClient": "...", "resource": "Task/123/_history/3" }
  "demoEvent": null                       // kind = "demo" のとき { "event": "reset" } など
}
```

- `seq` は初期化からの連番。`kind = "http"` の記録は**要求を受信した時点で採番**し、応答の完了後に記録・配信する。
  そのため、要求の処理中に発生した `notification`（ping）は、その要求より大きい `seq` を持つ一方で、先に配信されることがある。
  受信側（通信モニタ・シナリオの判定）は常に `seq` の順に並べて扱う。
- 本文は最大 256 KB まで記録し、超える分は切り詰めて `"truncated": true` を付ける。
- 接続直後の既存分は送らない。既存分は `/demo/traffic`（[demo-control-api.md](demo-control-api.md)）で取得する。
