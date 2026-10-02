# Contract: 画面（S3 での追加・変更）

S1 の [contracts/ui-screens.md](../../001-lab-order-workflow/contracts/ui-screens.md) と
S2 の [contracts/ui-screens.md](../../002-concurrent-acceptance/contracts/ui-screens.md) に対する追加・変更を書く。
記載の無い事項（画面の更新の流れ、エラーの表示の共通部分、ステージビュー、S1 のシナリオ定義、S2 の画面）は S1・S2 のまま。

## ルート（追加）

| パス | 画面 | 備考 |
|---|---|---|
| `/ehr/ct?doctor=dr-x` | 電子カルテ CT 予約（医師 X） | 個別ウィンドウ（research.md R-04） |
| `/ehr/ct?doctor=dr-y` | 電子カルテ CT 予約（医師 Y） | 個別ウィンドウ。`doctor` が無い・不正なら医師 X |
| `/ris` | 放射線部門システム | 個別ウィンドウ。予約枠のカレンダーと予約・作業の一覧（D-34） |

- 入口（`/`）の「個別のウィンドウで開く」に上の 3 つを加える。続けて小見出し「S3 予約枠の取り合いで開くウィンドウ」の下に、
  `/control`・`/ehr/ct?doctor=dr-x`・`/ehr/ct?doctor=dr-y`・`/ris`・`/monitor` へのリンクと「手順は docs/06-demo-procedures.md」の 1 行を置く。
- 電子カルテ（`/ehr`）の見出しに「CT 予約」へのリンクを、CT 予約の見出しに「検体検査」（`/ehr?role=doctor`）へのリンクを置く（医師 Y の CT 予約からは検体検査へのリンクを出さない）。
- S3 はステージビューを使わない（D-33）。ステージビューの配置・シナリオの一覧は変えない。

## `X-Demo-Client` の値と Subscription（追加）

| 画面 | `X-Demo-Client` | 通信モニタ上の名前 | Subscription id | criteria |
|---|---|---|---|---|
| 電子カルテ CT 予約（医師 X） | `ehr-doctor` | 医師 X | `ehr-ct-slots` | `Slot?schedule=Schedule/ct-1` |
| 電子カルテ CT 予約（医師 Y） | `ehr-doctor-y` | 医師 Y | `ehr-ct-slots` | 同上（同じ Subscription に bind する） |
| 放射線部門システム | `ris` | 放射線部門システム | `ris-slots`、`ris-tasks` | `Slot?schedule=Schedule/ct-1`、`Task?owner=Organization/rad-dept` |
| 仮押さえの期限切れ（サーバー内の処理） | `server-slot-expiry`（通信記録の `client`） | FHIR サーバー（仮押さえの期限切れ） | — | — |

## 電子カルテ CT 予約（`/ehr/ct`）

### 見出し

- 「電子カルテ（医師 X）CT 予約」。横に現在の設定を小さく表示する（`data-testid="ct-booking-mode"`）：
  「予約方式：仮押さえを使う（期限 30 秒）」または「予約方式：直接予約する（デモ設定）」。値は `ehrUsesSlotHold`・`slotHoldSeconds`（S2 の `usePolicy` で購読）。操作の案内はしない。

### 枠の一覧

| 列 | 内容 |
|---|---|
| 日時 | 「10/3（土）10:00–10:30」（日本時間） |
| 状態 | 業務用語 + コード値（「空き `free`」「仮押さえ中 `busy-tentative`」「予約済み `busy`」）。仮押さえ中は `comment` の名前を併記（「仮押さえ中（医師 X）」） |
| 版 | `W/"2"` |
| 操作 | 「枠を選ぶ」（`data-testid="slot-select-{slotId}"`） |

- 「枠を選ぶ」を押せる条件：このウィンドウが予約中の枠（`BookingDraft`）を持っていない、かつ（仮押さえを使う方式なら状態が `free`／直接予約する方式なら常に）。
- 一覧は通知（`ehr-ct-slots`）のたびに取り直す。S2 の行の変化の表示（`rowChanges`。状態・押さえた人が変わった行の「変更前 → 変更後」）を使う。

### 予約欄（`data-testid="booking-draft"`）

`BookingDraft` を持っている間、一覧の下に開く（行の現在の状態に関係なく表示する。data-model.md §7）。

| 部品 | `data-testid` | 表示する条件 | 動作 |
|---|---|---|---|
| 選んだ枠 | `booking-slot` | 常に | 日時・選んだ時点の状態・**選んだ時点の版**（例：「版 1（W/"1"）をもとに予約します」） |
| 患者 | `booking-patient` | 常に | 選択肢は全患者。既定は医師 X：デモ 太郎、医師 Y：デモ 花子 |
| 検査内容 | `booking-procedure` | 常に | 頭部 CT（単純）／胸部 CT（単純）／腹部 CT（造影）。既定は胸部 CT（単純） |
| 仮押さえする | `booking-hold` | 方式が `hold` で、まだ仮押さえしていない | `PUT /Slot/{id}`（contracts/fhir-api.md「仮押さえ」） |
| 残り時間 | `booking-remaining` | 仮押さえ中 | 「確定までの残り 23 秒」。0 になったら「期限切れ（サーバーの処理を待っています）」。表示は目安で、判定はサーバー |
| 確定する | `booking-confirm` | 仮押さえ中（残り時間が 0 でも押せる） | 確定の Transaction |
| 予約を確定する | `booking-confirm-direct` | 方式が `direct` | 直接予約の Transaction（Slot の更新を含まない） |
| 取りやめる | `booking-cancel` | 常に | 仮押さえ中なら `PUT /Slot/{id}`（`free`）、それ以外は通信なしで閉じる |

- 結果の表示（エラー欄は S1 の `ErrorBanner`、成功は予約欄の下のメッセージ `data-testid="booking-result"`）：

  | 操作 | 応答 | 表示 | 予約欄 |
  |---|---|---|---|
  | 仮押さえする | 200 | 残り時間の表示を始める | 開いたまま |
  | 仮押さえする | 412 | 最新の枠を GET し、「この枠は 医師 X が仮押さえ中です。別の枠を選んでください（412 Precondition Failed）」／「この枠は既に予約済みです。別の枠を選んでください（412 Precondition Failed）」／S1 の 412 の文言 | 閉じる |
  | 確定する・予約を確定する | 200 | 「予約しました（オーダー番号 R-20261002-X001、10/3（土）10:00 胸部 CT（単純）デモ 太郎）」 | 閉じる |
  | 確定する | 412 | 「仮押さえの期限が切れました。枠を選び直してください（412 Precondition Failed）」 | 閉じる |
  | 取りやめる | 200 | なし | 閉じる |
  | 取りやめる | 412 | 「仮押さえの期限が切れていました」（エラーにしない） | 閉じる |
  | いずれか | その他 | S1 のエラー表示のまま | 閉じる |

- いずれの失敗も自動ではやり直さず、一覧を取り直す。
- 初期化（`demo.reset`）を受けたら予約欄を閉じる。

## 放射線部門システム（`/ris`）

### 予約枠のカレンダー（`data-testid="ris-calendar"`）

| 列 | 内容 |
|---|---|
| 日時 | 電子カルテと同じ |
| 枠の状態 | 業務用語 + コード値、仮押さえ中は押さえた人 |
| 予約 | その枠を参照する `booked` の Appointment の患者名（複数なら並べる） |

- 同じ枠に `booked` の予約が 2 件以上ある行は、行全体を強調し「同じ枠に予約が 2 件あります」を表示する（`data-testid="ris-double-booking-{slotId}"`。FR-009）。
  強調は注意の色（`--c-warn`）を使うが、エラーのアイコンは使わない（サーバーの判定ではない）。
- 枠の状態が `free` なのに予約がある行は、「枠は空きのまま」を併記する（S3-1 で、枠を確認しない予約だったことが分かるように）。
- S2 の行の変化の表示（`rowChanges`）を、枠の状態・押さえた人・予約の件数に使う。

### 予約・作業の一覧（`data-testid="ris-orders"`）

| 列 | 内容 |
|---|---|
| 予約日時 | Appointment の `start`（日本時間） |
| 患者 | 患者名 |
| 検査内容 | ServiceRequest の `code` の表示名 |
| 依頼医 | 医師 X / 医師 Y |
| オーダー番号 | ServiceRequest の `identifier` |
| 作業の状態 | 「依頼済み `requested`・予約済み」（Task の status と businessStatus） |

- 初期データの予約（ServiceRequest・Task の無い Appointment）は、検査内容・依頼医・オーダー番号を「（初期データの予約）」と表示する。
- 受付・撮影の操作部品は置かない（D-34）。
- 一覧は `ris-slots`・`ris-tasks` のどちらの通知でも取り直す（`useLiveData` に Subscription を 2 つ渡す。research.md R-07）。

## デモ制御パネル（`/control`）— 追加

| 部品 | `data-testid` | 内容 |
|---|---|---|
| 準備ボタン | `btn-prepare-s3-1`・`btn-prepare-s3-2`・`btn-prepare-s3-3` | 表示名「S3-1 の準備（直接予約）」「S3-2 の準備（仮押さえ）」「S3-3 の準備（期限切れ）」。contracts/demo-control-api.md の順に送る |
| 準備の状況 | `prepare-status` | S2 と共用。S3 の段階は「初期化しています」「設定を切り替えています」、完了は「S3-x の準備ができました」 |
| 予約方式 | `policy-ehr-uses-slot-hold` | 「仮押さえを使う」「直接予約する（デモ専用）」の 2 択。`PUT /demo/policy { ehrUsesSlotHold }` |
| 仮押さえの期限 | `policy-slot-hold-seconds` | 10〜300 の数値入力と「変更」ボタン。現在値を表示。範囲外は送らずに「10〜300 秒で指定してください」 |

- S2 と同じく、準備の実行中は準備ボタン・設定の切り替え・初期化ボタンを押せない。画面上の案内は表示しない（D-33）。
- 節の見出しは「S2 同時受付の準備」「S3 予約枠の取り合いの準備」「設定」（版の確認・予約方式・期限をまとめる）。

## 通信モニタ（`/monitor`）— 変更（research.md R-06・R-10）

- シーケンス図の列：電子カルテ・FHIR サーバーは常に表示し、検体検査システム・放射線部門システムは、表示中の通信記録にその画面の記録があるときだけ表示する。
  列の名前は「放射線部門システム」。`laneOf`：`ris` → 放射線部門システム、`server-slot-expiry` → FHIR サーバー。
- 名前（`clientName`）：`ehr-doctor-y` → 医師 Y、`ris` → 放射線部門システム、`server-slot-expiry` → FHIR サーバー（仮押さえの期限切れ）。
- `kind = "server"` の記録：FHIR サーバーの列の中の閉じた矢印として表示し、注記は「FHIR サーバー：仮押さえの期限切れ Slot/ct1-1000（仮押さえ中 → 空き、版 2 → 3）」。
  詳細欄には「サーバーの規則による自動の更新です（期限 30 秒）」と、変更前・変更後の状態・版・押さえた人を表示する（`data-testid="server-action-detail"`）。
- Transaction の矢印の注記：Slot の PUT を含むものは「POST Transaction（一括登録・枠の版の確認あり）」、含まないものは「POST Transaction（一括登録）」。
- Transaction の詳細欄に「一括送信の中身」の表（`data-testid="transaction-entries"`）を加える：

  | # | 要求 | 版の確認 | 結果 |
  |---|---|---|---|
  | 0 | PUT Slot/ct1-1000 | `ifMatch: W/"2"` | 200 OK |
  | 1 | POST Appointment | — | 201 Created → Appointment/1 |
  | 2 | POST ServiceRequest | — | 201 Created → ServiceRequest/1 |
  | 3 | POST Task | — | 201 Created → Task/1 |

  失敗した Transaction では、OperationOutcome の `Bundle.entry[n]` のエントリを「失敗」、それ以外を「取り消し（登録されていない）」と表示し、
  表の下に「一括送信の全体が取り消されました（何も登録されていません）」を出す。
- 版の履歴：
  - 対象の候補に、Transaction の要求の `entry.request.url`（PUT）、応答の `entry.response.location`、Appointment の `slot` の参照を加える。
  - Slot では、比べる項目を「状態（`status`）・押さえた人（`comment`）」にし、列名もそれに合わせる。
  - 「この版を作った通信」に、`kind = "server"` の記録（`serverAction.resource` が一致するもの）を「FHIR サーバー（仮押さえの期限切れ）」として表示する。

## 表示ラベル（FR-024）— 追加

`fhir/labels.ts` の Slot・Appointment のラベル（docs/04）は既にある。追加するもの：

| 対象 | コード | 表示 |
|---|---|---|
| Task.businessStatus（放射線） | `booked` | 予約済み |
| ServiceRequest.category | `363679005` | 画像検査 |
| 予約方式（デモ設定） | `ehrUsesSlotHold = true` / `false` | 仮押さえを使う / 直接予約する（デモ設定） |
