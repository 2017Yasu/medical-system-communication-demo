# Contract: 画面（S4 での追加・変更）

S1 の [contracts/ui-screens.md](../../001-lab-order-workflow/contracts/ui-screens.md)・S2・S3 の contracts/ui-screens.md に対する追加・変更を書く。
記載の無い事項（画面の更新の流れ、エラーの表示の共通部分、S1 のシナリオとステップの判定、S2・S3 の画面）は S1〜S3 のまま。

## ルート（追加・変更）

| パス | 画面 | 備考 |
|---|---|---|
| `/ehr/rx?role=dr-x` | 電子カルテ 処方（医師 X） | 個別ウィンドウ。`role` が無い・不正なら医師 X |
| `/ehr/rx?role=dr-y` | 電子カルテ 処方（医師 Y） | 個別ウィンドウ |
| `/ehr/rx?role=ns-f` | 電子カルテ 病棟（看護師 F、外科病棟） | 個別ウィンドウ |
| `/pharmacy?pharmacist=ph-c` | 薬剤部門システム | 個別ウィンドウ。`pharmacist` は最初に選ぶ薬剤師（無い・不正なら薬剤師 C） |
| `/stage?mode=…&scenario={id}` | ステージビュー | `scenario` で最初のシナリオを選ぶ（無い・不正なら `s1-main`）。S1 の `/stage?mode=…` はそのまま |

- 入口（`/`）に「S4 処方調剤」の欄（`aria-label="S4 処方調剤"`）を加える：
  講演モード（`/stage?mode=presentation&scenario=s4-outpatient`）、自習モード 外来（`…self-study&scenario=s4-outpatient`）・入院（`…self-study&scenario=s4-inpatient`）、
  個別ウィンドウ（`/ehr/rx?role=dr-x`・`dr-y`・`ns-f`、`/pharmacy`）。「個別のウィンドウで開く」にも 4 つを加える。
- 電子カルテ（`/ehr`）の見出しに「処方」（`/ehr/rx?role=dr-x`）へのリンクを、処方の見出しに「検体検査」（`/ehr?role=doctor`）へのリンクを置く（医師 X のときだけ）。

## `X-Demo-Client` の値と Subscription（追加）

| 画面 | `X-Demo-Client` | 通信モニタ上の名前 | Subscription id |
|---|---|---|---|
| 電子カルテ 処方（医師 X） | `ehr-doctor` | 医師 X | `ehr-rx-dr-x` |
| 電子カルテ 処方（医師 Y） | `ehr-doctor-y` | 医師 Y | `ehr-rx-dr-y` |
| 電子カルテ 病棟（看護師 F） | `ehr-nurse-f` | 看護師 F | `ehr-ward-surgery` |
| 薬剤部門システム（通知の受信と一覧の取得） | `pharmacy` | 薬剤部門システム | `pharmacy-dept` |
| 薬剤部門システム（薬剤師 C・E の更新の操作） | `pharmacy-ph-c`・`pharmacy-ph-e` | 薬剤師 C・薬剤師 E | —（更新の要求だけに使う） |

criteria は contracts/websocket.md。調剤した薬剤師の読み取り（`GET Task/{id}/_history`）はお渡し・払出の操作の一部なので、操作する薬剤師の値で送る。

## 電子カルテ 処方（`/ehr/rx`、医師）

### 見出し

「電子カルテ（医師 X）処方」。医師 Y は「電子カルテ（医師 Y）処方」。

### 処方の入力（`data-testid="rx-form"`）

| 項目 | 内容 | `data-guide` |
|---|---|---|
| 患者 | 患者の一覧（患者番号順）。既定は医師 X = デモ 太郎、医師 Y = デモ 三郎（FHIR マスタの `prescriptionDefaults`） | `rx-patient` |
| 区分 | 選んだ患者に入院中の Encounter があれば「入院処方・臨時処方（外科病棟）」、無ければ「外来処方・院内処方」。表示だけで変更できない | — |
| 薬剤 | FHIR マスタの 4 種（表示名と HOT9 コードを併記）。既定は医師ごとの既定 | `rx-drug` |
| 1 回量・用法・日数 | 薬剤を選ぶと既定値が入る。1 回量（錠）・日数は変更できる。用法は表示だけ（JAMI 用法コードを併記） | — |
| 数量 | 1 回量 × 1 日の回数 × 日数（表示だけ） | — |
| 処方する | 押すと Transaction（contracts/fhir-api.md「処方」）を送り、一覧を取り直す | `rx-submit` |

### 処方の一覧（`data-testid="rx-list"`）

自分が出した処方（`MedicationRequest?requester=Practitioner/{dr}`）を新しい順に表示する。

| 列 | 内容 |
|---|---|
| オーダー番号 | `P-yyyymmdd-nnnn` |
| 患者 | 名前 |
| 薬剤・用法 | 「ノルバスク錠５ｍｇ 1 錠 1 日 1 回朝食後 14 日分」 |
| 区分 | 「外来・院内」／「入院・臨時（外科病棟）」 |
| 処方 | 「有効（依頼中）`active`」「完了 `completed`」 |
| 作業 | 「依頼済み `requested`」「実施中 `in-progress`（調剤中）」など。業務上の状態があれば括弧で併記 |
| 担当 | 「薬剤部」「薬剤師 C」「薬剤師 E」 |
| お渡し・払出 | 調剤の記録があれば「お渡し済み 10:20」「払出済み 10:20」、無ければ「—」 |

- 行の `data-testid="rx-row-{MedicationRequest id}"`。S2 の行の変化の表示（`rowChanges`。状態・業務上の状態・担当・お渡し・払出の変化）を使う。
- 入院の処方で、作業が完了し処方が有効のままの行は「払出済み・投与中」と表示する（Edge Cases：未処理の処方に見せない）。

## 電子カルテ 病棟（`/ehr/rx?role=ns-f`、看護師 F）

- 見出し「電子カルテ（看護師 F）外科病棟」。操作は無い（受領・与薬は作らない。D-48）。
- 外科病棟に入院中の患者（`Encounter?location=Location/ward-surgery&status=in-progress`）の処方（`MedicationRequest?encounter=…`）を表示する（`data-testid="ward-list"`）。
  列：患者・薬剤・用法・処方の状態・作業の状態・払出（「払出済み 10:20」／「薬剤部で調剤中」など）。行の変化の表示を使う。
- 払出済みの行には「病棟に届いています（処方は投与中のため有効のままです）」を添える。

## 薬剤部門システム（`/pharmacy`）

### 見出しと薬剤師の切り替え

- 見出し「薬剤部門システム」。横に操作する薬剤師の切り替えボタン「薬剤師 C」「薬剤師 E」（`aria-pressed`、`data-guide="pharmacist-ph-c"`・`"pharmacist-ph-e"`）。
  **選択中の薬剤師のボタンは押せない（`disabled`）**。切り替えても通知の受信（Subscription）はそのまま（research.md R-05）。初期化（`demo.reset`）で薬剤師 C に戻る。
- ステージビューでは、切り替えの値をステージビューが渡す（data-model.md §5）。ボタンでの切り替えはステージビューに伝える。

### 処方の一覧（`data-testid="pharmacy-list"`）

薬剤部宛て・薬剤部の薬剤師が担当する作業（`Task?owner=…`）と、その処方を表示する。

| 列 | 内容 |
|---|---|
| オーダー番号・患者 | 番号と名前 |
| 薬剤・1 回量・用法・日数・数量 | 処方の内容 |
| 区分 | 「外来」／「入院（外科病棟）」。入院の病棟は Encounter の `location` の表示名 |
| 作業 | 状態 + 業務上の状態（「実施中 `in-progress`・調剤中」） |
| 担当 | 「薬剤部」「薬剤師 C」「薬剤師 E」 |
| 操作 | data-model.md §3.2 の表 |

- 操作ボタン：「受付・調剤開始」（`data-guide="rx-accept-{id}"`）、「監査を開始」（`rx-audit-{id}`）、「監査を終えてお渡し」（`rx-handover-{id}`）、「監査を終えて払出」（`rx-ward-dispense-{id}`）。`{id}` は MedicationRequest の id。
- 押せない理由は `data-testid="rx-hint-{id}"` に出す（data-model.md §3.2）。
- 一覧は通知（`pharmacy-dept`）のたびに取り直し、行の変化の表示を使う。
- 412 のとき：エラーを表示し（Transaction は「お渡し（払出）は取り消されました。調剤の記録は登録されていません」を併記）、一覧を取り直す。自動でやり直さない。

## ステージビュー（変更）

- 選ばれたシナリオの `stage` で列を決める（data-model.md §5）。S1 のシナリオでは変えない。
- S4（`stage = "pharmacy"`）の列の見出し：「電子カルテ」（タブ：外来は「医師 X」、入院は「医師 Y」「看護師 F（外科病棟）」）、「薬剤部門システム（薬剤師 C / 薬剤師 E）」、「通信モニタ」。
  電子カルテのタブの画面はすべて配置し、表示だけを切り替える。`data-guide-region` は `ehr`・`pharmacy`。
- 役割・薬剤師の自動の切り替えは data-model.md §5。

## 進行パネル（講演モード、変更）

- シナリオの選択に「処方調剤（外来：患者にお渡し）」「処方調剤（入院：病棟へ払出）」を加える。S4 と S1 を切り替えると列も切り替わる（切り替えは初期化を伴う。S1 のまま）。
- シナリオに `fastForward` があり、完了したステップが `to` 未満のとき、「次へ」の横に `fastForward.label` のボタン（`data-testid="btn-fast-forward"`）を出す。
  押すとランナーの `runTo(to)` を実行する（research.md R-09）。実行中は「次へ」「戻る」と同じく押せない。完了しなければ「通知を待っています」（S1 のまま）。

## 自習モードのガイド（変更）

- 進行パネルと同じシナリオの選択（`data-testid="scenario-select"`）を置く。切り替えは初期化を伴う。
- 案内の文言：`target.screen = "pharmacy"` は「薬剤部門システム（薬剤師 C）」のように薬剤師を併記する。電子カルテは役割の名前（医師 X・医師 Y・看護師 F）を併記する。
- 案内している薬剤師と、画面で選ばれている薬剤師が違うときは、「薬剤師 E に切り替えてください」を案内に加える（US4 AS3）。切り替えボタンは強調される（data-model.md §4.3）。
- 促し（案内と違う操作）の画面名に「薬剤部門システム」を加える。

## 通信モニタ（変更）

- シーケンス図の列に「薬剤部門システム」を加える（`pharmacy`・`pharmacy-*` の送信元）。名前は contracts/websocket.md の表。
- 一括送信の中身の表は S3 のまま（処方：POST MedicationRequest・POST Task、お渡し：POST MedicationDispense・PUT Task・PUT MedicationRequest、払出：POST MedicationDispense・PUT Task）。
- 版の履歴：MedicationRequest・MedicationDispense の状態を業務用語で表示する（処方は ServiceRequest と同じラベル、調剤の記録は「お渡し済み／払出済み」）。

## 表示ラベル（追加）

| 対象 | 表示 |
|---|---|
| MedicationRequest.status | ServiceRequest と同じ（「有効（依頼中）`active`」「完了 `completed`」など） |
| MedicationDispense.status | `receiver` あり：「お渡し済み `completed`」、`destination` あり：「払出済み `completed`」 |
| 業務上の状態（薬剤） | 「調剤中 `dispensing`」「監査中 `auditing`」 |
| 処方の区分 | MERIT9 の表示名を「・」でつなぐ（「外来処方・院内処方」「入院処方・臨時処方」） |

## エラーの操作名（追加）

「処方」「受付・調剤開始」「監査開始」「お渡し」「払出」。文言の規則は S1 のまま（例：「この状態からは お渡し できません（完了 `completed`）`422`」）。
