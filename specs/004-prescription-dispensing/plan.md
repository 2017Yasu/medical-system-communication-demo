# Implementation Plan: S4 処方調剤（外来・入院）

**Branch**: `004-prescription-dispensing`（作業は `develop` 上。専用ブランチは未作成） | **Date**: 2026-10-09 | **Spec**: [spec.md](spec.md)

**Input**: Feature specification from `specs/004-prescription-dispensing/spec.md`

## Summary

医師の処方（MedicationRequest + Task）→ 薬剤部の受付・調剤（薬剤師 C）→ 監査（薬剤師 E）→ 外来は患者へのお渡し、入院は病棟への払出、までを、
S1 と同じステージビュー（電子カルテ・薬剤部門システム・通信モニタ）と講演・自習モードで見せる（D-41・D-42）。
外来（本線）はお渡しの Transaction で処方まで `completed` にし、入院（変化形）は払出で作業だけを `completed` にして処方を `active` のまま残す（D-43）。
「依頼のリソースは部門で異なるが、作業（Task）の仕組みは共通」「作業の完了と依頼の完了は別」を伝える。

技術的には、S1〜S3 の仕組み（ResourceWriter・TransactionProcessor・If-Match・Task の状態遷移・Subscription・ScenarioRunner・ステージビュー・自習ガイド・通信モニタの中身の表）をそのまま使い、次を加える。
サーバー：MedicationRequest・MedicationDispense（書き込み可）と Encounter・Location（読み取り専用）の Provider、検索パラメータ（Task `encounter` など）、初期データ（薬剤部・薬剤師 C/E・看護師 F・外科病棟・デモ 三郎と入院）。
UI：電子カルテ 処方（`/ehr/rx`。医師 X・医師 Y の処方と、看護師 F の病棟の一覧）、薬剤部門システム（`/pharmacy`。1 つの画面で薬剤師を切り替える）、
処方・お渡し・払出の組み立てと送信（画面と自動実行が共有）、S4 の 2 つのシナリオ、シナリオに応じたステージビューの列、入院のステップ 1〜4 を送るボタン（`runTo`）、
通信モニタの薬剤部門システムの列、薬剤のマスタ（HOT9・JAMI 用法コード・MERIT9 区分。JP Terminology で確認済み）。
調剤した薬剤師は Task の版の履歴から読み取って調剤の記録に残す（D-51）。サーバーのデモのポリシーは変えない。詳細は [research.md](research.md)。

## Technical Context

**Language/Version**: Java 21 LTS（サーバー）、TypeScript（UI）。S1〜S3 と同じ

**Primary Dependencies**: S1〜S3 と同じ（HAPI FHIR 8.12.1 plain server、Jetty 12.1、`io.dogote:json-patch`、React 19、React Router、Vite、`@types/fhir`）。新しい依存は追加しない

**Storage**: インメモリ（S1 のまま）。初期データ（静的な JSON）に 10 ファイルを加える。日付に依存する初期データは無い

**Testing**: JUnit 5 + Java の HTTP クライアント（`S4ScenarioIT`、`-Ds4.repeat` 既定 20）、JUnit の単体テスト（`SearchMatcherTest`・`JpPackageConsistencyTest` の追加）、
Vitest（組み立て・判定の純粋関数、ランナー、シナリオ定義）、Playwright（`s4-prescription.spec.ts`、S1〜S3 の回帰）

**Target Platform**: S1 と同じ（Docker Compose、講演者のノート PC、Chrome / Edge の最新版、1920×1080 のプロジェクタ、オフライン）

**Project Type**: Web アプリケーション（FHIR サーバー + SPA、1 コンテナで配信）。S1 と同じ

**Performance Goals**: 操作の結果がほかの列・通信モニタに 2 秒以内で反映（SC-003）。入院のステップ 1〜4 を 1 分以内で送る（SC-002。各ステップは 1〜2 秒の想定）。
外来の 6 ステップを解説なしで 2 分以内（SC-001）

**Constraints**: 原則 I（薬剤師の切り替え・調剤した薬剤師の受け渡しも FHIR 経由。画面の記憶に頼らない）、原則 V（S4 は通常の流れなので講演・自習の両モードで提供。手順書は作らない。D-42）、
原則 VI（依頼 = MedicationRequest、履行 = Task、結果 = MedicationDispense を分ける。JP Core のプロファイルと必須の識別子）、オフライン（原則 VII）、S1〜S3 の振る舞いを変えない（FR-033）

**Scale/Scope**: ステージビュー 1 画面（個別ウィンドウは任意）。処方は 1 剤 × 1 件ずつ。
変更の範囲：サーバー 約 10 ファイル（Provider 4・検索・書き込み可能な種別・配線）+ 初期データ JSON 11（追加 10・修正 1）、テスト 5（新規 2・更新 3）、
UI 約 25 ファイル（処方画面 3・薬剤部門システム 2・組み立て・操作・マスタ・ラベル・エラー・シナリオ 3・ランナー・ステージ・進行パネル・ガイド・入口・ルート・クライアント・通信モニタ 3）とテスト、docs 4 ファイル

## Constitution Check

*GATE: Must pass before Phase 0 research. Re-check after Phase 1 design.*

| 原則 | 判定 | 根拠 |
|---|---|---|
| I. FHIR サーバー経由の連携のみ | PASS | 電子カルテ・薬剤部門システム・病棟の画面は FHIR の要求と Subscription の通知だけでつながる。調剤した薬剤師は画面の記憶ではなく Task の版の履歴から読み取る（research.md R-04）。薬剤師の切り替えは 1 つの画面の中の操作者の選択で、ウィンドウ間で共有する設定は無い（`/demo/*` に項目を加えない） |
| II. 架空データのみ | PASS | 追加する患者（デモ 三郎）・職員（薬剤師 C・E、看護師 F）・部門・病棟はすべて架空。薬剤は実在の医薬品のコード（HOT9）だが、個人の情報ではなく、処方は架空の患者に対するもの |
| III. すべての通信を見える化する | PASS | 処方・受付・監査・お渡し・払出と版の履歴の取得はすべて `/fhir` の要求として記録される。サーバー内部の自動処理は加えない。処方の完了（外来）も薬剤部門システムの Transaction として見える |
| IV. 事故を再現できる | PASS（該当なし） | S4 は通常の業務の流れで、事故の再現を含まない。412 は自動でやり直さない（お渡し・払出の競合は結合テストで確認）。既定のポリシー（If-Match 必須・遷移チェック ON）のまま使う |
| V. 医療従事者に伝わる表示 | PASS | 業務用語 + コード値（調剤中 `dispensing`、お渡し済み／払出済み `completed`、外来処方・院内処方）。講演モード（ステップ送り・解説・ステージビュー）と自習モード（画面上の案内）の両方を S4 の外来・入院に提供する（D-42） |
| VI. FHIR R4 に忠実かつ必要十分 | PASS | MedicationRequest（認可）と Task（進捗）を分け、MedicationDispense は結果として最後に 1 回作る（D-47）。Transaction の `ifMatch`・全体の取り消しは R4 どおり。JP Core のプロファイル（`meta.profile`）・必須の識別子（Rp 番号）・コード体系（HOT9・JAMI 用法・MERIT9）を使い、サーバー側の検証はしない。調剤者・監査者は R4 の `medicationdispense-performer-function` |
| VII. オフライン・ワンコマンド運用 | PASS | 新しい依存・外部資産は無い。JP のパッケージはテスト時だけ使う（実行時には使わない。S1 のまま） |
| VIII. ドキュメント先行 | PASS | D-41〜D-50 を spec の作成時に記録済み。本計画で docs/02・03・04 を更新し、計画で決めた D-51・D-52 を docs/05 に記録した（research.md R-14） |
| 技術制約 | PASS | 1 コンテナ・1 プロセス、インメモリ、412、R4 websocket、React + TS。別プロセス・サーバー側の S4 専用 API は作らない |
| 開発ワークフロー | PASS | S4 の外来・入院を JUnit の結合テスト（`S4ScenarioIT`）で再現し、各ステップの状態と調剤の記録まで検証する（SC-004）。V-xx の新しい技術検証項目は無い（使う機能はすべて S1〜S3 で検証済み） |

**Post-design re-check（Phase 1 後）**: PASS。data-model.md・contracts/ で新たな違反は無い。
薬剤部門システムの「通知の受信は `pharmacy`、更新は薬剤師ごとの送信元」という分け方は、通信モニタで「誰が操作したか」を区別する（FR-023）ためのもので、
FHIR の処理には影響しない（`X-Demo-Client` は S1 のまま検証しない独自ヘッダ）。画面側の制限（調剤した薬剤師は監査できない）はサーバーで判定しないことを data-model.md §3.2 に明記した（D-46）。
看護師 F の通知の条件に初期データの Encounter の id を書くのは、検体検査システムが自部門の技師を列挙するのと同じ前提（docs/04）であり、チェーン検索を加えない（原則 VI の YAGNI）。

### docs への反映

- docs/05-decisions.md：D-41〜D-50 を spec の作成時に記録済み。本計画で **D-51**（調剤した薬剤師は Task の版の履歴から読み取る）・**D-52**（入院のステップ 1〜4 を 1 回の操作で送るボタン）を記録した。
- docs/02-demo-scenarios.md：本計画で S4 の節（ステージビューの列の言い方、入院のステップ 1〜4 の送り方、ステップ 5 の版の履歴の取得、解説ポイント）を更新した。
- docs/03-architecture.md：本計画で検索パラメータの表（MedicationRequest・MedicationDispense・Task `encounter`・Encounter・Location）を更新した。
- docs/04-design-rules.md：本計画で薬剤の業務上の状態のコード体系・完了時の扱い、病棟の通知の条件、薬剤の単位（MERIT9 単位コード）を追記した。
- CLAUDE.md：実装の中で、実装範囲（S1〜S4）と S4 の要点・テストのコマンドを更新する。

## Project Structure

### Documentation (this feature)

```text
specs/004-prescription-dispensing/
├── plan.md              # This file
├── research.md          # Phase 0
├── data-model.md        # Phase 1
├── quickstart.md        # Phase 1
├── contracts/           # Phase 1（S1〜S3 の contracts/ に対する差分。デモ制御 API は変更なし）
│   ├── fhir-api.md          # MedicationRequest・MedicationDispense・Encounter・Location、検索パラメータ、処方・受付・監査・お渡し・払出の例
│   ├── websocket.md         # 追加の Subscription、送信元の値
│   └── ui-screens.md        # /ehr/rx、/pharmacy、ステージビュー・進行パネル・ガイド・入口・通信モニタの変更、ラベル
├── checklists/
│   └── requirements.md
└── tasks.md             # Phase 2（/speckit-tasks で作成）
```

### Source Code (repository root)

S1〜S3 の構成のまま。追加・変更するファイル：

```text
server/src/
├── main/java/jp/example/demo/
│   ├── DemoServerMain.java              # Provider 4 つの登録
│   ├── fhir/ResourceWriter.java         # WRITABLE に MedicationRequest・MedicationDispense
│   ├── fhir/provider/
│   │   ├── MedicationRequestProvider.java   # 新規（read / vread / history / search / create / update）
│   │   ├── MedicationDispenseProvider.java  # 新規（同上）
│   │   ├── EncounterProvider.java           # 新規（読み取り専用）
│   │   └── LocationProvider.java            # 新規（読み取り専用）
│   └── fhir/search/SearchParameters.java    # MedicationRequest・MedicationDispense・Encounter・Location、Task encounter
├── main/resources/seed/                 # organization-pharmacy-dept、practitioner(-role)-ph-c・ph-e・ns-f、location-ward-surgery、
│                                        # patient-demo-saburo、encounter-adm-saburo、index.txt。practitioner-dr-y の名前の修正
└── test/java/jp/example/demo/
    ├── integration/PharmacyFlow.java    # 新規：処方・受付・監査・お渡し・払出の HTTP の手順（LabFlow と同じ形）
    ├── integration/S4ScenarioIT.java    # 新規：外来・入院（-Ds4.repeat）、お渡しの競合、完了後のお渡し、通知の条件、S1 の条件との分離
    ├── integration/FhirApiContractIT.java # MedicationRequest・MedicationDispense・Encounter・Location の API、Task encounter の Subscription
    ├── unit/SearchMatcherTest.java      # 追加した検索パラメータ
    └── jp/JpPackageConsistencyTest.java # HOT9・JAMI 用法・MERIT9 区分・単位が確認されることの表明

ui/src/
├── app/
│   ├── routes.tsx                       # /ehr/rx、/pharmacy
│   ├── Launcher.tsx                     # S4 の欄、個別ウィンドウ
│   ├── StageView.tsx                    # シナリオの stage で列を決める、?scenario=、役割・薬剤師の自動の切り替え
│   ├── stageRoles.ts                    # 新規：役割・薬剤師の決め方（純粋関数。data-model.md §5）
│   └── ProgressPanel.tsx                # fastForward のボタン
├── scenario/
│   ├── types.ts                         # ScenarioId・ScenarioClient・ScenarioState・target・Scenario の追加（data-model.md §4.1）
│   ├── runner.ts                        # runTo(n)、loadState にシナリオを渡す
│   ├── ScenarioProvider.tsx             # S4 のシナリオ、クライアントの追加、初期シナリオ
│   ├── s4Prescription.ts                # 新規：s4-outpatient・s4-inpatient（共通のステップは関数で作る）
│   └── s4State.ts                       # 新規：S4 のシナリオの状態の取得
├── guide/
│   ├── useGuide.ts                      # 画面名に薬剤部門システム、薬剤師の切り替えの案内
│   └── GuideOverlay.tsx                 # シナリオの選択、役割・薬剤師の名前
├── fhir/
│   ├── client.ts                        # ClientId に ehr-nurse-f・pharmacy・pharmacy-ph-c・pharmacy-ph-e
│   ├── builders/prescription.ts         # 新規：処方の Transaction、受付・監査の PATCH、お渡し・払出の Transaction、オーダー番号
│   ├── prescriptionActions.ts           # 新規：placePrescription / acceptPrescription / startAudit / handOver / dispenseToWard / dispenserOf（画面と自動実行が共有）
│   ├── errors.ts                        # 操作名、Transaction の取り消しの併記
│   └── labels.ts                        # 処方・調剤の記録・薬剤の業務上の状態・区分のラベル
├── master/fhir-master.json              # 薬剤・コード体系・区分・既定値（data-model.md §2.1）
├── systems/
│   ├── ehr/PrescriptionScreen.tsx       # 新規：/ehr/rx（役割で切り替え）
│   ├── ehr/PrescriptionForm.tsx         # 新規：処方の入力
│   ├── ehr/WardView.tsx                 # 新規：看護師 F の病棟の一覧
│   ├── ehr/EhrScreen.tsx                # 処方へのリンク
│   ├── pharmacy/PharmacyScreen.tsx      # 新規：/pharmacy（薬剤師の切り替え・一覧・操作）
│   ├── pharmacy/pharmacyRules.ts        # 新規：画面側の制限（純粋関数。data-model.md §3.2）
│   └── shared/prescriptions.ts          # 新規：処方・作業・調剤の記録・患者・入院の取得と結合（医師・看護師 F・薬剤部の一覧）
└── monitor/
    ├── sequenceModel.ts                 # 列 pharmacy、名前
    ├── SequenceDiagram.tsx              # 列の見出し
    └── HistoryView.tsx                  # MedicationRequest・MedicationDispense のラベル

ui/tests/
├── unit/                                # prescriptionBuilders・prescriptionActions・pharmacyRules・stageRoles・prescriptions の新規、
│                                        # scenarioRunner（runTo）・scenarios（一覧・data-guide）・sequence・labels・errors の更新
└── e2e/
    ├── pages.ts                         # 処方・薬剤部門システムの共通操作
    └── s4-prescription.spec.ts          # 新規：講演（外来・入院）、手動操作と画面側の制限、自習（入院）

docs/
├── 02-demo-scenarios.md                 # S4 の節（本計画で反映済み）
├── 03-architecture.md                   # 検索パラメータ（本計画で反映済み）
├── 04-design-rules.md                   # 薬剤の業務上の状態・単位・通知の条件（本計画で反映済み）
└── 05-decisions.md                      # D-51・D-52（本計画で記録済み）

CLAUDE.md                                # 実装範囲（S1〜S4）と S4 の要点、S4 のテストのコマンド
```

**Structure Decision**: S1〜S3 と同じ Web アプリケーション構成（`server/` と `ui/`、1 つの JAR で配信）。サーバーは S4 に固有の処理を持たない（Provider と検索パラメータの追加だけ）。
UI の処方の組み立てと送信は、検体検査（`builders/labOrder.ts`・`labActions.ts`）・CT 予約（`builders/ctBooking.ts`・`ctActions.ts`）と同じ分け方で
`builders/prescription.ts`・`prescriptionActions.ts` に置き、画面とシナリオの自動実行が共有する。
処方の一覧の取得と結合は、医師・看護師 F・薬剤部門システムの 3 画面で共有するため `systems/shared/prescriptions.ts` に置く。
ステージビューの役割の決め方と薬剤部門システムの画面側の制限は、テストしやすいよう純粋関数のファイルに分ける。

## Complexity Tracking

| 事項 | 理由 | 採らなかった案と理由 |
|---|---|---|
| 薬剤部門システムで、通知の受信（`pharmacy`）と更新の送信元（`pharmacy-ph-c`・`pharmacy-ph-e`）を分ける | 1 つの画面で薬剤師を切り替えつつ、通信モニタで操作者を区別する（FR-013・FR-023）。通知と取得が薬剤師ごとに二重に並ぶのを避ける（research.md R-05） | 薬剤師ごとに画面を常に配置する：通知 1 回ごとに ping と取得が 2 組ずつ並び、講演で読みにくい。送信元を 1 つにする：操作者を区別できない |
| S4 だけステージビューの役割を講演モードでも自動で切り替える | 「払出の結果を病棟の画面で見せる」ことがステップの中身（US3 AS5）。S1 に適用しないのは FR-033 のため | S1 も含めて自動で切り替える：S1 の講演の見え方と E2E が変わる。講演者が手で切り替える：US3 AS5 を満たさない |
| お渡し・払出の前に Task の版の履歴を取得する（GET が 1 回増える） | 調剤した薬剤師は、監査の開始で Task の担当者から消える。部門システムはバックエンドを持たず、FHIR に残る記録は版の履歴だけ（research.md R-04、D-51） | `Task.input` に独自のコードで残す：デモ独自の取り決めが増える。画面の記憶：原則 I・再読み込み・自動実行で破綻する |
