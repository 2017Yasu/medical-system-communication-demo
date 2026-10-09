# Contract: WebSocket（S4 での変更）

S1 の [contracts/websocket.md](../../001-lab-order-workflow/contracts/websocket.md)・S3 の [contracts/websocket.md](../../003-ct-slot-booking/contracts/websocket.md) に対する変更だけを書く。
メッセージの形式（`bind` / `ping`、`traffic` / `demo.reset` / `demo.policy`、TrafficRecord の JSON）は変えない。S4 はデモのポリシーに項目を加えない。

## `/ws/subscription` — 追加の Subscription

各画面が開いた時点で `GET` → 無ければ `PUT` で作る（S1 のまま）。初期データには含めない。

| Subscription id | criteria | `bind` する画面（`X-Demo-Client`） |
|---|---|---|
| `ehr-rx-dr-x` | `Task?requester=Practitioner/dr-x` | 電子カルテ 処方（医師 X、`ehr-doctor`） |
| `ehr-rx-dr-y` | `Task?requester=Practitioner/dr-y` | 電子カルテ 処方（医師 Y、`ehr-doctor-y`） |
| `ehr-ward-surgery` | `Task?encounter=Encounter/adm-saburo` | 電子カルテ 病棟（看護師 F、`ehr-nurse-f`） |
| `pharmacy-dept` | `Task?owner=Organization/pharmacy-dept,PractitionerRole/ph-c,PractitionerRole/ph-e` | 薬剤部門システム（`pharmacy`。操作する薬剤師を切り替えても bind し直さない） |

- ping の通知記録（`kind = "notification"`）の `targetClient` は bind した画面の `X-Demo-Client`。S4 のステップの判定はこれを使う（data-model.md §4）。
- `ehr-rx-dr-x` の criteria は S1 の `ehr-dr-x` と同じだが、画面ごとに別の Subscription にする（S1 の画面を変えない）。
  両方の画面を開いていると、検体検査・処方のどちらの作業の更新でも両方に ping が届く。各画面は自分の一覧に関係しない作業を表示しない（research.md R-06）。

## TrafficRecord — 送信元の値（`client`）の追加

| `client` | 通信モニタ上の名前 | 列 |
|---|---|---|
| `ehr-nurse-f` | 看護師 F | 電子カルテ |
| `pharmacy` | 薬剤部門システム | 薬剤部門システム |
| `pharmacy-ph-c` | 薬剤師 C | 薬剤部門システム |
| `pharmacy-ph-e` | 薬剤師 E | 薬剤部門システム |

- `ehr-doctor`（医師 X）・`ehr-doctor-y`（医師 Y）は S1・S3 のまま。
- サーバーは `X-Demo-Client` の値を検証しない（S1 のまま）。名前と列は通信モニタ（UI）が決める。
