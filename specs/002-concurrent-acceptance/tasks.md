---

description: "S2 排他制御①：同時受付の実装タスク"
---

# Tasks: S2 排他制御①：同時受付

**Input**: Design documents from `specs/002-concurrent-acceptance/`

**Prerequisites**: [plan.md](plan.md)、[spec.md](spec.md)、[research.md](research.md)、[data-model.md](data-model.md)、[contracts/](contracts/)、[quickstart.md](quickstart.md)

**Tests**: 含める。constitution の開発ワークフロー（「排他制御のシナリオは同時更新の結果（片方が 412）まで検証する」）と、
SC-002（同時確定 100 回）・SC-003（20 回連続）が自動テストを要求しているため。テストは対応する実装より先に書き、失敗することを確認してから実装する。

**Prerequisite（analyze D1）**: 完了。憲章の原則 V を v1.1.0 で明確化し（事故を再現するシナリオは手順書に従う手操作でもよい）、`docs/05-decisions.md` に D-31 として記録した。

**Organization**: ユーザーストーリーごとにフェーズを分ける。US1〜US3 はどれも Phase 2（ポリシーの追加・準備ボタン・2 段階の受付）の上に載り、互いに独立して確認できる。

## Format: `[ID] [P?] [Story] Description`

- **[P]**: 並行して実施できる（別ファイル、未完了タスクへの依存なし）
- **[Story]**: 対応するユーザーストーリー（US1〜US4）
- パスはリポジトリのルートからの相対パス

## Path Conventions

- サーバー（Java）：`server/src/main/java/jp/example/demo/`、テスト：`server/src/test/java/jp/example/demo/`
- UI（React + TypeScript）：`ui/src/`、テスト：`ui/tests/unit/`（Vitest）、`ui/tests/e2e/`（Playwright）
- コード上の識別子は英語、UI 文言・ドキュメントは日本語（constitution 開発ワークフロー）
- E2E は起動済みのサーバーに対して実行する。UI を変えたら UI をビルドして `server/src/main/resources/static/` にコピーし、`mvn -DskipTests package` で JAR を作り直す（CLAUDE.md）

---

## Phase 1: Setup

**Purpose**: 変更前の状態が緑であることを確かめる（S1 の回帰の基準）

- [X] T001 変更前の基準を記録する：`server/` で `mvn verify`、`ui/` で `npm ci && npm test && npm run typecheck` を実行し、すべて成功することを確認する。失敗があれば本機能の作業前に原因を報告する（`server/`、`ui/`）

- [X] T002 `docs/06-demo-procedures.md` の骨子を先に作る（原則 VIII。docs/02・D-29 がすでにこのファイルにリンクしている）：冒頭の目的、S2 の節の章立て（準備／S2-1・S2-2・S2-3／締めの解説／うまくいかないとき／所要時間）、S2-1〜S2-3 の操作の表の見出しと「操作する画面」「操作」の列だけを書き、期待結果と話すことの列は「（実装後に記入）」とする。`docs/README.md` の一覧への追加もここで行う

---

## Phase 2: Foundational (Blocking Prerequisites)

**Purpose**: すべてのストーリーが使う 3 つの土台 —— ポリシーの `labSendsIfMatch`、デモ制御パネルの準備ボタン、受付の 2 段階化（S1 の回帰を含む）

**⚠️ CRITICAL**: このフェーズが終わるまで US1〜US4 に着手しない

### サーバー：ポリシーの `labSendsIfMatch`（data-model.md §1、contracts/demo-control-api.md）

- [X] T003 [P] `server/src/test/java/jp/example/demo/integration/TrafficMonitorIT.java` にテストを追加する：`GET /demo/policy` が `{"ifMatchRequired":true,"taskTransitionCheck":true,"labSendsIfMatch":true}` を返す。`PUT /demo/policy {"labSendsIfMatch":false}` は「本文に含めた項目だけを変更する（部分更新）」こと（ほかの 2 項目は変わらない）と、応答が 3 項目すべてを返すこと。`/ws/monitor` の `demo.policy` の `policy` と、通信記録の `demoEvent.detail` に 3 項目が入ること。値が boolean でない `labSendsIfMatch`（例：`"no"`）は無視されること。`POST /demo/reset` の後は 3 項目とも `true` に戻ること
- [X] T004 `server/src/main/java/jp/example/demo/demo/DemoPolicy.java` に `DEFAULT_LAB_SENDS_IF_MATCH = true`、`volatile boolean labSendsIfMatch`、`labSendsIfMatch()`・`setLabSendsIfMatch(boolean)` を追加し、`resetToDefaults()` で既定値に戻す。Javadoc に「サーバーの判定には使わない。検体検査システムの画面だけが読むデモ専用の設定（specs/002 research R-01）」と書く
- [X] T005 `labSendsIfMatch` を API と配信に通す：`server/src/main/java/jp/example/demo/demo/DemoControl.java` の `updatePolicy` に第 3 引数 `Boolean labSendsIfMatch` を加え（null は変更しない）、`demoEvent("policy", …)` の detail を 3 項目にする。`server/src/main/java/jp/example/demo/demo/DemoControlServlet.java` の `doPut` で `optionalBoolean(body, "labSendsIfMatch")` を読み、`policyJson()` に `labSendsIfMatch` を加える。`server/src/main/java/jp/example/demo/traffic/MonitorBroadcaster.java` の `demo.policy` の本文に `labSendsIfMatch` を加える。`IfMatchRule` は変えない（T003 が通ることを確認）
- [X] T006 [P] 結合テストの補助を追加する：`server/src/test/java/jp/example/demo/integration/LabFlow.java` に `acceptWith(Ids ids, String tech, String ifMatchOrNull)`（受付の PATCH を、渡した If-Match の値で送る。`null` なら If-Match を付けない。本文は既存の `accept` と同じ。既存の `headers(client, ifMatch)` を使う）と `etagNow(Ids ids)`（現在の作業の ETag）を追加する。`server/src/test/java/jp/example/demo/integration/DemoServerExtension.java` に `setPolicy(Boolean ifMatchRequired, Boolean labSendsIfMatch)`（`PUT /demo/policy`、null の項目は本文に含めない）を追加する

### UI：ポリシーの購読（contracts/websocket.md）

- [X] T007 [P] `ui/src/realtime/types.ts` の `DemoPolicy` に `labSendsIfMatch: boolean` を追加する。`ui/src/realtime/demoApi.ts` に `putPolicy(partial: Partial<DemoPolicy>): Promise<DemoPolicy>`（`PUT /demo/policy`、`Content-Type: application/json`。`!res.ok` なら「設定を変更できません（{status}）」の Error）を追加する
- [X] T008 [P] `ui/tests/unit/policyState.test.ts` を作る：純粋関数 `reducePolicy(state, message)` について、`demo.policy` で新しい値になる、`demo.reset` で既定値（3 項目とも `true`）になる、`socket.open` の `reconnect: true` で「取り直しが必要」（`stale: true`）になる、`traffic` では変わらない、を確かめる
- [X] T009 `ui/src/demo/policyState.ts`（`DEFAULT_POLICY`、`reducePolicy`）と `ui/src/demo/usePolicy.ts`（開いたときに `getPolicy()`、`monitorSocket.subscribe` で `reducePolicy` を適用し、`stale` になったら `getPolicy()` で取り直すフック。戻り値は `{ policy: DemoPolicy | null; error: string | null }`）を作り、T008 を通す

### UI：受付の 2 段階化（D-27、research.md R-03・R-09、contracts/ui-screens.md）

- [X] T010 [P] `ui/tests/unit/acceptDraft.test.ts` を作る（`fetch` を差し替えた `FhirClient` を使う。`ui/tests/unit/client.test.ts` の書き方に合わせる）：`beginAccept(client, "1")` が `GET /fhir/Task/1`（`X-Demo-Client` 付き）を送り `Versioned<Task>` を返す。`confirmAccept(client, draft, "tech-b", true)` が **draft の ETag**（例：`W/"2"`）を If-Match に付けた `PATCH /fhir/Task/1` を送る（その間にサーバー側の版が進んでいても draft の値を使う）。`confirmAccept(…, false)` は If-Match を付けない。`acceptTask(client, order, "tech-a")` が GET → PATCH の順に 2 回送り、PATCH の If-Match が GET の応答の ETag である
- [X] T011 `ui/src/fhir/labActions.ts` に `beginAccept(client, taskId): Promise<Versioned<Task>>` と `confirmAccept(client, draft: Versioned<Task>, techRoleId, sendIfMatch: boolean, now = new Date())`（`buildAcceptPatch(techRoleId, now)` を送る。`sendIfMatch` が false なら etag に `null` を渡す）を追加し、`acceptTask` を「`beginAccept` → `confirmAccept(…, true)`」に変える。T010 を通す
- [X] T012 `ui/src/systems/lis/AcceptDraftPanel.tsx` を作り、`ui/src/systems/lis/LisScreen.tsx` を 2 段階の受付に変える（contracts/ui-screens.md「受付の 2 段階化」の表のとおり）。受付済み以降の行には補足「この依頼は受付済みです（担当：{担当者名}）」を表示し、受付ボタンは出さない（spec Edge Cases）：
  - 「受付」（`data-guide="accept-{srId}"`）で `beginAccept` を呼び、応答を受付中の作業（data-model.md §4 の `AcceptDraft`：`taskId`・`serviceRequestId`・`task`・`openedAt`）として保持する。「1 つのウィンドウで同時に保持できる `AcceptDraft` は 1 つ。保持中は、ほかの行の『受付』ボタンを押せない」
  - 確認欄（`data-testid="accept-draft-{srId}"`）は**行の現在の状態に関係なく** `AcceptDraft` があれば表示し、患者・検査・受付を始めた時刻・読み込んだ状態・担当者・「版 {versionId}（W/"{versionId}"）をもとに受付します」を表示する。「保持中は、通知で一覧が取り直されても `task` を変えない」
  - 「受付を確定」（`data-guide`・`data-testid` ともに `accept-confirm-{srId}`）で `confirmAccept(live.client, draft.task, current, policy.labSendsIfMatch)`。「取りやめ」（`accept-cancel-{srId}`）は通信なしで破棄する。確定の後は成功・失敗にかかわらず `AcceptDraft` を破棄し、一覧を取り直す。失敗は既存の `live.setError(e, "受付")` で表示する（412・400 の専用文言は US2・US3 で加える）
  - `demo.reset` を受けたら `AcceptDraft` を破棄する（`monitorSocket.subscribe`）
  - 見出しに `data-testid="lab-if-match-mode"` で「版の確認：付ける」／「版の確認：付けない（デモ設定）」を表示する（`usePolicy()`。`embedded` のときも表示する）。`policy` が未取得の間は確定ボタンを押せない
- [X] T013 S1 のシナリオ定義を 2 段階の受付に合わせる：`ui/src/scenario/s1Main.ts` のステップ 4 と `ui/src/scenario/variations.ts` の `acceptStep` の `target.control` を `accept-{id},accept-confirm-{id}`（現在の `accept-1` なら `accept-1,accept-confirm-1`）にする（`run` は T011 の `acceptTask` のままで GET → PATCH になる。`traffic` は `http lis-tech-a PATCH Task` のまま）。`ui/tests/unit/scenarios.test.ts`・`ui/tests/unit/guide.test.ts` の期待値を更新し、`npm test` を通す
- [X] T014 S1 の E2E を 2 段階の受付に合わせる：`ui/tests/e2e/pages.ts` に `acceptOn(row: Locator)`（行の「受付」→ 確認欄の「受付を確定」を押す）を追加し、`ui/tests/e2e/s1-manual.spec.ts`・`ui/tests/e2e/monitor.spec.ts` の「受付」ボタンのクリックをこれに置き換える。`ui/tests/e2e/self-study.spec.ts` は、ステップ 4 で強調される 2 つのボタン（「受付」「受付を確定」）を順に押すように直す。`presentation.spec.ts`・`variations.spec.ts` は自動実行なので期待値だけ確認する（`monitor.spec.ts` の版の履歴の件数「依頼・採血・受付で 3」は変わらない）
- [X] T015 [P] `specs/001-lab-order-workflow/contracts/ui-screens.md` を更新する：`s1-main` の表のステップ 4 に「受付は GET → PATCH の 2 段階（specs/002、D-27）」を注記し、「画面の更新の流れ」の 3 に「受付だけは、受付を始めた時点で取得した ETag を使う（D-27）」を加える。あわせて `specs/001-lab-order-workflow/spec.md` の FR-013 に「受付は 2 段階（specs/002、D-27）」の注記を足す

### UI：デモ制御パネルと準備ボタン（D-30、research.md R-02・R-08、contracts/demo-control-api.md）

- [X] T016 [P] `ui/tests/unit/prepare.test.ts` を作る：`prepareScenario("s2-1", deps)`（`deps` で `resetDemo`・`putPolicy`・電子カルテの `FhirClient` を差し替える）が、`resetDemo` → `putPolicy({ ifMatchRequired: false, labSendsIfMatch: false })` → `ehr-doctor` の Transaction（依頼）→ `ehr-nurse` の検索と Transaction（採血）の順に呼ぶこと。`s2-2` は `{ ifMatchRequired: true, labSendsIfMatch: true }`、`s2-3` は `{ ifMatchRequired: true, labSendsIfMatch: false }`（data-model.md §2）。段階の通知が `reset → policy → order → collect → done` の順であること。依頼で失敗したら採血を送らず、`{ stage: "order", error }` で止まること
- [X] T017 `ui/src/demo/prepare.ts` を作る：`S2_PRESETS`（data-model.md §2 の表の値）、`type PrepareStage = "reset" | "policy" | "order" | "collect" | "done"`、`prepareScenario(id, deps, onStage)`。依頼は `placeOrder(ehrDoctor, "demo-taro", ["CBC"], now)`、採血は `fetchLatestOrder(ehrNurse)` → `recordCollection(ehrNurse, order, now)`（`ui/src/fhir/labActions.ts` の既存の関数）。失敗は `FhirError.display`（それ以外は `toDisplayError({ network: true }, …)`）で返す。T016 を通す
- [X] T018 `ui/src/app/ControlPanel.tsx` を作り、`ui/src/app/routes.tsx` に `/control` を追加する（contracts/ui-screens.md「デモ制御パネル」）：見出し「デモ制御パネル」、初期化ボタン（既存の `ResetButton`、`data-testid="btn-reset"`）、準備ボタン 3 つ（`btn-prepare-s2-1`「S2-1 の準備（ルール無し）」・`btn-prepare-s2-2`「S2-2 の準備（版の確認あり）」・`btn-prepare-s2-3`「S2-3 の準備（必須化）」）、準備の状況（`prepare-status`。段階の文言は contracts のとおり。完了「S2-x の準備ができました」、失敗は段階 + `DisplayError.text`）、現在の設定の表示（`usePolicy()`。「サーバーの版の確認：必須／任意」「検体検査システムの版の確認：付ける／付けない」。切り替えの操作は US3 の T037 で加える）。「準備の実行中は、準備ボタンと設定の切り替えを押せない」。画面上の案内は出さない

**Checkpoint**: `mvn verify` と `npm test`・`npm run typecheck` が通る。JAR を作り直して S1 の E2E（`npx playwright test`）が通る。`/control` の準備ボタンで、技師 A・B のウィンドウに「依頼済み・採取済」の依頼が現れ、「受付」→「受付を確定」で受付できる

---

## Phase 3: User Story 1 - ルールが無いと後から操作した人の内容で上書きされる事故を再現する（S2-1） (Priority: P1) 🎯 MVP

**Goal**: S2-1 の準備の後、技師 A・技師 B が同じ版から受付を確定すると両方成功し、担当者が技師 B に上書きされる。技師 A の一覧で変化がアニメーションで示され、通信モニタで If-Match なしの 2 つの PATCH と、版の履歴の上書きが分かる

**Independent Test**: quickstart.md §2.1 の 1〜5 が期待どおりになる（`S2ScenarioIT` の S2-1 と、E2E の S2-1）

### Tests for User Story 1

- [X] T019 [P] [US1] `server/src/test/java/jp/example/demo/integration/S2ScenarioIT.java` を作り、S2-1 のテストを書く：`demo.reset()` → `setPolicy(false, false)` → `LabFlow.order("demo-taro", "CBC")` → `collect` → 作業の ETag を 1 回読んで技師 A・B の両方の「受付を始めた版」とする → `acceptWith(ids, "tech-a", null)` が 200 → `acceptWith(ids, "tech-b", null)` が 200 → 作業は `accepted`・`received`・`owner = PractitionerRole/tech-b`、版は準備後の版 + 2 → `GET /Task/{id}/_history` で、準備後の版 + 1 の担当が `tech-a`、+ 2 が `tech-b` → `taskTransitionCheck` が `true` のままであること。回数は `Integer.getInteger("s2.repeat", 20)`（S2-1・S2-3 の既定 20）で繰り返す（`S1ScenarioIT` の `s1.repeat` の書き方に合わせる）
- [X] T020 [P] [US1] `ui/tests/unit/rowChanges.test.ts` を作る：`diffRows(prev, next)` について、担当者だけが変わると `[{ field: "owner", before: "技師 A", after: "技師 B" }]`、状態と業務上の状態と担当者が変わると 3 項目（表示ラベルは docs/04、`ui/src/fhir/labels.ts` を使う）、`prev` が null（初回・初期化の直後）なら空、新しく現れた行・消えた行は対象外、何も変わらなければ空。`useRowChanges` の保持時間（`detectedAt` から 10 秒で消える）は、時刻を差し替えて確かめる
- [X] T021 [P] [US1] `ui/tests/unit/history.test.ts` に `diffVersions(versions, records)` のテストを追加する：新しい版が先頭の配列について、各版の `changed`（1 つ前の版から変わった `status`・`businessStatus`・`owner`。最古の版は空）と `causeClient`（その版を作った通信の `client`。`findCause` を使う）を返す
- [X] T022 [P] [US1] `ui/tests/unit/sequence.test.ts` にテストを追加する：`PATCH`・`PUT` の要求の矢印の注記に、`If-Match` ヘッダがあれば「（If-Match: W/"2"）」、無ければ「（If-Match なし）」が付く。`GET`・`POST`（Transaction）には付かない

### Implementation for User Story 1

- [X] T023 [US1] `ui/src/systems/shared/rowChanges.ts` を作る：`RowChange`（data-model.md §5）、純粋関数 `diffRows(prev: OrderRow[] | null, next: OrderRow[]): RowChange[]`（作業の id で突き合わせ、`status`・`businessStatus`・`owner` を表示ラベルで比べる）、フック `useRowChanges(rows, resetKey)`（取得のたびに比べ、`RowChange` を作業の id ごとに 10 秒保持し、次の変更で置き換える。`demo.reset` の後と初回は比べない）。T020 を通す
- [X] T024 [US1] 一覧の変化を表示する：`ui/src/systems/lis/LisScreen.tsx` の各行に、`RowChange` があればクラス `row-changed` を付け、作業の状態の欄に変わった項目ごとの 1 行（`data-testid="row-change-{srId}"`、例：「担当：技師 A → 技師 B」「状態：依頼済み requested → 受付済み accepted」）を表示する。`ui/src/styles/components.css` に `@keyframes row-changed`（背景の点滅 1.2 秒 × 2）と `.row-changed` を追加し、`@media (prefers-reduced-motion: reduce)` では点滅させない。赤色・警告アイコンは使わない（D-28）
- [X] T025 [P] [US1] 版の履歴の差分：`ui/src/monitor/history.ts` に `VersionDiff`（data-model.md §6）と `diffVersions` を追加し、`ui/src/monitor/HistoryView.tsx` で変わったセルを強調表示する（`data-testid="history-changed-{versionId}-{field}"`）。「この版を作った通信」の列に送信元の画面名（`clientName(cause.client)`、例：「技師 B」）を併記する。T021 を通す
- [X] T026 [P] [US1] `ui/src/monitor/sequenceModel.ts` の `operationLabel` の呼び出し元で、`PUT`・`PATCH` の要求に `If-Match` の注記を付ける（ヘッダ名は大文字小文字を区別せずに探す）。T022 を通す
- [ ] T027 [US1] `ui/tests/e2e/s2-concurrent.spec.ts` を作り、S2-1 のテストを書く（`PageBag` で `/control`・`/lis?tech=tech-a`・`/lis?tech=tech-b`・`/monitor` を別々のコンテキストで開く）：「S2-1 の準備」→ 両方の見出しが「版の確認：付けない（デモ設定）」→ 技師 A・B の順に「受付」→ 両方の確認欄に同じ版 → 技師 A「受付を確定」→ 技師 B の確認欄が開いたまま → 技師 B「受付を確定」→ エラー表示が無い → 技師 A の `row-change-{srId}` に「技師 A → 技師 B」→ 通信モニタに「If-Match なし」の PATCH が 2 件（送信元がそれぞれ「技師 A」「技師 B」と区別して表示される。FR-002）、どちらも成功 → 版の履歴の最新の版で担当のセルが強調され「技師 B」

**Checkpoint**: S2-1 を 4 つのウィンドウで再現できる（MVP：事故の再現）

---

## Phase 4: User Story 2 - 版の確認があれば先に操作した人だけが成功する（S2-2） (Priority: P1)

**Goal**: S2-2 の準備の後、後から確定した技師 B が 412 で拒否され、「この依頼は既に 技師 A が受付済みです」と最新の状態が表示される。同じ版への同時の確定は必ず片方だけが成功する

**Independent Test**: quickstart.md §2.2 が期待どおりになる。`S2ScenarioIT` の同時確定 100 回で、毎回ちょうど 1 つが 200・1 つが 412

### Tests for User Story 2

- [X] T028 [P] [US2] `server/src/test/java/jp/example/demo/integration/S2ScenarioIT.java` に S2-2 のテストを追加する：(a) 順番の確定：`setPolicy(true, true)` の準備の後、両者が同じ ETag で `acceptWith` → 技師 A が 200、技師 B が 412（OperationOutcome 付き）→ 作業は `owner = tech-a` で版は準備後の版 + 1 のまま。(b) 同時の確定：2 つのスレッドが `CountDownLatch` で揃ってから同じ ETag の `acceptWith`（技師 A・技師 B）を送り、ちょうど 1 つが 200・1 つが 412、作業の担当が 200 を受けた側であることを、`Integer.getInteger("s2.repeat", 100)` 回（各回は準備からやり直す）確かめる
- [ ] T029 [P] [US2] `ui/tests/unit/errors.test.ts` にテストを追加する：`acceptConflictError(latestTask)` が、最新が `accepted` で担当が `PractitionerRole/tech-a` なら「この依頼は既に 技師 A が受付済みです」（`httpLabel` は「412 Precondition Failed」、`kind` は `conflict`）、`in-progress` 以降で担当が技師でも同様、`cancelled` や担当が検査部なら S1 の 412 の文言を返す

### Implementation for User Story 2

- [ ] T030 [US2] `ui/src/fhir/errors.ts` に `acceptConflictError(latest: Task): DisplayError` を追加する（担当者名は `PractitionerRole/tech-a` → 「技師 A」、`tech-b` → 「技師 B」。`ui/src/systems/shared/StatusBadges.tsx` の対応と同じ値を使う）。T029 を通す
- [ ] T031 [US2] `ui/src/systems/lis/LisScreen.tsx` の確定の失敗処理で、`FhirError` の `status === 412` のときは `beginAccept`（`GET /Task/{id}`）で最新を取り直して `acceptConflictError(latest.resource)` をエラー欄に表示し、`AcceptDraft` を破棄して一覧を取り直す。自動ではやり直さない（FR-013）。取り直しに失敗したら S1 の 412 の文言を表示する
- [ ] T032 [US2] `ui/tests/e2e/s2-concurrent.spec.ts` に S2-2 のテストを追加する：「S2-2 の準備」→ 見出しが「版の確認：付ける」→ 技師 A・B の順に「受付」→ 技師 A「受付を確定」→ 技師 B「受付を確定」→ 技師 B に「この依頼は既に 技師 A が受付済みです（412 Precondition Failed）」と、行に「受付済み」「担当：技師 A」、確認欄が閉じる → 通信モニタに同じ `If-Match: W/"n"` の PATCH が 2 件、後の 1 件が「412 他の利用者が先に更新済み」で失敗の表示 → 版の履歴に技師 B が作った版が無い。また、技師 A の受付が反映された後は技師 B の行に受付ボタンが出ず補足が表示されること。続けて「同時に確定」のテスト：準備 → 両者「受付」→ 2 つの「受付を確定」を `Promise.all` で押し、片方のウィンドウにだけ 412 の文言が出て、作業の担当が成功した側であることを `Number(process.env.S2_REPEAT ?? 5)` 回繰り返す

**Checkpoint**: S2-1 と S2-2 を続けて見せられる（講演の中心の対比）

---

## Phase 5: User Story 3 - サーバー側で版の確認を必須にして、確認の無い更新を拒否する（S2-3） (Priority: P2)

**Goal**: S2-3 の準備の後、If-Match の無い受付が 400 で拒否され、作業が変わらない。デモ制御パネルでサーバーを「任意」に変えると同じ操作が成功する

**Independent Test**: quickstart.md §2.3 が期待どおりになる

### Tests for User Story 3

- [X] T033 [P] [US3] `server/src/test/java/jp/example/demo/integration/S2ScenarioIT.java` に S2-3 のテストを追加する：`setPolicy(true, false)` の準備の後、`acceptWith(ids, "tech-a", null)` が 400（OperationOutcome の diagnostics に `If-Match` を含む）、作業は版・状態・担当とも変わらない → `setPolicy(false, null)` の後、同じ要求が 200 → 別の準備で `setPolicy(true, …)` のまま正しい ETag の `acceptWith` が 200（US3 シナリオ 4）。回数は `s2.repeat`（既定 20）
- [ ] T034 [P] [US3] `ui/tests/unit/errors.test.ts` の 400（If-Match 無し）の期待値を「版の確認（If-Match）が無い更新はサーバーが受け付けません」に変える。`ui/tests/unit/sequence.test.ts` に、応答本文の diagnostics に `If-Match` を含む 400 は「400 版の確認が必要」、それ以外の 400 は「400 要求の形式が不正」になるテストを追加する

### Implementation for User Story 3

- [ ] T035 [P] [US3] `ui/src/fhir/errors.ts` の 400（If-Match 無し）の文言を「版の確認（If-Match）が無い更新はサーバーが受け付けません」に変える（research.md R-05）。T034 の errors 部分を通す
- [ ] T036 [P] [US3] `ui/src/monitor/sequenceModel.ts` の `resultText` を `resultText(status, body?)` にし、400 で本文に `If-Match` を含めば「400 版の確認が必要」を返す（呼び出し元で `record.response.body` を渡す）。T034 の sequence 部分を通す
- [ ] T037 [US3] `ui/src/app/ControlPanel.tsx` に設定の切り替えを追加する：「サーバーの版の確認」（`data-testid="policy-if-match-required"`、「必須」「任意」の 2 択）と「検体検査システムの版の確認」（`data-testid="policy-lab-sends-if-match"`、「付ける」「付けない（デモ専用）」の 2 択）。現在値を選択状態で示し、変えると `putPolicy` の部分更新を送る。失敗は「設定を変更できません」と表示する。準備の実行中は押せない
- [ ] T038 [US3] `ui/tests/e2e/s2-concurrent.spec.ts` に S2-3 のテストを追加する：「S2-3 の準備」→ 技師 A「受付」→「受付を確定」→「版の確認（If-Match）が無い更新はサーバーが受け付けません（400 Bad Request）」と、行が「依頼済み」のまま → 通信モニタに「If-Match なし」の PATCH と「400 版の確認が必要」→ 制御パネルでサーバーを「任意」に変える → 通信モニタに「ポリシーの変更」→ 技師 A で再び受付・確定して成功する

**Checkpoint**: S2-1〜S2-3 のすべてを再現できる

---

## Phase 6: User Story 4 - 手順書に従って複数のウィンドウで S2 を実演する (Priority: P2)

**Goal**: 講演者・来場者が手順書だけを頼りに、ウィンドウを開くところから S2-1〜S2-3 を 5 分（解説込み）で実演できる

**Independent Test**: 開発に関わっていない人が docs/06-demo-procedures.md だけを見て S2-1〜S2-3 を実演し、各手順の期待結果が画面と一致する（SC-001・SC-008）

### Implementation for User Story 4

- [ ] T039 [P] [US4] `docs/06-demo-procedures.md` の骨子（T002）を完成させる（research.md R-11 の構成。期待結果と話すことの列を埋める）：冒頭に本書の目的（画面上の案内を出さないシナリオの手順。D-29）。S2 の節に (1) 準備：起動、4 つのウィンドウの URL（`/control`・`/lis?tech=tech-a`・`/lis?tech=tech-b`・`/monitor`）と 1920×1080 での並べ方の例（左上 技師 A、右上 技師 B、左下 デモ制御パネル、右下 通信モニタ）、入口の「S2 同時受付で開くウィンドウ」からも開けること。(2) S2-1・S2-2・S2-3 のそれぞれ：表（# / 操作する画面 / 操作 / 画面の期待結果 / 通信モニタの期待結果 / 話すこと（業務上の意味・FHIR 上の意味））。期待結果は quickstart.md §2.1〜§2.3 と一致させ、版は実際の番号（準備の後の版は 2、例：`W/"2"`）で書く（data-model.md §3）。(3) 締めの解説：ETag と If-Match（楽観的ロック）、「誰が処理中か」は Task.status + owner（論理ロック。FHIR に編集中ロックの標準 API は無い）、状態の遷移チェックでは「受付済み → 受付済み」の上書きを防げないこと。(4) うまくいかないとき：設定が違う・順序を間違えた・確認欄が開かない → 準備ボタンを押し直す／初期化。(5) 所要時間の目安：S2 全体で解説込み 5 分（D-24）、S1 と合わせて 15 分
- [ ] T040 [P] [US4] `ui/src/app/Launcher.tsx` の「個別のウィンドウで開く」に「デモ制御パネル」（`/control`）を加え、小見出し「S2 同時受付で開くウィンドウ」の下に `/control`・`/lis?tech=tech-a`・`/lis?tech=tech-b`・`/monitor` へのリンクと「操作の手順は docs/06-demo-procedures.md を参照」の 1 行を置く（contracts/ui-screens.md「ルート」）
- [ ] T041 [P] [US4] `docs/README.md` の一覧に `06-demo-procedures.md` があることを確認し、説明文を実装後の内容に合わせる
- [ ] T042 [US4] `ui/tests/e2e/s2-concurrent.spec.ts` に入口のテストを追加する：`/` に「S2 同時受付で開くウィンドウ」と 4 つのリンクがあり、各リンクの先が開ける。S2 のウィンドウ（`/control`・`/lis`）に自習モードのガイドの強調（S1 のガイドが付ける `data-guide-active` 属性。`ui/src/guide/useGuide.ts`）が無いこと（D-29）

**Checkpoint**: 手順書と画面がそろい、S2 を講演で実演できる

---

## Phase 7: Polish & Cross-Cutting Concerns

- [ ] T043 [P] `CLAUDE.md` を更新する：「現在の実装範囲は S1（検体検査）」を「S1（検体検査）と S2（同時受付）」に、S2 の要点（S2 はステージビューを使わず `/control` と個別ウィンドウ・手順書 docs/06 で操作、`labSendsIfMatch` はサーバーの判定に使わないデモ設定、受付は GET → PATCH の 2 段階で `AcceptDraft` の ETag を使う）と、コマンド（`mvn verify -Dit.test=S2ScenarioIT -Ds2.repeat=100`、`S2_REPEAT=100 npx playwright test tests/e2e/s2-concurrent.spec.ts`）を追記する
- [ ] T044 全体の回帰を実行する：UI をビルドして JAR を作り直し、`mvn verify -Ds1.repeat=20 -Ds2.repeat=100`、`npm test`、`npm run typecheck`、`npx playwright test`、`S2_REPEAT=100 npx playwright test tests/e2e/s2-concurrent.spec.ts -g "同時に確定"` がすべて成功することを確認する
- [ ] T045 quickstart.md §2（手での確認）と §2.4（初期化・準備の 2 度押し・取りやめ・S1 の講演モード・`docker run --network none`）を実施し、`specs/002-concurrent-acceptance/validation-results.md` に SC-001〜SC-008 の結果（SC-001 の所要時間、SC-005 の準備の時間、SC-002 の 100 回の結果、SC-006 のオフライン、SC-004 は反映までの時間を計測し、SC-007 はアンケートを実施するか見送るか（理由つき）、SC-008 は試行の要否と結果）を S1 の validation-results.md と同じ形式で記録する
- [ ] T046 `docs/05-decisions.md` の技術検証項目 V-07 の結果を「確認済み（サーバーは HTTP の同時 PATCH 100 回、画面は 2 つのウィンドウからの同時確定 {回数}、specs/002 validation-results.md）」に更新する

---

## Dependencies & Execution Order

### Phase Dependencies

- **Setup（Phase 1）**：依存なし
- **Foundational（Phase 2）**：Phase 1 の後。US1〜US4 のすべてを止める
- **US1（Phase 3）・US2（Phase 4）・US3（Phase 5）**：Phase 2 の後。互いに独立して確認できるが、`S2ScenarioIT.java`・`s2-concurrent.spec.ts`・`LisScreen.tsx`・`errors.ts`・`sequenceModel.ts` を共有するため、1 人で進めるなら US1 → US2 → US3 の順
- **US4（Phase 6）**：Phase 2 の後に着手できる。手順書（T039）の期待結果は US1〜US3 の画面に合わせるので、最終確認は US1〜US3 の後
- **Polish（Phase 7）**：すべてのストーリーの後

### User Story Dependencies

- **US1（P1）**：Phase 2 のみ
- **US2（P1）**：Phase 2 のみ（412 の文言は US1 の成果に依存しない）
- **US3（P2）**：Phase 2 のみ（設定の切り替え T037 は T018 の制御パネルに足す）
- **US4（P2）**：Phase 2 のみ（文書の最終確認は US1〜US3 の後）

### Within Each User Story

- テストを先に書き、失敗することを確かめてから実装する
- 純粋関数（`diffRows`・`diffVersions`・`acceptConflictError`・`resultText`）→ 画面への組み込み → E2E の順
- UI を変えたら JAR を作り直してから E2E を実行する

### Parallel Opportunities

- Phase 2：T003・T006・T007・T008・T010・T015・T016 は互いに並行できる（別ファイル）。T004 → T005 は順番。T009 は T007・T008、T011 は T010、T017 は T011・T016、T012 は T009・T011、T018 は T009・T017 の後
- US1：T019〜T022 のテストは並行。T025・T026 は T023・T024 と並行
- US3：T035・T036 は並行
- US4：T039・T040・T041 は並行

---

## Parallel Example: User Story 1

```bash
# テストを並行して書く
Task: "T019 S2ScenarioIT の S2-1（server/src/test/java/jp/example/demo/integration/S2ScenarioIT.java）"
Task: "T020 diffRows のテスト（ui/tests/unit/rowChanges.test.ts）"
Task: "T021 diffVersions のテスト（ui/tests/unit/history.test.ts）"
Task: "T022 If-Match の注記のテスト（ui/tests/unit/sequence.test.ts）"

# 画面の一覧（LisScreen）と通信モニタ（history・sequenceModel）は別ファイルなので並行
Task: "T023 → T024 一覧の変化（rowChanges.ts、LisScreen.tsx、components.css）"
Task: "T025 版の履歴の差分（history.ts、HistoryView.tsx）"
Task: "T026 If-Match の注記（sequenceModel.ts）"
```

---

## Implementation Strategy

### MVP First (User Story 1 Only)

1. Phase 1・Phase 2 を終える（S1 の回帰が緑のまま、準備ボタンと 2 段階の受付が動く）
2. Phase 3（US1：S2-1 の上書き事故）を終える
3. **止めて確認する**：quickstart.md §2.1 を 4 つのウィンドウで実演する
4. ここで見せられるのは「事故」だけなので、講演に使うには US2 まで進める

### Incremental Delivery

1. Phase 2 → 準備ボタンと 2 段階の受付（S1 も新しい受付で動く）
2. US1 → 上書き事故の再現（MVP）
3. US2 → 412 による防止（講演の中心の対比が完成）
4. US3 → サーバー側の強制（400）
5. US4 → 手順書と入口のリンク（講演・展示で使える状態）
6. Polish → CLAUDE.md、検証結果、V-07 の更新

---

## Notes

- [P] = 別ファイルで、未完了のタスクに依存しない
- [Story] でタスクとユーザーストーリーを対応付ける
- 各タスクまたはまとまりごとにコミットする（コミットメッセージは既存の形式 `feat:` / `test:` / `docs:` に合わせる）
- 各チェックポイントで、そのストーリーを単独で確認できる
- S2 の画面には自習モードのガイド・進行パネルを足さない（D-29・D-30）
