# Research: S4 処方調剤（外来・入院）

**Feature**: [spec.md](spec.md) | **Plan**: [plan.md](plan.md) | **Date**: 2026-10-09

S1〜S3（[specs/001](../001-lab-order-workflow/research.md)・[specs/002](../002-concurrent-acceptance/research.md)・[specs/003](../003-ct-slot-booking/research.md)）の
技術選定（HAPI FHIR 8.12.1 plain server、インメモリのリポジトリ、React + TypeScript、Vitest / Playwright / JUnit 5）はそのまま使う。
本書は S4 で新たに決めることだけを扱う。Technical Context に NEEDS CLARIFICATION は無い（spec の作成時に D-41〜D-50 を決定済み）。
以下は、S1〜S3 のコードと JP Core 1.2.0 / JP Terminology 2.2609.0（`.cache/fhir-packages/`）を確認したうえで、設計上の選択肢を比較した結果である。

## R-01 サーバーに加えるリソース種別と検索パラメータ

- **Decision**:
  - 書き込み可能な種別（`ResourceWriter.WRITABLE`）に **MedicationRequest・MedicationDispense** を加える。**Encounter・Location** は読み取り専用（初期データ）として Provider を加える。
    いずれも `AbstractRepositoryProvider` を継承する（read / vread / history / search、書き込み可能な種別は create / update。patch は Task のまま）。
  - 検索パラメータ（`SearchParameters`）を加える：
    MedicationRequest `requester`・`subject`・`encounter`・`status`、MedicationDispense `prescription`・`subject`、
    Task に **`encounter`**、Encounter `patient`・`location`・`status`。Location はパラメータ無し（全件）。
  - MedicationRequest・MedicationDispense には状態遷移の規則を**作らない**（ServiceRequest と同じ）。Task の状態遷移マトリクス（`TaskTransitionRule`）は S1 のまま適用される。
- **Rationale**: 画面の一覧（R-05）と Subscription の条件（R-06）に必要な検索パラメータだけを、S1・S3 と同じく種別ごとに明示的に実装する。
  処方の状態（`active` → `completed`）はお渡しの Transaction の中でだけ変わり、ServiceRequest と同じく規則を置かなくても説明に欠けがない。
  Task の終了状態の更新は既存の規則で 422 になるため、「完了した作業をもう一度お渡しする」はサーバーでも拒否される（Edge Cases）。
- **Alternatives considered**:
  - MedicationRequest の状態遷移チェック（`completed` からの変更を 422）：S1 の ServiceRequest に無い規則を S4 だけに置くことになり、FR-020（S1 と同じ判定）の範囲を超える。
  - `_id` の検索で処方を取り寄せる：既存のサーバーは `_id` を実装していない。S1 の検体検査システムと同じく「全件を取得して画面で絞る」で足りる（データは数件）。

## R-02 初期データの追加（FR-001、D-44・D-46・D-48・D-50）

- **Decision**: 静的な初期データ（`seed/index.txt`）に次を加える。日付に依存するものは無い（入院日 `period` は持たせない）。

  | id | 種別 | 内容 |
  |---|---|---|
  | `pharmacy-dept` | Organization | 薬剤部（`partOf` = 病院） |
  | `ph-c`・`ph-e` | Practitioner / PractitionerRole | 薬剤師 C・薬剤師 E（`staff-role#pharmacist` 薬剤師、所属 = 病院） |
  | `ns-f` | Practitioner / PractitionerRole | 看護師 F（`staff-role#nurse`、`location` = 外科病棟） |
  | `ward-surgery` | Location | 外科病棟（`type` = v3-RoleCode `WARD`、`physicalType` = `wa`、`mode` = `instance`） |
  | `demo-saburo` | Patient | デモ 三郎（患者番号 `00000005`、男性） |
  | `adm-saburo` | Encounter | デモ 三郎の入院（`status` = `in-progress`、`class` = v3-ActCode `IMP`、`location` = 外科病棟（`display` 付き）、`participant` = 医師 Y） |

  あわせて、S3 で加えた `practitioner-dr-y.json` の `name.text` が「医師 X」になっている誤りを「医師 Y」に直す（S4 で医師 Y の処方を表示するため、誤りが画面に出る）。
- **Rationale**: 入院の情報（Encounter）と病棟（Location）は入院の処方だけが参照する（D-44）。PractitionerRole の `location` で「看護師 F は外科病棟の看護師」を表せる。
  入院日を持たせると固定の日付がいずれ古くなる（S3 の D-39 と同じ問題）。S4 の説明に入院日は要らない。
- **Alternatives considered**:
  - 入院日を初期化のたびに生成する（S3 の `SlotSeedGenerator` と同じ）：表示しない値のために生成の仕組みを増やすことになる。
  - 病棟を Organization（部署）で表す：払出先（`MedicationDispense.destination`）は Location でなければならない（R4）。

## R-03 薬剤のマスタとコード（FR-004、SC-007）

- **Decision**: FHIR マスタ（`ui/src/master/fhir-master.json`）に、処方できる薬剤 4 種（`medications`）と S4 の固定の coding を加える。
  コードはすべて JP Terminology 2.2609.0 で実在を確認した（2026-10-09、`.cache/fhir-packages/`）。

  | key | 薬剤（HOT9） | 既定の 1 回量 | 用法（JAMI 用法コード） | 既定の日数 | 使う場面 |
  |---|---|---|---|---|---|
  | `amlodipine` | `103299401` ノルバスク錠５ｍｇ | 1 錠 | `1011000400000000` 内服 １日１回 朝食後 | 14 日 | 外来の既定（降圧薬） |
  | `loxoprofen` | `100988001` ロキソニン錠６０ｍｇ | 1 錠 | `1013044400000000` 内服 １日３回 朝昼夕食後 | 3 日 | 入院の既定（術後の鎮痛） |
  | `rebamipide` | `104528401` ムコスタ錠１００ｍｇ | 1 錠 | `1013044400000000` 内服 １日３回 朝昼夕食後 | 3 日 | 選択肢 |
  | `magnesium-oxide` | `114778001` マグミット錠３３０ｍｇ | 1 錠 | `1012040400000000` 内服 １日２回 朝夕食後 | 7 日 | 選択肢 |

  - 処方の区分：`http://jpfhir.jp/fhir/core/CodeSystem/JP_MedicationCategoryMERIT9_CS`（`OHP` 外来処方・`OHI` 院内処方・`IHP` 入院処方・`XTR` 臨時処方。D-44）。
  - 投与経路 `http://jpfhir.jp/fhir/core/CodeSystem/route-codes#PO`（口）、用法詳細 `http://jami.jp/CodeSystem/MedicationMethodDetailUsage#10`（経口）、
    力価区分 `http://jpfhir.jp/fhir/core/mhlw/CodeSystem/MedicationIngredientStrengthStrengthType#1`（製剤量）、
    単位 `http://jpfhir.jp/fhir/core/mhlw/CodeSystem/MedicationUnitMERIT9Code#TAB`（錠）。日数は UCUM `d`。
  - 調剤者・監査者：`http://terminology.hl7.org/CodeSystem/medicationdispense-performer-function`（`packager`・`checker`。FHIR R4 の定義。JP のパッケージには含まれない）。
  - 入院の class：`http://terminology.hl7.org/CodeSystem/v3-ActCode#IMP`、病棟の種類：`http://terminology.hl7.org/CodeSystem/v3-RoleCode#WARD`（いずれも HL7 の定義）。
  - プロファイル：`JP_MedicationRequest`・`JP_MedicationDispense`・`JP_Encounter`・`JP_Location`（JP Core 1.2.0 に存在することを確認）。
  - `JpPackageConsistencyTest` は、JP のパッケージに含まれる「complete」のコード体系の coding を既に自動で確認している（初期データと FHIR マスタを走査）。
    S4 では「確認が空振りしていないこと」の表明を加える：HOT9 が 4 件、JAMI 用法コードが 3 種、MERIT9 区分が 4 種、MERIT9 単位・route-codes が確認されること。
- **Rationale**: 降圧薬 14 日分（外来）・臨時の内服薬 3 日分（入院）という spec の既定（Assumptions）に合い、薬剤師が見て不自然でない組み合わせ。
  HOT9 は同じ表示名で複数のコード（包装・販売元の違い）を持つことがあるため、先発品で 1 件に定まるものを選んだ（ロキソニン・ムコスタは HOT9 が 1 件）。
  単位を MERIT9 単位コードにするのは JP Core の例（`MedicationRequest-jp-medicationrequest-example-1`）に合わせたもの（docs/04 の「単位は UCUM」を薬剤の数量について補足する）。
- **Alternatives considered**:
  - 後発品（「アムロジピン錠５ｍｇ「ＴＣＫ」」など）：表示名に販売元が入り、講演で読み上げにくい。HOT9 の候補も多い。
  - 一般名処方のコード：JP Terminology 2.2609.0 に含まれず、テストで確認できない。
  - 単位を UCUM（`{tbl}`）にする：JP Core の例・用語集と合わない。

## R-04 処方・調剤の各操作が送る内容（FR-005〜FR-019）

- **Decision**:
  - **処方**（電子カルテ）：Transaction（MedicationRequest POST + Task POST。`Task.focus` は MedicationRequest の `urn:uuid`）。
    MedicationRequest は JP Core の必須の識別子（Rp 番号 `1`・Rp 内の順番 `1`）と、オーダー番号（`P-yyyymmdd-nnnn`、S1 の `order-number` の識別子の体系）を持つ。
    入院の処方は MedicationRequest と Task の両方に `encounter` を入れる（Task の `encounter` は看護師 F の通知の条件に使う。R-06）。
  - **受付・調剤開始**（薬剤師 C）：`PATCH /Task/{id}` + If-Match（一覧の行の ETag）。`status` = `in-progress`、`businessStatus` = 調剤中（`dispensing`）、`owner` = `PractitionerRole/ph-c`、`lastModified`。
  - **監査開始**（薬剤師 E）：`PATCH /Task/{id}` + If-Match。`businessStatus` = 監査中（`auditing`）、`owner` = `PractitionerRole/ph-e`、`lastModified`（`status` は `in-progress` のまま）。
  - **お渡し（外来）／払出（入院）**（薬剤師 E）：まず `GET /Task/{id}/_history` で**調剤した薬剤師**（業務上の状態が調剤中だった最後の版の `owner`）を読み取り、
    Transaction（MedicationDispense POST + Task PUT（`ifMatch`、`completed`、`output` → MedicationDispense、`businessStatus` は削除）、外来だけ MedicationRequest PUT（`ifMatch`、`completed`））を送る。
  - 受付は S1 の検体検査と違い **1 回の操作**（一覧の行の ETag をそのまま If-Match に使う）。D-27 の 2 段階（受付を始める → 確定）は、S2 の同時受付を人の操作で再現するためのもので、S4 には同時操作の場面が無い。
- **Rationale**:
  - 調剤した薬剤師は、監査の開始で `Task.owner` が薬剤師 E に変わると、Task の現在の版からは分からなくなる（D-46）。部門システムはバックエンドを持たず（D-09）、
    画面の記憶はウィンドウ・再読み込み・自動実行をまたいで共有できない（原則 I）。FHIR に残っている「誰が担当していたか」の記録は Task の版の履歴であり、
    それを読むのが最も追加の取り決めが少ない。通信モニタに「版の履歴の取得」が現れるので、「Task の版の履歴が作業の記録になっている」ことも解説できる（原則 III の `_history`）。
  - `businessStatus` を完了時に削除するのは、薬剤の業務上の状態を調剤中・監査中だけに限るため（D-47）。完了は `Task.status` で表す。
  - 外来と入院で、処方から監査までの通信を完全に同じにできる（`encounter` の有無だけが違う）。
- **Alternatives considered**:
  - 監査の開始の PATCH で、調剤した薬剤師を `Task.input`（独自の種類のコード）に残す：GET が 1 回減るが、デモ独自の取り決めを Task に加えることになる。
  - 調剤の記録（MedicationDispense）を調剤の開始で `preparation` として作り、最後に `completed` にする：D-47（最後に 1 回だけ作る）に反する。
  - 画面の状態（React）に調剤した薬剤師を持つ：上記の理由（原則 I、再読み込み・自動実行）で採らない。
  - 受付を S1 と同じ 2 段階にする：操作が 1 回増えるだけで、S4 で伝えることが増えない。

## R-05 画面の構成（FR-005〜FR-013、FR-028）

- **Decision**:
  - 電子カルテの処方画面を新しいルート **`/ehr/rx?role=dr-x|dr-y|ns-f`** に作る（S3 の `/ehr/ct` と同じく、S1 の `/ehr` を変えない）。
    - 医師（`dr-x`・`dr-y`）：処方の入力（患者・薬剤・1 回量・用法・日数。区分は患者に入院中の Encounter があるかで決まり、変更できない）と、自分が出した処方の一覧。
      既定の患者・薬剤は、医師 X ならデモ 太郎・ノルバスク、医師 Y ならデモ 三郎・ロキソニン（R-03）。
    - 看護師 F（`ns-f`）：外科病棟に入院中の患者の処方の一覧（処方の状態・作業の状態・払出の状況）。操作は無い（D-48）。
  - 薬剤部門システムを新しいルート **`/pharmacy?pharmacist=ph-c|ph-e`** に作る。1 つの画面で操作する薬剤師を切り替える（ログインの切り替えに相当。FR-013）。
    - 通知の受信と一覧の取得は画面に 1 つ（`X-Demo-Client: pharmacy`）。**更新の要求だけを操作する薬剤師の送信元**（`pharmacy-ph-c`・`pharmacy-ph-e`）で送る。
    - 画面側の制限（D-46）：調剤中の行の「監査を開始」は、操作する薬剤師が現在の担当者（調剤した薬剤師）なら押せず、「調剤した薬剤師とは別の薬剤師が監査します」と表示する。
      監査中の行の「監査を終えてお渡し」「監査を終えて払出」は、操作する薬剤師が現在の担当者（監査を始めた薬剤師）のときだけ押せる。受付前の行には「監査を開始」を出さない。
    - お渡しと払出は MedicationRequest の区分（`OHP` / `IHP`）でボタンの文言と送る内容を切り替える。
- **Rationale**:
  - 薬剤師ごとに画面（と通知の受信）を分けると、通知 1 回ごとに ping と取得が 2 組ずつ通信モニタに並び、講演で読みにくい。
    薬剤部門システムは 1 つのシステムであり、「通知を受けて取り直すのはシステム」「操作するのは人」という分け方は通信モニタの見え方としても実態に近い（FR-023）。
  - 切り替えで Subscription の登録をやり直さないので、ステージビューで薬剤師を切り替えても通知の受信が途切れない（S1 の「医師/看護師の両画面を常に配置する」と同じ目的を、より少ない通信で満たす）。
- **Alternatives considered**:
  - S1 の電子カルテ（`/ehr?role=doctor`）に処方の欄を加える：S1 のステージビュー・E2E の画面が変わり、FR-033 の確認が増える。
  - 薬剤師ごとに別の画面（`/pharmacy?pharmacist=…` を 2 つ常に配置）：上記の通信モニタの見え方の理由で採らない。
  - 看護師 F の画面を `/ehr?role=nurse` に加える：看護師 D（検体検査の採血）と業務も通知の条件も異なる。

## R-06 通知の条件と、S1〜S3 の画面に混ざらないこと（FR-009、FR-022、Edge Cases）

- **Decision**:

  | 画面 | Subscription id | criteria |
  |---|---|---|
  | 電子カルテ 処方（医師 X） | `ehr-rx-dr-x` | `Task?requester=Practitioner/dr-x` |
  | 電子カルテ 処方（医師 Y） | `ehr-rx-dr-y` | `Task?requester=Practitioner/dr-y` |
  | 電子カルテ 病棟（看護師 F） | `ehr-ward-surgery` | `Task?encounter=Encounter/adm-saburo` |
  | 薬剤部門システム | `pharmacy-dept` | `Task?owner=Organization/pharmacy-dept,PractitionerRole/ph-c,PractitionerRole/ph-e` |

  - 看護師 F の条件は「外科病棟に入院中の患者の入院（Encounter）」で表す。病棟の画面は自病棟の入院を知っている前提とし（検体検査システムが自部門の技師を知っている前提と同じ。docs/04）、
    デモでは初期データの 1 件を列挙する。一覧の取得は `Encounter?location=Location/ward-surgery&status=in-progress` から始める。
  - S1 の画面との分離：検体検査の作業は `owner` が検査部側、処方の作業は薬剤部側なので、検体検査システム・看護師 D・薬剤部門システムの一覧は互いに混ざらない。
    医師 X の S1 の依頼一覧（`/ehr?role=doctor`）は ServiceRequest の `category` で絞り、作業は `focus` で依頼に結び付けるため、処方の作業は表示されない（通知で取り直しは起きる）。
    処方一覧は MedicationRequest を起点にするので、検体検査・CT の依頼は表示されない。
- **Rationale**: criteria は更新後のリソースで評価されるため、状態が変わると外れる条件を使わない（S1）。`requester`・`owner` の列挙・`encounter` は S4 の操作で変わらない。
  入院の Encounter を条件にすると、デモ 三郎が外来で処方を受けた場合（S4 では作らない）に病棟の画面に混ざらない。
- **Alternatives considered**:
  - `Task?patient=Patient/demo-saburo`：既存の検索パラメータで済むが、「病棟の患者」ではなく「特定の患者」の条件になる。
  - `MedicationDispense?destination=Location/ward-surgery`：払出の時点でしか通知が届かず、処方・調剤中の段階が看護師 F の一覧に反映されない（FR-010）。
  - Encounter を介したチェーン検索（`Task?encounter.location=…`）：サーバーはチェーン検索を実装しない（docs/04）。

## R-07 ステージビューの列（FR-028、US3 AS4・AS5）

- **Decision**: シナリオ定義に `stage`（`"lab"` / `"pharmacy"`、既定は `"lab"`）を持たせ、ステージビューは選ばれたシナリオの `stage` で列を決める。
  - `lab`（S1）：これまでどおり（電子カルテ（医師 X / 看護師 D）・検体検査システム（技師 A）・通信モニタ）。S1 の振る舞いは変えない。
  - `pharmacy`（S4）：電子カルテ 処方・**薬剤部門システム**・通信モニタ。電子カルテの列のタブはシナリオに出てくる役割だけ（外来：医師 X、入院：医師 Y・看護師 F）。
    タブの画面は**すべて配置して表示だけを切り替える**（通知の bind を外さない。S1 と同じ）。
  - S4 では、電子カルテの役割（`target.role`）と薬剤師（`target.pharmacist`）を**ステップに合わせて自動で切り替える**。
    基準のステップは、講演モードは解説中のステップ（完了した最後のステップ。始める前は 1 つ目）、自習モードは次に操作するステップで、
    そのステップまでのうち最後に指定された役割・薬剤師を使う。ただし**自習モードでは薬剤師を自動で切り替えない**（利用者が切り替える。US4 AS3）。
    入院の払出（ステップ 5）が終わり、ステップ 6（看護師 F への通知）が完了すると、電子カルテの列が看護師 F になる（US3 AS5）。
  - 講演者が手で切り替えた後は、基準のステップが変わるまで手の切り替えを優先する（値が変わったときだけ自動で切り替える）。
- **Rationale**: S1 の講演モードは電子カルテの役割を自動で切り替えないが、S4 では「払出の結果を病棟の画面で見せる」ことがステップの中身であり、講演者の操作を減らす（SC-001）。
  S1 に適用しないことで FR-033 を守る。
- **Alternatives considered**:
  - S4 専用のステージ（`/stage/pharmacy`）を作る：進行パネル・自習ガイド・シナリオの選択が二重になる。
  - 電子カルテの列にすべての役割（医師 X・医師 Y・看護師 F）を常に配置する：初期化のたびの Subscription の登録が増えるだけで、使わない画面がタブに並ぶ。

## R-08 シナリオ定義とステップの判定（FR-026、FR-029）

- **Decision**:
  - シナリオを 2 つ加える：`s4-outpatient`（「処方調剤（外来：患者にお渡し）」）・`s4-inpatient`（「処方調剤（入院：病棟へ払出）」）。どちらも 6 ステップ（docs/02 S4 の表）。
  - `ScenarioClient` に `ehr-doctor-y`・`ehr-nurse-f`・`pharmacy`・`pharmacy-ph-c`・`pharmacy-ph-e` を加える。`target.screen` に `pharmacy`、`target.role` に `dr-x`・`dr-y`・`ns-f`、`target.pharmacist`（`ph-c`・`ph-e`）を加える。
  - シナリオが注目する状態（`ScenarioState`）に `medicationRequest`（status）と `medicationDispense`（`none` / `completed`）を加える。
    状態の取得はシナリオごとに持たせる（`Scenario.loadState`。S4 は「その医師の最新の処方・その作業・その調剤の記録」。省略時は S1 の取得）。
  - 通信の条件は S1 と同じ形（data-model.md §5 の表）。自動のステップ（2・6）は「通知 → その画面の Task の取得」。
- **Rationale**: 既存の `ScenarioRunner`・`evaluateProgress`（データの条件 + 通信の条件）をそのまま使える。シナリオごとの状態の取得にすると、S1 の取得（`fetchLatestOrder`）を変えずに済む。
- **Alternatives considered**:
  - S4 のステップ 1〜4 を共通化して 1 つのシナリオにまとめ、最後だけ分岐させる：ランナーに分岐の概念が無く、講演の「戻る」・自習の「最初から」の意味が曖昧になる。
    定義の重複は、S1 のバリエーションと同じく共通のステップを作る関数で避ける。

## R-09 入院のステップ 1〜4 を短時間で送る方法（FR-027、SC-002、US3 AS6）

- **Decision**: 講演モードの進行パネルに「**ステップ 4 まで進める（外来と同じ部分）**」ボタンを加える。
  シナリオ定義の `fastForward`（`{ to: 4, label }`）で、入院のシナリオにだけ表示する（現在のステップが 4 未満のとき）。
  押すと、ランナーの新しい操作 `runTo(n)` が「次へ」と同じ処理（各ステップの自動実行 → 完了の判定を待つ）を n ステップ目まで続けて行う。
  途中で完了しない（通知を待つ）・失敗したときは、そこで止めて「次へ」と同じ表示をする。通信はすべて実際に送るので通信モニタにも表示される。
- **Rationale**: 「次へ」を 4 回押しても 1 分以内には届くが、そのたびに解説が切り替わり、「ここまでは外来と同じ」と言いながら送る講演の流れに合わない。
  `runTo` は「戻る」が既に行っている「初期化して n ステップ再実行」の再実行部分と同じ処理で、追加は小さい。途中のステップへ直接飛ぶ（状態を直接作る）と、通信モニタに処方〜監査の通信が残らない。
- **Alternatives considered**:
  - 進行パネルのステップの一覧をクリックしてそのステップまで進める（汎用の「ジャンプ」）：S1 の講演で誤って押す危険があり、S4 の入院以外に使い道が無い。
  - 入院のシナリオをステップ 5 から始め、1〜4 はデモ制御パネルの準備ボタンで送る（S2・S3 の準備と同じ）：ステージビュー・講演モードで完結しなくなる（D-42）。
  - 何も作らず「次へ」を 4 回押す：上記の理由で採らない。

## R-10 シナリオの選び方（自習モード・入口）

- **Decision**: ステージビューは `?scenario={id}` で最初のシナリオを受け取る（無ければ `s1-main`）。自習モードのガイドにも、進行パネルと同じシナリオの選択を置く。
  入口（`/`）に「S4 処方調剤」の欄を加え、講演モード（外来から）・自習モード（外来・入院）へのリンクと、個別ウィンドウ（電子カルテ 処方 ×3、薬剤部門システム）へのリンクを置く。
- **Rationale**: 自習モードには今シナリオを選ぶ手段が無い（S1 の通常の流れだけ）。US4 は S4 のシナリオを選んで始めることを求める。

## R-11 通信モニタ（FR-023〜FR-025）

- **Decision**:
  - シーケンス図に「薬剤部門システム」の列（`pharmacy`。`pharmacy` と `pharmacy-*` の送信元）を加える。名前：`pharmacy` = 薬剤部門システム、`pharmacy-ph-c` = 薬剤師 C、`pharmacy-ph-e` = 薬剤師 E、`ehr-nurse-f` = 看護師 F。
    表示する列は S3 と同じく記録にある送信元で決まる（`lanesFor`）。
  - 一括送信の中身の表（S3 の `transactionSummary`）はリソースの種別に依存しないので、そのまま処方・お渡し・払出の Transaction に使える。外来のお渡しには「PUT MedicationRequest/1」の行があり、入院の払出には無い（FR-024、US2 AS6）。
  - 版の履歴の表示（`HistoryView`）で MedicationRequest・MedicationDispense の状態を業務用語で表示する。版の履歴の候補は Transaction の応答の `location` から取るので、追加の処理は要らない。
- **Rationale**: S3 で作った汎用の仕組み（列の決め方・中身の表・履歴の候補）が S4 にもそのまま使える。お渡しと払出の違いは中身の表の行の有無で見える。
- **Alternatives considered**: Transaction の注記を「処方の完了を含む」などに変える：S1 の結果報告（ServiceRequest の完了を含む）の注記と食い違う。中身の表で足りる。

## R-12 表示ラベルとエラー（FR-031・FR-032）

- **Decision**:
  - 処方の状態は ServiceRequest と同じラベル（「有効（依頼中）`active`」「完了 `completed`」）。
  - 調剤の記録は `destination` があれば「払出済み `completed`」、`receiver` があれば「お渡し済み `completed`」（docs/04 の表示ラベル）。
  - 薬剤の業務上の状態は新しいコード体系 `https://demo.example.jp/fhir/CodeSystem/pharm-business-status`（`dispensing` 調剤中・`auditing` 監査中）。FHIR マスタの `pharmBusinessStatuses` に置く。
  - 処方の区分は MERIT9 の表示名を並べる（「外来処方・院内処方」「入院処方・臨時処方」）。
  - エラーは S1 の文言の規則（業務上の意味 + HTTP ステータス）をそのまま使い、操作名だけを加える（「処方」「受付・調剤開始」「監査開始」「お渡し」「払出」）。
    お渡し・払出の 412 は「他の利用者が先に更新しました。最新の状態を表示します」（Transaction 全体が取り消されたことを併記）。
- **Rationale**: 検体検査（`lab-business-status`）・放射線（`rad-business-status`）と同じ命名で、部門ごとの業務上の状態を並べて説明できる。

## R-13 テスト（SC-004・SC-006・SC-007・SC-008）

- **Decision**:
  - サーバー：`S4ScenarioIT`（HTTP の結合テスト。`-Ds4.repeat`、既定 20 回）で外来・入院の 6 ステップを繰り返し、
    外来は処方 `completed`・入院は処方 `active`（版 1 のまま）・作業はどちらも `completed`・調剤の記録はどちらも 1 件（performer = 薬剤師 C の `packager` と 薬剤師 E の `checker`、外来は `receiver`、入院は `destination`）を確かめる。
    加えて、お渡しの時点で処方が更新されていたら Transaction 全体が 412 で調剤の記録が作られないこと、完了した作業へのもう一度のお渡しが拒否されること、
    看護師 F・薬剤部・医師 Y の通知の条件で ping が届くこと、検体検査の画面の条件（検査部の `owner`）に処方の作業が一致しないことを確かめる。手順は `PharmacyFlow`（S1 の `LabFlow` と同じ形）にまとめる。
  - 単体：`SearchMatcherTest`（追加した検索パラメータ）、`JpPackageConsistencyTest`（R-03 の表明）。
  - UI 単体（Vitest）：処方・お渡し・払出の組み立て（`builders/prescription.ts`）、調剤した薬剤師の読み取り（版の履歴 → `owner`）、画面側の制限の判定、
    ステージビューの役割・薬剤師の決め方（純粋関数）、ランナーの `runTo`、シナリオの定義（`scenarios.test.ts` の一覧と `data-guide` の対応）、通信モニタの列と名前。
  - E2E（Playwright）：講演モードで外来を「次へ」で最後まで、入院を「ステップ 4 まで進める」+「次へ」で最後まで（電子カルテの列が看護師 F になること、1 分以内）、
    画面の手動操作（調剤した薬剤師は監査できない表示）、自習モードの入院（薬剤師 E への切り替えの案内）。S1〜S3 の既存の E2E を回帰として流す。
- **Rationale**: 憲章の開発ワークフロー（各シナリオを JUnit の結合テストで再現）と SC-004（20 回連続）に合わせる。S4 には同時操作の場面が無いため、繰り返しの既定は S1 と同じ 20 回とする。

## R-14 docs の更新（原則 VIII）

- **Decision**: 本計画で次を更新した。
  - docs/02：ステージビューの列の言い方（「3 列目」→ 部門システムの列）、入院のステップ 1〜4 を送る方法（R-09）、調剤した薬剤師を版の履歴から読み取ること（R-04）。
  - docs/03：検索パラメータの表（R-01）。
  - docs/04：薬剤の業務上の状態のコード（R-12）、薬剤の単位（R-03）、病棟の通知の条件の例（R-06）、完了時の businessStatus の扱い（R-04）。
  - docs/05：D-51（調剤した薬剤師は Task の版の履歴から読み取る）、D-52（入院のステップ 1〜4 を 1 回の操作で送るボタン）を記録した。
- **Rationale**: 画面・通信に現れる決定（版の履歴の取得、進行パネルのボタン）は docs に残し、医療・技術の両面でレビューできるようにする。
