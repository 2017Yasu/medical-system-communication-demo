# Contract: 画面（S2 での追加・変更）

S1 の [contracts/ui-screens.md](../../001-lab-order-workflow/contracts/ui-screens.md) に対する追加・変更を書く。
記載の無い事項（`X-Demo-Client` の値、Subscription、画面の更新の流れの 1・2・5、シナリオ定義の形式）は S1 のまま。

## ルート（追加）

| パス | 画面 | 備考 |
|---|---|---|
| `/control` | デモ制御パネル | 個別ウィンドウ。初期化、S2 の準備ボタン、版の確認の設定（R-08） |

- 入口（`/`）の「個別のウィンドウで開く」に「デモ制御パネル」を加える。続けて小見出し「S2 同時受付で開くウィンドウ」の下に、
  `/control`・`/lis?tech=tech-a`・`/lis?tech=tech-b`・`/monitor` へのリンクと「手順は docs/06-demo-procedures.md」の 1 行を置く。
- S2 はステージビュー（`/stage`）を使わない（D-29）。ステージビューの配置・シナリオの一覧は S1 のまま変えない（S2 のシナリオを追加しない）。

## デモ制御パネル（`/control`）

| 部品 | `data-testid` | 内容 |
|---|---|---|
| 初期化ボタン | `btn-reset` | S1 の `ResetButton` と同じ |
| 準備ボタン | `btn-prepare-s2-1`・`btn-prepare-s2-2`・`btn-prepare-s2-3` | 表示名「S2-1 の準備（ルール無し）」「S2-2 の準備（版の確認あり）」「S2-3 の準備（必須化）」。押すと contracts/demo-control-api.md の順に送る |
| 準備の状況 | `prepare-status` | 実行中は段階（「初期化しています」「設定を切り替えています」「依頼を登録しています」「採血を記録しています」）、完了は「S2-x の準備ができました」、失敗は段階と業務上のエラー |
| サーバーの版の確認 | `policy-if-match-required` | 「必須」「任意」の 2 択。現在値を選択状態で示す。変えると `PUT /demo/policy { ifMatchRequired }` |
| 検体検査システムの版の確認 | `policy-lab-sends-if-match` | 「付ける」「付けない（デモ専用）」の 2 択。変えると `PUT /demo/policy { labSendsIfMatch }` |

- 現在値は `GET /demo/policy` と `demo.policy` / `demo.reset`（contracts/websocket.md）で常に最新を表示する。
- 準備の実行中は、準備ボタン・設定の切り替え・初期化ボタンを押せない。
- 画面上の案内（次に押すボタンの強調など）は表示しない（D-29）。

## 検体検査システム（`/lis`）— 変更

### 見出し

- 見出しの横に「版の確認：付ける」または「版の確認：付けない（デモ設定）」を表示する（`data-testid="lab-if-match-mode"`）。
  値は `labSendsIfMatch`。開いたとき・再接続のときに `GET /demo/policy`、以後は `demo.policy` / `demo.reset` で更新する。

### 受付の 2 段階化（D-27、research.md R-03）

| 部品 | `data-guide` / `data-testid` | 表示する条件 | 動作 |
|---|---|---|---|
| 受付（受付を始める） | `accept-{srId}` | 作業が `requested` かつ採取済、かつこのウィンドウが受付中の作業を持っていない | `GET /Task/{taskId}` を送り、応答を受付中の作業（`AcceptDraft`）として保持し、確認欄を開く |
| 確認欄 | `accept-draft-{srId}` | このウィンドウがこの行の `AcceptDraft` を持っている（**行の現在の状態に関係なく**表示する） | 患者・検査・受付を始めた時刻・読み込んだ作業の状態・担当者・**読み込んだ版**（例：「版 2（W/"2"）をもとに受付します」） |
| 受付を確定 | `accept-confirm-{srId}` | 確認欄の中 | `PATCH /Task/{taskId}`。If-Match は `labSendsIfMatch` が `true` なら `AcceptDraft` の ETag、`false` なら付けない。本文は S1 と同じ（status・businessStatus・owner） |
| 取りやめ | `accept-cancel-{srId}` | 確認欄の中 | `AcceptDraft` を破棄する（通信は無い） |

- 確定の結果：
  - 200：確認欄を閉じ、一覧を取り直す。
  - 412：`GET /Task/{taskId}` で最新を取り直し、エラー欄に「この依頼は既に {担当者名} が受付済みです（412 Precondition Failed）」を表示する
    （最新が `accepted` 以降で担当が技師のとき。それ以外は S1 の 412 の文言）。確認欄を閉じ、一覧を取り直す。自動ではやり直さない。
  - 400（If-Match 無し）：エラー欄に「版の確認（If-Match）が無い更新はサーバーが受け付けません（400 Bad Request）」を表示し、確認欄を閉じ、一覧を取り直す。
  - その他：S1 のエラー表示のまま。
- 確認欄を開いている間も、一覧は通知で取り直される（行の状態・担当者は最新になる。確認欄の内容は変わらない）。
- 初期化（`demo.reset`）を受けたら確認欄を閉じる。

### 一覧の変化のアニメーション（D-28、research.md R-06）

- 取り直すたびに、直前の表示と作業の `status`・`businessStatus`・`owner` を比べ、変わった行に次を表示する。
  - 行の背景の点滅（1.2 秒 × 2。`prefers-reduced-motion: reduce` では点滅しない）。クラス名 `row-changed`。
  - 変わった項目ごとに「担当：技師 A → 技師 B」「状態：依頼済み `requested` → 受付済み `accepted`」の 1 行（`data-testid="row-change-{srId}"`）。10 秒で消える。
- 初回の表示と初期化の直後は比較しない。エラー・警告の見た目（赤色、警告アイコン）は使わない。

## 通信モニタ（`/monitor`）— 変更

- シーケンス図の矢印の注記：`PUT` と `PATCH` の要求には `If-Match: W/"n"` または `If-Match なし` を付ける（例：「PATCH Task/1（If-Match: W/"2"）」）。
- 応答の表示（`resultText`）：

  | 応答 | 表示 | 失敗の表示 |
  |---|---|---|
  | 412 | 412 他の利用者が先に更新済み | する（S1 のまま） |
  | 400（応答本文の diagnostics に `If-Match` を含む） | 400 版の確認が必要 | する |
  | 400（その他） | 400 要求の形式が不正 | する（S1 のまま） |

- 版の履歴：
  - 列「この版を作った通信」に送信元の画面名（例：「技師 B」）を併記する。
  - 1 つ前の版から変わった `status`・`businessStatus`・`owner` のセルを強調表示する（`data-testid="history-changed-{versionId}-{field}"`）。

## エラーの表示（FR-022）— 変更

| 応答 | 表示（S1 から変わる部分は太字） |
|---|---|
| 400（If-Match 無し） | **「版の確認（If-Match）が無い更新はサーバーが受け付けません」** |
| 412（受付の確定で、最新が受付済み） | **「この依頼は既に {担当者名} が受付済みです」** |
| 412（その他） | 「他の利用者が先に更新しました。最新の状態を表示します」（S1 のまま） |

## S1 のシナリオ定義への影響（D-27、research.md R-09）

- `s1-main` のステップ 4「技師 A が検体を受付」：
  - `target.control` を `accept-{id},accept-confirm-{id}` にする（自習モードの案内は「受付」→「受付を確定」の順に強調）。
  - `run`（自動実行）は `GET /Task/{id}` → `PATCH /Task/{id}`（If-Match 付き）を送る。
  - 通信の条件（`traffic`）は `http lis-tech-a PATCH Task` のまま。
- バリエーション（`s1-cancel`・`s1-rerun`・`s1-partial`）の受付のステップも同じ。
- 画面の更新の流れ（S1 の 3）：「操作するとき：表示中のリソースの ETag を保持し…」に、
  「受付だけは、受付を始めた時点で取得した ETag を使う（D-27）」を加える。
