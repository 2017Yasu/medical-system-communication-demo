# Implementation Plan: S1 検体検査ワークフロー

**Branch**: `develop`（専用ブランチは未作成） | **Date**: 2026-10-01 | **Spec**: [spec.md](spec.md)

**Input**: Feature specification from `specs/001-lab-order-workflow/spec.md`

## Summary

電子カルテ（医師・看護師）と検体検査システム（臨床検査技師）が FHIR サーバーだけを介して、
検査依頼 → 採血 → 検体受付 → 測定 → 結果報告 → 結果確認を行う流れを実演できるようにする。
あわせて、全通信を見せる通信モニタ、講演モード（ステップ送り・戻し、解説、ステージビュー）、自習モード、
例外的な流れ（取消・受付不可・再検・一部先行報告）を提供する。

技術的には、fhirstarters skeleton をもとに HAPI FHIR 8.12.1 の plain server（R4）を組み込み Jetty 12.1 上で動かし、
インメモリのリポジトリ、If-Match による楽観的ロック、Transaction Bundle、JSON Patch、Task 状態遷移チェック、
R4 websocket 方式の Subscription、通信記録を自作する。UI は React + TypeScript で作り、同じ JAR から配信する。
全体は Docker Compose の 1 サービスで起動する。
JP Core 1.2.0 / JP Terminology 2.2609.0 は取得スクリプトで各自取得し（リポジトリには含めない）、初期データ・検査項目のコードと
プロファイルの整合性をテストで確認する。詳細は [research.md](research.md)。

## Technical Context

**Language/Version**: Java 21 LTS（サーバー）、TypeScript（UI。最新安定版を lockfile で固定）

**Primary Dependencies**: HAPI FHIR 8.12.1（`hapi-fhir-base`、`hapi-fhir-server`、`hapi-fhir-structures-r4`）、
Jetty 12.1（ee10 servlet、ee10 Jakarta WebSocket）、`io.dogote:json-patch` 1.15、Logback ／
React 19、React Router、Vite 8、`@types/fhir` ／
参照データ（開発・テスト時のみ）：JP Core `jp-core.r4#1.2.0`、JP Terminology `jpfhir-terminology#2.2609.0`。
`scripts/fetch-jp-packages.sh` で取得し、リポジトリ・Docker イメージには含めない（R-20）

**Storage**: インメモリ（版付きスナップショット）。再起動・初期化で初期データに戻る（D-10）

**Testing**: JUnit 5 + HAPI Generic Client（サーバーの単体・結合テスト）、JP パッケージとのコード・プロファイル整合性テスト（R-21）、
Vitest（UI の単体テスト）、Playwright（E2E）

**Target Platform**: Docker Compose（Linux コンテナ）を講演者のノート PC（Windows / macOS / Linux）で実行。
ブラウザは最新の Chrome / Edge（講演用）。オフライン動作

**Project Type**: Web アプリケーション（FHIR サーバー + SPA、1 コンテナで配信）

**Performance Goals**: 操作結果が他の画面・通信モニタに 2 秒以内で反映（SC-002）、初期化から 10 秒以内に操作可能（SC-003）

**Constraints**: 外部ネットワーク・CDN に依存しない（原則 VII）、架空データのみ（原則 II）、全通信を記録（原則 III、SC-006）、
同時更新の結果が決定的（原則 IV）、FHIR R4 準拠（原則 VI）、JP パッケージは再配布しない（取得スクリプトで各自取得、R-20）

**Scale/Scope**: 利用者 1〜数人、同時に開く画面 5 程度、リソース数百件、通信記録は初期化まで数千件以内。
画面：ステージビュー、電子カルテ（医師・看護師）、検体検査システム（技師 A・B）、通信モニタ、進行パネル

## Constitution Check

*GATE: Must pass before Phase 0 research. Re-check after Phase 1 design.*

| 原則 | 判定 | 根拠 |
|---|---|---|
| I. FHIR サーバー経由の連携のみ | PASS | 業務画面同士は直接通信しない。シナリオの自動実行もブラウザから FHIR 要求として送る（R-13）。初期化の合図（`/ws/monitor` の `demo.reset`）はデモ進行のメタ操作で、業務情報を運ばない（R-12） |
| II. 架空データのみ | PASS | 初期データはリポジトリ内の FHIR JSON（data-model.md の架空データ）。識別子は `example.jp` 配下（R-19）。JP パッケージはコード体系・プロファイルの定義のみで、患者データを含まない |
| III. すべての通信を見える化する | PASS | `/fhir/*` のサーブレットフィルタで全要求・応答を記録し、通知・初期化もイベントとして記録（R-11）。依頼の完了も結果報告の Transaction の中で行い、サーバー内部の隠れた更新をしない（D-13） |
| IV. 事故を再現できる | PASS | 書き込みをグローバルロックで直列化して結果を決定的にする（R-06）。ポリシーの既定値は安全側（必須・ON、R-12）。412 で自動リトライしない（FR-004）。事故の再現 UI 自体は S2 |
| V. 医療従事者に伝わる表示 | PASS | 表示ラベルは docs/04 に従い業務用語 + コード値（FR-031）。講演モード・自習モードを本機能に含める（US3、US4） |
| VI. FHIR R4 に忠実かつ必要十分 | PASS | R4 / HAPI structures-r4。依頼と作業を分離（data-model.md）。docs/04 にない新しいルールは無い（未採取の依頼を受付不可にするのは画面側の業務ルールとして spec に明記） |
| VII. オフライン・ワンコマンド運用 | PASS | Docker Compose 1 サービス、フォント同梱、CDN 不使用（R-16、R-18）。JP パッケージの取得はオンライン環境での開発・テスト時のみで、実行時には使わない（R-20） |
| VIII. ドキュメント先行 | PASS | docs/ と spec.md を先に確定。本計画で決めた O-03・O-04・O-09 と、JP パッケージの版は docs/05 に反映済み（下記「docs への反映」） |
| 技術制約 | PASS | skeleton ベースの HAPI plain server、1 コンテナ・1 プロセス、インメモリ、412、R4 websocket、React + TS、Docker Compose。skeleton 流用部分の著作権表示を残す |
| 開発ワークフロー | PASS | S1 の全ステップ・バリエーションを JUnit 結合テストで再現（R-17）。V-xx の確認をタスク化 |

**Post-design re-check（Phase 1 後）**: PASS。data-model.md・contracts/ で新たな違反は無い。
`X-Demo-Client` ヘッダは FHIR の標準外だが、通信モニタの表示のための付加情報であり FHIR の処理には影響しない（contracts/fhir-api.md）。
2 回目の計画更新（JP パッケージの取得スクリプト）でも PASS。パッケージで確認した結果、data-model.md のコード（血算の JLAC10、
DiagnosticReport の category / code、Observation の category）を JP Core 1.2.0 / JP Terminology 2.2609.0 に合わせて修正した（R-15）。

### docs への反映

本計画で決定した未決事項を docs/05-decisions.md の決定事項に移した（反映済み）：
O-03 → D-20（HAPI FHIR 8.12.1）、O-04 → D-21（`io.dogote:json-patch`）、O-09 → D-22（FHIR Tester は削除）。V-02 は確認済みとして記録。
docs/03-architecture.md（Tester の扱い、技術スタック表）と docs/04-design-rules.md（businessStatus に「一部報告済」「報告済」を追加）も更新した。
JP パッケージの版（JP Core 1.2.0、JP Terminology 2.2609.0）と取得方法を D-23 として docs/05 に追加し、docs/03（技術スタック表）と
docs/04（コード体系と JP Core の表）を更新した。

## Project Structure

### Documentation (this feature)

```text
specs/001-lab-order-workflow/
├── plan.md              # This file
├── research.md          # Phase 0
├── data-model.md        # Phase 1
├── quickstart.md        # Phase 1
├── contracts/           # Phase 1
│   ├── fhir-api.md          # FHIR REST API（リソース・操作・検索・ヘッダ・エラー）
│   ├── websocket.md         # /ws/subscription と /ws/monitor のメッセージ
│   ├── demo-control-api.md  # /demo/* のデモ制御 API
│   ├── ui-screens.md        # 画面のルート、X-Demo-Client の値、シナリオ定義の形式
│   └── fetch-jp-packages.md # JP パッケージ取得スクリプトの使い方・処理・終了コード
├── checklists/
│   └── requirements.md
└── tasks.md             # Phase 2（/speckit-tasks で作成）
```

### Source Code (repository root)

```text
compose.yaml                      # サービス demo（ポート 8080）
Dockerfile                        # UI ビルド → サーバービルド → JRE 実行のマルチステージ
.gitignore                        # .cache/、ビルド成果物（server/target/、server/src/main/resources/static/、ui/node_modules/、ui/dist/ など）
.dockerignore                     # .cache/、ビルド成果物

scripts/
└── fetch-jp-packages.sh          # JP Core / JP Terminology の取得・SHA-256 検証・展開（contracts/fetch-jp-packages.md）

.cache/fhir-packages/             # 上記スクリプトの取得先（リポジトリに含めない）
├── downloads/                    # 取得した tgz
├── jp-core.r4#1.2.0/package/
└── jpfhir-terminology#2.2609.0/package/

server/                           # FHIR サーバー（Maven、Java 21）
├── pom.xml
└── src/
    ├── main/
    │   ├── java/jp/example/demo/
    │   │   ├── DemoServerMain.java          # 組み込み Jetty の起動、各サーブレット・フィルタ・WebSocket の登録
    │   │   ├── fhir/
    │   │   │   ├── DemoRestfulServer.java   # HAPI RestfulServer（R4）。skeleton の ExampleRestfulServlet を元にする
    │   │   │   ├── provider/                # リソース種別ごとの ResourceProvider（共通基底クラス + 種別ごと）
    │   │   │   ├── system/                  # TransactionProvider（@Transaction）
    │   │   │   ├── patch/                   # JSON Patch の適用
    │   │   │   ├── search/                  # 検索パラメータの抽出・照合、criteria の解析
    │   │   │   └── rules/                   # If-Match ポリシー、Task 状態遷移マトリクス
    │   │   ├── store/                       # InMemoryRepository、版付きスナップショット、作業用コピー
    │   │   ├── subscription/                # SubscriptionEngine、/ws/subscription エンドポイント
    │   │   ├── traffic/                     # 通信記録フィルタ、TrafficLog、/ws/monitor エンドポイント
    │   │   └── demo/                        # /demo/* サーブレット、DemoPolicy、初期データの読み込み
    │   └── resources/
    │       ├── seed/                        # 初期データ（FHIR JSON、架空）
    │       ├── static/                      # UI のビルド成果物（Docker ビルド時に取り込む。リポジトリには含めない）
    │       └── logback.xml
    └── test/java/jp/example/demo/
        ├── unit/                            # 状態遷移・If-Match・Transaction・検索・criteria・通信記録
        ├── integration/                     # S1 シナリオ・バリエーション・Subscription・通信記録の結合テスト
        └── jp/                              # JpPackageConsistencyTest（パッケージが無ければスキップ。R-21）

ui/                               # 画面（React + TypeScript + Vite）
├── package.json
├── vite.config.ts                # 開発時は /fhir・/ws・/demo を localhost:8080 へプロキシ
├── public/fonts/                 # 同梱フォント
├── src/
│   ├── app/                      # ルーティング、レイアウト（ステージビュー・個別ウィンドウ）
│   ├── fhir/                     # FHIR クライアント（X-Demo-Client、ETag/If-Match、エラー変換）、表示ラベル
│   ├── realtime/                 # /ws/subscription（bind/ping）、/ws/monitor の接続管理
│   ├── systems/
│   │   ├── ehr/                  # 電子カルテ（医師・看護師）
│   │   └── lis/                  # 検体検査システム（技師）
│   ├── monitor/                  # 通信モニタ（シーケンス図、通信の詳細、版の履歴）
│   ├── master/fhir-master.json   # FHIR マスタ：プロファイル、検査項目（JLAC10・単位・基準値・既定値）、固定の coding
│   ├── scenario/                 # シナリオ定義（S1 + バリエーション）、実行部、期待状態の判定、解説文
│   ├── guide/                    # 自習モードのガイド表示
│   └── styles/                   # デザイントークン（CSS 変数）
└── tests/
    ├── unit/                     # Vitest
    └── e2e/                      # Playwright

docs/                             # 設計ドキュメント（既存）
specs/                            # Spec Kit の機能仕様（既存）
```

**Structure Decision**: Web アプリケーション構成。サーバー（`server/`、Maven）と UI（`ui/`、Vite）をリポジトリ内で分け、
Docker のマルチステージビルドで 1 つの実行可能 JAR に統合して 1 コンテナで配信する（D-08、D-19）。
Java のパッケージ名は `jp.example.demo`（R-19 と同じく `example.jp` を用いる）。
skeleton から流用するのは `RestfulServer` のサブクラス、ResourceProvider の書き方、ロギング設定で、流用したファイルには元の著作権表示を残す。

## Complexity Tracking

Constitution Check に違反は無いため、記載事項なし。
