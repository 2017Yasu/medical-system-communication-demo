# Contract: デモ制御 API（S2 での変更）

S1 の [contracts/demo-control-api.md](../../001-lab-order-workflow/contracts/demo-control-api.md) に対する変更だけを書く。
記載の無い事項（Base URL、`/demo/reset`・`/demo/traffic`、初期化中の書き込みの待ち合わせ）は S1 のまま。

## ポリシー

| メソッド | パス | 内容 | 応答 |
|---|---|---|---|
| `GET` | `/demo/policy` | 現在のポリシー | `200` `{ "ifMatchRequired": true, "taskTransitionCheck": true, "labSendsIfMatch": true }` |
| `PUT` | `/demo/policy` | 本文に含めた項目だけを変更する（部分更新）。変更後に通信記録（`kind = "demo"`、`event = "policy"`）と `/ws/monitor` の `demo.policy` を送る。**S2 のデモ制御パネルから使う** | `200` 変更後のポリシー（3 項目すべて） |
| `POST` | `/demo/reset` | S1 のまま。ポリシーの既定値に `labSendsIfMatch = true` が加わる | S1 のまま |

### `PUT /demo/policy` の本文

```jsonc
// 例：S2-1 の準備（サーバーは任意、検体検査システムは付けない）
{ "ifMatchRequired": false, "labSendsIfMatch": false }
```

| 項目 | 型 | 省略時 |
|---|---|---|
| `ifMatchRequired` | boolean | 変更しない |
| `taskTransitionCheck` | boolean | 変更しない |
| `labSendsIfMatch` | boolean | 変更しない |

- S1 と同じく、未知の項目と、値が boolean でない項目は無視する（変更しない）。本文を JSON として解析できなければ `400`。
- `labSendsIfMatch` はサーバーの判定に使わない。検体検査システムの画面が、更新時に If-Match を付けるかどうかの判断に使う（data-model.md §1）。
- 通信記録の `demoEvent.detail` は変更後の 3 項目（`{ "ifMatchRequired": false, "taskTransitionCheck": true, "labSendsIfMatch": false }`）。

## 準備ボタンが送る要求の順序（デモ制御パネル、FR-001）

準備ボタンはサーバー側の専用 API を持たない。デモ制御パネルのウィンドウが次の順に送る（research.md R-02）。

| # | 要求 | 送信元（`X-Demo-Client`） | 通信モニタ上の表示 |
|---|---|---|---|
| 1 | `POST /demo/reset` | —（デモ制御 API） | 「初期化」イベント |
| 2 | `PUT /demo/policy`（data-model.md §2 の値） | —（デモ制御 API） | 「ポリシーの変更」イベント |
| 3 | `POST /fhir`（依頼の Transaction。S1 のステップ 1 と同じ） | `ehr-doctor` | 電子カルテ（医師 X）→ FHIR サーバー |
| 4 | `GET /fhir/ServiceRequest?…`・`GET /fhir/Task?…`（採血の対象の取得） | `ehr-nurse` | 電子カルテ（看護師 D）→ FHIR サーバー |
| 5 | `POST /fhir`（採血の Transaction。S1 のステップ 3 と同じ） | `ehr-nurse` | 電子カルテ（看護師 D）→ FHIR サーバー |

- 2 の後に 3 を送るのは、初期化でポリシーが既定値に戻るため。3 と 5 は電子カルテとして送るので、`labSendsIfMatch` に関係なく `ifMatch` を付ける。
- どれかが失敗したら以降を送らない。デモ制御パネルは失敗した段階（初期化／設定の切り替え／依頼／採血）と業務上のエラーを表示する。
- 準備の完了は 5 の応答の受信とする（SC-005 の計測の終点は、検体検査システムのウィンドウが通知を受けて準備後の作業を表示した時点）。
