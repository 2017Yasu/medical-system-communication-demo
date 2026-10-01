# 03. アーキテクチャと技術スタック

## 方針

- FHIR サーバーは [hapi-fhirstarters-rest-server-skeleton](https://github.com/FirelyTeam/fhirstarters/tree/master/java/hapi-fhirstarters-rest-server-skeleton)（HAPI FHIR **plain server**）をベースにし、**デモに必要な機能だけを自作**する。
- HAPI FHIR JPA Server（DB 付きの汎用サーバー）は使わない。
  - 利点：ポリシー切替（If-Match 必須など）・状態遷移チェック・通信の見える化をサーバー内部に直接組み込める。挙動をすべて把握・説明できる。
  - 代償：Transaction・PATCH・検索・Subscription などを自前で実装する（[自作する機能](#自作する機能) 参照）。
- **Docker Compose の 1 コマンド**（`docker compose up`）で起動し、講演者のノート PC でオフライン動作させる。
- アプリケーションは **1 コンテナ・1 プロセス**（Java / Jetty）で、FHIR サーバーと UI（React のビルド成果物）を一緒に配信する。

## ベースにする skeleton の現状

2026-10-01 時点の master（commit `765f4d4`）を確認した内容。

| 項目 | skeleton の状態 | デモでの扱い |
|---|---|---|
| HAPI FHIR | 7.0.2（`hapi-fhir-base` / `hapi-fhir-server` / `hapi-fhir-validation`） | **8.12.1** に更新（`hapi-fhir-base` / `hapi-fhir-server` / `hapi-fhir-structures-r4`。`hapi-fhir-validation` は使わない）（D-20） |
| FHIR バージョン | **R5**（`FhirContext.forR5Cached()`、`hapi-fhir-structures-r5`） | **R4 に変更**（参考資料・JP Core が R4 のため） |
| Java | 17 | 17 以上 |
| パッケージング | war、`mvn jetty:run`（Jetty 11） | 組み込み Jetty の実行可能 JAR に変更し、Docker イメージに格納する（[起動と配布](#起動と配布)） |
| 永続化 | Provider ごとの `HashMap` によるインメモリ管理（版の履歴あり） | 汎用のインメモリリポジトリに整理して全リソースで共有 |
| Provider | Patient（read/vread/create/update/search）、Organization（read のみ） | 必要なリソースすべてに拡張 |
| Interceptor | ログ出力の例（新旧 2 種） | 使わない。通信記録はサーブレットフィルタ、ポリシー判定はリソースプロバイダと Transaction 処理で行う。CapabilityStatement への websocket URL の追加にのみ Interceptor のフックを使う |
| FHIR Tester | `hapi-fhir-testpage-overlay`（Spring MVC、`/*` にマッピング） | 削除する（D-22） |
| ライセンス | BSD 系（Copyright (c) 2015, Furore） | 流用したソースには著作権表示を残す |

## 全体構成

```
┌──────────────────────── 講演者のノート PC（オフライン）────────────────────────┐
│                                                                              │
│  ブラウザ（ステージビュー or 個別ウィンドウ）                                     │
│  ┌──────────┐ ┌──────────────┐ ┌──────────┐ ┌──────────┐ ┌──────────────┐   │
│  │電子カルテ │ │検体検査(A/B) │ │ 放射線   │ │ 薬剤部   │ │ 通信モニタ    │   │
│  └────┬─────┘ └──────┬───────┘ └────┬─────┘ └────┬─────┘ │ デモ制御パネル │   │
│       │ FHIR REST (JSON)            │            │       └──────┬───────┘   │
│       │ + WebSocket (Subscription 通知)          │              │ WebSocket │
│       ▼              ▼              ▼            ▼              ▼ (通信ログ) │
│  ┌────────────────────────────────────────────────────────────────────────┐  │
│  │ Docker コンテナ「demo」：Java プロセス（組み込み Jetty）                   │  │
│  │                                                                        │  │
│  │  /fhir/*   TrafficCaptureFilter（全要求・応答を記録）→                     │  │
│  │            HAPI RestfulServer（R4, plain server）                        │  │
│  │    ├ ResourceProvider 群 ── InMemoryRepository（版管理・ロック）          │  │
│  │    ├ SystemProvider（@Transaction、$process-message）                    │  │
│  │    ├ ルール：IfMatchRule / TaskTransitionRule（Provider・Transaction で適用）│  │
│  │    └ SubscriptionEngine（criteria 評価 → 通知）                           │  │
│  │  /ws/*     WebSocket：Subscription 通知（R4 websocket 方式）・通信ログ配信 │  │
│  │  /demo/*   デモ制御 API：初期化・初期データ投入・ポリシー切替・シナリオ     │  │
│  │  /         静的 UI（React のビルド成果物：各システム画面・通信モニタ）      │  │
│  └────────────────────────────────────────────────────────────────────────┘  │
└──────────────────────────────────────────────────────────────────────────────┘
```

### 構成上の判断

- **部門システムはブラウザ画面として実装し、独自のバックエンドを持たない。**
  各画面は FHIR クライアントとしてサーバーに直接アクセスする。これにより「システム間の連携は FHIR サーバー経由のみ」の原則が構成上保証される。
- **Gateway / BFF を別プロセスで立てない。**
  通信の記録・ポリシー判定はサーバー内（同一プロセス）に組み込む。通信の記録は `/fhir/*` のサーブレットフィルタ、
  If-Match・状態遷移の判定はリソースプロバイダと Transaction 処理で行う（constitution 1.0.1 技術制約、specs/001 research R-07・R-11）。
- **永続化はインメモリ。**
  プロセス再起動 = 初期状態。デモ制御 API の「初期化」でも同じ状態に戻せる。

## 自作する機能

HAPI plain server は REST の入口（アノテーションによる振り分け、パース、エラー応答）を提供するが、
保存・検索・PATCH の適用・Transaction の処理などは実装しない。必要なものを以下に挙げる。

| # | 機能 | 使うシナリオ | 実装メモ |
|---|---|---|---|
| F1 | read / vread / create / update（版管理） | 全シナリオ | 汎用 `InMemoryRepository`。`meta.versionId` / `meta.lastUpdated` を採番。ETag は `W/"n"` |
| F2 | `_history`（インスタンス単位） | S2 | Lost Update の様子を版履歴で見せる |
| F3 | 検索（必要なパラメータのみ） | 全シナリオ | 下表「検索パラメータ」参照 |
| F4 | If-Match による楽観的ロック | S1〜S4 | 版が一致しなければ `PreconditionFailedException`（**412**）。HAPI ドキュメントの例は 409（`ResourceVersionConflictException`）だが、FHIR 仕様に合わせ 412 を返す |
| F5 | If-Match 必須ポリシー | S2-3 | ヘッダ無しの update / patch を `400` で拒否。デモ制御で ON/OFF |
| F6 | PATCH（JSON Patch） | S1, S2, S4 | `@Patch` で受け、適用処理は `io.dogote:json-patch` を利用（D-21）。HAPI は `@Patch` の If-Match を `IdType` に設定しないため、ヘッダを自分で読む。If-Match を同様に扱う |
| F7 | Transaction Bundle | S1, S3, S4 | `@Transaction`。`urn:uuid` 参照の解決、`entry.request.ifMatch` / `ifNoneExist` の処理、失敗時は全体を元に戻す |
| F8 | 条件付き作成（If-None-Exist） | S3 | 単独リクエストと Transaction 内の両方 |
| F9 | Task 状態遷移チェック | S1, S2 | [04-design-rules.md](04-design-rules.md#task-の状態遷移マトリクス) のマトリクスで判定。デモ制御で ON/OFF |
| F10 | Subscription | S1〜S4 | 下記 [Subscription](#subscription) 参照 |
| F11 | Slot 仮押さえのタイムアウト | S3 | スケジューラで `busy-tentative` の Slot を一定秒数後に `free` へ戻す |
| F12 | `$process-message` | S5 | Message Bundle を受け、中のリソースを登録する |
| F13 | 通信記録と配信 | 全シナリオ | `/fhir/*` のサーブレットフィルタでリクエスト/レスポンス（メソッド・URL・ヘッダ・本文・ステータス・所要時間・送信元画面）を記録し、WebSocket で通信モニタへ配信。送信元画面は UI が全要求に付ける `X-Demo-Client` ヘッダ（FHIR の処理には影響しない独自ヘッダ）で識別する |
| F14 | デモ制御 API | 全シナリオ | 初期化、初期データ投入、ポリシー切替、タイムアウト秒数の変更 |
| F15 | CapabilityStatement | — | HAPI の自動生成をそのまま利用 |

### 検索パラメータ（最小限）

| リソース | パラメータ | 用途 |
|---|---|---|
| Task | `owner`, `requester`, `status`, `focus`, `patient` | 部門の受付待ち一覧、電子カルテの進捗表示、Subscription の条件 |
| ServiceRequest | `subject`, `requester`, `status`, `category` | 電子カルテの依頼一覧（S1 は `subject`・`requester`・`status` を使う。`category` は S3 以降） |
| DiagnosticReport | `based-on`, `subject` | 結果の表示 |
| Observation | `based-on`, `subject` | 結果の表示 |
| MedicationRequest / MedicationDispense | `subject`, `status` | 処方・調剤の一覧 |
| Slot | `schedule`, `status`, `start` | 予約枠カレンダー |
| Appointment | `slot`, `status` | If-None-Exist の条件、予約一覧 |
| Patient | `identifier`, `name` | 患者選択 |

### 同時実行の扱い

- リソース単位でロックを取り、「版の確認 → 新しい版の書き込み」をまとめて行う。
  同時に届いた更新も必ずどちらか一方だけが成功し、もう一方は 412 になる（S2 の再現性を保証する）。
- Transaction はリポジトリ全体のロックで直列化する（デモの規模では性能上の問題は無い）。

### Subscription

- R4 の Subscription リソースを使う（`criteria` に検索 URL、`channel.type = websocket`）。
- 通知方式は R4 websocket チャネルの方式に従う：画面が `/ws` に接続して `bind {Subscription id}` を送り、
  条件に合うリソースが作成・更新されたら、サーバーが `ping {Subscription id}` を送る。画面は ping を受けて最新状態を GET する。
  - 「通知は合図だけ、中身は取りに行く」という流れが通信モニタ上で見えるので、説明に向いている。
  - 部門システムがバックエンドを持たないため、rest-hook（サーバーから部門システムの URL へ POST）は使わない。
- criteria の評価は F3 の検索ロジックを再利用する。criteria は更新後のリソースで評価される。
- 各画面は開いた時点で、画面ごとに固定 ID の Subscription を `GET` し、無ければ `PUT` で作成する（初期データには含めない）。
  初期化でリソースが消えたら登録し直す。登録の通信も通信モニタに表示される。

## 技術スタック

| 層 | 採用 / 候補 | 備考 |
|---|---|---|
| 言語 | Java 17 以上 | skeleton に合わせる |
| FHIR ライブラリ | HAPI FHIR（`hapi-fhir-server`, `hapi-fhir-structures-r4`） | 8.12.1（D-20） |
| サーブレットコンテナ | 組み込み Jetty | 実行可能 JAR として起動 |
| WebSocket | Jakarta WebSocket（Jetty 付属） | Subscription 通知・通信ログ配信 |
| JP Core / JP Terminology | `jp-core.r4#1.2.0`、`jpfhir-terminology#2.2609.0`（D-23） | 開発・テスト時の参照データ。`scripts/fetch-jp-packages.sh` で取得し、`.cache/fhir-packages/` に展開。リポジトリ・Docker イメージには含めず、実行時にも使わない |
| JSON Patch | `io.dogote:json-patch` 1.15（D-21） | HAPI 本体の PATCH 実装と同じライブラリ。Apache 2.0 / LGPL 3.0 のデュアルライセンス |
| 永続化 | インメモリ | DB 不要 |
| 初期データ | `src/main/resources` に FHIR JSON を配置し、起動時・初期化時に読み込む | 架空データのみ |
| フロントエンド | TypeScript + React（Vite でビルド） | ビルド成果物を JAR に同梱し Jetty から配信。FHIR の型は `@types/fhir`（R4）。Node.js はビルド時のみ必要 |
| 起動・配布 | Docker Compose | [起動と配布](#起動と配布) 参照 |
| テスト | JUnit 5 + HAPI Generic Client | シナリオを結合テストとして自動化し、講演前の動作確認にも使う |
| ビルド | Maven（サーバー）、npm または pnpm（UI）、Docker のマルチステージビルド | UI の資産（フォント等）も同梱し CDN に依存しない |

## 起動と配布

```
docker compose up        # 起動（http://localhost:8080/）
docker compose down      # 停止（インメモリのためデータは消え、次回は初期状態）
```

### Docker イメージの構成（マルチステージビルド）

| ステージ | ベースイメージ（例） | 処理 |
|---|---|---|
| ui-build | Node.js | React アプリをビルドして静的ファイルを出力 |
| server-build | Maven + JDK | 静的ファイルを取り込み、実行可能 JAR をビルド |
| runtime | JRE | 実行可能 JAR だけを含む最終イメージ |

- `compose.yml` のサービスは `demo` の 1 つ。ポート、If-Match ポリシーの既定値、Slot タイムアウト秒数などは環境変数で設定する。
- 開発時は UI を Vite の開発サーバー（ホットリロード）で動かし、FHIR へのリクエストをコンテナにプロキシする構成も使えるようにする。

### オフライン運用

- ビルドはインターネットに接続できる環境で事前に行う（`docker compose build`）。講演会場では、ビルド済みのイメージから起動するだけにする。
- 講演者の PC を替えるときは、`docker save` / `docker load` でイメージを持ち運べる。
- 講演者の PC に Docker（Docker Desktop など）が入っていることを前提にする。
