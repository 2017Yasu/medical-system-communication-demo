# Data Model: S2 排他制御①：同時受付

**Feature**: [spec.md](spec.md) | **Research**: [research.md](research.md)

FHIR リソース（Patient・Practitioner・PractitionerRole・Organization・ServiceRequest・Task・Specimen）と初期データは
S1 の [data-model.md](../001-lab-order-workflow/data-model.md) のまま変えない。新しい FHIR リソース・検索パラメータ・コードは無い。
本書は S2 で追加・変更する、デモのポリシーと画面側の状態、および S2 の各シナリオでの作業（Task）の版の変化を定める。

## 1. デモのポリシー（サーバー、`DemoPolicy`）— 変更

| 項目 | 型 | 既定値 | 意味 | 変更 |
|---|---|---|---|---|
| `ifMatchRequired` | boolean | `true` | サーバーの版の確認。`true`＝必須（If-Match の無い update / patch を 400）、`false`＝任意（無ければ版を確かめずに更新） | S1 のまま |
| `taskTransitionCheck` | boolean | `true` | Task の状態遷移チェック | S1 のまま（S2 では切り替えない） |
| `labSendsIfMatch` | boolean | `true` | 検体検査システム（技師 A・技師 B）が更新時に If-Match を付けるか。**サーバーの判定には使わない**（画面だけが読む、デモ専用の設定。R-01） | **追加** |

- 初期化（`POST /demo/reset`）とサーバーの起動で、3 つとも既定値に戻る。
- 変更は `PUT /demo/policy` で、指定した項目だけを変える（部分更新）。変更のたびに `kind = "demo"`・`event = "policy"` の通信記録と
  `/ws/monitor` の `demo.policy` を送る（[contracts/demo-control-api.md](contracts/demo-control-api.md)）。
- 電子カルテは `labSendsIfMatch` に関係なく常に If-Match（Transaction では `ifMatch`）を付ける（FR-006）。

## 2. S2 のシナリオの設定（準備ボタンが設定する値）

| シナリオ | `ifMatchRequired` | `labSendsIfMatch` | 技師 A の確定 | 技師 B の確定 | 作業の最終状態 |
|---|---|---|---|---|---|
| S2-1 ルール無し | `false`（任意） | `false`（付けない） | 200 → 版 2 | 200 → 版 3 | 版 3：受付済み・検体到着・担当 技師 B |
| S2-2 版の確認あり | `true`（必須） | `true`（付ける） | 200 → 版 2 | **412** | 版 2：受付済み・検体到着・担当 技師 A |
| S2-3 必須化 | `true`（必須） | `false`（付けない） | **400** | （操作しない。押しても 400） | 版 1：依頼済み・採取済・担当 検査部 |

`taskTransitionCheck` はすべて `true` のまま。S2-1 の技師 B の更新は `accepted → accepted`（同じ状態への更新）なので遷移チェックを通る（docs/04、
`TaskTransitionRule` は `from == to` を許可）。遷移チェックでは Lost Update を防げないことを手順書で解説する。

## 3. 作業（Task）の版の変化

準備ボタンの処理（依頼・採血）の後、作業は版 1 から始まる（依頼の Transaction で作成 = 版 1、採血の Transaction で更新 = 版 2 となるため、
**実際の版番号は準備の後で 2**。以下では「準備後の版」を v<sub>0</sub> とし、受付で +1 ずつ進む）。

| 時点 | S2-1 | S2-2 | S2-3 |
|---|---|---|---|
| 準備後（v<sub>0</sub>） | requested・採取済・検査部 | 同左 | 同左 |
| 技師 A・技師 B が受付を始める | 両者が v<sub>0</sub> を保持 | 両者が v<sub>0</sub> を保持 | 技師 A が v<sub>0</sub> を保持 |
| 技師 A が確定 | v<sub>0</sub>+1：accepted・検体到着・技師 A | v<sub>0</sub>+1：accepted・検体到着・技師 A | 400、v<sub>0</sub> のまま |
| 技師 B が確定 | v<sub>0</sub>+2：accepted・検体到着・**技師 B** | 412、v<sub>0</sub>+1 のまま | — |

> spec と docs/02 の「版 1・版 2・版 3」は、受付の場面だけを切り出した説明上の番号である。画面・通信モニタ・手順書は実際の版番号
> （`meta.versionId`、ETag）をそのまま表示し、手順書では「準備の後の版（例：2）」と書く。テストは実際の版番号で判定する。

## 4. 受付中の作業（画面、`AcceptDraft`）— 追加

検体検査システムの各ウィンドウが持つ一時的な状態。サーバーには保存しない。

| 項目 | 型 | 内容 |
|---|---|---|
| `taskId` | string | 対象の作業の id |
| `serviceRequestId` | string | 対象の依頼の id（一覧の行との対応付け） |
| `task` | `Versioned<Task>` | 「受付を始める」の `GET /Task/{id}` の応答（リソースと ETag） |
| `openedAt` | string（ISO 8601） | 受付を始めた時刻（確認欄に表示） |
| `result` | `null` \| `"conflict"` \| `"missing-if-match"` \| `"error"` | 確定に失敗したときの種別（成功時は `AcceptDraft` を破棄する） |

- 状態の遷移：無し →（受付を始める）→ 保持中 →（確定 200）→ 無し ／（確定 412・400・その他）→ 無し（エラーの表示は画面のエラー欄に残す）／（取りやめ）→ 無し。
- 保持中は、通知で一覧が取り直されても `task` を変えない（R-03）。初期化（`demo.reset`）を受けたら破棄する。
- 1 つのウィンドウで同時に保持できる `AcceptDraft` は 1 つ。保持中は、ほかの行の「受付」ボタンを押せない。
- 確定時の If-Match：`labSendsIfMatch = true` なら `task.etag`、`false` なら付けない。

## 5. 一覧の行の変化（画面、`RowChange`）— 追加

| 項目 | 型 | 内容 |
|---|---|---|
| `taskId` | string | 変わった作業の id |
| `fields` | `{ field: "status" \| "businessStatus" \| "owner"; before: string; after: string }[]` | 変わった項目と、変更前・変更後の表示ラベル（docs/04） |
| `detectedAt` | number（ms） | 検出した時刻。10 秒経過で表示を消す |

- 直前に表示した一覧と、新しく取得した一覧を作業の id で突き合わせて作る（`diffRows`、R-06）。新しく現れた行・消えた行は対象外。
- 直前の一覧が無い場合（初回の表示、初期化の直後）は作らない。

## 6. 版の履歴の差分（通信モニタ、`VersionDiff`）— 追加

| 項目 | 型 | 内容 |
|---|---|---|
| `versionId` | string | 版 |
| `changed` | `("status" \| "businessStatus" \| "owner")[]` | 1 つ前の版から変わった項目（最古の版は空） |
| `causeClient` | string \| null | この版を作った通信の送信元（`X-Demo-Client`。表示は「技師 A」などの名前） |

## 7. 準備の処理（デモ制御パネル、`PrepareRun`）— 追加

| 項目 | 型 | 内容 |
|---|---|---|
| `scenario` | `"s2-1"` \| `"s2-2"` \| `"s2-3"` | 準備するシナリオ |
| `stage` | `"reset"` \| `"policy"` \| `"order"` \| `"collect"` \| `"done"` | 実行中（または失敗した）段階 |
| `error` | `DisplayError` \| null | 失敗したときの業務上のエラー（S1 の `errors.ts`） |

- 段階は `reset → policy → order → collect → done` の順に進む。失敗したらその段階で止め、`error` を表示する。
- 準備の実行中は、準備ボタンと設定の切り替えを押せない。
