# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## プロジェクトの要点

医療機関の FHIR サーバーと部門システム（電子カルテ・検体検査）の連携を、医療従事者にも分かりやすく見せるデモ。
ドキュメント・UI 文言・コミットメッセージ以外のコード上の識別子は英語、ドキュメントと UI 文言は日本語。
現在の実装範囲は S1（検体検査）・S2（同時受付の排他制御）・S3（CT の予約枠の取り合い）。S4・S5（処方調剤、Message Bundle）は `docs/` に設計のみ。

`.specify/memory/constitution.md`（v1.1.0）が最優先。特に次を守る：
- 画面同士は FHIR サーバー経由でのみ通信する（直接通信・独自バックエンド禁止）。デモの初期化・ポリシー変更（`/demo/*`）だけが例外。
- 実行時に外部ネットワーク・CDN に依存しない（オフライン、`docker compose up` の 1 コマンド）。データはすべて架空。
- 設計の変更は先に `docs/`（決定は `docs/05-decisions.md`）と `specs/` を更新してから実装する（原則 VIII）。

## コマンド

```bash
# サーバー（Java 21、Maven）— server/ で実行
mvn test                                         # 単体テスト（surefire。*IT は除外）
mvn verify                                       # 単体 + 統合テスト（failsafe の *IT）
mvn verify -Dit.test=S1ScenarioIT                # 統合テストを 1 クラスだけ
mvn test -Dtest=IfMatchRuleTest                  # 単体テストを 1 クラスだけ
mvn verify -Ds1.repeat=20                        # S1 系シナリオを 20 回繰り返す（SC-004）
mvn verify -Dit.test=S2ScenarioIT -Ds2.repeat=100  # S2（同時確定は既定 100 回、S2-1・S2-3 は 20 回）
mvn verify -Dit.test=S3ScenarioIT -Ds3.repeat=100  # S3（同時の仮押さえは既定 100 回、S3-1〜S3-3 は 20 回。期限切れは期限 1 秒で確かめる）
mvn -DskipTests package                          # server/target/demo-server.jar（shade の実行可能 JAR）

# UI — ui/ で実行
npm ci && npm test                               # Vitest（tests/unit）
npx vitest run tests/unit/sequence.test.ts       # 1 ファイルだけ
npm run typecheck                                # tsc --noEmit（lint は無い）
npm run dev                                      # Vite（/fhir /ws /demo を localhost:8080 へプロキシ。DEMO_BACKEND で変更）
npm run build

# E2E（Playwright。起動済みの http://localhost:8080 に対して実行。DEMO_URL で変更）
npx playwright install chromium && npx playwright test
npx playwright test tests/e2e/presentation.spec.ts -g "次へ"
S2_REPEAT=100 npx playwright test tests/e2e/s2-concurrent.spec.ts   # S2（画面からの同時確定の繰り返し回数。既定 5）
S3_REPEAT=100 npx playwright test tests/e2e/s3-slot-booking.spec.ts -g "同時に仮押さえ"   # S3（画面からの同時の仮押さえ。既定 5）

# 起動
docker compose build && docker compose up        # http://localhost:8080/

# JP Core / JP Terminology（リポジトリに含めない。.cache/fhir-packages/ に取得）
scripts/fetch-jp-packages.sh [--check|--force]
```

- 統合テストは組み込み Jetty をランダムポートで起動する（`DemoServerExtension`）。E2E は別途サーバーが必要。
  ローカルで E2E を回すには、UI をビルドして `server/src/main/resources/static/` にコピー（gitignore 済み）→ `mvn -DskipTests package` → `java -jar server/target/demo-server.jar`。
  Docker のイメージも同じ手順（`Dockerfile` のマルチステージ）。UI を変えたら JAR を作り直さないと E2E に反映されない。
- `JpPackageConsistencyTest` は `.cache/fhir-packages/` が無いとスキップされる。環境変数 `JP_FHIR_PACKAGE_DIR` で場所を変えられる。
- Linux で Playwright の Chromium が `libasound.so.2` 不足で起動しない場合は `npx playwright install-deps`（要 root）か、`LD_LIBRARY_PATH` に展開したライブラリを追加する。

## アーキテクチャ

1 コンテナ・1 プロセス（組み込み Jetty）が、`/fhir/*`（HAPI FHIR 8.12.1 の plain server、R4）、`/ws/*`、`/demo/*`、静的 UI を配信する。
永続化はインメモリで、再起動・初期化で初期データ（`server/src/main/resources/seed/`、架空）に戻る。`fhirstarters` の skeleton を元にしており、HAPI JPA Server は使わない。

### サーバー（`server/src/main/java/jp/example/demo/`）
- `store/InMemoryRepository`：リソースの版を不変スナップショットで保持。**書き込みは 1 つのロックで直列化**し、コミットと初期化（`replaceAll`）は参照の差し替え 1 回。同じ版への同時更新は必ず片方だけ成功する。
- `fhir/ResourceWriter`：create / update / patch の規則（If-Match → 400/412、Task 状態遷移 → 422、Subscription の検証）を一箇所に集約。**単一操作の Provider と Transaction の各エントリが同じ規則を通る**。規則は `fhir/rules/`、ポリシー（既定は安全側）は `demo/DemoPolicy`。
- `fhir/provider/*`：リソース種別ごとの HAPI Provider（`AbstractRepositoryProvider` 継承）。HAPI は `@Patch` の If-Match を ID に設定しないので、`TaskProvider` は `RequestDetails` から自分で読む。PATCH 応答の ETag/Location も自分で付ける。
- `fhir/system/TransactionProcessor`：POST → PUT → GET の順に作業用セッションへ適用し、全成功でコミット、失敗は全体を破棄（`urn:uuid` の書き換え、`ifMatch`、`ifNoneExist`）。DELETE/PATCH エントリは 400。
- `traffic/TrafficCaptureFilter`：`/fhir/*` の全要求・応答を記録（gzip は展開）。**seq は要求の受信時に採番**するため、処理中に出た通知（ping）の記録のほうが先に配信されることがある（常に seq 順に並べて扱う）。
- `subscription/SubscriptionEngine`：R4 websocket 方式（`bind {id}` / `ping {id}`）。コミットごとに、**更新後のリソース**を criteria で評価（状態が変わると外れる条件は使わない）。
- `demo/DemoControl`：`/demo/reset`（全データ・通信記録・bind・ポリシーを初期化）、`/demo/policy`、`/demo/traffic`。

### UI（`ui/src/`）
- `fhir/client.ts`：全要求に `X-Demo-Client`（通信モニタが送信元を表示するための独自ヘッダ）を付け、ETag を保持して If-Match を付ける。412 等は自動リトライせず、業務用語のエラー（`fhir/errors.ts`、`fhir/labels.ts`）にする。
- `fhir/builders/labOrder.ts` と `fhir/labActions.ts`：検体検査の各操作が送る FHIR リソース・要求の組み立てと送信。画面操作とシナリオの自動実行が共有する。検査項目・コードは `master/fhir-master.json`（JLAC10 などは JP Terminology で確認済み。サーバーのテストも同じファイルを読む）。
- `realtime/`：`useLiveData`（Subscription を登録 → bind → ping で取り直す共通フック）、`trafficStore`（通信記録を seq 順に保持）。同じ ID の Subscription を複数画面が同時に作る競合を `ensureSubscription` が吸収する。
- `scenario/`：シナリオ定義（`s1Main.ts`、`variations.ts`）と `ScenarioRunner`。**ステップの完了は「データの状態」と「通信記録の条件（前のステップの基準 seq より後で最初に一致した通信）」の両方で判定**する。データが変わらないステップ（通知による自動反映など）を区別するため。講演モードの「戻る」は初期化して再実行する。
- `guide/`：自習モード。シナリオの `target.control` と画面の `data-guide` 属性が対応している（`tests/unit/scenarios.test.ts` が食い違いを検出する）。
- `app/StageView`：電子カルテ・検体検査・通信モニタを 1 画面に並べる。医師/看護師の両画面を常に配置し表示だけ切り替える（通知の bind を外さないため）。

### S2（同時受付）の要点
- **ステージビューを使わない**（D-29）。`/control`（デモ制御パネル）・`/lis?tech=tech-a`・`/lis?tech=tech-b`・`/monitor` を別ウィンドウで開き、`docs/06-demo-procedures.md` に従って手で操作する。画面上の案内（講演モードの進行・自習ガイド）は無い。憲章 v1.1.0 の原則 V がこれを認めている。
- 「S2-x の準備」ボタン（`ui/src/demo/prepare.ts`）が、初期化 → `PUT /demo/policy` → 依頼・採血（電子カルテとして FHIR に送る）を行う。サーバー側に準備用の API は無い。
- `labSendsIfMatch`（`DemoPolicy`）は**サーバーの判定には使わない**。検体検査システムの画面だけが読む、「If-Match を付けるか」のデモ設定で、別ウィンドウ間で共有できる唯一の経路が `/demo/policy` のため置いている。
- 受付は S1 も含め **GET → PATCH の 2 段階**（D-27）。`AcceptDraft`（`systems/lis/AcceptDraftPanel.tsx`）が受付を始めた時点の ETag を確定まで保持する（一覧の行の ETag は通知のたびに最新になるため使えない）。
- 一覧の変化は `systems/shared/rowChanges.ts` が検出し、変更前 → 変更後を 10 秒表示する（D-28）。

### S3（CT の予約枠の取り合い）の要点
- **ステージビューを使わない**（D-33）。`/control`・`/ehr/ct?doctor=dr-x`・`/ehr/ct?doctor=dr-y`・`/ris`・`/monitor` を別ウィンドウで開き、`docs/06-demo-procedures.md` の S3 の節に従って手で操作する。画面上の案内は無い。
- 「S3-x の準備」ボタン（`ui/src/demo/prepare.ts`）は **初期化 → `PUT /demo/policy`（`ehrUsesSlotHold`）の 2 段階だけ**（S2 と違い依頼・採血を送らない）。`demo.reset` の通知には初期化後のポリシーが載る（画面が取り直すと、「初期化 → 設定」の途中で古い値が後から届いて上書きしてしまう）。
- `ehrUsesSlotHold`（`DemoPolicy`）は**サーバーの判定には使わない**。電子カルテの CT 予約画面だけが読む、「仮押さえを使うか／直接予約するか」のデモ設定（S3-1 の二重予約を、サーバーの規則を変えずに再現するため）。`slotHoldSeconds`（既定 30、API は 1〜300、画面は 10〜300、環境変数 `SLOT_HOLD_SECONDS`）はサーバーの期限切れが使う。
- **予約枠は初期化のたびに生成**する（`slot/SlotSeedGenerator`）：日本時間の翌日 9:00〜12:00 の 30 分 × 6。id は日付を含まない `ct1-0900`〜`ct1-1130`（テスト・手順書が日付に依存しない）。9:00・11:00 は予約済み。Slot・Appointment は書き込み可、Schedule・Device は読み取り専用。Slot の状態遷移はサーバーで検査しない。
- **仮押さえの期限切れ**（`slot/SlotHoldExpiry`）：コミットされた `busy-tentative` の Slot を「版・更新日時・期限（更新日時 + 受け付けた時点の秒数）」で保持し、250 ms ごとに確認する。書き込みロックの中で版が変わっていないことを確かめて `free` に戻すので、確定・取りやめと同時に起きても片方だけが反映される。通信記録に **`kind = "server"`**（送信元 `server-slot-expiry`、`serverAction`）として残り、通信モニタは FHIR サーバーの列の帯で表示する（憲章の原則 III の例外）。初期化で保持を消す。
- 確定は Transaction（`PUT Slot`（`busy`、`ifMatch` = 仮押さえの版）+ Appointment + ServiceRequest + Task）。**If-None-Exist は使わない**（D-40：一致すれば既存を返す＝成功なので、取り合いの拒否にならない）。直接予約は Slot の PUT を含まない同じ Transaction。
- 電子カルテの CT 予約は「枠を選ぶ（その時点の版を `BookingDraft` に保持）→ 仮押さえ → 確定」。一覧の行の版は通知のたびに最新になるため使えない（S2 の `AcceptDraft` と同じ）。押さえた人は `Slot.comment`（「仮押さえ：医師 X」）に**表示用**として書き、判定には使わない（D-35）。
- 医師 X の CT の依頼が S1 の検体検査の一覧・準備に混ざらないよう、`ServiceRequest` の検索は `category`（検体検査 `108252007`／画像検査 `363679005`）で絞る。通信モニタは Transaction の中身の表（`monitor/transactionSummary.ts`）と、記録にある画面の種類で決まる列（`lanesFor`）を持つ。

## ドキュメントと仕様

- `docs/`：設計（概要、シナリオ S1〜S5、アーキテクチャ、設計ルール＝状態遷移・表示ラベル・コード体系、決定事項と未決事項）。
- `specs/001-lab-order-workflow/`・`specs/002-concurrent-acceptance/`（S2）・`specs/003-ct-slot-booking/`（S3）：Spec Kit 成果物（spec / plan / research / data-model / contracts / quickstart / tasks / validation-results）。API・WebSocket・画面の契約は `contracts/`。
- 新しい機能は `/speckit-specify` → `/speckit-plan` → `/speckit-tasks` → `/speckit-implement` の流れ（`.specify/`、`.claude/skills/`）。
