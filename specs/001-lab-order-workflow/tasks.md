---

description: "S1 検体検査ワークフローの実装タスク"
---

# Tasks: S1 検体検査ワークフロー

**Input**: Design documents from `specs/001-lab-order-workflow/`

**Prerequisites**: [plan.md](plan.md)、[spec.md](spec.md)、[research.md](research.md)、[data-model.md](data-model.md)、[contracts/](contracts/)、[quickstart.md](quickstart.md)

**Tests**: 含める。constitution の開発ワークフロー（「各シナリオは MUST 自動結合テストでステップを再現」）と SC-004（20 回連続の自動確認）、
SC-006（通信の取りこぼし 0 件）が自動テストを要求しているため。テストは対応する実装より先に書き、失敗することを確認してから実装する。

**Organization**: ユーザーストーリーごとにフェーズを分け、各ストーリーを独立に実装・確認できるようにする。

## Format: `[ID] [P?] [Story] Description`

- **[P]**: 並行して実施できる（別ファイル、未完了タスクへの依存なし）
- **[Story]**: 対応するユーザーストーリー（US1〜US5）
- パスはリポジトリのルートからの相対パス

## Path Conventions

- サーバー（Java）：`server/src/main/java/jp/example/demo/`、テスト：`server/src/test/java/jp/example/demo/`
- 初期データ：`server/src/main/resources/seed/`
- UI（React + TypeScript）：`ui/src/`、テスト：`ui/tests/unit/`（Vitest）、`ui/tests/e2e/`（Playwright）
- コード上の識別子は英語、UI 文言・ドキュメントは日本語（constitution 開発ワークフロー）

---

## Phase 1: Setup (Shared Infrastructure)

**Purpose**: リポジトリの初期構成、ビルド・起動の土台

- [X] T001 ルートに `.gitignore` を作成し、`.cache/`、`server/target/`、`server/src/main/resources/static/`、`ui/node_modules/`、`ui/dist/`、`ui/test-results/`、`ui/playwright-report/` を除外する。同じ内容（`.git/` も追加）で `.dockerignore` を作成する（contracts/fetch-jp-packages.md「リポジトリ・Docker への取り込み防止」）
- [X] T002 [P] `scripts/fetch-jp-packages.sh` を作成する（bash、`set -euo pipefail`、実行権限付き）。contracts/fetch-jp-packages.md のとおり、`jp-core.r4#1.2.0`（`https://jpfhir.jp/fhir/core/1.2.0/jp-core.r4-1.2.0.tgz`、SHA-256 `39c4ade9c32ea815a6c5889f9ee89f80efe02d5bbc8236a6b02ec573a28a2c70`）と `jpfhir-terminology#2.2609.0`（`https://jpfhir.jp/fhir/core/terminology/jpfhir-terminology.r4-2.2609.0.tgz`、SHA-256 `aff833151afbef9d6127868ba94e20f29e88ab4500af080e896b651e3999efd5`）を、`--dest`（既定は `JP_FHIR_PACKAGE_DIR`、無ければ `{ルート}/.cache/fhir-packages`）・`--force`・`--check`・`--help` に対応して取得・検証・展開する。`curl`/`wget`、`sha256sum`/`shasum -a 256` のどちらでも動かし、終了コード 0〜6 とメッセージを契約どおりにする
- [X] T003 `server/pom.xml` を作成する：Java 21（`maven.compiler.release` 21）、依存 `ca.uhn.hapi.fhir:hapi-fhir-base` / `hapi-fhir-server` / `hapi-fhir-structures-r4` 8.12.1、`org.eclipse.jetty.ee10:jetty-ee10-servlet` と `org.eclipse.jetty.ee10.websocket:jetty-ee10-websocket-jakarta-server` 12.1.13、`jakarta.servlet:jakarta.servlet-api` 6.0.0、`io.dogote:json-patch` 1.15、`ch.qos.logback:logback-classic`。テスト依存 `org.junit.jupiter:junit-jupiter`、`ca.uhn.hapi.fhir:hapi-fhir-client` 8.12.1、`org.assertj:assertj-core`。maven-shade-plugin（Main-Class `jp.example.demo.DemoServerMain`、`ServicesResourceTransformer`）、surefire（単体テスト）と failsafe（`*IT.java`、システムプロパティ `s1.repeat` を渡す）を設定する（research.md R-01〜R-03、R-05）
- [X] T004 [P] `server/src/main/resources/logback.xml` を skeleton（`fhirstarters/java/hapi-fhirstarters-rest-server-skeleton/src/main/resources/logback.xml`）から流用して作成し、ルートに `THIRD_PARTY_NOTICES.md` を作成して fhirstarters の著作権表示（Copyright (c) 2015, Furore、BSD 系ライセンス全文）と、流用したファイルの一覧を記載する（constitution 技術制約）
- [X] T005 [P] `ui/` を Vite + React + TypeScript で初期化する：`ui/package.json`（`react`・`react-dom` 19、`react-router`、`@types/fhir`、開発依存 `vite` 8・`@vitejs/plugin-react`・`typescript`（**5.9.3**。7 系はネイティブ実装で互換性が未確認のため見送り）・`vitest`・`@playwright/test`・`jsdom`・`@types/node`。scripts：`dev`・`build`・`test`（vitest run）・`e2e`（playwright test））、`ui/tsconfig.json`、`ui/index.html`（`lang="ja"`）、`ui/src/main.tsx`、`ui/vite.config.ts`（開発サーバーで `/fhir`・`/demo` を `http://localhost:8080` へ、`/ws` を `ws: true` でプロキシ）、`ui/playwright.config.ts`（baseURL `http://localhost:8080`）
- [X] T006 [P] 同梱フォントとデザイントークンを用意する：OFL ライセンスの日本語フォント（Noto Sans JP）を npm の `@fontsource/noto-sans-jp`（5.3.0）としてビルド時に同梱し（`ui/src/styles/tokens.css` から import。実行時に CDN を使わない）、ライセンス文を `ui/public/fonts/OFL.txt` に置く。`ui/src/styles/tokens.css` に色・余白・文字サイズの CSS 変数（1920×1080 のプロジェクタで後方から読める本文 20px 以上を基準）を定義し、`ui/src/main.tsx` で読み込む（research.md R-16、原則 VII）
- [X] T007 ルートに `Dockerfile`（ステージ `ui-build`：`node:22` で `npm ci && npm run build` → ステージ `server-build`：Maven + Temurin 21 で `ui/dist` を `server/src/main/resources/static/` にコピーして `mvn -DskipTests package` → ステージ `runtime`：`eclipse-temurin:21-jre` で shade 済み JAR を `java -jar` で起動、ポート 8080）と `compose.yml`（サービス `demo`、`8080:8080`、環境変数 `PORT`）を作成する（research.md R-18）

---

## Phase 2: Foundational (Blocking Prerequisites)

**Purpose**: 全ストーリーが使う FHIR サーバーの中核（保存・If-Match・状態遷移・検索・Transaction・PATCH・Subscription・通信記録・デモ制御）と、UI の共通部品

**⚠️ CRITICAL**: このフェーズが終わるまでユーザーストーリーの作業は始めない

### サーバー：テスト（先に書く）

- [X] T008 [P] `server/src/test/java/jp/example/demo/unit/InMemoryRepositoryTest.java`：versionId が 1 から増えること、`meta.lastUpdated` の設定、最新版・指定版・履歴の取得、作業用コピーへの適用と破棄（ロールバック）、`replaceAll()` の実行中に別スレッドから読み取っても差し替え前か後のどちらかの完全な状態だけが返ること、**2 スレッドが同じ版を前提に同時更新すると必ず片方だけ成功し他方は 412 になること**（V-07 相当、100 回繰り返し）を確認する
- [X] T009 [P] `server/src/test/java/jp/example/demo/unit/IfMatchRuleTest.java`：`ifMatchRequired = true` で If-Match 無しの update / patch は 400、版の不一致は 412、一致は通過、create と存在しない id への PUT（update as create）は If-Match 不要、`W/"3"` と `"3"` の両形式を解釈できることを確認する（data-model.md §7、research.md R-07）
- [X] T010 [P] `server/src/test/java/jp/example/demo/unit/TaskTransitionRuleTest.java`：docs/04 のマトリクスのとおり、許可（`requested`→`accepted`/`rejected`/`in-progress`/`cancelled`、`accepted`→`in-progress`/`on-hold`/`cancelled`、`in-progress`→`on-hold`/`completed`/`failed`/`cancelled`、`on-hold`→`in-progress`/`failed`/`cancelled`）と、それ以外の拒否（422）、**終了状態（`completed`/`rejected`/`failed`/`cancelled`）の Task は status を変えない更新（businessStatus・owner などのみの変更）も含めて一切の更新を 422 で拒否**、終了状態でなければ同じ状態のまま（businessStatus のみの変更）は許可、`taskTransitionCheck = false` で判定しないことを確認する
- [X] T011 [P] `server/src/test/java/jp/example/demo/unit/SearchMatcherTest.java`：contracts/fhir-api.md の検索パラメータ（Task：`owner`・`requester`・`status`・`focus`・`patient`、ServiceRequest：`subject`・`requester`・`status`、DiagnosticReport / Observation：`based-on`、Patient：`identifier`）の抽出・照合、カンマ区切りの OR、複数パラメータの AND、未対応パラメータの拒否、criteria 文字列（例：`Task?owner=Organization/lab-dept,PractitionerRole/tech-a,PractitionerRole/tech-b`）の解析を確認する
- [X] T012 [P] `server/src/test/java/jp/example/demo/unit/TransactionProcessorTest.java`：POST エントリへの ID 割り当てと `urn:uuid` 参照の書き換え、処理順序（POST → PUT → GET。PUT が同じ Bundle 内で POST したリソースを `urn:uuid` で参照できること）、`DELETE` と `PATCH` のエントリが 400 で拒否されること（contracts/fhir-api.md transaction）、`ifMatch` の不一致で全体が反映されず 412、`ifNoneExist` の一致時に作成しないこと、Task の不正遷移で 422、失敗時の OperationOutcome の `issue.expression` が `Bundle.entry[n]` を指すこと、成功時の `transaction-response` の各 `response.status`・`location`・`etag` を確認する（research.md R-08）
- [X] T013 [P] `server/src/test/java/jp/example/demo/unit/JsonPatchApplierTest.java`：`replace`・`add` の適用、`resourceType` または `id` を変えるパッチの拒否（422）、適用できないパッチ（存在しないパスへの replace）の拒否（422）を確認する
- [X] T014 [P] `server/src/test/java/jp/example/demo/unit/TrafficCaptureFilterTest.java`：要求（メソッド・URL・`If-Match`・`If-None-Exist`・`Content-Type`・`Prefer`・本文）と応答（ステータス・`ETag`・`Location`・`Content-Location`・`Last-Modified`・本文・所要時間）の記録、`X-Demo-Client` が無い場合は `unknown`、本文が 256 KB を超えると切り詰めて `truncated: true`、エラー応答も記録されること、`http` の `seq` が要求の受信時に採番され、要求の処理中に追加された `notification` の `seq` がその要求より大きくなることを確認する（contracts/websocket.md TrafficRecord）
- [X] T015 `server/src/test/java/jp/example/demo/integration/DemoServerExtension.java`：JUnit 5 拡張として `DemoServerMain` をランダムポートで起動・停止し、各テストの前に `POST /demo/reset` を行い、`X-Demo-Client` を付ける HAPI Generic Client（R4）と、`/ws/subscription`・`/ws/monitor` に接続するテスト用 WebSocket クライアントを提供する
- [X] T016 `server/src/test/java/jp/example/demo/integration/FhirApiContractIT.java`：quickstart.md §3 の表（初期化で初期データ 12 件、`GET /fhir/Patient` で 2 件、If-Match 無しの PATCH で 400、古い版で 412、`requested`→`completed` で 422、`_history`、`/demo/traffic` に全要求が順に記録）と、`/fhir/metadata` の `rest[0].extension` に `capabilitystatement-websocket` があること、create / update / patch の応答に `ETag`・`Location` があることを確認する（T015 に依存）
- [X] T017 [P] `server/src/test/java/jp/example/demo/jp/JpPackageConsistencyTest.java`：環境変数 `JP_FHIR_PACKAGE_DIR`（無ければ `../.cache/fhir-packages`）の `jp-core.r4#1.2.0/package/` と `jpfhir-terminology#2.2609.0/package/` を読み、(1) `server/src/main/resources/seed/*.json` の `meta.profile` と `ui/src/master/fhir-master.json` の `profiles` の値が JP Core の StructureDefinition の `url` に存在すること、(2) seed と FHIR マスタの coding のうち、system がパッケージ内の CodeSystem（`content = complete`）にあるものは code が存在することを確認する。パッケージが無ければ `Assumptions.assumeTrue` でスキップし「scripts/fetch-jp-packages.sh を実行してください」と表示する（research.md R-21）

### サーバー：実装

- [X] T018 `server/src/main/java/jp/example/demo/store/` に `StoredVersion`（不変の版：リソースの JSON 文字列、versionId、lastUpdated）、`InMemoryRepository`（`type/id` ごとの版のリスト、型ごとの連番 ID、**全書き込みを 1 つの公平な `ReentrantLock` で直列化**、読み取りはロック不要、`WorkingCopy` によるステージングとコミット／破棄、`replaceAll(seedResources)`（**新しい状態を別に組み立ててから参照を 1 回で差し替える**。読み取りは差し替え前か後のどちらかの状態だけを見る）、変更通知リスナー）を実装する（research.md R-06。T008 を通す）
- [X] T019 [P] `server/src/main/java/jp/example/demo/demo/DemoPolicy.java`：`ifMatchRequired`（既定 `true`）・`taskTransitionCheck`（既定 `true`）をスレッドセーフに保持する（data-model.md §6）
- [X] T020 [P] `server/src/main/java/jp/example/demo/fhir/rules/IfMatchRule.java`：If-Match の値（`UpdateMethodBinding.applyETagAsVersion` と同じ解釈）と現在の版を比較し、必須時のヘッダ無しは `InvalidRequestException`（400、diagnostics「更新の前提となる版（If-Match）が指定されていません」）、不一致は `PreconditionFailedException`（412、diagnostics「他の利用者が先に更新しました（現在の版: n）」）を投げる（T009 を通す）
- [X] T021 [P] `server/src/main/java/jp/example/demo/fhir/rules/TaskTransitionRule.java`：docs/04 の状態遷移マトリクスを `Map<TaskStatus, Set<TaskStatus>>` で定義し、違反は `UnprocessableEntityException`（422、diagnostics「この状態（{現在}）から {遷移先} へは変更できません」）を投げる。現在の状態が終了状態（`completed`/`rejected`/`failed`/`cancelled`）の場合は、status が変わらない更新も `UnprocessableEntityException`（422、diagnostics「この作業は{現在の状態の表示ラベル}のため変更できません」）で拒否する（data-model.md §7。T010 を通す）
- [X] T022 [P] `server/src/main/java/jp/example/demo/fhir/search/` に `SearchParameters`（リソース種別ごとの明示的な抽出関数：参照は `{Type}/{id}` 文字列、トークンはコード）、`SearchMatcher`（OR / AND 照合）、`CriteriaParser`（`Type?name=v1,v2&...` の解析、未対応パラメータは例外）を実装する（research.md R-09。T011 を通す）
- [X] T023 [P] `server/src/main/java/jp/example/demo/fhir/patch/JsonPatchApplier.java`：`io.dogote:json-patch` で RFC 6902 パッチを適用し、適用後に `resourceType` と `id` が変わっていないことを確認する（research.md R-02。T013 を通す）
- [X] T024 `server/src/main/java/jp/example/demo/fhir/provider/AbstractRepositoryProvider.java`：`IResourceProvider` の共通基底として `@Read(version = true)`・`@History`（インスタンス）・`@Create`・`@Update`（存在しない id は作成）・`@Search`（パラメータ無しの全件と、種別ごとの検索の委譲）を `InMemoryRepository`・`IfMatchRule`・`SearchMatcher` に接続し、`MethodOutcome` に版付き ID を返す（応答の `ETag`・`Location` が付く）。書き込み前の検証フック `validateWrite(current, next)` を持つ（T018、T020、T022 に依存）
- [X] T025 [P] `server/src/main/java/jp/example/demo/fhir/provider/` に読み取り中心の Provider を実装する：`PatientProvider`（`identifier` 検索）、`PractitionerProvider`、`PractitionerRoleProvider`、`OrganizationProvider`（contracts/fhir-api.md：read / vread / `_history` / 全件検索）（T024 に依存）
- [X] T026 [P] `server/src/main/java/jp/example/demo/fhir/provider/` に `ServiceRequestProvider`（create / update、検索 `subject`・`requester`・`status`）、`SpecimenProvider`（create / update）、`ObservationProvider`（create、検索 `based-on`）、`DiagnosticReportProvider`（create / update、検索 `based-on`）を実装する（T024 に依存）
- [X] T027 `server/src/main/java/jp/example/demo/fhir/provider/TaskProvider.java`：create / update / 検索（`owner`・`requester`・`status`・`focus`・`patient`）に加え、`@Patch`（`PatchTypeEnum.JSON_PATCH`）を実装する。**HAPI は `@Patch` の If-Match を `IdType` に設定しないため、引数の `RequestDetails` から `UpdateMethodBinding.applyETagAsVersion(RequestDetails, IIdType)` で版を取り出して `IfMatchRule` に渡す**。update / patch とも `taskTransitionCheck` が ON なら `TaskTransitionRule` で判定する（research.md R-07。T020、T021、T023、T024 に依存）
- [X] T028 `server/src/main/java/jp/example/demo/fhir/provider/SubscriptionProvider.java`：read / vread / `_history` / update（update as create を含む）。`channel.type` が `websocket` 以外、または `criteria` を `CriteriaParser` で解析できない場合は 422 で保存しない。保存時に `status` を `active` にする（data-model.md Subscription、§7。T022、T024 に依存）
- [X] T029 `server/src/main/java/jp/example/demo/fhir/system/TransactionProvider.java`（`@Transaction`）と `TransactionProcessor.java`：research.md R-08 の手順（POST への ID 割り当てと `fullUrl` 対応表 → `FhirTerser` で全 Reference を書き換え → `WorkingCopy` に DELETE / POST（`ifNoneExist`）/ PUT（`ifMatch`、update as create）/ GET の順で適用、Task は `TaskTransitionRule` も適用 → 全件成功でコミット、1 件でも失敗で破棄して OperationOutcome（`issue.expression` = `Bundle.entry[n]`、ステータスは失敗の種類に応じて 400 / 412 / 422））を実装し、`transaction-response` を返す。`PATCH` / `DELETE` エントリは 400（T012 を通す。T018、T020、T021 に依存）
- [X] T030 `server/src/main/java/jp/example/demo/fhir/DemoRestfulServer.java`：skeleton の `ExampleRestfulServlet` を元に（著作権表示を残す）`FhirContext.forR4Cached()`、T025〜T029 の Provider 登録、既定の応答形式 JSON、`ETagSupportEnum.ENABLED` を設定し、`Pointcut.SERVER_CAPABILITY_STATEMENT_GENERATED` のフックで `rest[0].extension` に `http://hl7.org/fhir/StructureDefinition/capabilitystatement-websocket`（`ws://{Host}/ws/subscription`）を追加する（contracts/fhir-api.md capabilities）
- [X] T031 [P] `server/src/main/java/jp/example/demo/traffic/` に `TrafficRecord`（record。data-model.md §6 の項目：`seq`・`timestamp`・`kind`（`http` / `notification` / `demo`）・`client`・`request`・`response`・`notification`・`demoEvent`）、`TrafficLog`（初期化からの連番、全件保持、リスナー、`clear()`、`reserveSeq()`）、`TrafficCaptureFilter`（`/fhir/*` の要求の受信時に `reserveSeq()` で `seq` を採番し、応答の完了後にその `seq` で記録する。本文は最大 256 KB、超過分は切り詰めて `truncated: true`）を実装する（research.md R-11。T014 を通す）
- [X] T032 `server/src/main/java/jp/example/demo/traffic/MonitorWebSocketEndpoint.java`（`/ws/monitor`）：接続中の全セッションへ `{"type":"traffic","record":...}`、`{"type":"demo.reset",...}`、`{"type":"demo.policy","policy":...}` を JSON で配信する（contracts/websocket.md。T031 に依存）
- [X] T033 `server/src/main/java/jp/example/demo/subscription/SubscriptionEngine.java` と `SubscriptionWebSocketEndpoint.java`（`/ws/subscription?client=...`）：`bind {id}` に `bound {id}`（存在しない・`active` でない場合は `error {id} {理由}`）を返し、リポジトリのコミット（単一操作または Transaction 全体）ごとに、変更されたリソースを `active` な Subscription の criteria で評価して、**該当 Subscription ごとに 1 回だけ** `ping {id}` を bind 中の接続へ送り、送信ごとに `TrafficLog` へ `notification`（`subscriptionId`・`targetClient`・きっかけのリソースの版付き参照）を記録する。`unbindAll()` を持つ（research.md R-10、contracts/websocket.md。T018、T022、T031 に依存）
- [X] T034 [P] `server/src/main/resources/seed/` に初期データ 12 件を FHIR R4 JSON で作成する（data-model.md §1：Organization `hospital`・`lab-dept`（`partOf` → `Organization/hospital`）、Patient `demo-taro`（デモ 太郎、男性、1966-04-01 生、患者番号 `00000001`）・`demo-hanako`（デモ 花子、女性、1985-07-15 生、患者番号 `00000002`）、Practitioner `dr-x`・`ns-d`・`tech-a`・`tech-b`、PractitionerRole `dr-x`・`ns-d`（`organization` → `hospital`）・`tech-a`・`tech-b`（`organization` → `lab-dept`）。`meta.profile` は data-model.md §1 の表の JP Core 1.2.0 の URL、識別子の system は `https://demo.example.jp/fhir/sid/...`）
- [X] T035 `server/src/main/java/jp/example/demo/demo/SeedLoader.java` と `DemoControlServlet.java`（`/demo/*`）：`POST /demo/reset`（書き込みロック内で `InMemoryRepository.replaceAll`（初期データだけの状態へ一括差し替え）と通信記録の消去 → `SubscriptionEngine.unbindAll()` → `kind = demo` の `reset` を記録 → `/ws/monitor` に `demo.reset` を配信 → `{"resetAt": ..., "seedResources": 12}`）、`GET` / `PUT /demo/policy`（変更時は `demo.policy` を配信）、`GET /demo/traffic?after={seq}` を実装する（contracts/demo-control-api.md。T018、T019、T031〜T034 に依存）
- [X] T036 `server/src/main/java/jp/example/demo/DemoServerMain.java`：環境変数 `PORT`（既定 8080）で組み込み Jetty 12.1（ee10）を起動し、1 つの `ServletContextHandler` に `DemoRestfulServer`（`/fhir/*`）、`TrafficCaptureFilter`（`/fhir/*`）、`DemoControlServlet`（`/demo/*`）、`/ws/subscription`・`/ws/monitor`、クラスパス `static/` の静的ファイル配信（未知のパスは `index.html` へフォールバック）を登録し、起動時に初期化（`/demo/reset` と同じ処理）を行う（research.md R-03、V-04・V-05。T016 を通す。T030〜T035 に依存）

### UI：共通部品

- [X] T037 [P] `ui/tests/unit/labels.test.ts` と `ui/tests/unit/errors.test.ts`：表示ラベル（docs/04「表示ラベル」の Task.status・ServiceRequest.status・HTTP ステータスの表と、data-model.md §3.3 の businessStatus）と、エラーの表示（contracts/ui-screens.md「エラーの表示」：400 If-Match 無し「更新の前提となる版が指定されていません」、412「他の利用者が先に更新しました。最新の状態を表示します」、422「この状態からは {操作名} できません」、通信できない「FHIR サーバーに接続できません」など。HTTP ステータスとコード値を併記）を確認する
- [X] T038 [P] `ui/src/master/fhir-master.json` を作成する：`profiles`（data-model.md §1 の 8 リソースの JP Core URL）、`labSets`（`CBC` 血算・`BIO` 生化学、system `https://demo.example.jp/fhir/CodeSystem/lab-set`）、`labItems`（data-model.md §1 の 8 項目の JLAC10 コード（system `http://medis.or.jp/CodeSystem/master-JLAC10-17digits`）・日本語名・UCUM 単位・基準値 low/high・デモ 太郎の既定値）、固定の coding（ServiceRequest category SNOMED `108252007`・code `demo:CodeSystem/order-code#LAB`、Observation category `JP_SimpleObservationCategory_CS#laboratory`、DiagnosticReport category LOINC `LP29693-6`・code `JP_DocumentCodes_CS#11502-2`「検体検査報告書」、Specimen type `v2-0487#BLD`、Task code `task-code#fulfill`、businessStatus 7 コード）。`demo:` は `https://demo.example.jp/fhir/` と書く
- [X] T039 [P] `ui/src/fhir/labels.ts` と `ui/src/fhir/errors.ts`：T037 の表をデータとして実装し、`formatStatus(kind, code)`（「受付済み `accepted`」形式）と `toDisplayError(response | networkError, operationName)` を提供する（T037 を通す）
- [X] T040 `ui/src/fhir/client.ts`：`fetch` の薄いラッパー。`/fhir` を基点に、全要求へ `X-Demo-Client` を付け、`application/fhir+json` / `application/json-patch+json` を扱い、`read`・`search`（`searchset` を配列で返す）・`history`・`create`・`update(resource, etag)`・`patch(ref, ops, etag)`・`transaction(bundle)` を提供する。応答の `ETag` を返り値に含め、更新系は呼び出し側が渡した ETag を `If-Match` に付ける。エラーは `toDisplayError` で変換した例外にする（research.md R-16、contracts/ui-screens.md「画面の更新の流れ」3〜4）
- [X] T041 `ui/src/realtime/monitorSocket.ts` と `ui/src/realtime/subscription.ts`：`/ws/monitor` の受信（`traffic`・`demo.reset`・`demo.policy`）をアプリ全体のイベントとして配信し、`ensureSubscription(client, id, criteria, reason)`（`GET` → 404 なら `PUT` で `status: requested`・`channel.type: websocket` を作成）と、`/ws/subscription?client=` への接続・`bind`・`ping` の受信・切断時の再接続と再 bind を提供する。`demo.reset` を受けたら Subscription を登録し直す（contracts/websocket.md、contracts/ui-screens.md「画面の更新の流れ」）
- [X] T042 `ui/src/realtime/useLiveData.ts`：画面ごとの設定（`X-Demo-Client`、Subscription id・criteria、取得関数）を受け取り、開いたときの登録と取得、`ping` 受信時の取り直し、再接続時と `demo.reset` 時の取り直しを行う React フック（FR-008、FR-012、FR-022。T040、T041 に依存）
- [X] T043 `ui/src/app/App.tsx`・`ui/src/app/routes.tsx`・`ui/src/app/ErrorBanner.tsx`・`ui/src/app/ResetButton.tsx`：React Router で contracts/ui-screens.md「ルート」のパス（`/`・`/stage`・`/ehr`・`/lis`・`/monitor`）を定義し（各画面は後続タスクで実装、ここでは仮の画面）、エラー表示の帯と、`POST /demo/reset` を呼ぶ「初期化」ボタン（FR-003）を用意する（T039、T040 に依存）

**Checkpoint**: `mvn verify` で T008〜T016 が通り（T017 はパッケージ取得後に通る）、`docker compose up` で `/fhir/metadata` と仮の画面が表示される

---

## Phase 3: User Story 1 - 検体検査の一連の流れを通しで実演する (Priority: P1) 🎯 MVP

**Goal**: 医師の依頼 → 看護師の採血 → 技師の受付・測定・結果報告 → 医師の結果確認を、電子カルテと検体検査システムの画面で FHIR サーバー経由で実演できる

**Independent Test**: 初期状態から docs/02 S1 の 8 ステップを `/ehr?role=doctor`・`/ehr?role=nurse`・`/lis?tech=tech-a` で操作し、各ステップ後に両方の画面で依頼・作業・検体・結果の状態が data-model.md §3.5 のとおり表示される

### Tests for User Story 1

- [X] T044 [P] [US1] `server/src/test/java/jp/example/demo/integration/S1ScenarioIT.java`：`s1-main` の 8 ステップを data-model.md §4 の要求（依頼 Transaction、採血 Transaction、受付 PATCH、測定開始 PATCH、全項目報告 Transaction、結果取得）で再現し、各ステップ後に ServiceRequest・Task（status・businessStatus・owner）・Specimen・DiagnosticReport の状態が data-model.md §3.5 と一致し、**ServiceRequest.status がステップ 1〜6 の間 `active` のまま、ステップ 7 で `completed`** になることを確認する。システムプロパティ `s1.repeat`（既定 1）の回数だけ繰り返す（SC-004。T015 に依存）
- [X] T045 [P] [US1] `server/src/test/java/jp/example/demo/integration/SubscriptionIT.java`：`lis-lab-dept`（`Task?owner=Organization/lab-dept,PractitionerRole/tech-a,PractitionerRole/tech-b`）と `ehr-dr-x`（`Task?requester=Practitioner/dr-x`）を登録・bind し、依頼 Transaction で各 1 回の `ping`、受付 PATCH（owner が技師に変わっても）で `ping` が届くこと、1 つの Transaction で複数リソースが該当しても ping は 1 回、存在しない Subscription への bind は `error`、初期化で bind が解除されることを確認する（T015 に依存）
- [X] T046 [P] [US1] `ui/tests/unit/labOrderBuilders.test.ts`：T047 の各ビルダーが data-model.md §2・§4 のとおりのリソース・要求を作ること（オーダー番号 `L-{yyyyMMdd}-{4 桁}`、`orderDetail` が 1 件以上、Task 作成時 owner `Organization/lab-dept`・businessStatus `not-collected`、受付 PATCH の 4 操作、全項目報告で Observation × n・DiagnosticReport `final`・Task `completed`・ServiceRequest `completed`、既存の `partial` 報告がある場合は DiagnosticReport を `ifMatch` 付き PUT、基準値外の判定 H / L / N）を確認する

### Implementation for User Story 1

- [X] T047 [US1] `ui/src/fhir/builders/labOrder.ts`：FHIR マスタ（T038）を使い、`buildOrderTransaction(patient, sets, now)`（POST ServiceRequest + Task + Specimen、`urn:uuid` で相互参照、Specimen は status 無し）、`buildCollectionTransaction(specimen, specimenEtag, task, taskEtag, now)`（Specimen `available`・`collection.collector` `Practitioner/ns-d`・`collectedDateTime`、Task businessStatus `collected`）、`buildAcceptPatch(techRole, now)`（status `accepted`・businessStatus `received`・owner・lastModified）、`buildStartPatch(now)`（`in-progress`・`measuring`）、`buildFinalReportTransaction(...)`（data-model.md §4「全項目報告」）、`judgeInterpretation(value, range)` を実装する（T046 を通す）
- [X] T048 [P] [US1] `ui/src/systems/ehr/OrderForm.tsx`：医師が患者（`GET /fhir/Patient` の 2 名）と検査セット（血算・生化学、1 つ以上必須。FR-005）を選んで依頼する画面部品。送信は `buildOrderTransaction` → `transaction`（FR-006）
- [X] T049 [P] [US1] `ui/src/systems/ehr/OrderList.tsx`：`ServiceRequest?requester=Practitioner/dr-x` と、各依頼の Task（`Task?focus=`）を表示し、依頼の状態・作業の状態・業務上の状態・担当者を `formatStatus` で表示する（FR-007、FR-031）
- [X] T050 [P] [US1] `ui/src/systems/ehr/ResultView.tsx`：選んだ依頼の `DiagnosticReport?based-on=` と `Observation?based-on=` を取得し、項目名・値・単位・基準値・H / L を表示する（FR-009）
- [X] T051 [US1] `ui/src/systems/ehr/DoctorView.tsx`：T048〜T050 を組み合わせ、`useLiveData`（`X-Demo-Client: ehr-doctor`、Subscription `ehr-dr-x`、criteria `Task?requester=Practitioner/dr-x`、reason「医師 X が出した依頼の作業の通知」）で通知時に一覧と結果を取り直す（FR-008。T042、T048〜T050 に依存）
- [X] T052 [US1] `ui/src/systems/ehr/NurseView.tsx`：`useLiveData`（`ehr-nurse`、Subscription `ehr-nurse`、criteria `Task?owner=Organization/lab-dept,PractitionerRole/tech-a,PractitionerRole/tech-b`）で Task を取得し、`requested` かつ未採取のものを採血待ち一覧として表示し、「採血を記録」で Specimen と Task を取得して ETag 付きで `buildCollectionTransaction` を送る（FR-011、contracts/ui-screens.md の看護師の criteria の注記。T042、T047 に依存）
- [X] T053 [US1] `ui/src/systems/ehr/EhrScreen.tsx`：`?role=doctor` / `?role=nurse` で T051 / T052 を切り替える電子カルテの画面（ステージビューからも使えるよう props でも役割を受ける）。`/ehr` ルートに接続する（T043、T051、T052 に依存）
- [X] T054 [P] [US1] `ui/src/systems/lis/ResultEntry.tsx`：依頼の `orderDetail` に含まれる項目（FHIR マスタ）の値を入力し（講演用に既定値を入れるボタン付き）、「承認・報告」で `buildFinalReportTransaction` を送る（FR-015）
- [X] T055 [US1] `ui/src/systems/lis/LisScreen.tsx`：`?tech=tech-a|tech-b` を受け、`useLiveData`（`lis-tech-a` / `lis-tech-b`、Subscription `lis-lab-dept`、criteria `Task?owner=Organization/lab-dept,PractitionerRole/tech-a,PractitionerRole/tech-b`）で作業一覧を表示する。未採取は業務上の状態「未採取」と表示して受付ボタンを無効にし「採血の記録後に受付できます」と案内、採取済は「受付」（`buildAcceptPatch`、If-Match 付き）、受付済みは「測定開始」、実施中は T054 を表示する。412 は ErrorBanner に出して一覧を取り直し、自動でやり直さない（FR-004、FR-012〜FR-015、data-model.md §5。T042、T047、T054 に依存）。`/lis` ルートに接続する
- [X] T056 [US1] `ui/tests/e2e/s1-manual.spec.ts`：Docker で起動したアプリに対し、`/ehr?role=doctor`・`/ehr?role=nurse`・`/lis?tech=tech-a` を別ページで開き、8 ステップを手動操作して各画面の表示（quickstart.md §4 の表の「電子カルテ」「検体検査システム」列）と、他の画面への反映が 2 秒以内であること（SC-002）を確認する

**Checkpoint**: US1 単独で講演の中心部分を手動で実演できる（MVP）

---

## Phase 4: User Story 2 - 通信モニタで各ステップの通信と状態変化を見る (Priority: P2)

**Goal**: すべての要求・応答・通知を時刻順のシーケンス図で示し、個々の通信の中身とリソースの版の履歴を確認できる

**Independent Test**: US1 の各ステップ（または同等の API 呼び出し）を実行し、`/monitor` に表示される通信の件数・順序・送信元・結果が実際の通信と一致し、詳細と版の履歴を開ける

### Tests for User Story 2

- [X] T057 [P] [US2] `server/src/test/java/jp/example/demo/integration/TrafficMonitorIT.java`：S1 の 8 ステップの要求を送りながら `/ws/monitor` を受信し、`traffic` イベントの件数・順序・`client`・ステータスが実際の要求と通知（`notification`）に一致し、`/demo/traffic` と `/demo/traffic?after=` の結果も一致すること（取りこぼし 0 件、SC-006）、初期化で `demo.reset` が届き記録が消えることを確認する（T015 に依存）
- [X] T058 [P] [US2] `ui/tests/unit/sequence.test.ts`：`X-Demo-Client` から列への対応（`ehr-doctor`・`ehr-nurse` → 「電子カルテ」、`lis-tech-a`・`lis-tech-b` → 「検体検査システム」、通知は「FHIR サーバー」→ 通知先の列）、矢印の注記（操作者・メソッド・リソース種別・業務上の意味）、`monitor` の通信を既定で非表示にする絞り込みを確認する（contracts/ui-screens.md）

### Implementation for User Story 2

- [X] T059 [US2] `ui/src/monitor/sequenceModel.ts`：TrafficRecord をシーケンス図の要素（列・矢印・注記・結果）に変換する純粋関数を実装する（T058 を通す）
- [X] T060 [US2] `ui/src/monitor/useTraffic.ts`：開いた時点で先に `/ws/monitor` に接続してから `/demo/traffic` を取得し、両者を `seq` で重複を除いて結合し、常に `seq` の順に並べて保持する（配信は `seq` の順とは限らない。contracts/websocket.md）。`demo.reset` で空にする。シナリオの判定（T069）からも使えるよう、`ui/src/realtime/trafficStore.ts` に共通の保持部を置く（T041 に依存）
- [X] T061 [P] [US2] `ui/src/monitor/SequenceDiagram.tsx`：3 列（電子カルテ・FHIR サーバー・検体検査システム）の SVG シーケンス図。新しい通信に自動スクロールし、矢印の選択で詳細を開く。`monitor` の通信の表示切替を持つ（FR-023。T059 に依存）
- [X] T062 [P] [US2] `ui/src/monitor/JsonView.tsx` と `ui/src/monitor/TrafficDetail.tsx`：要求と応答の本文（整形・折りたたみ可能な JSON）、主要ヘッダ（`If-Match`・`ETag` を強調）、応答の業務上の意味（`toDisplayError` と成功時の「成功」）、`truncated` の表示（FR-024）
- [X] T063 [P] [US2] `ui/src/monitor/HistoryView.tsx`：リソース参照を受け取り、`X-Demo-Client: monitor` で `GET /fhir/{type}/{id}/_history` を取得して、版ごとの status・businessStatus・owner・更新日時と、Transaction の中で更新されたこと（通信記録の該当 `seq` へのリンク）を一覧表示する（FR-025、US2 シナリオ 3・4）
- [X] T064 [US2] `ui/src/monitor/MonitorScreen.tsx`：T060〜T063 を組み合わせた通信モニタの画面を `/monitor` ルートに接続する（T043 に依存）

**Checkpoint**: US1 と US2 がそれぞれ単独で動作する

---

## Phase 5: User Story 3 - 講演モードでステップごとに解説しながら進める (Priority: P2)

**Goal**: ステージビューで「次へ（自動実行）」「戻る」「初期化」とステップごとの解説を使い、講演で安定して実演できる

**Independent Test**: `/stage?mode=presentation` で「次へ」を 8 回押し、各ステップで解説が表示され画面と通信モニタが期待どおり変化する。ステップ 5 で「戻る」を押すとステップ 4 完了時点の状態になる

### Tests for User Story 3

- [X] T065 [P] [US3] `ui/tests/unit/scenarioRunner.test.ts`：FHIR クライアントを模擬して、`next()` が次のステップの `run` をそのステップの `actor` の `X-Demo-Client` で実行すること、`back()` が `POST /demo/reset` の後にステップ 1〜(n-1) を順に再実行すること、`detectStep()` が contracts/ui-screens.md「ステップの判定」のとおり、データの条件と通信の条件（前のステップの基準 `seq` より大きい `seq` の TrafficRecord）の両方で現在のステップを判定すること（手動操作でも進む）を確認する。特に、データが同じステップ 1 と 2、4 と 5、7 と 8 が通信の条件で区別されること、ping がその原因の要求より先に届いても `seq` の順で正しく判定されること、auto のステップで「次へ」を押すと最大 5 秒待ち、条件が満たされなければ「通知を待っています」の状態になることを確認する（research.md R-13）
- [X] T066 [P] [US3] `ui/tests/e2e/presentation.spec.ts`：`/stage?mode=presentation` で `s1-main` を選び、「次へ」を 8 回押して各ステップの解説と、電子カルテ・検体検査システム・通信モニタの表示（quickstart.md §4 の表）を確認する。「戻る」でステップ 7 完了時点の状態、「初期化」で 10 秒以内に初期状態に戻ること（SC-003）、1920×1080 と 1280×720 で横スクロールが出ないことを確認する

### Implementation for User Story 3

- [X] T067 [P] [US3] `ui/src/scenario/types.ts`：contracts/ui-screens.md「シナリオ定義の形式」の `ScenarioId`・`Scenario`・`ScenarioStep`・`ExpectedState`・`ScenarioContext`（actor ごとの FHIR クライアントと、直近に取得したリソース・ETag の参照）を定義する
- [X] T068 [US3] `ui/src/scenario/s1Main.ts`：docs/02 S1 の 8 ステップを定義する。各ステップに `title`、`actor`（contracts/ui-screens.md「ステップの判定」の表のとおり。**ステップ 2 と 5 が `auto`（`run` 無し）**、ステップ 8 は `ehr-doctor` で `run` は結果表示を開く）、`target`（自習モードで強調する画面と `data-guide` の値。auto は画面のみ）、T047 のビルダーを使う `run`、data-model.md §3.5 に基づくデータの条件と同表の通信の条件（`traffic`）からなる `expected`、`explanation.business`（医療従事者向け）と `explanation.fhir`（技術者向け。例：「ServiceRequest は active のまま、Task だけが accepted に進む」）を書く（T047、T067 に依存）
- [X] T069 [US3] `ui/src/scenario/runner.ts`：`ScenarioRunner`（`start(scenario)`・`next()`・`back()`・`reset()`・`detectStep(state)`、現在のステップの購読）を実装する。`detectStep` は contracts/ui-screens.md「ステップの判定」に従い、T060 の `trafficStore` から受け取る TrafficRecord ごとに判定し直す。`next()` は auto 以外なら `run` を実行し、完了の判定を最大 5 秒待つ（満たされなければ「通知を待っています」）。`back()` は `/demo/reset` → ステップ 1〜(n-1) の再実行（FR-027）（T065 を通す。T040、T060、T067 に依存）
- [X] T070 [US3] `ui/src/app/ProgressPanel.tsx`：シナリオの選択、「次へ」「戻る」「初期化」、現在のステップ番号とタイトル、業務上の意味と FHIR 上の意味の解説を表示する（FR-026。T069 に依存）
- [X] T071 [US3] `ui/src/app/StageView.tsx` と `ui/src/app/stage.module.css`：電子カルテ（医師 / 看護師の切替）・検体検査システム（技師 A）・通信モニタの 3 領域と進行パネルを 1 画面に並べ、`/stage?mode=presentation` に接続する。各領域は個別ウィンドウと同じ部品（T053、T055、T064）を使う。1920×1080 で後方から読める文字の大きさ、1280×720 で横スクロール無し（FR-028）（T070 に依存）
- [X] T072 [US3] `ui/src/app/Launcher.tsx`：`/` に講演モード・自習モード・個別ウィンドウ（電子カルテ医師・看護師、検体検査システム技師 A・B、通信モニタ）への入口を置く（contracts/ui-screens.md「ルート」）

**Checkpoint**: 講演モードで S1 を通しで実演できる

---

## Phase 6: User Story 4 - 自習モードでガイドに従って自分で操作する (Priority: P3)

**Goal**: 来場者がガイドだけを頼りに一連の流れを自分で操作できる

**Independent Test**: `/stage?mode=self-study` で「開始」から最後まで、強調表示されたボタンだけを順に押して完了でき、案内と違う操作をすると案内に戻るよう促され、「最初から」で初期状態に戻る

### Tests for User Story 4

- [X] T073 [P] [US4] `ui/tests/e2e/self-study.spec.ts`：`/stage?mode=self-study` で「開始」→ 強調表示された要素（`data-guide`）を順にクリックして最後まで進めること、案内と違うボタンを押すと案内に戻るよう促されること、「最初から」で初期状態に戻ることを確認する

### Implementation for User Story 4

- [X] T074 [US4] `ui/src/systems/ehr/OrderForm.tsx`・`ui/src/systems/ehr/NurseView.tsx`・`ui/src/systems/ehr/ResultView.tsx`・`ui/src/systems/lis/LisScreen.tsx`・`ui/src/systems/lis/ResultEntry.tsx` の操作要素に、`ui/src/scenario/s1Main.ts` の `target.control` と一致する `data-guide` 属性を付ける
- [X] T075 [US4] `ui/src/guide/GuideOverlay.tsx` と `ui/src/guide/useGuide.ts`：`ScenarioRunner.detectStep` で現在のステップを判定し、次に操作する画面とボタン（`data-guide`）を強調表示して、そのステップの解説を表示する。auto のステップでは `target.screen` の画面を強調して「通知が届くのを待っています」と表示し、完了したら自動で次へ進む。案内と違う `data-guide` の要素が押されたら案内に戻るよう促し、最終ステップの後に「最初から」（`/demo/reset`）を出す（FR-029。T069、T074 に依存）
- [X] T076 [US4] `ui/src/app/StageView.tsx` に `mode=self-study` の表示を追加し、進行パネルの代わりに GuideOverlay を表示する（T071、T075 に依存）

**Checkpoint**: 講演モードと自習モードの両方が使える（D-01）

---

## Phase 7: User Story 5 - 例外的な流れ（取消・受付不可・再検・一部先行報告）を実演する (Priority: P3)

**Goal**: 取消・受付不可・再検・一部先行報告で、依頼と作業の状態がどう変わるかを示す

**Independent Test**: 各バリエーションを初期状態から実行し、依頼・作業の状態が docs/02 S1 バリエーション表と data-model.md §3 のとおりになる

### Tests for User Story 5

- [X] T077 [P] [US5] `server/src/test/java/jp/example/demo/integration/S1VariationsIT.java`：`s1-cancel`（ServiceRequest `revoked`・Task `cancelled` を 1 つの Transaction で更新）、`s1-reject`（Task `rejected`・`statusReason`、ServiceRequest は `active` のまま）、`s1-rerun`（`in-progress` → `on-hold`/`rerun` → `in-progress`/`measuring` → 全項目報告で `completed`）、`s1-partial`（血算のみ報告で DiagnosticReport `partial`・Task `in-progress`/`partial-reported`（output 追加）・ServiceRequest `active`、残りの報告で DiagnosticReport `final`・Task / ServiceRequest `completed`）を再現し、取消済みの Task を `in-progress` にする PATCH と、取消済みの依頼への採血の記録（最新の ETag を付けた採血の Transaction）がどちらも 422 になり、Specimen も更新されないことを確認する。`s1.repeat` の回数だけ繰り返す（T015 に依存）
- [X] T078 [P] [US5] `ui/tests/unit/variationBuilders.test.ts`：T079 のビルダー（取消 Transaction、受付不可 PATCH、再検の 2 つの PATCH、一部報告 Transaction）が data-model.md §4 のとおりの要求を作ること、一部報告は「依頼された全項目のうち 1 項目以上・全項目未満」のときだけ作れること（data-model.md §5）を確認する

### Implementation for User Story 5

- [X] T079 [US5] `ui/src/fhir/builders/labOrder.ts` に `buildCancelTransaction(sr, srEtag, task, taskEtag)`、`buildRejectPatch(reason, now)`、`buildRerunPatches(now)`、`buildPartialReportTransaction(...)`（POST Observation × n・POST DiagnosticReport `partial`・PUT Task（`ifMatch`、output 追加、businessStatus `partial-reported`））を追加する（T078 を通す）
- [X] T080 [P] [US5] `ui/src/systems/ehr/OrderList.tsx` に「取消」を追加する（DiagnosticReport が無い依頼のみ有効。data-model.md §5、FR-010）
- [X] T081 [P] [US5] `ui/src/systems/lis/RejectDialog.tsx` を作成し、`ui/src/systems/lis/LisScreen.tsx` に「受付不可」（理由の入力必須。例：「溶血のため再採血が必要」。FR-017）と「再検」（FR-018）を追加し、受付不可の理由を電子カルテの `OrderList.tsx` にも表示する
- [X] T082 [US5] `ui/src/systems/lis/ResultEntry.tsx` に、項目ごとの報告対象の選択と「一部報告」を追加し、既存の `partial` 報告がある場合の全項目報告（DiagnosticReport を `ifMatch` 付き PUT で `final`）に対応する（FR-016。T079 に依存）
- [X] T083 [US5] `ui/src/scenario/s1Cancel.ts`・`ui/src/scenario/s1Reject.ts`・`ui/src/scenario/s1Rerun.ts`・`ui/src/scenario/s1Partial.ts` を contracts/ui-screens.md のステップ構成で定義し（データが変わらないステップには `traffic` の条件を付ける）、`ui/src/app/ProgressPanel.tsx` のシナリオ選択に追加する（FR-030。T068、T079 に依存）

**Checkpoint**: 全ユーザーストーリーが独立に動作する

---

## Phase 8: Polish & Cross-Cutting Concerns

**Purpose**: 複数のストーリーにまたがる確認・文書化

- [X] T084 [P] ルートに `README.md` を作成する：デモの目的、`docker compose up` での起動、`scripts/fetch-jp-packages.sh` の位置付け（開発・テスト時のみ、パッケージはリポジトリに含めない）、quickstart.md・docs/ への案内
- [X] T085 [P] `docs/05-decisions.md` の技術検証項目を更新する：V-01・V-03〜V-05・V-08 を確認済みとし、確認方法（該当テスト・quickstart.md の節）を記録する。V-06・V-07 は T087・T008 の結果で更新する
- [X] T086 `scripts/fetch-jp-packages.sh` を実行してから `cd server && mvn verify` と `mvn verify -Dit.test='S1ScenarioIT,S1VariationsIT' -Ds1.repeat=20`、`cd ui && npm test && npx playwright test` を実行し、すべて成功することを確認する（SC-004、R-21）
- [X] T087 quickstart.md の §0〜§7 を順に実施し、特に §7（ネットワーク切断状態での起動と全ステップの実行、ブラウザの開発者ツールで外部への通信 0 件）を確認する（SC-005、V-06）
- [X] T088 SC-001（講演モードで解説込み 10 分以内、操作のみ 3 分以内）・SC-002（他の画面への反映 2 秒以内）・SC-003（初期化 10 秒以内）を quickstart.md §4 の手順で計測し、結果を `specs/001-lab-order-workflow/validation-results.md` に記録する
- [X] T089 `git status` で `.cache/`・ビルド成果物がリポジトリに含まれていないこと、`docker compose build` のビルドコンテキストに `.cache/` が含まれないことを確認する（D-23）

---

## Dependencies & Execution Order

### Phase Dependencies

- **Setup（Phase 1）**：依存なし。T001 → 他は並行可（T007 は T003・T005 の後）
- **Foundational（Phase 2）**：Setup の後。全ストーリーをブロックする
  - サーバー：テスト T008〜T014・T017 → 実装 T018〜T036（T018 → T024 → T025〜T028、T029 は T018・T020・T021 の後、T031 → T032・T033、T035 → T036）
  - UI：T037・T038 → T039 → T040 → T041 → T042・T043
- **User Stories（Phase 3〜7）**：Foundational の後
- **Polish（Phase 8）**：対象のストーリーの完了後

### User Story Dependencies

- **US1（P1）**：Foundational の後に開始。他のストーリーに依存しない
- **US2（P2）**：Foundational の後に開始できる（通信モニタは API 呼び出しだけで確認できる）。画面の通しでの確認は US1 の後
- **US3（P2）**：US1 に依存（ビルダー T047 と画面 T053・T055 を使う）。US2 の通信モニタ（T064）をステージビューに組み込む
- **US4（P3）**：US3 に依存（シナリオ定義 T068 と ScenarioRunner T069 を使う）
- **US5（P3）**：US1 に依存。シナリオとして選べるようにする T083 は US3 に依存

### Within Each User Story

- テストを先に書き、失敗することを確認してから実装する
- ビルダー → 画面部品 → 画面 → ルート接続の順
- ストーリーの Checkpoint で独立に確認してから次へ進む

### Parallel Opportunities

- Setup：T002・T004・T005・T006 を並行
- Foundational：サーバーのテスト T008〜T014・T017 を並行。実装は T019〜T023 を並行、T025・T026 を並行、T031・T034 を並行。UI の T037・T038 を並行
- US1：T044・T045・T046 を並行、T048〜T050 を並行、T054 は T048〜T050 と並行
- US2：T057・T058 を並行、T061〜T063 を並行
- US2 と US1 は別の担当者で並行可能
- US5：T077・T078 を並行、T080・T081 を並行

---

## Parallel Example: User Story 1

```bash
# US1 のテストをまとめて書く
Task: "S1ScenarioIT in server/src/test/java/jp/example/demo/integration/S1ScenarioIT.java"
Task: "SubscriptionIT in server/src/test/java/jp/example/demo/integration/SubscriptionIT.java"
Task: "labOrderBuilders.test.ts in ui/tests/unit/labOrderBuilders.test.ts"

# ビルダー（T047）の後、電子カルテの部品を並行で作る
Task: "OrderForm in ui/src/systems/ehr/OrderForm.tsx"
Task: "OrderList in ui/src/systems/ehr/OrderList.tsx"
Task: "ResultView in ui/src/systems/ehr/ResultView.tsx"
Task: "ResultEntry in ui/src/systems/lis/ResultEntry.tsx"
```

---

## Implementation Strategy

### MVP First (User Story 1 Only)

1. Phase 1（Setup）を完了する
2. Phase 2（Foundational）を完了する。サーバーの単体・契約テストが通ることを確認する
3. Phase 3（US1）を完了する
4. **止めて確認**：`/ehr`・`/lis` を並べて S1 の 8 ステップを手動で実演できること、S1ScenarioIT が 20 回連続で通ること
5. 社内の試行に出す

### Incremental Delivery

1. Setup + Foundational → 基盤の完成
2. US1 → 手動での実演（MVP）
3. US2 → 通信モニタで技術者向けの説明ができる
4. US3 → 講演モードで安定した実演
5. US4 → 展示ブースで自習
6. US5 → 例外的な流れで医療従事者の納得感を高める

### Parallel Team Strategy

1. 全員で Setup + Foundational（サーバー担当と UI 担当に分かれる）
2. その後：
   - 担当 A：US1 → US3 → US4
   - 担当 B：US2 → US5（US5 の T083 は US3 の完了後）

---

## Notes

- [P] = 別ファイルで、未完了タスクへの依存が無い
- [Story] ラベルで spec.md のユーザーストーリーに対応付ける
- 各タスクまたは論理的なまとまりごとにコミットする
- 設計と食い違う実装が必要になったら、先に docs/ と specs/ を更新する（constitution 原則 VIII）
- JP パッケージ（`.cache/fhir-packages/`）はリポジトリに含めない。`git add` の前に `git status` で確認する
