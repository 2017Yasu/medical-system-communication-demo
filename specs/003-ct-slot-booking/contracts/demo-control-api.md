# Contract: デモ制御 API（S3 での変更）

S1 の [contracts/demo-control-api.md](../../001-lab-order-workflow/contracts/demo-control-api.md) と
S2 の [contracts/demo-control-api.md](../../002-concurrent-acceptance/contracts/demo-control-api.md) に対する変更だけを書く。
記載の無い事項（Base URL、`/demo/traffic`、初期化中の書き込みの待ち合わせ、S2 の準備の順序）は S1・S2 のまま。

## ポリシー

| メソッド | パス | 内容 | 応答 |
|---|---|---|---|
| `GET` | `/demo/policy` | 現在のポリシー | `200` `{ "ifMatchRequired": true, "taskTransitionCheck": true, "labSendsIfMatch": true, "ehrUsesSlotHold": true, "slotHoldSeconds": 30 }` |
| `PUT` | `/demo/policy` | 本文に含めた項目だけを変更する（部分更新）。変更後に通信記録（`kind = "demo"`、`event = "policy"`）と `/ws/monitor` の `demo.policy` を送る | `200` 変更後のポリシー（5 項目すべて）。`slotHoldSeconds` が不正なら `400`（何も変更しない） |
| `POST` | `/demo/reset` | S1 のまま。加えて、ポリシーの既定値に `ehrUsesSlotHold = true`・`slotHoldSeconds = 既定値` が加わり、仮押さえの保持（data-model.md §5）をすべて消す。予約枠（Slot）と初期の予約は、初期化した時点の翌日の日付で作り直す | S1 のまま |

### `PUT /demo/policy` の本文

```jsonc
// 例：S3-1 の準備（電子カルテは直接予約する）
{ "ehrUsesSlotHold": false }

// 例：仮押さえの期限を 60 秒にする
{ "slotHoldSeconds": 60 }
```

| 項目 | 型 | 省略時 | 不正な値 |
|---|---|---|---|
| `ifMatchRequired` | boolean | 変更しない | 無視（S1 のまま） |
| `taskTransitionCheck` | boolean | 変更しない | 無視（S1 のまま） |
| `labSendsIfMatch` | boolean | 変更しない | 無視（S2 のまま） |
| `ehrUsesSlotHold` | boolean | 変更しない | 無視 |
| `slotHoldSeconds` | 整数（1〜300） | 変更しない | **`400`** `{ "error": "slotHoldSeconds は 1〜300 の整数で指定してください" }`。ほかの項目も変更しない |

- `ehrUsesSlotHold` はサーバーの判定に使わない。電子カルテの CT 予約画面が、仮押さえを使うか直接予約するかの判断に使う（data-model.md §4）。
- `slotHoldSeconds` の変更は、変更後に受け付けた仮押さえから適用する（進行中の仮押さえの期限は変わらない）。
- デモ制御パネルの入力は 10〜300 に制限する（FR-003）。1〜9 は自動テストで期限切れを短時間に確かめるためにだけ使う。
- 既定値は環境変数 `SLOT_HOLD_SECONDS`（1〜300 の整数。未設定・不正なら 30）。サーバーの起動時に読む。
- 通信記録の `demoEvent.detail` は変更後の 5 項目。

## 準備ボタンが送る要求の順序（S3、デモ制御パネル、FR-002）

準備ボタンはサーバー側の専用 API を持たない。デモ制御パネルのウィンドウが次の順に送る（research.md R-11）。

| # | 要求 | 送信元 | 通信モニタ上の表示 |
|---|---|---|---|
| 1 | `POST /demo/reset` | —（デモ制御 API） | 「初期化」イベント |
| 2 | `PUT /demo/policy`（S3-1：`{ "ehrUsesSlotHold": false }`、S3-2・S3-3：`{ "ehrUsesSlotHold": true }`） | —（デモ制御 API） | 「ポリシーの変更」イベント |

- S3-2・S3-3 の 2 は既定値と同じ値を送る（設定を明示し、通信モニタに残すため）。
- どちらかが失敗したら以降を送らない。デモ制御パネルは失敗した段階（初期化／設定の切り替え）とエラーを表示する。
- 準備の完了は 2 の応答の受信とする（SC-006 の計測の終点は、電子カルテ・放射線部門システムのウィンドウが通知を受けて初期状態の枠の一覧を表示した時点）。
