# Research: S1 検体検査ワークフロー

**Feature**: [spec.md](spec.md) | **Plan**: [plan.md](plan.md) | **Date**: 2026-10-01

Technical Context の未確定事項と、docs/05 の未決事項・技術検証項目のうち本機能に関わるものを調査し、決定した。
バージョンは 2026-10-01 時点の Maven Central / npm registry で確認した最新安定版。

---

## R-01 HAPI FHIR のバージョン（docs/05 O-03）

- **Decision**: HAPI FHIR **8.12.1**（`hapi-fhir-base`、`hapi-fhir-server`、`hapi-fhir-structures-r4`）。
- **Rationale**: skeleton の 7.0.2 から 1 年以上の修正が入った最新安定版。Java 17 以上・Jakarta Servlet 6.0 が前提で、
  本プロジェクトの構成（Java 21、Jetty 12 ee10）と合う。plain server の API（`@Read` / `@Update` / `@Patch` / `@Transaction`、
  Interceptor）は 7.x から大きな変更が無い。
- **Alternatives considered**: 7.0.2 のまま（古い依存ライブラリの脆弱性修正が入らない）。
- **Note**: `hapi-fhir-validation` と `hapi-fhir-testpage-overlay` は使わない（R-04、D-05 によりサーバー側検証は行わない）。

## R-02 JSON Patch の実装方法（docs/05 O-04）

- **Decision**: `io.dogote:json-patch` **1.15**（Jackson ベース）で RFC 6902 JSON Patch を適用する。
- **Rationale**: HAPI FHIR 本体（JPA サーバーの PATCH 実装）が採用しているライブラリで、HAPI が既に依存する Jackson と組み合わせられる。
  ライセンスは Apache 2.0 / LGPL 3.0 のデュアルライセンスで、Apache 2.0 を選択して利用できる。
  適用手順：現在の版を JSON にシリアライズ → パッチ適用 → パースし直す → `resourceType` と `id` が変わっていないことを確認。
- **Alternatives considered**: `com.flipkart.zjsonpatch:zjsonpatch` 0.4.16（Apache 2.0。2023 年以降リリースが無い）、
  replace / add のみ自作（テストの手間に見合わない）、FHIRPath Patch（医療従事者向けの説明には JSON Patch の方が読みやすい）。

## R-03 サーブレットコンテナと起動形式

- **Decision**: **組み込み Jetty 12.1（ee10、Servlet 6.0）** の実行可能 JAR。`main` メソッドで Jetty を起動し、
  HAPI `RestfulServer`・Jakarta WebSocket エンドポイント・デモ制御サーブレット・静的ファイル配信を 1 つの `ServletContextHandler` に登録する。
  JAR は maven-shade-plugin で作成する。
- **Rationale**: D-19（Docker Compose）と D-08（1 プロセス）を最小構成で満たす。war の overlay や外部コンテナが不要になる。
  Jetty 12.1 ee10 は Jakarta Servlet 6.0 に対応し、HAPI 8.12 の前提と一致する。
- **Alternatives considered**: war + `mvn jetty:run`（Maven 込みのイメージが必要で起動が遅い）、Spring Boot（依存が大きく、skeleton の構成から離れる）。
- **Verification (V-04, V-05)**: 同一コンテキストでのパス割り当て `/fhir/*`（HAPI）、`/ws/*`（WebSocket）、`/demo/*`（デモ制御）、
  `/`（静的 UI、SPA のため未知パスは `index.html` へフォールバック）。スパイクで起動を確認するタスクを tasks.md に置く。

## R-04 FHIR Tester（testpage overlay）の扱い（docs/05 O-09）

- **Decision**: **削除する**。
- **Rationale**: war overlay は実行可能 JAR と相性が悪く、Spring MVC への依存が増える。技術者向けの「生の通信」は通信モニタで見せられる。
- **Alternatives considered**: `/tester/*` へ移して残す（Spring の構成を組み込み Jetty へ移植する手間が大きい）。

## R-05 Java のバージョン

- **Decision**: ビルド・実行とも **Java 21 LTS**（Docker イメージは Eclipse Temurin 21）。ソースの言語レベルも 21。
- **Rationale**: HAPI 8.12 は 17 以上が前提。21 は広く使われている LTS で、record・パターンマッチ・仮想スレッドが使える。
- **Alternatives considered**: 17（skeleton と同じ。新しい言語機能が使えない）、25 LTS（周辺ツールの対応状況を確認する手間がある）。

## R-06 インメモリリポジトリと同時実行制御

- **Decision**:
  - リソースは `type/id` ごとに版のリスト（不変のスナップショット）として保持する。読み取りは最新版の参照を返すだけでロック不要。
  - **書き込みはすべて 1 つのグローバルなロックで直列化**する（単一リソースの更新・PATCH・Transaction のいずれも）。
    ロック内で「版の確認 → 新しい版の作成 → 通知の評価対象への登録」を行う。
  - Transaction はロック内で作業用のコピーに適用し、全エントリ成功時のみ本体に反映する（失敗時は破棄 = ロールバック）。
  - versionId は `1` から始まる整数。ETag は `W/"{versionId}"`。
- **Rationale**: デモの規模（リソース数百件、同時操作は数人）では性能上の問題が無く、同時到達でも必ず片方だけ成功する
  （原則 IV の「決定的な結果」、S2 の V-07 に対応）。リソース単位のロックと Transaction のロックを組み合わせるより単純。
- **Alternatives considered**: リソース単位のロック + Transaction 用の全体ロック（デッドロックの検討が必要）、組み込み DB（D-10 に反する）。

## R-07 If-Match の取り扱い（V-02 の結果を含む）

- **Decision**:
  - `@Update`：HAPI が If-Match の値を `IdType` の版に設定する（`UpdateMethodBinding.applyETagAsVersion`）。
  - `@Patch`：**HAPI は If-Match を `IdType` に設定しない**（HAPI 8.12.1 のソースで確認。If-Match を読むのは `UpdateMethodBinding` のみ）。
    メソッド引数に `RequestDetails` を受け取り、同じ静的メソッド `UpdateMethodBinding.applyETagAsVersion(RequestDetails, IIdType)` で版を取り出す。
  - 版の不一致は `PreconditionFailedException`（412）。ポリシーが「必須」でヘッダが無い場合は `InvalidRequestException`（400）。
  - Transaction 内は `Bundle.entry.request.ifMatch` を同じ規則で評価する（V-03：Bundle のモデルから直接取得できる）。
  - create（POST）と、存在しないリソースへの PUT（update as create）には If-Match を要求しない。
- **Rationale**: FHIR R4 の http.html（Managing Resource Contention）と D-12・D-14 に合わせる。
- **Alternatives considered**: Interceptor で一律に判定する（PATCH と Transaction 内の判定を別に書く必要があり、かえって分散する）。

## R-08 Transaction Bundle の処理

- **Decision**: FHIR R4 の処理順序（DELETE → POST → PUT / PATCH → GET）に従う。ただし本機能では `DELETE` と `PATCH` のエントリは受け付けず 400 を返す
  （contracts/fhir-api.md）ため、実際の順序は POST → PUT → GET となる。
  1. POST エントリに新しい ID を割り当て、`fullUrl`（`urn:uuid:...`）→ 新しい参照の対応表を作る。
  2. 全エントリのリソース内の参照を対応表で書き換える。
  3. 各エントリを作業用コピーに適用（If-Match・If-None-Exist・状態遷移チェックを含む）。
  4. 1 件でも失敗したら全体を破棄し、失敗したエントリの理由を含む OperationOutcome を、失敗の種類に応じたステータス（400 / 412 / 422）で返す。
  5. 成功時は `transaction-response` Bundle（各エントリの `response.status` / `location` / `etag` / `lastModified`）を返す。
- **Rationale**: S1 の依頼・採血・結果報告・取消をすべて「全部成功か全部失敗か」で扱うため（FR-006、FR-011、FR-015、FR-010）。
- **Alternatives considered**: batch（エントリごとの成否。アトミック性が無いため不採用）。

## R-09 検索と Subscription criteria の評価

- **Decision**: 検索パラメータは docs/03「検索パラメータ（最小限）」のうち S1 で使うものだけを、**リソース種別ごとの明示的な抽出関数**で実装する
  （例：`Task.owner` → 参照文字列、`Task.status` → コード）。カンマ区切りの OR に対応する。
  Subscription の `criteria`（例：`Task?owner=Organization/lab-dept,PractitionerRole/tech-a,PractitionerRole/tech-b`）は同じ抽出関数で評価する。
- **Rationale**: 対象が少数で、挙動を説明しやすい。FHIRPath エンジンを使うには検証用モジュールへの依存が増える。
- **Alternatives considered**: HAPI の `RuntimeSearchParam` のパス + FHIRPath による汎用評価（依存と複雑さが増える）。

## R-10 Subscription の通知方式と登録（D-11、FR-021、FR-022）

- **Decision**:
  - 画面は開いた時点で、画面ごとに固定 ID の Subscription（例：`Subscription/lis-lab-dept`）を `GET` し、無ければ `PUT` で作成する
    （update as create。作成なので If-Match は不要）。`channel.type = websocket`、`status = requested` で登録し、サーバーが `active` にする。
  - 画面は `/ws/subscription` に WebSocket で接続して `bind {Subscription id}` を送り、サーバーは `bound {id}` を返す。
    条件に合うリソースが作成・更新されたら `ping {id}` を送る（R4 websocket チャネルの方式）。画面は ping を受けて一覧を取り直す。
  - CapabilityStatement に websocket の URL を R4 の拡張（`http://hl7.org/fhir/StructureDefinition/capabilitystatement-websocket`）で示す。
  - 通知（ping）は通信記録にも残し、通信モニタに「FHIR サーバー → 画面」の矢印として表示する。
  - 初期化でリソースはすべて消えるため、画面は初期化の合図（R-12）を受けて Subscription を登録し直す。
- **Rationale**: 部門システムにバックエンドが無い（D-09）。「合図だけ通知、中身は取りに行く」を見せられる。
  登録の通信も見えることで FR-021（画面が通知の条件を登録する）を満たす。
- **Alternatives considered**: 初期データに Subscription を含める（登録の通信が見えなくなる）、rest-hook（画面が受け口を持てない）、
  通知に中身を含める（R4 websocket の方式から外れる）。

## R-11 通信の記録（原則 III、FR-023〜FR-025）

- **Decision**:
  - `/fhir/*` に**サーブレットフィルタ**を置き、要求（メソッド、URL、主要ヘッダ、本文）と応答（ステータス、主要ヘッダ、本文、所要時間）を記録する。
    HAPI の処理より外側で記録するため、HAPI が返したエラー応答も漏れなく記録できる。
  - 送信元の画面は、UI が全要求に付ける **`X-Demo-Client` ヘッダ**（例：`ehr-doctor`、`ehr-nurse`、`lis-tech-a`）で識別する。
  - 通知（ping）・初期化・ポリシー変更も同じ通信記録に「イベント」として追加する。
  - 記録は初期化まで全件をメモリに保持し、`/ws/monitor` で通信モニタへ逐次配信する。後から開いた通信モニタは `/demo/traffic` で既存分を取得する。
  - 版の履歴（FR-025）は FHIR の `GET /{type}/{id}/_history` で取得する（通信モニタからの取得も FHIR 経由で行い、記録対象にする）。
- **Rationale**: 記録漏れが起きない場所で、FHIR の処理と独立して記録できる（SC-006）。
- **Alternatives considered**: HAPI Interceptor のみ（要求本文の取得や例外時の応答本文の取得が煩雑）。

## R-12 デモ制御と、画面への合図

- **Decision**:
  - `/demo/reset`（POST）：全リソース・通信記録を消去し、初期データを再投入する。`/demo/policy`（GET / PUT）：If-Match 必須/任意、状態遷移チェック ON/OFF。
    S1 では既定値（必須・ON）のまま使い、切替の UI は S2 で追加する。
  - 初期化・ポリシー変更は `/ws/monitor` で全画面に合図（`demo.reset`、`demo.policy`）として配信する。
- **Rationale**: 初期化はデモ進行のためのメタ操作であり、システム間の業務連携ではない（原則 I の対象外。Constitution Check 参照）。
- **Alternatives considered**: 初期化を FHIR の `$reset` 操作にする（FHIR の操作に見えて誤解を招く）。

## R-13 シナリオの進行（講演モード・自習モード、FR-026〜FR-030）

- **Decision**:
  - シナリオ（ステップの定義・解説文・期待状態）は **UI 側の TypeScript データ**として定義し、ステップ実行はブラウザ内のシナリオ実行部が
    各画面と同じ FHIR 要求を、その画面の `X-Demo-Client` を付けて送る。
  - 「次へ」は次のステップを実行、「戻る」は `/demo/reset` → ステップ 1〜(n-1) を順に再実行する（FR-027）。
  - 手動操作でも、各操作の後に「期待状態に到達したステップ」を判定して現在のステップと解説を進める（US3 シナリオ 3）。
  - 判定は**データの条件と通信の条件の両方**で行う。通知による自動反映や結果の確認のようにデータが変わらないステップは、
    データの状態だけでは前後のステップと区別できないため、「前のステップの完了後に、特定の画面への ping や特定の画面の要求が通信記録に現れたか」で判定する
    （contracts/ui-screens.md「ステップの判定」）。通信記録は原則 III により必ず残るため、判定の材料として使える。
  - 自習モードは同じシナリオ定義を使い、自動実行の代わりに「次に操作する画面とボタン」を強調表示する。
- **Rationale**: ステップの自動実行も FHIR 経由の通信になり、通信モニタに表示される（原則 I・III）。サーバーにシナリオの知識を持たせない。
- **Alternatives considered**: サーバー側でシナリオを実行（サーバーが業務画面の代理になり、通信の主体が分かりにくくなる）、
  「戻る」で版を巻き戻す（FHIR の履歴の意味に反し、通信として見えない）、
  データが変わらないステップを解説だけのステップとして「次へ」でのみ進める（自習モードでは進める人がいないため不採用）、
  画面間で「表示した」ことを直接伝える（原則 I に反する）。

## R-14 検査依頼のモデル化

- **Decision**: **1 回のオーダー = ServiceRequest 1 件 + Task 1 件 + Specimen 1 件（血液）+ DiagnosticReport 1 件**。
  選んだ検査項目（血算・生化学）は `ServiceRequest.orderDetail` に列挙し、`ServiceRequest.code` は院内オーダーコード「検体検査」とする。
  一部先行報告は同じ DiagnosticReport を `partial` で作成し、残りの報告時に `final` へ更新する。
- **Rationale**: 1 つのオーダー番号に複数の検査項目が含まれる国内の一般的な運用と対応し、「一部報告では依頼も作業も完了しない」（US5）を
  1 組の依頼と作業で示せる。リソース数が少なく、医療従事者に説明しやすい。
- **Alternatives considered**: 検査項目ごとに ServiceRequest を作り `requisition` でまとめる（FHIR として一般的だが、Task とのつながりが複雑になり
  S1 の説明の焦点がぼやける。拡張時の選択肢として残す）。

## R-15 検査項目のコードと基準値

- **Decision**: 血算 5 項目・生化学 3 項目。単位は UCUM、基準値は日本臨床検査標準協議会（JCCLS）の共用基準範囲を参考にした値を使う（男性）。
  コードは JLAC10（system `http://medis.or.jp/CodeSystem/master-JLAC10-17digits`）を使い、
  **JP Terminology 2.2609.0 の JLAC10 マスタと CLINS コア検査項目（`JP_CLINS_ObsLabResult_CoreLabo_CS`）で確認済みの値**を使う（data-model.md §1）。
  - 血算は「末梢血液一般検査_全血(添加物入り)_自動機械法_分析物固有結果コード」の各項目（`2A99000000193095x`）。
  - 生化学（AST・ALT・クレアチニン）は血清・定量値のコード。
  - 当初の候補値のうち血算 5 項目はマスタに存在しなかったため差し替えた（2026-10-01 確認）。
- **Rationale**: D-05（ワークフローを説明できる程度）だが、教材として誤ったコードを見せない。CLINS のコア検査項目に含まれるコードを選ぶことで、
  国内の標準的な実装例と揃う。値の正しさは R-21 の自動テストで継続的に確認する。
- **Alternatives considered**: LOINC のみ（国内の医療従事者に馴染みが無い）、院内の独自コードのみ（JP Core の説明につながらない）、
  JLAC11（JP Terminology に含まれるが、JP Core 1.2.0 の例・CLINS の主な実装例は JLAC10 が中心）。

## R-16 フロントエンドの構成（D-18）

- **Decision**: React 19 + TypeScript + Vite 8、ルーティングは React Router。FHIR の型は `@types/fhir`（R4）。
  通信は `fetch` の薄いラッパー（`X-Demo-Client` の付与、ETag の保持と If-Match の付与、エラーの業務用語への変換）。
  シーケンス図・JSON 表示は自作の SVG / React コンポーネントとし、追加の UI ライブラリは使わない。
  スタイルは CSS 変数によるデザイントークン + CSS Modules。フォントは同梱する（CDN を使わない）。
- **Rationale**: 依存を最小にし、オフライン動作（原則 VII）とプロジェクタでの見やすさ（大きな文字）を自分たちで制御する。
- **Alternatives considered**: FHIR クライアントライブラリ（fhir.js、fhirclient）：SMART 認証向けの機能が中心で、If-Match の扱いを細かく制御したい用途には過剰。
  UI ライブラリ（MUI など）：見た目の制御とバンドルサイズの面で不要。

## R-17 テスト方針（開発ワークフロー）

- **Decision**:
  - サーバー：JUnit 5。結合テストは組み込み Jetty をランダムポートで起動し、HAPI Generic Client（`hapi-fhir-client`、テストスコープ）で
    S1 の 8 ステップと US5 の各バリエーションを再現する。SC-004 のため、シナリオテストは 20 回繰り返し実行できるようにする。
    単体テスト：状態遷移マトリクス、If-Match 判定、Transaction の参照書き換え・ロールバック、検索抽出、criteria 評価、通信記録。
  - UI：Vitest（シナリオ定義と期待状態の判定、表示ラベル、エラー変換）、Playwright（ステージビューで講演モードを最後まで進める E2E。Docker 起動後に実行）。
- **Rationale**: 講演前の動作確認をテストで自動化する（constitution 開発ワークフロー）。

## R-18 Docker の構成（D-19）

- **Decision**: ルートの `Dockerfile` でマルチステージビルド（`node:22` で UI ビルド → `maven` + Temurin 21 で JAR ビルド（UI の成果物を
  JAR の `static/` に取り込む）→ `eclipse-temurin:21-jre` で実行）。`compose.yaml` はサービス `demo` 1 つ、ポート 8080。
  開発時は Vite の開発サーバーから `/fhir`・`/ws`・`/demo` を `localhost:8080` へプロキシする（V-08）。
- **Rationale**: 講演者の PC には Docker だけあればよい。ビルドはオンライン環境で事前に行う（原則 VII）。

## R-19 ローカルのコード体系・識別子の URI

- **Decision**: 院内の独自コード・識別子の system URI は `https://demo.example.jp/fhir/` 配下に置く
  （例：`https://demo.example.jp/fhir/CodeSystem/lab-business-status`、`https://demo.example.jp/fhir/sid/order-number`）。
- **Rationale**: `example.jp` は例示用に予約されたドメインで、実在の組織と衝突しない（原則 II）。

## R-20 JP Core / JP Terminology パッケージの取得

- **Decision**: リポジトリには含めず、**取得用のシェルスクリプト `scripts/fetch-jp-packages.sh`** で次の 2 つを取得・展開する
  （インターフェースは [contracts/fetch-jp-packages.md](contracts/fetch-jp-packages.md)）。

  | パッケージ | package.json の name#version | 取得元 | SHA-256 |
  |---|---|---|---|
  | JP Core | `jp-core.r4#1.2.0` | `https://jpfhir.jp/fhir/core/1.2.0/jp-core.r4-1.2.0.tgz` | `39c4ade9c32ea815a6c5889f9ee89f80efe02d5bbc8236a6b02ec573a28a2c70` |
  | JP Terminology | `jpfhir-terminology#2.2609.0` | `https://jpfhir.jp/fhir/core/terminology/jpfhir-terminology.r4-2.2609.0.tgz` | `aff833151afbef9d6127868ba94e20f29e88ab4500af080e896b651e3999efd5` |

  - 取得先は既定で `.cache/fhir-packages/`（`{name}#{version}/package/` に展開。FHIR パッケージキャッシュと同じ配置）。
  - SHA-256 をスクリプトに固定し、一致しなければ展開しない。同じ版番号で内容が差し替えられた場合も検知できる。
  - 取得済みで検証に通れば何もしない（何度実行してもよい）。
  - `.cache/` はルートの `.gitignore` と `.dockerignore` に追加し、リポジトリにも Docker のビルドコンテキストにも含めない。
- **Rationale**: パッケージには MEDIS 等の各種マスタが含まれ、それぞれの利用条件に従うため再配布しない。サイズも大きい
  （JP Terminology は約 7.7 MB の圧縮ファイル）。版と SHA-256 を固定することで、誰が取得しても同じ内容になる。
- **Runtime への影響**: パッケージは**開発・テスト時の参照データ**であり、サーバーの実行時には使わない（D-05 によりサーバー側検証は行わない）。
  Docker イメージにも含めないため、オフライン実行（原則 VII）に影響しない。
- **Alternatives considered**: リポジトリに含める（再配布になる、サイズが大きい）、Maven / npm の依存として取得（FHIR パッケージの公式レジストリに
  同じ版が無い場合がある。取得元をユーザー指定の URL に固定できない）、HAPI の `NpmPackage` で実行時に取得（オフライン実行と両立しない）。

## R-21 コードとプロファイルの整合性テスト

- **Decision**: サーバーのテストに `JpPackageConsistencyTest` を置き、R-20 で取得したパッケージを読んで次を確認する。
  1. 初期データ（`server/src/main/resources/seed/`）の `meta.profile` と、画面が作成するリソースに付けるプロファイル
     （FHIR マスタ `ui/src/master/fhir-master.json` の `profiles`）が、JP Core 1.2.0 の StructureDefinition の `url` に存在する。
  2. 初期データと FHIR マスタ（検査項目・固定の coding）に含まれる coding のうち、system が JP Terminology / JP Core に含まれる CodeSystem（JLAC10、`JP_SimpleObservationCategory_CS`、
     `JP_DocumentCodes_CS`、LOINC など）のものは、その code が CodeSystem に存在する。
     パッケージに含まれない system（HL7 terminology の v2 表、SNOMED CT、UCUM、`demo:` の独自コード）は対象外。
  - パッケージが無い場合はテストを**スキップ**し、`scripts/fetch-jp-packages.sh` の実行を促すメッセージを出す
    （パッケージが無い環境でも `mvn verify` 自体は通る）。
  - パッケージの場所は環境変数 `JP_FHIR_PACKAGE_DIR`、無ければ `../.cache/fhir-packages`。
- **Rationale**: R-15 のコード確認を一度きりにせず、初期データや検査項目を変えたときにも自動で検出する。パッケージの読み込みは JSON の解析だけで済み、
  HAPI の検証モジュールは不要。
- **Alternatives considered**: HAPI の `FhirInstanceValidator` によるプロファイル検証（`hapi-fhir-validation` への依存が増え、D-05 の範囲を超える）、
  手作業での確認のみ（変更時に漏れる）。

## 未解決事項

なし（Technical Context の NEEDS CLARIFICATION はすべて解消）。
