# Implementation Plan: S3 放射線：CT 検査の予約枠の取り合い

**Branch**: `003-ct-slot-booking` | **Date**: 2026-10-02 | **Spec**: [spec.md](spec.md)

**Input**: Feature specification from `specs/003-ct-slot-booking/spec.md`

## Summary

医師 X と医師 Y が同じ CT の予約枠（翌日 10:00）を取り合う場面を、複数のブラウザウィンドウ（医師 X・医師 Y の電子カルテ CT 予約、放射線部門システム、通信モニタ、デモ制御パネル）で再現する。
S3-1（枠を確認せずに予約 → 二重予約）、S3-2（仮押さえ → 確定、後発の仮押さえは 412）、S3-3（仮押さえの期限切れ → 遅れた確定は Transaction 全体が 412）の 3 つを、
デモ制御パネルの準備ボタンで切り替えて、手順書（docs/06-demo-procedures.md）に従って手で操作する（D-33・D-38）。

技術的には、S1・S2 の仕組みをそのまま使い、次を加える。
サーバー：Slot・Appointment（書き込み可）、Schedule・Device（読み取り専用）の Provider と検索パラメータ、日付に依存する予約枠の生成（`SlotSeedGenerator`）、
仮押さえの期限切れの処理（`SlotHoldExpiry`。書き込みロックの中で版を確かめて `free` に戻す）、通信記録の新しい種別 `kind = "server"`、
デモのポリシーに `ehrUsesSlotHold`（画面だけが読む）と `slotHoldSeconds`。
UI：電子カルテ CT 予約（`/ehr/ct`。枠を選ぶ → 仮押さえ → 確定、または直接予約）、放射線部門システム（`/ris`）、デモ制御パネルの S3 の準備と設定、
通信モニタの放射線部門システムの列・Transaction の中身の表・サーバー内の処理の表示。テスト：HTTP の結合テスト（同時の仮押さえ 100 回、期限切れ）と 5 ウィンドウの E2E。詳細は [research.md](research.md)。

## Technical Context

**Language/Version**: Java 21 LTS（サーバー）、TypeScript（UI）。S1・S2 と同じ

**Primary Dependencies**: S1・S2 と同じ（HAPI FHIR 8.12.1 plain server、Jetty 12.1、`io.dogote:json-patch`、React 19、React Router、Vite、`@types/fhir`）。
新しい依存は追加しない（期限の確認は JDK の `ScheduledExecutorService`、日付は `java.time`、画面の日時表示は `Intl.DateTimeFormat`（`timeZone: "Asia/Tokyo"`））

**Storage**: インメモリ（S1 のまま）。予約枠は初期化のたびに生成する。仮押さえの保持・デモのポリシーもメモリ上で、初期化・再起動で消える

**Testing**: JUnit 5 + Java の HTTP クライアント（`S3ScenarioIT`）、JUnit の単体テスト（`SlotHoldExpiryTest`・`SlotSeedGeneratorTest`・検索パラメータ）、
Vitest（純粋関数と画面の操作）、Playwright（5 ウィンドウの E2E、S1・S2 の回帰）

**Target Platform**: S1 と同じ（Docker Compose、講演者のノート PC、Chrome / Edge の最新版、オフライン）。コンテナのタイムゾーンに依存しない（日本時間を明示）

**Project Type**: Web アプリケーション（FHIR サーバー + SPA、1 コンテナで配信）。S1 と同じ

**Performance Goals**: 操作の結果（期限切れを含む）がほかのウィンドウと通信モニタに 2 秒以内で反映（SC-004）。期限切れは設定秒数の経過から 2 秒以内（SC-005、250 ミリ秒ごとの確認）。
準備ボタンから操作できるまで 10 秒以内（SC-006）

**Constraints**: 原則 I（ウィンドウ間の設定共有は `/demo/policy` だけ）、原則 III（期限切れの更新は `kind = "server"` の通信記録として表示。サーバー内部の自動処理は憲章が認める例外の条件を満たす形だけ）、
原則 IV（同じ版への同時の仮押さえ、期限切れと確定の競合は必ず片方だけ成功）、オフライン（原則 VII）、S1・S2 を変えない（FR-025）

**Scale/Scope**: 同時に開くウィンドウは 5 つ。予約枠は 6、Slot の取り合いは 1 枠。
変更の範囲：サーバー 約 15 ファイル（Provider 4・検索・書き込み可能な種別・予約枠の生成・期限切れ・通信記録・ポリシー・デモ制御・配線・初期データ JSON 7）とテスト 4、
UI 約 20 ファイル（CT 予約・放射線部門システム・組み立て・エラー・ポリシー・準備・制御パネル・入口・通信モニタ 4・useLiveData・ラベル・マスタ）とテスト、docs 5 ファイル

## Constitution Check

*GATE: Must pass before Phase 0 research. Re-check after Phase 1 design.*

| 原則 | 判定 | 根拠 |
|---|---|---|
| I. FHIR サーバー経由の連携のみ | PASS | 医師 X・医師 Y・放射線部門システムのウィンドウ同士は直接通信しない。取り合いは FHIR サーバーの If-Match（Slot の版）の判定でだけ起きる。ウィンドウ間で共有する設定（`ehrUsesSlotHold`・`slotHoldSeconds`）は `/demo/policy` に置く（例外として認められたポリシー変更。research.md R-03） |
| II. 架空データのみ | PASS | 追加するデータ（医師 Y・放射線部・CT-1 号機・予約表・予約枠・デモ 次郎・デモ 桜子・初期の予約）はすべて架空。氏名は「デモ 〇〇」「職種 + 英字」の規則に従う |
| III. すべての通信を見える化する | PASS（例外の条件を満たす） | 予約の操作はすべて FHIR の要求として記録される。期限切れによる Slot の更新はサーバー内部の自動処理だが、憲章が例として挙げる「ルールとして明示し通信モニタに表示する仕組み（Slot 仮押さえのタイムアウト）」に当たり、`kind = "server"` の通信記録・ping・版の履歴で見える（research.md R-05・R-06、D-37） |
| IV. 事故を再現できる | PASS | S3-1 で二重予約を意図的に再現。既定値は安全側（仮押さえを使う・期限 30 秒）で、初期化で戻る。同時の仮押さえの決定性を HTTP で 100 回、期限切れと確定の競合を繰り返し確認する（R-12）。412 で自動リトライしない |
| V. 医療従事者に伝わる表示 | PASS（憲章 v1.1.0 の原則 V、D-31・D-33） | 文言は業務用語 + コード値・HTTP の数値（R-09）。講演・自習の両モードは S1 で提供済み。S3 は事故の再現を含むため、S2 と同じく手順書に従う手操作とする（Complexity Tracking を参照） |
| VI. FHIR R4 に忠実かつ必要十分 | PASS | Slot・Appointment・Schedule は R4 の基本定義（JP Core にプロファイルが無い）。Transaction の `ifMatch` と全体の取り消しは R4 の http.html どおり。If-None-Exist は R4 の意味（一致すれば既存を返す）を正しく扱い、取り合いの拒否には使わない（D-40）。検査内容のコードはデモ用の独自コード（JJ1017 が JP Terminology に無い。D-39）、モダリティは DICOM（JP_RadiologyModality_VS で確認） |
| VII. オフライン・ワンコマンド運用 | PASS | 新しい依存・外部資産は無い。期限の既定値は環境変数で変えられるが、未設定で動く |
| VIII. ドキュメント先行 | PASS | docs/02・03・04・05（D-32〜D-40）は spec の作成・clarify の際に更新済み。本計画で docs/02（登場人物）・docs/03（F11・F13・F14・検索パラメータ・環境変数）・docs/04（画像検査のコード）を更新した。docs/06（手順書）は本機能の成果物（FR-022）として実装の中で作る |
| 技術制約 | PASS | 1 コンテナ・1 プロセス、インメモリ、412、R4 websocket、React + TS。別プロセス・サーバー側の準備 API を作らない。期限の確認は同じプロセスのスレッドで行う |
| 開発ワークフロー | PASS | S3 を JUnit の結合テスト（`S3ScenarioIT`）で再現し、同時の仮押さえの結果（片方が 412）まで検証する（憲章の「排他制御のシナリオは…片方が 412 まで検証する」）。期限切れも統合テストで確かめる |

**Post-design re-check（Phase 1 後）**: PASS。data-model.md・contracts/ で新たな違反は無い。
`ehrUsesSlotHold` は S2 の `labSendsIfMatch` と同じく「サーバーの判定に使わない」ことを contracts/demo-control-api.md に明記した。
`slotHoldSeconds` はサーバーの振る舞い（期限切れの処理）を変えるが、デモのポリシーの変更として `/demo/policy` で行い、通信記録（ポリシーの変更）に残る。
`kind = "server"` の通信記録は FHIR の要求ではないことを contracts/websocket.md で区別し、送信元を「FHIR サーバー（仮押さえの期限切れ）」と明示した（利用者の要求に見せかけない。research.md R-06）。

### docs への反映

- docs/05-decisions.md：D-32〜D-40 を spec の作成・clarify の際に記録済み。
- docs/02-demo-scenarios.md：S3 の節（見せ方・準備・放射線部門システムの範囲・S3-1〜S3-3）を更新済み。本計画で登場人物の表に、初期の予約の患者（デモ 次郎・デモ 桜子）と CT-1 号機を加えた。
- docs/03-architecture.md：本計画で F11（期限切れの処理の方式）・F13（`kind = "server"` の記録）・F14（`ehrUsesSlotHold`・`slotHoldSeconds`・S3 の準備）・
  検索パラメータの表（実装する範囲に合わせる）・環境変数 `SLOT_HOLD_SECONDS` を更新した。
- docs/04-design-rules.md：本計画で画像検査のコード（検査内容はデモ用の独自コード、放射線の業務上の状態のコード）を追記した。
- docs/06-demo-procedures.md：実装の中で S3 の節を追加する（FR-022、research.md R-13）。docs/README.md の 06 の説明を S2・S3 に広げる。

## Project Structure

### Documentation (this feature)

```text
specs/003-ct-slot-booking/
├── plan.md              # This file
├── research.md          # Phase 0
├── data-model.md        # Phase 1
├── quickstart.md        # Phase 1
├── contracts/           # Phase 1（S1・S2 の contracts/ に対する差分）
│   ├── fhir-api.md          # Slot・Appointment・Schedule・Device、検索パラメータ、仮押さえ・確定・直接予約・取りやめの例、期限切れ
│   ├── demo-control-api.md  # /demo/policy の ehrUsesSlotHold・slotHoldSeconds、S3 の準備の順序
│   ├── websocket.md         # demo.policy の追加項目、TrafficRecord の kind = "server"、追加の Subscription
│   └── ui-screens.md        # /ehr/ct、/ris、/control の S3、通信モニタの変更、ラベル
├── checklists/
│   └── requirements.md
└── tasks.md             # Phase 2（/speckit-tasks で作成）
```

### Source Code (repository root)

S1・S2 の構成のまま。追加・変更するファイル：

```text
server/src/
├── main/java/jp/example/demo/
│   ├── DemoServerMain.java              # Provider の追加、SlotHoldExpiry の起動と停止、SLOT_HOLD_SECONDS の読み取り
│   ├── fhir/ResourceWriter.java         # WRITABLE に Slot・Appointment
│   ├── fhir/provider/
│   │   ├── SlotProvider.java            # 新規（read / vread / history / search / create / update）
│   │   ├── AppointmentProvider.java     # 新規（同上）
│   │   ├── ScheduleProvider.java        # 新規（読み取り専用）
│   │   └── DeviceProvider.java          # 新規（読み取り専用）
│   ├── fhir/search/SearchParameters.java # Slot・Appointment・ServiceRequest category・Schedule・Device
│   ├── slot/
│   │   ├── SlotSeedGenerator.java       # 新規：翌日（日本時間）の予約枠 6 つと初期の予約 2 件（Clock を受け取る）
│   │   └── SlotHoldExpiry.java          # 新規：CommitListener + 250 ms ごとの確認、期限切れの書き込みと通信記録
│   ├── demo/
│   │   ├── DemoPolicy.java              # ehrUsesSlotHold・slotHoldSeconds（既定値は環境変数）
│   │   ├── DemoControl.java             # reset で静的な初期データ + SlotSeedGenerator の生成分を結合、保持の消去、updatePolicy の項目追加と範囲の検証
│   │   └── DemoControlServlet.java      # JSON の 5 項目、slotHoldSeconds の 400
│   └── traffic/
│       ├── TrafficRecord.java           # kind "server" と ServerAction
│       ├── TrafficLog.java              # serverAction(...) の生成
│       └── MonitorBroadcaster.java      # demo.policy の 5 項目
├── main/resources/seed/                 # practitioner(-role)-dr-y、organization-rad-dept、device-ct-1、schedule-ct-1、
│                                        # patient-demo-jiro、patient-demo-sakurako、index.txt
└── test/java/jp/example/demo/
    ├── unit/SlotHoldExpiryTest.java     # 新規
    ├── unit/SlotSeedGeneratorTest.java  # 新規
    ├── unit/SearchMatcherTest.java      # Slot・Appointment・category の追加
    ├── integration/S3ScenarioIT.java    # 新規：S3-1〜S3-3、同時の仮押さえ 100 回、期限切れと確定の競合（-Ds3.repeat）
    ├── integration/TrafficMonitorIT.java # ポリシーの 5 項目・slotHoldSeconds の 400・kind = "server" の配信
    └── jp/JpPackageConsistencyTest.java # DCM#CT が JP_RadiologyModality_VS に含まれること（マスタ経由で自動的に確認される範囲を確認）

ui/src/
├── app/
│   ├── routes.tsx                       # /ehr/ct、/ris
│   ├── Launcher.tsx                     # 個別ウィンドウと「S3 予約枠の取り合いで開くウィンドウ」
│   └── ControlPanel.tsx                 # S3 の準備ボタン、予約方式、期限の入力
├── demo/
│   ├── prepare.ts                       # S3 の準備（reset → policy）。シナリオごとの段階の並び
│   └── policyState.ts                   # DEFAULT_POLICY に 2 項目
├── realtime/
│   ├── types.ts                         # DemoPolicy の 2 項目、TrafficRecord の kind "server" と serverAction
│   └── useLiveData.ts                   # Subscription を複数受け取る
├── fhir/
│   ├── client.ts                        # ClientId に ehr-doctor-y・ris
│   ├── builders/ctBooking.ts            # 新規：仮押さえ・取りやめの Slot、確定・直接予約の Transaction、オーダー番号
│   ├── ctActions.ts                     # 新規：selectSlot / holdSlot / confirmBooking / bookDirect / releaseSlot（画面と E2E の補助が共有）
│   ├── errors.ts                        # slotHoldConflictError・slotHoldExpiredError
│   └── labels.ts                        # 放射線の業務上の状態、画像検査の分類、日時の表示（日本時間）
├── master/fhir-master.json              # 検査内容・コード体系・画像検査の分類・モダリティ・放射線の業務上の状態
├── systems/
│   ├── ehr/CtBookingScreen.tsx          # 新規：/ehr/ct（見出し・枠の一覧・予約欄）
│   ├── ehr/BookingDraftPanel.tsx        # 新規：予約欄（残り時間を含む）
│   ├── ehr/EhrScreen.tsx                # CT 予約へのリンク
│   ├── ris/RisScreen.tsx                # 新規：/ris（カレンダー・予約と作業の一覧）
│   ├── shared/slots.ts                  # 新規：枠・予約・作業の取得と結合、二重予約の判定（純粋関数）
│   └── shared/orders.ts                 # loadDoctorOrders を検体検査の category に絞る（R-08）
└── monitor/
    ├── sequenceModel.ts                 # 列 ris、名前、kind "server"、Transaction の注記、resourceRefsIn の拡張
    ├── SequenceDiagram.tsx              # 表示する列を記録から決める、サーバー内の処理の閉じた矢印
    ├── TrafficDetail.tsx                # Transaction の中身の表、サーバー内の処理の詳細
    ├── transactionSummary.ts            # 新規：Transaction の要求・応答からエントリの表を作る（純粋関数）
    ├── history.ts                       # findCause の kind "server" 対応、比べる項目に comment
    └── HistoryView.tsx                  # Slot の列名、送信元の名前

ui/tests/
├── unit/                                # ctBooking・bookingDraft・slots・transactionSummary の新規、errors・sequence・history・prepare・policyState の更新
└── e2e/
    ├── pages.ts                         # CT 予約・放射線部門システムの共通操作
    └── s3-slot-booking.spec.ts          # 新規：5 ウィンドウで S3-1〜S3-3、同時の仮押さえ（S3_REPEAT）

docs/
├── 02-demo-scenarios.md                 # 登場人物（本計画で反映済み）
├── 03-architecture.md                   # F11・F13・F14・検索パラメータ・環境変数（本計画で反映済み）
├── 04-design-rules.md                   # 画像検査のコード（本計画で反映済み）
├── 06-demo-procedures.md                # S3 の節を追加
└── README.md                            # 06 の説明

compose.yml                              # SLOT_HOLD_SECONDS（コメントで既定 30 を示す）
CLAUDE.md                                # 実装範囲（S1〜S3）と S3 の要点、S3 のテストのコマンド
```

**Structure Decision**: S1・S2 と同じ Web アプリケーション構成（`server/` と `ui/`、1 つの JAR で配信）。
サーバーの予約枠に固有の処理（生成・期限切れ）は `slot/` にまとめ、FHIR の汎用の処理（`fhir/`）と分ける。
UI の CT 予約の組み立てと送信は、検体検査（`builders/labOrder.ts`・`labActions.ts`）と同じ分け方で `builders/ctBooking.ts`・`ctActions.ts` に置く。
枠と予約の結合・二重予約の判定は、電子カルテと放射線部門システムで共有するため `systems/shared/slots.ts` に置く。

## Complexity Tracking

| 事項 | 理由 | 採らなかった案と理由 |
|---|---|---|
| 原則 V の解釈（S3 には講演モードのステップ送り・自習モードの画面上の案内が無い） | 憲章 v1.1.0（D-31）と D-33。S3 は事故（二重予約）の再現と 2 つのウィンドウの操作の順序・期限の待ち時間が主題で、手で操作して見せるほうが伝わる | ステージビューに医師 2 人の列を並べて案内する：利用者が不要と判断（D-33）。原則 V は S1 で満たしている |
| サーバー内部の自動処理（期限切れ）による業務データの更新 | 仮押さえの期限切れはクライアントの操作ではなく、サーバーの運用規則として起きる。憲章の原則 III が例外として名指しする場面 | クライアント（デモ制御パネル）が期限を監視して PUT する：パネルを閉じると期限切れが起きず、「サーバーの規則」の説明と合わない。送信元も不正確になる |
| サーバーのポリシーに、サーバーが使わない値（`ehrUsesSlotHold`）を置く | 別々のウィンドウで設定を共有する手段が、原則 I の下では `/demo/*` しか無い（S2 と同じ。research.md R-03） | `localStorage`・`BroadcastChannel`：原則 I 違反。URL パラメータ：準備ボタンで一括して切り替えられない |
