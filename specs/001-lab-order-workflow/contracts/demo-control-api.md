# Contract: デモ制御 API

**Base URL**: `http://localhost:8080/demo`（`application/json`）

デモの進行のためのメタ操作。業務情報は扱わない（原則 I の対象外。plan.md Constitution Check）。
FHIR の API ではないため、`/fhir` の通信記録には含めず、操作の結果を `kind = "demo"` のイベントとして記録する。

| メソッド | パス | 内容 | 応答 |
|---|---|---|---|
| `POST` | `/demo/reset` | 全リソース・通信記録を消去し、初期データを再投入する。Subscription の bind をすべて解除し、ポリシーを既定値（If-Match 必須・遷移チェック ON）に戻し、`/ws/monitor` に `demo.reset` を配信する | `200` `{ "resetAt": "...", "seedResources": 12 }` |
| `GET` | `/demo/policy` | 現在のポリシー | `200` `{ "ifMatchRequired": true, "taskTransitionCheck": true }` |
| `PUT` | `/demo/policy` | ポリシーを変更し、`/ws/monitor` に `demo.policy` を配信する。本機能の UI からは使わない（S2 で使う） | `200` 変更後のポリシー |
| `GET` | `/demo/traffic` | 初期化以降の通信記録を `seq` の昇順で返す。`?after={seq}` でそれ以降のみ | `200` `{ "records": [ TrafficRecord, ... ] }` |

- 初期化は 10 秒以内に完了する（SC-003）。初期化中に届いた FHIR の書き込み要求は、初期化の完了まで待たせてから処理する（書き込みロックを共有）。
  読み取り要求は待たせず、初期化前か初期化後のどちらかの完全な状態を返す（途中の状態は返さない。research.md R-06）。
- 起動時にも初期化と同じ処理を行う。
