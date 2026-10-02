# Implementation Plan: S2 排他制御①：同時受付

**Branch**: `002-concurrent-acceptance` | **Date**: 2026-10-02 | **Spec**: [spec.md](spec.md)

**Input**: Feature specification from `specs/002-concurrent-acceptance/spec.md`

## Summary

技師 A と技師 B が同じ採取済の依頼をほぼ同時に受付する場面を、複数のブラウザウィンドウ（技師 A・技師 B・通信モニタ・デモ制御パネル）で再現する。
S2-1（版の確認が無い → 後勝ちで上書き）、S2-2（版の確認あり → 後発は 412）、S2-3（サーバーが版の確認を必須にする → 確認の無い更新は 400）の 3 つを、
デモ制御パネルの準備ボタンで切り替えて、手順書（docs/06-demo-procedures.md）に従って手で操作する。

技術的には、S1 の仕組みをそのまま使い、次を加える。
サーバー：デモのポリシーに `labSendsIfMatch`（検体検査システムが If-Match を付けるか。サーバーの判定には使わない）を追加する。
UI：受付を「受付を始める（GET して版を保持）→ 確定（PATCH）」の 2 段階にする（S1 も含む。D-27）。一覧の変化をアニメーションで示す（D-28）。
デモ制御パネル `/control`（準備ボタン・ポリシーの切り替え）を作る。通信モニタに If-Match の値と、版の履歴の差分を表示する。
テスト：HTTP で同時確定を 100 回繰り返す結合テストと、4 ウィンドウの E2E。詳細は [research.md](research.md)。

## Technical Context

**Language/Version**: Java 21 LTS（サーバー）、TypeScript（UI）。S1 と同じ

**Primary Dependencies**: S1 と同じ（HAPI FHIR 8.12.1 plain server、Jetty 12.1、`io.dogote:json-patch`、React 19、React Router、Vite、`@types/fhir`）。
新しい依存は追加しない（アニメーションは CSS の keyframes で行う）

**Storage**: インメモリ（S1 のまま）。デモのポリシーもメモリ上で、初期化・再起動で既定値に戻る

**Testing**: JUnit 5 + HAPI Generic Client / Java の HTTP クライアント（`S2ScenarioIT`、デモ制御 API の結合テスト）、Vitest（純粋関数と画面の操作）、
Playwright（4 ウィンドウの E2E、S1 の回帰）

**Target Platform**: S1 と同じ（Docker Compose、講演者のノート PC、Chrome / Edge の最新版、オフライン）

**Project Type**: Web アプリケーション（FHIR サーバー + SPA、1 コンテナで配信）。S1 と同じ

**Performance Goals**: 操作の結果がほかのウィンドウと通信モニタに 2 秒以内で反映（SC-004）。準備ボタンから受付を操作できるまで 10 秒以内（SC-005）

**Constraints**: 原則 I（ウィンドウ間の設定共有は `/demo/policy` だけ。`localStorage`・`BroadcastChannel` を使わない）、
原則 III（準備の依頼・採血も FHIR の通信として記録）、原則 IV（同じ版への同時更新は必ず片方だけ成功）、オフライン（原則 VII）

**Scale/Scope**: 同時に開くウィンドウは 4 つ（S1 のステージビューを並行して開いても 5〜6）。
変更の範囲：サーバー 3〜4 ファイル（ポリシー・デモ制御・テスト）、UI 約 15 ファイル（LIS・制御パネル・通信モニタ・エラー・S1 のシナリオと E2E）、docs 4 ファイル

## Constitution Check

*GATE: Must pass before Phase 0 research. Re-check after Phase 1 design.*

| 原則 | 判定 | 根拠 |
|---|---|---|
| I. FHIR サーバー経由の連携のみ | PASS | 技師 A・技師 B のウィンドウ同士は直接通信しない。両者の競合は FHIR サーバーの If-Match 判定でだけ起きる。ウィンドウ間で共有する設定（`labSendsIfMatch`）は `/demo/policy` に置き（例外として認められたポリシー変更）、ブラウザ間メッセージ・共有ストレージは使わない（R-01）。準備の依頼・採血はブラウザから FHIR の要求として送る（R-02） |
| II. 架空データのみ | PASS | 新しいデータは無い。S1 の架空の患者・技師を使う |
| III. すべての通信を見える化する | PASS | 準備の依頼・採血は電子カルテとして FHIR に送り、通信モニタに出る。ポリシーの変更はイベントとして記録。If-Match の値と、412・400 を矢印の注記・結果に表示し、版の履歴で上書きを示す（R-07）。サーバー内部で業務データを書き換えない |
| IV. 事故を再現できる | PASS | S2-1 で Lost Update を意図的に再現。既定値は安全側（必須・付ける）で、初期化で戻る。同時確定の決定性を HTTP で 100 回確認する（R-10）。412 で自動リトライしない（FR-013） |
| V. 医療従事者に伝わる表示 | PASS（憲章 v1.1.0 の原則 V、D-31。S2 は手順書に従う手操作で、手順書を用意する） | 文言は業務用語 + コード値・HTTP の数値（R-04・R-05）。講演モード・自習モードは S1 で提供済み。S2 は事故の再現であり、画面上の案内・ステージビューを使わず手順書に従って手で操作する（D-29、clarify Q1）。下記 Complexity Tracking を参照 |
| VI. FHIR R4 に忠実かつ必要十分 | PASS | ETag / If-Match / 412 は R4 の http.html どおり。If-Match 必須時の 400 は docs/04 で明文化済み（D-14）。`labSendsIfMatch` は FHIR の外のデモ設定で、FHIR の処理に影響しない。新しいリソース・操作は無い |
| VII. オフライン・ワンコマンド運用 | PASS | 新しい依存・外部資産は無い。CSS アニメーションのみ |
| VIII. ドキュメント先行 | PASS | docs/02・docs/05（D-27〜D-30）は spec と同時に更新済み。本計画で docs/03（デモ制御 API・デモ制御パネル）を更新した。docs/06（手順書）は本機能の成果物（FR-020）として実装の中で作る |
| 技術制約 | PASS | 1 コンテナ・1 プロセス、インメモリ、412、R4 websocket、React + TS。別プロセス・サーバー側の準備 API を作らない |
| 開発ワークフロー | PASS | S2 を JUnit の結合テスト（`S2ScenarioIT`）で再現し、同時更新の結果（片方が 412）まで検証する（憲章の「排他制御のシナリオは…片方が 412 まで検証する」）。V-07 の画面での再現を E2E で確認する |

**Post-design re-check（Phase 1 後）**: PASS。data-model.md・contracts/ で新たな違反は無い。
`labSendsIfMatch` をサーバーに置くことは「サーバーが業務の振る舞いを変える」ものではなく、判定に使わないことを contracts/demo-control-api.md に明記した。
準備の要求は電子カルテの `X-Demo-Client` で送る。これは S1 のシナリオの自動実行（S1 R-13）と同じ扱いで、通信モニタ上は「電子カルテ（医師 X）」などとして表示される。

### docs への反映

- docs/05-decisions.md：D-27（受付の 2 段階化）、D-28（一覧の変化のアニメーション）、D-29（S2 は複数ウィンドウと手順書）、D-30（準備ボタン）を spec の作成・clarify の際に記録済み。
- docs/02-demo-scenarios.md：S1 ステップ 4 の通信、S2 の冒頭（2 段階の受付・複数ウィンドウ・準備ボタン）、S2-1 の技師 A の画面、画面構成を更新済み。
- docs/03-architecture.md：本計画でデモ制御 API（F14）に `labSendsIfMatch` とデモ制御パネルの準備ボタンを追記した。
- docs/06-demo-procedures.md と docs/README.md の一覧：実装の中で作成する（FR-020、research.md R-11）。

## Project Structure

### Documentation (this feature)

```text
specs/002-concurrent-acceptance/
├── plan.md              # This file
├── research.md          # Phase 0
├── data-model.md        # Phase 1
├── quickstart.md        # Phase 1
├── contracts/           # Phase 1（S1 の contracts/ に対する差分）
│   ├── demo-control-api.md  # /demo/policy の labSendsIfMatch、準備ボタンが送る要求の順序
│   ├── websocket.md         # demo.policy の本文の追加
│   └── ui-screens.md        # /control、受付の 2 段階化、変化のアニメーション、通信モニタの表示、S1 への影響
├── checklists/
│   └── requirements.md
└── tasks.md             # Phase 2（/speckit-tasks で作成）
```

### Source Code (repository root)

S1 の構成のまま。追加・変更するファイル：

```text
server/src/
├── main/java/jp/example/demo/demo/
│   ├── DemoPolicy.java              # labSendsIfMatch の追加（既定 true、resetToDefaults で戻す）
│   ├── DemoControl.java             # updatePolicy に labSendsIfMatch、イベントの detail に 3 項目
│   └── DemoControlServlet.java      # GET/PUT /demo/policy の JSON に labSendsIfMatch
├── main/java/jp/example/demo/traffic/
│   └── MonitorBroadcaster.java      # demo.policy の本文に labSendsIfMatch
└── test/java/jp/example/demo/integration/
    ├── S2ScenarioIT.java            # 新規：S2-1〜S2-3、同時確定 100 回（-Ds2.repeat）
    └── TrafficMonitorIT.java        # 既存に追加：ポリシーの部分更新・初期化で既定値・demo.policy の配信（labSendsIfMatch）

ui/src/
├── app/
│   ├── routes.tsx                   # /control の追加
│   ├── Launcher.tsx                 # デモ制御パネルと「S2 同時受付で開くウィンドウ」のリンク
│   └── ControlPanel.tsx             # 新規：デモ制御パネル（準備ボタン、ポリシーの切り替え、準備の状況）
├── demo/
│   ├── prepare.ts                   # 新規：準備の処理（reset → policy → 依頼 → 採血）。段階と失敗を返す
│   ├── policyState.ts               # 新規：reducePolicy（純粋関数）と既定値
│   └── usePolicy.ts                 # 新規：GET /demo/policy + demo.policy / demo.reset / 再接続で最新のポリシーを保持
├── realtime/
│   ├── demoApi.ts                   # putPolicy の追加
│   └── types.ts                     # DemoPolicy に labSendsIfMatch
├── fhir/
│   ├── labActions.ts                # beginAccept / confirmAccept の追加、acceptTask を 2 段階で送る形に
│   └── errors.ts                    # 400（If-Match 無し）の文言、受付の 412 の文言
├── systems/
│   ├── lis/LisScreen.tsx            # 受付の確認欄（AcceptDraft）、見出しの版の確認の表示、変化の表示
│   ├── lis/AcceptDraftPanel.tsx     # 新規：確認欄
│   └── shared/rowChanges.ts         # 新規：diffRows（純粋関数）と useRowChanges（10 秒で消える）
├── monitor/
│   ├── sequenceModel.ts             # If-Match の注記、400 の業務上の意味
│   └── HistoryView.tsx              # diffVersions による強調、送信元の画面名
├── scenario/
│   ├── s1Main.ts                    # ステップ 4 の target.control（accept-…,accept-confirm-…）
│   └── variations.ts                # 受付のステップの target.control
└── styles/                          # row-changed の keyframes（prefers-reduced-motion 対応）

ui/tests/
├── unit/                            # rowChanges / historyDiff / acceptDraft / prepare / errors / sequence の追加・更新、scenarios.test の更新
└── e2e/
    ├── pages.ts                     # 受付の共通操作を「受付 → 受付を確定」に
    ├── s2-concurrent.spec.ts        # 新規：4 ウィンドウで S2-1〜S2-3、同時確定（S2_REPEAT）
    └── （s1-manual・self-study・variations・presentation の受付操作を更新）

docs/
├── 03-architecture.md               # F14 の更新（本計画で反映済み）
├── 06-demo-procedures.md            # 新規：デモ手順書（S2 の節）
└── README.md                        # 06 を一覧に追加

specs/001-lab-order-workflow/contracts/ui-screens.md   # ステップ 4 と画面の更新の流れに D-27 の変更を追記
CLAUDE.md                                               # 実装範囲（S1 + S2）と S2 の要点を追記
```

**Structure Decision**: S1 と同じ Web アプリケーション構成（`server/` と `ui/`、1 つの JAR で配信）。
S2 の画面側の処理のうち、デモの進行のためのもの（準備・ポリシーの購読）は `ui/src/demo/` にまとめ、業務画面（`systems/`）と分ける。
一覧の変化の比較は電子カルテにも流用できるよう `systems/shared/` に置く。

## Complexity Tracking

| 事項 | 理由 | 採らなかった案と理由 |
|---|---|---|
| 原則 V の解釈（S2 には講演モードのステップ送り・自習モードの画面上の案内が無い） | 利用者の判断（clarify Q1・Q2、D-29・D-30）。事故の再現は 2 つのウィンドウの操作の順序とタイミングが主題で、手で操作して見せるほうが伝わる。案内の作り込みを避けられる | ステージビューの列を差し替えてガイドで案内する（D-26 の当初案）：利用者が不要と判断。原則 V の「両方を提供する」は S1 で満たしている。将来この解釈を憲章に明記する場合は、意味を変えない明確化として PATCH 改定（v1.0.2）で扱える |
| サーバーのポリシーに、サーバーが使わない値（`labSendsIfMatch`）を置く | 別々のウィンドウで設定を共有する手段が、原則 I の下では `/demo/*` しか無い（R-01） | `localStorage`・`BroadcastChannel`：原則 I 違反。URL パラメータ：準備ボタンで一括して切り替えられない |
