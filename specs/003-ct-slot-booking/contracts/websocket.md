# Contract: WebSocket（S3 での変更）

S1 の [contracts/websocket.md](../../001-lab-order-workflow/contracts/websocket.md) と
S2 の [contracts/websocket.md](../../002-concurrent-acceptance/contracts/websocket.md) に対する変更だけを書く。
`/ws/subscription`（`bind` / `ping`）の手順は S1 のまま。

## `/ws/monitor` — `demo.policy` の本文に 2 項目を追加

```jsonc
{ "type": "demo.policy",
  "policy": { "ifMatchRequired": true, "taskTransitionCheck": true, "labSendsIfMatch": true,
              "ehrUsesSlotHold": false, "slotHoldSeconds": 30 } }
```

- 受け取る画面：
  - デモ制御パネル：予約方式・期限の表示を更新する。
  - 電子カルテの CT 予約画面（医師 X・医師 Y）：次に枠を選んだときの予約方式と、見出しの「予約方式」「期限」の表示を更新する。予約欄を開いている間は、その予約欄の方式を変えない（data-model.md §7 `mode`）。
- `demo.reset` の本文に、初期化後のポリシー（既定値）を載せる：`{ "type": "demo.reset", "timestamp": "…", "policy": { …5 項目… } }`。
  `slotHoldSeconds` の既定値は環境変数で変わりうるため、画面は本文の値を使う（`policy` が無いときは UI の既定値）。
  取り直し（`GET /demo/policy`）を使わないのは、準備ボタンの「初期化 → 設定の切り替え」の途中で取り直しの応答が古い値のまま後から届き、設定を上書きするのを防ぐため。

## TrafficRecord — `kind = "server"` を追加（research.md R-06、data-model.md §6）

```jsonc
{ "type": "traffic",
  "record": {
    "seq": 57,
    "timestamp": "2026-10-02T14:03:31.250+09:00",
    "kind": "server",
    "client": "server-slot-expiry",
    "request": null, "response": null, "notification": null, "demoEvent": null,
    "serverAction": {
      "action": "slot-hold-expired",
      "resource": "Slot/ct1-1000/_history/3",
      "before": { "status": "busy-tentative", "versionId": "2", "comment": "仮押さえ：医師 X" },
      "after": { "status": "free", "versionId": "3" },
      "holdSeconds": 30
    } } }
```

- 既存の種別（`http`・`notification`・`demo`）の記録では `serverAction` は `null`。
- 期限切れの更新で送られる ping の記録（`kind = "notification"`）は、この記録より後の seq を持つが、先に配信されることがある（S1 の規則どおり、受け取った側が seq 順に並べる）。
- `GET /demo/traffic` の応答にも同じ形で含まれる。

## `/ws/subscription` — 追加の Subscription

| Subscription id | criteria | bind する画面（`client`） |
|---|---|---|
| `ehr-ct-slots` | `Slot?schedule=Schedule/ct-1` | `ehr-doctor`（医師 X の CT 予約）、`ehr-doctor-y`（医師 Y の CT 予約） |
| `ris-slots` | `Slot?schedule=Schedule/ct-1` | `ris` |
| `ris-tasks` | `Task?owner=Organization/rad-dept` | `ris` |

- 1 つの画面が複数の Subscription に bind する場合（放射線部門システム）、接続は Subscription ごとに分ける（S1 の `openSubscriptionSocket` をそのまま使う）。
