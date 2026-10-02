---

description: "S3 放射線：CT 検査の予約枠の取り合いの実装タスク"
---

# Tasks: S3 放射線：CT 検査の予約枠の取り合い

**Input**: Design documents from `specs/003-ct-slot-booking/`

**Prerequisites**: [plan.md](plan.md)、[spec.md](spec.md)、[research.md](research.md)、[data-model.md](data-model.md)、[contracts/](contracts/)、[quickstart.md](quickstart.md)

**Tests**: 含める。constitution の開発ワークフロー（「排他制御のシナリオは同時更新の結果（片方が 412）まで検証する」）と、
SC-002（同時の仮押さえ 100 回）・SC-003（20 回連続）・SC-005（期限切れの反映）が自動テストを要求しているため。テストは対応する実装より先に書き、失敗することを確認してから実装する。

**Organization**: ユーザーストーリーごとにフェーズを分ける。US1〜US3 はどれも Phase 2（リソース・初期データ・ポリシー・CT 予約の組み立て・準備ボタン）の上に載り、互いに独立して確認できる。

## Format: `[ID] [P?] [Story] Description`

- **[P]**: 並行して実施できる（別ファイル、未完了タスクへの依存なし）
- **[Story]**: 対応するユーザーストーリー（US1〜US4）
- パスはリポジトリのルートからの相対パス

## Path Conventions

- サーバー（Java）：`server/src/main/java/jp/example/demo/`、テスト：`server/src/test/java/jp/example/demo/`
- UI（React + TypeScript）：`ui/src/`、テスト：`ui/tests/unit/`（Vitest）、`ui/tests/e2e/`（Playwright）
- コード上の識別子は英語、UI 文言・ドキュメントは日本語（constitution 開発ワークフロー）
- E2E は起動済みのサーバーに対して実行する。UI を変えたら UI をビルドして `server/src/main/resources/static/` にコピーし、`mvn -DskipTests package` で JAR を作り直す（CLAUDE.md）
- 日時は日本時間（`Asia/Tokyo`）を明示して扱う。サーバー・ブラウザ・コンテナのタイムゾーンに依存させない（research.md R-02）

---

## Phase 1: Setup

**Purpose**: 変更前の状態が緑であることを確かめ、手順書の骨子を先に置く

- [ ] T001 変更前の基準を記録する：`server/` で `mvn verify`、`ui/` で `npm ci && npm test && npm run typecheck` を実行し、すべて成功することを確認する。失敗があれば本機能の作業前に原因を報告する（`server/`、`ui/`）
- [ ] T002 `docs/06-demo-procedures.md` に「S3 予約枠の取り合い（排他制御②）」の節の骨子を先に作る（原則 VIII。docs/02 の S3 がこのファイルにリンクしている）：章立て（準備／S3-1・S3-2・S3-3／締めの解説／うまくいかないとき／所要時間）、S3-1〜S3-3 の操作の表の見出しと「操作する画面」「操作」の列だけを書き、期待結果と話すことの列は「（実装後に記入）」とする。冒頭の説明文（画面上の案内を出さないシナリオの手順）を S2・S3 の両方を指す表現に直す。`docs/README.md` の 06 の説明を「S2 同時受付・S3 予約枠の取り合いの操作手順」に変える

---

## Phase 2: Foundational (Blocking Prerequisites)

**Purpose**: すべてのストーリーが使う土台 —— Slot・Appointment・Schedule・Device の API、日付に依存する予約枠の生成、ポリシーの 2 項目、CT 予約の組み立てと送信、予約中の枠の状態、S3 の準備ボタン、S1 への影響の遮断

**⚠️ CRITICAL**: このフェーズが終わるまで US1〜US4 に着手しない

### サーバー：検索パラメータ（research.md R-01、contracts/fhir-api.md）

- [ ] T003 [P] `server/src/test/java/jp/example/demo/unit/SearchMatcherTest.java` にテストを追加する：Slot の `schedule`（`Schedule/ct-1`）・`status`、Appointment の `slot`（`Slot/ct1-1000`。`slot` は複数の参照を持てる）・`status`・`patient`（`participant.actor` のうち Patient）・`practitioner`（`participant.actor` のうち Practitioner）、ServiceRequest の `category`（`category.coding.code`。例：`category=108252007` が検体検査に一致し `363679005` には一致しない。`system|code` の形でも一致する）。Schedule・Device はパラメータ無しの全件検索に対応すること（`SearchParameters.supportsType`）
- [ ] T004 `server/src/main/java/jp/example/demo/fhir/search/SearchParameters.java` に T003 のパラメータを実装する（Slot・Appointment・Schedule・Device の定義を追加し、ServiceRequest に `category` を加える。トークンは `code` と `system|code` の両方を返す）。T003 を通す

### サーバー：初期データ（research.md R-02、data-model.md §1）

- [ ] T005 [P] `server/src/test/java/jp/example/demo/unit/SlotSeedGeneratorTest.java` を作る：`Clock.fixed(Instant.parse("2026-10-02T15:30:00Z"), ZoneOffset.UTC)`（日本時間では 10/3 0:30）で生成すると基準日が **10/4** になること（日本時間の翌日。UTC の日付に依存しない）。Slot が 6 件で id が `ct1-0900`・`ct1-0930`・`ct1-1000`・`ct1-1030`・`ct1-1100`・`ct1-1130`、`start` – `end` が 30 分、`start` の文字列が `+09:00` 付き（例：`2026-10-04T10:00:00+09:00`）、`schedule` が `Schedule/ct-1`。`ct1-0900`・`ct1-1100` が `busy`、ほかが `free`、`comment` を持たない。Appointment が 2 件（`seed-0900`：`slot` → `Slot/ct1-0900`、患者 `Patient/demo-jiro`、`status = booked`、`start`・`end` が枠と同じ／`seed-1100`：`Slot/ct1-1100`、`Patient/demo-sakurako`）
- [ ] T006 `server/src/main/java/jp/example/demo/slot/SlotSeedGenerator.java` を作る：`SlotSeedGenerator(Clock clock)`、`List<Resource> generate()`。基準日は `LocalDate.now(clock.withZone(ZoneId.of("Asia/Tokyo"))).plusDays(1)`、時刻は `ZonedDateTime` から `InstantType`（`TimeZone` `Asia/Tokyo` を指定して `+09:00` で出力）に変換する。Appointment の `participant` は患者と `Device/ct-1`（どちらも `status = accepted`）。T005 を通す
- [ ] T007 [P] 静的な初期データを追加する（`server/src/main/resources/seed/`、data-model.md §1.1。すべて架空）：`practitioner-dr-y.json`（医師 Y、JP_Practitioner）、`practitionerrole-dr-y.json`（`practitioner-dr-x` の PractitionerRole と同じ形、JP_PractitionerRole）、`organization-rad-dept.json`（放射線部、`partOf` → `Organization/hospital`、JP_Organization）、`device-ct-1.json`（`deviceName` 「CT-1 号機」、`type` = `http://dicom.nema.org/resources/ontology/DCM#CT`「Computed Tomography」、`owner` → `Organization/rad-dept`、`meta.profile` なし）、`schedule-ct-1.json`（`active = true`、`actor` → `Device/ct-1` display「CT-1 号機」、`serviceType.text`「CT 検査」、`comment`「30 分枠」、`meta.profile` なし）、`patient-demo-jiro.json`（デモ 次郎、患者番号 `00000003`、男性、JP_Patient）、`patient-demo-sakurako.json`（デモ 桜子、患者番号 `00000004`、女性、JP_Patient）。`index.txt` に追記する。`JpPackageConsistencyTest` が通ること（JP Core にプロファイルがあるものだけに `meta.profile` を付ける）
- [ ] T008 `server/src/main/java/jp/example/demo/demo/DemoControl.java` の `reset()` で、`seedLoader.load()` の結果に `SlotSeedGenerator.generate()` の結果を加えて `repo.replaceAll` に渡す（`DemoControl` のコンストラクタに `SlotSeedGenerator` を加え、`server/src/main/java/jp/example/demo/DemoServerMain.java` で `new SlotSeedGenerator(Clock.systemUTC())` を渡す）。`seedResources` の件数は結合後の件数にする

### サーバー：Provider と書き込み（research.md R-01、contracts/fhir-api.md）

- [ ] T009 [P] `server/src/test/java/jp/example/demo/integration/FhirApiContractIT.java` にテストを追加する：`GET /fhir/Schedule/ct-1`・`/fhir/Device/ct-1` が 200。`GET /fhir/Slot?schedule=Schedule/ct-1` が 6 件。`GET /fhir/Appointment?slot=Slot/ct1-0900&status=booked` が 1 件。`PUT /fhir/Slot/ct1-1000`（`If-Match: W/"1"`、`status = busy-tentative`）が 200 で `ETag: W/"2"`、同じ `If-Match: W/"1"` の 2 回目が 412、If-Match なしが 400。Schedule・Device への `PUT` が 400（書き込めない種別）。`Slot?schedule=Schedule/ct-1` を criteria に持つ Subscription の `PUT` が 201 で `active` になる。`POST /demo/reset` の後、Slot が版 1 の初期状態に戻る。`ServiceRequest?category=108252007` が検索できる
- [ ] T010 Provider を追加する：`server/src/main/java/jp/example/demo/fhir/provider/SlotProvider.java`・`AppointmentProvider.java`（`ServiceRequestProvider` と同じく read・history・search・create・update）、`ScheduleProvider.java`・`DeviceProvider.java`（`PatientProvider` と同じく read・history・search だけ）。`server/src/main/java/jp/example/demo/fhir/ResourceWriter.java` の `WRITABLE` に `"Slot"`・`"Appointment"` を加える（Schedule・Device は加えない）。`DemoServerMain.java` の `providers` に 4 つを登録する。T009 を通す

### サーバー：ポリシーの 2 項目（research.md R-03、data-model.md §4、contracts/demo-control-api.md）

- [ ] T011 [P] `server/src/test/java/jp/example/demo/integration/TrafficMonitorIT.java` にテストを追加する：`GET /demo/policy` が 5 項目（`"ehrUsesSlotHold": true`、`"slotHoldSeconds": 30` を含む）。`PUT {"ehrUsesSlotHold": false}` は「本文に含めた項目だけを変更する（部分更新）」こと。`PUT {"slotHoldSeconds": 60}` が反映される。`slotHoldSeconds` が `0`・`301`・`1.5`・`"30"` のとき **400**（`{"error": "slotHoldSeconds は 1〜300 の整数で指定してください"}`）で、同じ本文のほかの項目（例：`"ehrUsesSlotHold": false`）も変更しないこと。`/ws/monitor` の `demo.policy` と通信記録の `demoEvent.detail` が 5 項目。`POST /demo/reset` で既定値に戻る。既存の `setPolicy(Boolean, Boolean)` のテストは変えずに通ること
- [ ] T012 ポリシーを実装する：`server/src/main/java/jp/example/demo/demo/DemoPolicy.java` に `ehrUsesSlotHold`（既定 `true`。Javadoc に「サーバーの判定には使わない。電子カルテの CT 予約画面だけが読むデモ専用の設定（specs/003 research R-03）」）と `slotHoldSeconds`（既定はコンストラクタで受け取る値）を加え、`resetToDefaults()` で戻す。`DemoPolicy(int defaultSlotHoldSeconds)` と、引数なしのコンストラクタ（30）を用意する。`DemoServerMain.java` で環境変数 `SLOT_HOLD_SECONDS` を読み、「1〜300 の整数。未設定・不正なら 30」を既定値にする。`DemoControl.updatePolicy` に `Boolean ehrUsesSlotHold`・`Integer slotHoldSeconds` を加える。`DemoControlServlet.doPut` で `slotHoldSeconds` を検証し（整数のノードで 1〜300 以外、または整数でない値は 400、ほかの項目も変更しない）、`policyJson()` を 5 項目にする。`server/src/main/java/jp/example/demo/traffic/MonitorBroadcaster.java` の `demo.policy` を 5 項目にする。T011 を通す
- [ ] T013 [P] 結合テストの補助を追加する：`server/src/test/java/jp/example/demo/integration/DemoServerExtension.java` に `putPolicy(Map<String, Object> partial)`（`PUT /demo/policy`。応答の `HttpResponse<String>` を返す）を追加する。`server/src/test/java/jp/example/demo/integration/SlotFlow.java` を新規に作る（`LabFlow` と同じく FHIR マスタ `ui/src/master/fhir-master.json` からコードを読む）：`select(String slotId)`（GET。リソースと ETag）、`hold(String client, String doctorName, String slotId, String ifMatchOrNull)`、`release(...)`、`confirm(String client, String doctor, String patientId, String slotId, String heldEtag)`（data-model.md §2 の Transaction：`PUT Slot`（`busy`、`ifMatch`）+ `POST Appointment` + `POST ServiceRequest` + `POST Task`）、`bookDirect(String client, String doctor, String patientId, String slotId)`（Slot の PUT を含まない）、`bookedAppointments(String slotId)`（`Appointment?slot=Slot/{id}&status=booked` の件数）。どれも `HttpResponse<String>` を返し、`X-Demo-Client` を付ける。**T014（FHIR マスタへの検査内容・コードの追加）の後に実施する**（`SlotFlow` がそのマスタを読むため）

### UI：マスタ・型・ラベル（data-model.md §2.1、contracts/websocket.md、contracts/ui-screens.md「表示ラベル」）

- [ ] T014 [P] `ui/src/master/fhir-master.json` に追加する：`systems.radiologyProcedure`（`https://demo.example.jp/fhir/CodeSystem/radiology-procedure`）、`systems.radBusinessStatus`（`https://demo.example.jp/fhir/CodeSystem/rad-business-status`）、`radiologyProcedures`（`CT-HEAD` 頭部 CT（単純）、`CT-CHEST` 胸部 CT（単純）、`CT-ABD-C` 腹部 CT（造影））、`codings.imagingCategory`（SNOMED CT `363679005` Imaging）、`codings.modalityCT`（`http://dicom.nema.org/resources/ontology/DCM` `CT` Computed Tomography）、`radBusinessStatuses`（`booked` 予約済み）。`_comment` に「検査内容は JJ1017 が JP Terminology 2.2609.0 に無いためデモ用の独自コード（D-39）」を加える
- [ ] T015 [P] `server/src/test/java/jp/example/demo/jp/JpPackageConsistencyTest.java` に、FHIR マスタの `codings.modalityCT` が `ValueSet-jp-radiologymodality-vs.json`（`http://jpfhir.jp/fhir/core/ValueSet/JP_RadiologyModality_VS`）の `compose.include` に含まれることを確かめるテストを追加する（パッケージが無ければスキップする既存の扱いに合わせる）
- [ ] T016 [P] 型を更新する：`ui/src/realtime/types.ts` の `DemoPolicy` に `ehrUsesSlotHold: boolean`・`slotHoldSeconds: number`、`TrafficRecord.kind` に `"server"`、`serverAction: ServerAction | null`（data-model.md §6 の形：`action`・`resource`・`before { status, versionId, comment? }`・`after { status, versionId }`・`holdSeconds`）を加える。`ui/src/demo/policyState.ts` の `DEFAULT_POLICY` に `ehrUsesSlotHold: true`・`slotHoldSeconds: 30` を加え、`demo.reset` を受けたら `stale: true` にして取り直す（既定値が環境変数で変わりうるため。contracts/websocket.md）。`ui/tests/unit/policyState.test.ts` の期待値を合わせる。`ui/src/fhir/client.ts` の `ClientId` に `"ehr-doctor-y"`・`"ris"` を加える。既存のテストのデータ（`kind` を持つ記録）に `serverAction: null` を足して `npm run typecheck` を通す
- [ ] T017 [P] `ui/tests/unit/labels.test.ts` にテストを追加し、`ui/src/fhir/labels.ts` を更新する：`radBusinessStatusLabel("booked")` が「予約済み」、`formatSlotTime("2026-10-03T10:00:00+09:00", "2026-10-03T10:30:00+09:00")` が「10/3（土）10:00–10:30」（`Intl.DateTimeFormat` に `timeZone: "Asia/Tokyo"` を指定。テストの実行環境のタイムゾーンを `process.env.TZ = "UTC"` にしても同じ結果）、`holderName("仮押さえ：医師 X")` が「医師 X」（`comment` は表示用。D-35）、`holderName(undefined)` が null

### UI：CT 予約の組み立てと送信（research.md R-04、data-model.md §2・§7、contracts/fhir-api.md）

- [ ] T018 [P] `ui/tests/unit/ctBooking.test.ts` を作る：`buildHoldSlot(slot, "医師 X")` が `status = busy-tentative`・`comment = "仮押さえ：医師 X"`（ほかの要素は元の Slot のまま）。`buildReleaseSlot(slot)` が `status = free` で `comment` を持たない。`buildBookingTransaction({ slot, heldEtag: 'W/"2"', patientId, procedureCode: "CT-CHEST", doctor: "dr-x", orderNumber, now })` の entry が `PUT Slot/ct1-1000`（`ifMatch: W/"2"`、`status = busy`、`comment` なし）・`POST Appointment`・`POST ServiceRequest`・`POST Task` の 4 件。`heldEtag: null`（直接予約）では Slot のエントリが無く 3 件。**どのエントリにも `ifNoneExist` が無い**（D-40）。Appointment は `status = booked`、`slot` → `Slot/ct1-1000`、`start`・`end` が枠と同じ、`basedOn` → ServiceRequest の `urn:uuid`、`participant` が患者・`Practitioner/dr-x`・`Device/ct-1`（すべて `accepted`）、`serviceType` が検査内容。ServiceRequest は `category` = 363679005、`code` = `CT-CHEST`、`orderDetail` = DCM#CT、`requester` = `Practitioner/dr-x`、`performer` = `Organization/rad-dept`、`occurrencePeriod` = 枠の時刻、`meta.profile` = JP_ServiceRequest_Common。Task は `status = requested`、`businessStatus` = `booked`「予約済み」、`owner` = `Organization/rad-dept`、`requester` = `Practitioner/dr-x`、`focus` → ServiceRequest の `urn:uuid`。`nextCtOrderNumber(now, "dr-x", 0)` が `R-{yyyyMMdd}-X001`、`("dr-y", 2)` が `R-{yyyyMMdd}-Y003`（日付は日本時間）
- [ ] T019 `ui/src/fhir/builders/ctBooking.ts` を作り、T018 の関数を実装する（`ui/src/fhir/builders/labOrder.ts` と同じく、コードは FHIR マスタから読む。`DOCTORS = { "dr-x": { name: "医師 X", letter: "X" }, "dr-y": { name: "医師 Y", letter: "Y" } }`）。T018 を通す
- [ ] T020 [P] `ui/tests/unit/ctActions.test.ts` を作る（`fetch` を差し替えた `FhirClient`。`ui/tests/unit/acceptDraft.test.ts` の書き方に合わせる）：`selectSlot(client, "ct1-1000")` が `GET /fhir/Slot/ct1-1000` を送り `Versioned<Slot>` を返す。`holdSlot(client, selected, "医師 X")` が **選んだときの ETag** を If-Match に付けた `PUT /fhir/Slot/ct1-1000` を送る。`confirmBooking(client, draft)` が仮押さえの応答の ETag を `ifMatch` にした Transaction を送る。`bookDirect(client, draft)` の Transaction に Slot のエントリが無い。`releaseSlot(client, held)` が仮押さえの応答の ETag の If-Match で `status = free` を送る
- [ ] T021 `ui/src/fhir/ctActions.ts` を作り、T020 の関数を実装する（オーダー番号は、`ServiceRequest?requester=Practitioner/{doctor}&category=363679005` の件数から `nextCtOrderNumber` で採番する）。T020 を通す
- [ ] T022 [P] `ui/tests/unit/bookingDraft.test.ts` を作る：純粋関数 `reduceBookingDraft(state, event)` が data-model.md §7 の状態の遷移の表のとおりに動くこと（無し →「枠を選ぶ」成功で選択中、選択中 → 仮押さえ 200 で仮押さえ中（`held`・`heldAt`・`holdSeconds` を保持）、選択中 → 仮押さえ 412 で無し、選択中（`direct`）→ 予約を確定 200 で無し、仮押さえ中 → 確定 200／412 で無し、仮押さえ中 → 取りやめ 200／412 で無し、選択中 → 取りやめ（通信なし）で無し、いずれも `demo.reset` で無し）。「通知で一覧が取り直されても `selected`・`held` を変えない」（一覧の更新のイベントで状態が変わらない）。`mode` は枠を選んだ時点のポリシーで決まり、予約欄を開いている間にポリシーが変わっても変わらない。`remainingSeconds(draft, now)` が `heldAt + holdSeconds - now` を 0 で下限とする
- [ ] T023 `ui/src/systems/ehr/bookingDraft.ts` を作り、`BookingDraft`（data-model.md §7 の表の項目）・`reduceBookingDraft`・`remainingSeconds` を実装する。T022 を通す

### UI：枠と予約の結合（contracts/ui-screens.md「放射線部門システム」）

- [ ] T024 [P] `ui/tests/unit/slots.test.ts` を作る：純粋関数 `joinSlots(slots, appointments, serviceRequests, tasks, patients)` が `start` の昇順の行を返し、各行に `bookedAppointments`（`status = booked` で `slot` がその枠を指すもの）、`doubleBooked`（2 件以上）、`bookedButFree`（予約があるのに枠が `free`）、`holder`（`holderName(comment)`）を持つこと。初期データの予約（ServiceRequest の無い Appointment）は `seed: true` になること。`diffSlotRows(prev, next)` が、状態・押さえた人・予約の件数が変わった行を `RowChange` と同じ形で返し、`prev` が null なら空を返すこと
- [ ] T025 `ui/src/systems/shared/slots.ts` を作る：T024 の関数と、取得の関数 `loadCtSlots(client)`（`Slot?schedule=Schedule/ct-1` と `Appointment?status=booked`、患者）・`loadRisData(client)`（加えて `ServiceRequest?category=363679005`・`Task?owner=Organization/rad-dept`）。`ui/src/systems/shared/rowChanges.ts` の `useRowChanges` を、比べる関数を引数で受け取れる形に広げる（検体検査の既存の呼び出しは `diffRows` を渡して従来どおり動く。`ui/tests/unit/rowChanges.test.ts` が通ること）。T024 を通す

### UI：Subscription の複数化と S1 への影響の遮断（research.md R-07・R-08）

- [ ] T026 `ui/src/realtime/useLiveData.ts` の `subscription` を `SubscriptionSpec | SubscriptionSpec[]` にし、配列のときは Subscription ごとに `ensureSubscription` と `openSubscriptionSocket` を行い、どれかの `onBound`・`onPing` で取り直す。`onBindError` はその Subscription だけを登録し直す。既存の画面（電子カルテ・検体検査システム）は 1 件のまま動くこと（`npm test`・`npm run typecheck`）
- [ ] T027 `ui/src/systems/shared/orders.ts` の `loadDoctorOrders` で、ServiceRequest の検索に `category: "108252007"`（検体検査）を加える（R-08。医師 X の CT の依頼を S1 の一覧に出さない）。Task は focus で突き合わせるので、検体検査の依頼の作業だけが行になること。`ui/tests/unit/` の既存のテストが通ること

### UI：S3 の準備ボタンと予約方式の切り替え（research.md R-11、contracts/demo-control-api.md、contracts/ui-screens.md「デモ制御パネル」）

- [ ] T028 [P] `ui/tests/unit/prepare.test.ts` にテストを追加する：`prepareScenario("s3-1", deps)` が `resetDemo` → `putPolicy({ ehrUsesSlotHold: false })` の順に呼び、FHIR の依頼・採血を送らないこと。`s3-2`・`s3-3` は `putPolicy({ ehrUsesSlotHold: true })`。段階の通知が `reset → policy → done`。初期化で失敗したら `{ stage: "reset", error }` で止まり設定を送らないこと。S2 の既存のテストが変わらず通ること
- [ ] T029 `ui/src/demo/prepare.ts` を広げる：`type ScenarioId = S2ScenarioId | "s3-1" | "s3-2" | "s3-3"`、`S3_PRESETS`（data-model.md §4 の表：`s3-1` は `{ ehrUsesSlotHold: false }`、`s3-2`・`s3-3` は `{ ehrUsesSlotHold: true }`）、シナリオごとの段階の並び（S2 は `reset → policy → order → collect`、S3 は `reset → policy`）。T028 を通す
- [ ] T030 `ui/src/app/ControlPanel.tsx` に「S3 予約枠の取り合いの準備」の節を加える：`btn-prepare-s3-1`「S3-1 の準備（直接予約）」・`btn-prepare-s3-2`「S3-2 の準備（仮押さえ）」・`btn-prepare-s3-3`「S3-3 の準備（期限切れ）」、状況は既存の `prepare-status` を共用（「S3-x の準備ができました」）。設定の節の見出しを「設定」にし、「電子カルテの予約方式」（`data-testid="policy-ehr-uses-slot-hold"`、「仮押さえを使う」`policy-slot-hold-on`／「直接予約する（デモ専用）」`policy-slot-hold-off`）を加える。「準備の実行中は、準備ボタン・設定の切り替え・初期化ボタンを押せない」。画面上の案内は出さない（D-33）

**Checkpoint**: `mvn verify` と `npm test`・`npm run typecheck` が通る。JAR を作り直して S1・S2 の E2E（`npx playwright test`）が通る。`/control` の「S3-1 の準備」で予約方式が「直接予約する」に変わり、`GET /fhir/Slot?schedule=Schedule/ct-1` が翌日（日本時間）の 6 枠を返す

---

## Phase 3: User Story 1 - 枠を確認せずに予約すると二重予約になる事故を再現する（S3-1） (Priority: P1) 🎯 MVP

**Goal**: S3-1 の準備の後、医師 X・医師 Y が同じ 10:00 の枠に直接予約すると両方成功し、放射線部門システムの同じ枠に予約が 2 件並ぶ。枠は「空き」のまま版も変わらず、通信モニタで Transaction に枠の更新が含まれていないことが分かる

**Independent Test**: quickstart.md §2.1 の 1〜5 が期待どおりになる（`S3ScenarioIT` の S3-1 と、E2E の S3-1）

### Tests for User Story 1

- [ ] T031 [P] [US1] `server/src/test/java/jp/example/demo/integration/S3ScenarioIT.java` を作り、S3-1 のテストを書く（`S2ScenarioIT` の書き方に合わせ、回数は `Integer.getInteger("s3.repeat", 20)`）：`reset()` → `putPolicy({"ehrUsesSlotHold": false})` → `SlotFlow.bookDirect("ehr-doctor", "dr-x", "demo-taro", "ct1-1000")` が 200 → `bookDirect("ehr-doctor-y", "dr-y", "demo-hanako", "ct1-1000")` が 200 → `bookedAppointments("ct1-1000")` が 2 → `Slot/ct1-1000` は版 1 の `free` のまま → `Task?owner=Organization/rad-dept` が 2 件 → `ServiceRequest?requester=Practitioner/dr-x&category=108252007` が 0 件（FR-025：S1 の一覧に出ない）
- [ ] T032 [P] [US1] `ui/tests/unit/transactionSummary.test.ts` を作る：純粋関数 `summarizeTransaction(requestBody, responseStatus, responseBody)` が、要求の各エントリ（`method`・`url`・`ifMatch`）と応答の各エントリ（`response.status`・`location`）を並べた行を返すこと（成功時）。失敗時（412、OperationOutcome の `expression` が `Bundle.entry[0]`）は entry 0 を「失敗」、ほかを「取り消し（登録されていない）」にし、`cancelledAll: true` を返すこと。Transaction でない記録・本文が切り詰められた記録（`truncated`）では null を返すこと
- [ ] T033 [P] [US1] `ui/tests/unit/sequence.test.ts` にテストを追加する：`laneOf("ris")` が `"ris"`、`laneOf("server-slot-expiry")` が `"server"`。`clientName("ehr-doctor-y")` が「医師 Y」、`clientName("ris")` が「放射線部門システム」。Transaction の注記が、Slot の PUT を含めば「POST Transaction（一括登録・枠の版の確認あり）」、含まなければ「POST Transaction（一括登録）」。`lanesFor(items)` が、S1 の記録では `["ehr", "server", "lis"]`、放射線部門システムの記録を含めば `["ehr", "server", "ris"]`、両方を含めば 4 列を返す。`resourceRefsIn` が Transaction の要求の `entry.request.url`（PUT）、応答の `location`、Appointment の `slot` の参照（`Slot/ct1-1000`）を含むこと

### Implementation for User Story 1

- [ ] T034 [US1] T031 を通す（サーバーの実装は Phase 2 で足りているはず。通らなければ原因を Phase 2 のタスクに戻して直す）
- [ ] T035 [P] [US1] `ui/src/monitor/transactionSummary.ts` を作り T032 を通す。`ui/src/monitor/TrafficDetail.tsx` で、Transaction の記録に「一括送信の中身」の表（`data-testid="transaction-entries"`、列は「# / 要求 / 版の確認 / 結果」）を表示し、`cancelledAll` なら表の下に「一括送信の全体が取り消されました（何も登録されていません）」を出す（contracts/ui-screens.md「通信モニタ」）
- [ ] T036 [P] [US1] `ui/src/monitor/sequenceModel.ts` を更新して T033 を通す：`Lane` に `"ris"`、`NAMES` に `ehr-doctor-y`・`ris`・`server-slot-expiry`（「FHIR サーバー（仮押さえの期限切れ）」）、`laneOf` の対応、Transaction の注記（要求本文の entry に `PUT` の `Slot/` があるか）、`lanesFor(items)`、`resourceRefsIn` の拡張。`ui/src/monitor/SequenceDiagram.tsx` で列を `lanesFor(items)` から決め、列の数に応じて x 座標を等間隔に配置する（列名「放射線部門システム」）。S1 のステージビューでは従来どおり 3 列になること
- [ ] T037 [US1] `ui/src/systems/ehr/CtBookingScreen.tsx` と `ui/src/systems/ehr/BookingDraftPanel.tsx` を作り、`ui/src/app/routes.tsx` に `/ehr/ct` を追加する（contracts/ui-screens.md「電子カルテ CT 予約」。この段階では直接予約の経路と共通部分を作る）：
  - `?doctor=dr-x|dr-y`（無い・不正なら `dr-x`）。`X-Demo-Client` は `dr-x` が `ehr-doctor`、`dr-y` が `ehr-doctor-y`。`useLiveData` の Subscription は `{ id: "ehr-ct-slots", criteria: "Slot?schedule=Schedule/ct-1", reason: "CT-1 号機の予約枠の通知" }`、`load` は `loadCtSlots`
  - 見出し「電子カルテ（医師 X）CT 予約」、`data-testid="ct-booking-mode"` に「予約方式：仮押さえを使う（期限 {slotHoldSeconds} 秒）」／「予約方式：直接予約する（デモ設定）」（`usePolicy()`）、「検体検査」（`/ehr?role=doctor`。医師 X のときだけ）と「入口へ」のリンク
  - 枠の一覧（日時は `formatSlotTime`、状態は `formatStatus("slot", …)` と押さえた人、版、「枠を選ぶ」`data-testid="slot-select-{slotId}"`）。「枠を選ぶ」は `BookingDraft` が無く、かつ（仮押さえを使う方式なら `free`／直接予約する方式なら常に）押せる。`policy` が未取得の間は押せない。一覧の行の変化は T025 の `useRowChanges(rows, diffSlotRows)` で示す
  - 予約欄（`booking-draft`）：選んだ枠と「版 {n}（W/"{n}"）をもとに予約します」（`booking-slot`）、患者（`booking-patient`。既定は `dr-x` → `demo-taro`、`dr-y` → `demo-hanako`）、検査内容（`booking-procedure`。既定 `CT-CHEST`）、方式が `direct` なら「予約を確定する」（`booking-confirm-direct`）→ `bookDirect`、「取りやめる」（`booking-cancel`）。成功は `booking-result` に「予約しました（オーダー番号 {番号}、{日時} {検査内容} {患者}）」。失敗は `live.setError(e, "予約")`。いずれも `BookingDraft` を破棄して一覧を取り直す。`demo.reset` で破棄する
- [ ] T038 [P] [US1] `ui/src/systems/ehr/EhrScreen.tsx` の見出しに「CT 予約」（`/ehr/ct?doctor=dr-x`）へのリンクを加える
- [ ] T039 [US1] `ui/src/systems/ris/RisScreen.tsx` を作り、`ui/src/app/routes.tsx` に `/ris` を追加する（contracts/ui-screens.md「放射線部門システム」）：`X-Demo-Client` は `ris`、Subscription は `ris-slots`（`Slot?schedule=Schedule/ct-1`）と `ris-tasks`（`Task?owner=Organization/rad-dept`）の 2 つ（T026）、`load` は `loadRisData`。予約枠のカレンダー（`ris-calendar`。日時・枠の状態と押さえた人・予約の患者名）で、`doubleBooked` の行を強調し「同じ枠に予約が 2 件あります」（`data-testid="ris-double-booking-{slotId}"`。色は `--c-warn`、エラーのアイコンは使わない）、`bookedButFree` の行に「枠は空きのまま」を併記する。予約・作業の一覧（`ris-orders`。予約日時・患者・検査内容・依頼医・オーダー番号・作業の状態「依頼済み `requested`・予約済み」。初期データの予約は「（初期データの予約）」）。受付・撮影の操作部品は置かない（D-34）。行の変化は `useRowChanges(rows, diffSlotRows)`
- [ ] T040 [US1] `ui/tests/e2e/pages.ts` に `selectSlot(page, slotId)`・`bookDirectOn(page)`・`holdOn(page)`・`confirmOn(page)` を追加し、`ui/tests/e2e/s3-slot-booking.spec.ts` を作って S3-1 のテストを書く（`PageBag` で `/control`・`/ehr/ct?doctor=dr-x`・`/ehr/ct?doctor=dr-y`・`/ris`・`/monitor` を別々のコンテキストで開く）：「S3-1 の準備」→ 両方の見出しが「予約方式：直接予約する（デモ設定）」→ 医師 X・医師 Y の順に `ct1-1000` の「枠を選ぶ」→ 両方の予約欄に「版 1」→ 医師 X「予約を確定する」→ 医師 Y「予約を確定する」→ どちらにもエラー表示が無く、両方の 10:00 の行が「空き」→ 放射線部門システムに `ris-double-booking-ct1-1000` とデモ 太郎・デモ 花子、「枠は空きのまま」→ 通信モニタに「医師 X」「医師 Y」の「POST Transaction（一括登録）」が 2 件、どちらも成功、詳細の `transaction-entries` に Slot の行が無い → 版の履歴で `Slot/ct1-1000` を選ぶと版 1 だけ

**Checkpoint**: S3-1 を 5 つのウィンドウで再現できる（MVP：事故の再現）

---

## Phase 4: User Story 2 - 仮押さえ → 確定なら先に押さえた人だけが予約できる（S3-2） (Priority: P1)

**Goal**: S3-2 の準備の後、後から仮押さえした医師 Y が 412 で拒否され「この枠は 医師 X が仮押さえ中です。別の枠を選んでください」と表示される。医師 X の確定で枠が「予約済み」になり、予約は 1 件だけ。同じ版への同時の仮押さえは必ず片方だけが成功する

**Independent Test**: quickstart.md §2.2 が期待どおりになる。`S3ScenarioIT` の同時の仮押さえ 100 回で、毎回ちょうど 1 つが 200・1 つが 412

### Tests for User Story 2

- [ ] T041 [P] [US2] `server/src/test/java/jp/example/demo/integration/S3ScenarioIT.java` に S3-2 のテストを追加する：(a) 順番：`reset()` → 両者が `select("ct1-1000")` で同じ ETag（`W/"1"`）→ 医師 X の `hold` が 200（`ETag: W/"2"`、`comment` が「仮押さえ：医師 X」）→ 医師 Y の `hold`（`W/"1"`）が 412 → `confirm`（`heldEtag = W/"2"`）が 200 → Slot が版 3 の `busy`、`comment` なし → `bookedAppointments("ct1-1000")` が 1、その患者が `demo-taro`。回数は `s3.repeat`（既定 20）。(b) 同時：2 つのスレッドが `CountDownLatch` で揃ってから同じ `If-Match: W/"1"` の `hold`（医師 X・医師 Y）を送り、ちょうど 1 つが 200・1 つが 412、Slot の `comment` が 200 を受けた側の名前であることを `Integer.getInteger("s3.repeat", 100)` 回（各回は `reset()` からやり直す）。(c) 取りやめ：`hold` → `release`（`W/"2"`）が 200 で版 3 の `free`・`comment` なし
- [ ] T042 [P] [US2] `ui/tests/unit/errors.test.ts` にテストを追加する：`slotHoldConflictError(latestSlot)` が、最新が `busy-tentative` で `comment` が「仮押さえ：医師 X」なら「この枠は 医師 X が仮押さえ中です。別の枠を選んでください」（`httpLabel` は「412 Precondition Failed」、`kind` は `conflict`）、`busy` なら「この枠は既に予約済みです。別の枠を選んでください」、それ以外（`free`）なら S1 の 412 の文言
- [ ] T043 [P] [US2] `ui/tests/unit/history.test.ts` にテストを追加する：Slot の版の履歴で `diffVersions` が `status` と `comment` の変化を返す（例：版 2 は `["status", "comment"]`）。Task の比べる項目（`status`・`businessStatus`・`owner`）は従来どおり

### Implementation for User Story 2

- [ ] T044 [US2] `ui/src/fhir/errors.ts` に `slotHoldConflictError(latest: Slot): DisplayError` を追加する（名前は `holderName(latest.comment)`。D-35 のとおり表示だけに使う）。T042 を通す
- [ ] T045 [US2] `ui/src/systems/ehr/BookingDraftPanel.tsx` と `ui/src/systems/ehr/CtBookingScreen.tsx` に仮押さえを使う方式を加える：方式が `hold` で未仮押さえなら「仮押さえする」（`booking-hold`）→ `holdSlot`。200 なら `reduceBookingDraft` で仮押さえ中にし、「確定までの残り {n} 秒」（`booking-remaining`。`remainingSeconds` を 1 秒ごとに再計算）、「確定する」（`booking-confirm`）→ `confirmBooking`、「取りやめる」（`booking-cancel`）→ `releaseSlot`。仮押さえが 412 なら `selectSlot` で最新を取り直して `slotHoldConflictError` をエラー欄に表示し、予約欄を閉じて一覧を取り直す（自動ではやり直さない。FR-012）。取り直しに失敗したら S1 の 412 の文言を表示する
- [ ] T046 [P] [US2] `ui/src/monitor/history.ts` の比べる項目を種別ごとにする（Task：`status`・`businessStatus`・`owner`、Slot：`status`・`comment`）。`ui/src/monitor/HistoryView.tsx` で Slot の列名を「状態・押さえた人」にし、Slot・Appointment の状態のラベル（`labels.ts` の `slot`・`appointment`）を使う。T043 を通す
- [ ] T047 [US2] `ui/tests/e2e/s3-slot-booking.spec.ts` に S3-2 のテストを追加する：「S3-2 の準備」→ 見出しが「予約方式：仮押さえを使う（期限 30 秒）」→ 医師 X・医師 Y の順に `ct1-1000` の「枠を選ぶ」→ 医師 X「仮押さえする」→ 全ウィンドウの 10:00 が「仮押さえ中（医師 X）」→ 医師 Y「仮押さえする」→ 医師 Y に「この枠は 医師 X が仮押さえ中です。別の枠を選んでください（412 Precondition Failed）」、予約欄が閉じる → 通信モニタに同じ `If-Match: W/"1"` の `PUT Slot/ct1-1000` が 2 件、後の 1 件が「412 他の利用者が先に更新済み」→ 医師 X「確定する」→ 「予約しました」、10:00 が「予約済み」、放射線部門システムに予約 1 件と作業（「依頼済み」「予約済み」）、二重予約の表示が無い → 通信モニタの最新の Transaction の注記が「一括登録・枠の版の確認あり」、`transaction-entries` に `ifMatch: W/"2"` → 版の履歴で `Slot/ct1-1000` が版 1 → 2（仮押さえ中・医師 X）→ 3（予約済み）。続けて「同時に仮押さえ」のテスト：準備 → 両者「枠を選ぶ」→ 2 つの「仮押さえする」を `Promise.all` で押し、片方のウィンドウにだけ 412 の文言が出て、10:00 の押さえた人が成功した側であることを `Number(process.env.S3_REPEAT ?? 5)` 回繰り返す。仮押さえの後に「取りやめる」で 10:00 が「空き」に戻ることも確かめる。予約済みの 9:00 の行（初期データの予約）では「枠を選ぶ」が押せないことも確かめる（仮押さえを使う方式。spec Edge Cases）

**Checkpoint**: S3-1 と S3-2 を続けて見せられる（講演の中心の対比）

---

## Phase 5: User Story 3 - 仮押さえを放置すると期限切れで枠が戻り、遅れた確定は全部取り消される（S3-3） (Priority: P2)

**Goal**: 仮押さえから設定秒数（既定 30 秒）が過ぎると、FHIR サーバーが枠を「空き」に戻し、通信モニタに送信元「FHIR サーバー（仮押さえの期限切れ）」として表示される。その後の確定は Transaction 全体が 412 になり、予約・依頼・作業はどれも登録されない

**Independent Test**: quickstart.md §2.3 が期待どおりになる。`S3ScenarioIT` で期限 1 秒の期限切れが 2 秒以内に反映され、期限切れと確定の競合で食い違いが残らない

### Tests for User Story 3

- [ ] T048 [P] [US3] `server/src/test/java/jp/example/demo/unit/SlotHoldExpiryTest.java` を作る（`InMemoryRepository`・`TrafficLog`・`DemoPolicy` を直接使い、時刻は差し替え可能な `Clock`、確認は `checkNow()` を手で呼ぶ）：仮押さえの版のコミットで保持が登録され、`deadline` は「`lastUpdated` + 仮押さえを受け付けた時点の `slotHoldSeconds`」。期限前の `checkNow()` では何もしない。期限後は Slot が新しい版の `free`・`comment` なしになり、`kind = "server"`・`client = "server-slot-expiry"`・`serverAction`（`action = "slot-hold-expired"`、`resource = "Slot/ct1-1000/_history/3"`、`before.status = "busy-tentative"`・`before.versionId = "2"`・`before.comment`、`after.status = "free"`・`after.versionId = "3"`、`holdSeconds`）の記録が 1 件増える。仮押さえの後に秒数を変えても、その仮押さえの期限は変わらない。期限前に確定（`busy`）・取りやめ（`free`）がコミットされると保持が消え、期限後も何もしない。`clear()`（初期化）の後は、期限を過ぎても何もしない。初期化後に同じ id・同じ版番号の仮押さえができても、初期化前の保持で書き換えない（`lastUpdated` の比較）
- [ ] T049 [P] [US3] `server/src/test/java/jp/example/demo/integration/S3ScenarioIT.java` に S3-3 のテストを追加する：(a) `putPolicy({"slotHoldSeconds": 1})` → `hold` → 2 秒以内（100 ms 間隔で確認）に Slot が `free` の版 3 になる（SC-005）→ `GET /demo/traffic` に `kind = "server"` の記録があり、その seq より後に Subscription の ping の記録（`ehr-ct-slots` に bind した接続がある場合）がある → `confirm`（`heldEtag = W/"2"`）が **412** で、OperationOutcome の `expression` が `Bundle.entry[0]` → `bookedAppointments("ct1-1000")` が 0、`Task?owner=Organization/rad-dept` が 0 件、`ServiceRequest?category=363679005` が 0 件。回数は `s3.repeat`（既定 20）。(b) 競合：`slotHoldSeconds = 1` で仮押さえし、期限の直前・直後（800〜1200 ms の範囲でずらす）に `confirm` を送り、結果が「200 かつ Slot が `busy` かつ予約 1 件」か「412 かつ Slot が `free` かつ予約 0 件」のどちらかであることを `s3.repeat` 回（既定 20）確かめる（FR-019）。(c) 初期化：仮押さえの後に `reset()` し、期限を過ぎても `kind = "server"` の記録が出ないこと（FR-004）。(d) 期限切れ直後の別の医師の仮押さえ：`slotHoldSeconds = 1` で医師 X が仮押さえ → 期限切れ → 医師 Y が最新の版（版 3）で `hold` が 200 → 医師 X の `confirm`（`heldEtag = W/"2"`）が 412 で、`bookedAppointments` が 0、Slot は医師 Y の `busy-tentative`（`comment` が「仮押さえ：医師 Y」）のまま
- [ ] T050 [P] [US3] `server/src/test/java/jp/example/demo/integration/TrafficMonitorIT.java` に、期限切れの記録が `/ws/monitor` の `traffic` メッセージとして `serverAction` 付きで配信されること、既存の種別（`http`・`notification`・`demo`）の記録の `serverAction` が `null` であることのテストを追加する
- [ ] T051 [P] [US3] `ui/tests/unit/errors.test.ts` に `slotHoldExpiredError()` が「仮押さえの期限が切れました。枠を選び直してください」（`httpLabel`「412 Precondition Failed」、`kind` は `conflict`）を返すテストを追加する。`ui/tests/unit/sequence.test.ts` に、`kind = "server"` の記録が `from = to = "server"`・注記「仮押さえの期限切れ Slot/ct1-1000（仮押さえ中 → 空き、版 2 → 3）」・操作者「FHIR サーバー（仮押さえの期限切れ）」の要素になるテストを追加する。`ui/tests/unit/history.test.ts` に、`findCause` が `serverAction.resource` が一致する `kind = "server"` の記録を返すテストを追加する

### Implementation for User Story 3

- [ ] T052 [US3] 通信記録に `kind = "server"` を加える：`server/src/main/java/jp/example/demo/traffic/TrafficRecord.java` の末尾に `ServerAction serverAction`（`record ServerAction(String action, String resource, Map<String, Object> before, Map<String, Object> after, int holdSeconds)`）を加え、`TrafficLog`（`notification`・`demoEvent`）、`TrafficCaptureFilter`、そのほかの `new TrafficRecord(` の呼び出し（3 箇所）に `null` を渡す。`TrafficLog` に `serverAction(long seq, ServerAction action)`（`kind = "server"`、`client = "server-slot-expiry"`）を加える。`ui/src/realtime/types.ts` は T016 で対応済み
- [ ] T053 [US3] `server/src/main/java/jp/example/demo/slot/SlotHoldExpiry.java` を作る（research.md R-05、data-model.md §5）：`InMemoryRepository.CommitListener` を実装し、`committed` で Slot の変更ごとに `busy-tentative` なら保持（`slotId`・`versionId`・`lastUpdated`・`deadline` = `lastUpdated` + `policy.slotHoldSeconds()`）を登録し、それ以外なら削除する。`checkNow()` は `clock.instant()` が `deadline` を過ぎた保持ごとに、`traffic.reserveSeq()` で seq を取ってから `repo.write` の中で「最新の `versionId` と `lastUpdated` が保持と同じで `busy-tentative`」のときだけ `status = free`・`comment` なしの版を書き込み、書き込んだらコミット後に `traffic.add(traffic.serverAction(seq, …))` を記録する（書き込まなかったら記録しない）。保持は書き込みの有無にかかわらず消す。`start()` で単一スレッドの `ScheduledExecutorService` から 250 ミリ秒ごとに `checkNow()` を呼び（例外はログに出して続ける）、`stop()` で止める。`clear()` で保持をすべて消す。T048 を通す
- [ ] T054 [US3] `SlotHoldExpiry` を配線する：`server/src/main/java/jp/example/demo/DemoServerMain.java` で生成して `start()` し、Jetty の `Server` の停止時に `stop()` されるようにする（`server.addEventListener` の `LifeCycle.Listener` で `lifeCycleStopping` に止める）。`server/src/main/java/jp/example/demo/demo/DemoControl.java` の `reset()` で、`repo.replaceAll` の直後に `expiry.clear()` を呼ぶ。T049・T050 を通す
- [ ] T055 [P] [US3] `ui/src/fhir/errors.ts` に `slotHoldExpiredError()` を追加する。`ui/src/systems/ehr/BookingDraftPanel.tsx`・`CtBookingScreen.tsx` で、確定が 412 なら `slotHoldExpiredError()` をエラー欄に表示し、予約欄を閉じて一覧を取り直す（自動ではやり直さない。FR-018）。取りやめが 412 ならエラーにせず `booking-result` に「仮押さえの期限が切れていました」と表示して閉じる。残り時間が 0 になったら「期限切れ（サーバーの処理を待っています）」と表示し、「確定する」は押せるままにする（data-model.md §7）。T051 の errors 部分を通す
- [ ] T056 [P] [US3] 通信モニタでサーバー内の処理を表示する：`ui/src/monitor/sequenceModel.ts` の `buildSequence` に `kind = "server"` の要素（`from = to = "server"`、注記「仮押さえの期限切れ {Slot/id}（{変更前の状態} → {変更後の状態}、版 {n} → {m}）」、操作者「FHIR サーバー（仮押さえの期限切れ）」）を加える。`ui/src/monitor/SequenceDiagram.tsx` で FHIR サーバーの列の中の閉じた矢印（自分自身に戻る矢印）として描く。`ui/src/monitor/TrafficDetail.tsx` に `data-testid="server-action-detail"` の欄（「サーバーの規則による自動の更新です（期限 {holdSeconds} 秒）」、変更前・変更後の状態・版・押さえた人）を加える。`ui/src/monitor/history.ts` の `findCause` で `kind = "server"` の記録（`serverAction.resource` が `{type}/{id}/_history/{versionId}` に一致）も返す。T051 の sequence・history 部分を通す
- [ ] T057 [US3] `ui/src/app/ControlPanel.tsx` に「仮押さえの期限」（`data-testid="policy-slot-hold-seconds"`）を加える：現在値の表示、10〜300 の数値入力と「変更」ボタン（`putPolicy({ slotHoldSeconds })`）。範囲外・整数でない値は送らずに「10〜300 秒で指定してください」を表示する。サーバーが 400 を返したら「設定を変更できません」を表示する。準備の実行中は押せない（FR-003）
- [ ] T058 [US3] `ui/tests/e2e/s3-slot-booking.spec.ts` に S3-3 のテストを追加する：「S3-3 の準備」→ テストの中で `PUT /demo/policy {"slotHoldSeconds": 2}` を送る（手順書の 30 秒は手で確認する。research.md R-12）→ 医師 X で `ct1-1000` を「枠を選ぶ」→「仮押さえする」→ 残り時間が表示される → 4 秒以内に全ウィンドウの 10:00 が「空き」、医師 X の予約欄は開いたまま「期限切れ（サーバーの処理を待っています）」→ 通信モニタに「FHIR サーバー（仮押さえの期限切れ）」の要素と `server-action-detail` → 医師 X「確定する」→「仮押さえの期限が切れました。枠を選び直してください（412 Precondition Failed）」、放射線部門システムの予約・作業の一覧に増えた行が無い → `transaction-entries` で entry 0 が失敗・ほかが取り消し、「一括送信の全体が取り消されました」→ 版の履歴で版 3 の作った通信が「FHIR サーバー（仮押さえの期限切れ）」。また、制御パネルで期限に 5 を入れると「10〜300 秒で指定してください」が出て送られないこと、60 に変えると医師 Y の見出しが「期限 60 秒」になること

**Checkpoint**: S3-1〜S3-3 のすべてを再現できる

---

## Phase 6: User Story 4 - 手順書に従って複数のウィンドウで S3 を実演する (Priority: P2)

**Goal**: 講演者・来場者が手順書だけを頼りに、ウィンドウを開くところから S3-1〜S3-3 を 10 分（解説込み）で実演できる

**Independent Test**: 開発に関わっていない人が docs/06-demo-procedures.md だけを見て S3-1〜S3-3 を実演し、各手順の期待結果が画面と一致する（SC-001・SC-009）

### Implementation for User Story 4

- [ ] T059 [P] [US4] `docs/06-demo-procedures.md` の S3 の節（T002 の骨子）を完成させる（research.md R-13 の構成。期待結果と話すことの列を埋める）：(1) 準備：起動、5 つのウィンドウの URL（`/control`・`/ehr/ct?doctor=dr-x`・`/ehr/ct?doctor=dr-y`・`/ris`・`/monitor`）と 1920×1080 での並べ方の例（上段に医師 X・医師 Y・放射線部門システム、下段に通信モニタ・デモ制御パネル）、入口の「S3 予約枠の取り合いで開くウィンドウ」からも開けること。(2) S3-1・S3-2・S3-3 のそれぞれ：表（# / 操作する画面 / 操作 / 画面の期待結果 / 通信モニタの期待結果 / 話すこと（業務上の意味・FHIR 上の意味））。期待結果は quickstart.md §2.1〜§2.3 と一致させ、版は実際の番号（`W/"1"` など。data-model.md §3.2）で書く。S3-3 は期限 30 秒の待ち時間に話す内容を置く。(3) 締めの解説：S2 の版の確認は 1 つのリソースを守る仕組みで、数に限りがある枠の取り合いには「仮押さえ → 確定」という手順が要ること、Transaction は全部成功か全部取り消しであること、If-None-Exist は「同じものを二重に作らない」仕組みで取り合いの拒否には使えないこと（D-40）、期限切れはサーバーの規則であり通信モニタに見えること（原則 III）。(4) うまくいかないとき：予約方式が違う・期限が切れてしまった・順序を間違えた → 準備ボタンを押し直す／初期化。(5) 所要時間の目安：S3 全体で解説込み 10 分（D-32）、S1・S2 と合わせた 30 分版の構成の例
- [ ] T060 [P] [US4] `ui/src/app/Launcher.tsx` の「個別のウィンドウで開く」に「電子カルテ CT 予約（医師 X）」「電子カルテ CT 予約（医師 Y）」「放射線部門システム」を加え、小見出し「S3 予約枠の取り合いで開くウィンドウ」の下に `/control`・`/ehr/ct?doctor=dr-x`・`/ehr/ct?doctor=dr-y`・`/ris`・`/monitor` へのリンクと「操作の手順は docs/06-demo-procedures.md を参照してください。」の 1 行を置く（contracts/ui-screens.md「ルート」）
- [ ] T061 [US4] `ui/tests/e2e/s3-slot-booking.spec.ts` に入口のテストを追加する：`/` に「S3 予約枠の取り合いで開くウィンドウ」と 5 つのリンクがあり、各リンクの先が開ける。S3 のウィンドウ（`/ehr/ct`・`/ris`・`/control`）に自習モードのガイドの強調（`data-guide-active` 属性）が無いこと（D-33）。初期化で開いているウィンドウが初期状態に戻り、予約方式が「仮押さえを使う」、期限が 30 秒に戻ること（US4 シナリオ 3）

**Checkpoint**: 手順書と画面がそろい、S3 を講演で実演できる

---

## Phase 7: Polish & Cross-Cutting Concerns

- [ ] T062 [P] `CLAUDE.md` を更新する：現在の実装範囲を「S1（検体検査）・S2（同時受付の排他制御）・S3（CT 予約枠の取り合い）」に、未実装を「S4・S5」に変える。S3 の要点（S3 はステージビューを使わず `/control`・`/ehr/ct?doctor=…`・`/ris`・`/monitor` と手順書 docs/06 で操作、`ehrUsesSlotHold` はサーバーの判定に使わないデモ設定、`slotHoldSeconds` と `SlotHoldExpiry` による期限切れは `kind = "server"` の通信記録になる、予約枠は初期化のたびに日本時間の翌日で生成し id は `ct1-HHmm`、If-None-Exist は使わない（D-40）、医師の検体検査の一覧は category で絞る）を「アーキテクチャ」に追記する。コマンド（`mvn verify -Dit.test=S3ScenarioIT -Ds3.repeat=100`、`S3_REPEAT=100 npx playwright test tests/e2e/s3-slot-booking.spec.ts`）を追記する
- [ ] T063 [P] `compose.yml` の `environment` に `SLOT_HOLD_SECONDS: "30"`（コメントで「仮押さえの期限の既定値（秒）。1〜300」）を加える
- [ ] T064 [P] `specs/001-lab-order-workflow/contracts/ui-screens.md` の「`X-Demo-Client` の値と Subscription」に、電子カルテ（医師）の依頼一覧は ServiceRequest の `category` が検体検査のものに絞る（specs/003 research R-08）旨を注記する
- [ ] T065 `ui/tests/e2e/offline.spec.ts` の対象（`/`・`/ehr`・`/lis`・`/monitor`・`/control` など）に `/ehr/ct?doctor=dr-x`・`/ehr/ct?doctor=dr-y`・`/ris` を加え、外部ネットワークへの通信が 0 件であることを確かめる（SC-007）。S3 の操作（準備 → 枠を選ぶ → 仮押さえ → 確定）を 1 回通した状態でも外部通信が 0 件であること
- [ ] T066 全体の回帰を実行する：UI をビルドして JAR を作り直し、`mvn verify -Ds1.repeat=20 -Ds2.repeat=100 -Ds3.repeat=100`、`npm test`、`npm run typecheck`、`npx playwright test`、`S3_REPEAT=100 npx playwright test tests/e2e/s3-slot-booking.spec.ts -g "同時に仮押さえ"` がすべて成功することを確認する
- [ ] T067 quickstart.md §2（手での確認。S3-3 は既定の 30 秒で）と §2.4（初期化・取りやめ・期限の入力・S1 の講演モードと S2・`docker run --network none`・UTC のコンテナでの日付）を実施し、`specs/003-ct-slot-booking/validation-results.md` に SC-001〜SC-009 の結果（SC-001 の所要時間、SC-002 の 100 回の結果、SC-003 の 20 回、SC-004・SC-005 の反映までの時間の計測、SC-006 の準備の時間、SC-007 のオフライン、SC-008 はアンケートを実施するか見送るか（理由つき）、SC-009 は試行の要否と結果）を specs/002 の validation-results.md と同じ形式で記録する

---

## Dependencies & Execution Order

### Phase Dependencies

- **Setup（Phase 1）**：依存なし
- **Foundational（Phase 2）**：Phase 1 の後。US1〜US4 のすべてを止める
- **US1（Phase 3）・US2（Phase 4）・US3（Phase 5）**：Phase 2 の後。互いに独立して確認できるが、`S3ScenarioIT.java`・`s3-slot-booking.spec.ts`・`CtBookingScreen.tsx`・`BookingDraftPanel.tsx`・`errors.ts`・`sequenceModel.ts` を共有するため、1 人で進めるなら US1 → US2 → US3 の順
- **US4（Phase 6）**：Phase 2 の後に着手できる。手順書（T059）の期待結果は US1〜US3 の画面に合わせるので、最終確認は US1〜US3 の後
- **Polish（Phase 7）**：すべてのストーリーの後

### User Story Dependencies

- **US1（P1）**：Phase 2 のみ
- **US2（P1）**：Phase 2 のみ。CT 予約画面（T037）を US1 で作るため、US2 を先に進める場合は T037 の共通部分（一覧・予約欄・方式の表示）を先に作る
- **US3（P2）**：Phase 2 のみ（サーバーの期限切れは独立）。画面の確定の 412（T055）は US2 の仮押さえ（T045）の後
- **US4（P2）**：Phase 2 のみ（文書の最終確認は US1〜US3 の後）

### Within Each User Story

- テストを先に書き、失敗することを確かめてから実装する
- 純粋関数（`summarizeTransaction`・`lanesFor`・`slotHoldConflictError`・`diffVersions`・`findCause`）→ 画面への組み込み → E2E の順
- UI を変えたら JAR を作り直してから E2E を実行する

### Parallel Opportunities

- Phase 2：T003・T005・T007・T009・T011・T013・T014・T015・T016・T017・T018・T020・T022・T024・T028 は互いに並行できる（別ファイル）。
  T004 は T003、T006 は T005、T008 は T006・T007、T010 は T004・T009、T012 は T011、T013 は T014、T019 は T014・T018、T021 は T019・T020、T023 は T022、T025 は T017・T024、T029 は T028、T030 は T016・T029 の後。T026・T027 は T016 の後
- US1：T031〜T033 のテストは並行。T035・T036・T038 は並行。T037 → T039 → T040 は順番（T039 は T026 の後）
- US2：T041〜T043 は並行。T046 は T044・T045 と並行
- US3：T048〜T051 は並行。T052 → T053 → T054 は順番。T055・T056 は並行。T057 は T030 の後
- US4：T059・T060 は並行
- Polish：T062・T063・T064 は並行

---

## Parallel Example: Phase 2

```bash
# サーバーのテストを並行して書く
Task: "T003 検索パラメータのテスト（server/src/test/java/jp/example/demo/unit/SearchMatcherTest.java）"
Task: "T005 予約枠の生成のテスト（server/src/test/java/jp/example/demo/unit/SlotSeedGeneratorTest.java）"
Task: "T009 FHIR API のテスト（server/src/test/java/jp/example/demo/integration/FhirApiContractIT.java）"
Task: "T011 ポリシーのテスト（server/src/test/java/jp/example/demo/integration/TrafficMonitorIT.java）"

# UI の純粋関数のテストを並行して書く
Task: "T018 CT 予約の組み立てのテスト（ui/tests/unit/ctBooking.test.ts）"
Task: "T022 予約中の枠のテスト（ui/tests/unit/bookingDraft.test.ts）"
Task: "T024 枠と予約の結合のテスト（ui/tests/unit/slots.test.ts）"
Task: "T028 準備のテスト（ui/tests/unit/prepare.test.ts）"
```

## Parallel Example: User Story 3

```bash
# テストを並行して書く
Task: "T048 期限切れの単体テスト（server/src/test/java/jp/example/demo/unit/SlotHoldExpiryTest.java）"
Task: "T049 S3-3 の結合テスト（server/src/test/java/jp/example/demo/integration/S3ScenarioIT.java）"
Task: "T050 期限切れの記録の配信（server/src/test/java/jp/example/demo/integration/TrafficMonitorIT.java）"
Task: "T051 文言・シーケンス図・版の履歴（ui/tests/unit/errors.test.ts、sequence.test.ts、history.test.ts）"

# 画面（予約欄）と通信モニタは別ファイルなので並行
Task: "T055 確定の 412 と残り時間（errors.ts、BookingDraftPanel.tsx、CtBookingScreen.tsx）"
Task: "T056 サーバー内の処理の表示（sequenceModel.ts、SequenceDiagram.tsx、TrafficDetail.tsx、history.ts）"
```

---

## Implementation Strategy

### MVP First (User Story 1 Only)

1. Phase 1・Phase 2 を終える（S1・S2 の回帰が緑のまま、予約枠の API・準備ボタン・CT 予約の組み立てが動く）
2. Phase 3（US1：S3-1 の二重予約）を終える
3. **止めて確認する**：quickstart.md §2.1 を 5 つのウィンドウで実演する
4. ここで見せられるのは「事故」だけなので、講演に使うには US2 まで進める

### Incremental Delivery

1. Phase 2 → 予約枠の API・初期データ・準備ボタン（S1 の医師の一覧に CT の依頼が混ざらない）
2. US1 → 二重予約の再現（MVP）
3. US2 → 仮押さえによる防止（講演の中心の対比が完成）
4. US3 → 期限切れと Transaction の全体の取り消し
5. US4 → 手順書と入口のリンク（講演・展示で使える状態。30 分版がそろう）
6. Polish → CLAUDE.md、compose.yml、検証結果

---

## Notes

- [P] = 別ファイルで、未完了のタスクに依存しない
- [Story] でタスクとユーザーストーリーを対応付ける
- 各タスクまたはまとまりごとにコミットする（コミットメッセージは既存の形式 `feat:` / `test:` / `docs:` に合わせる）
- 各チェックポイントで、そのストーリーを単独で確認できる
- S3 の画面には自習モードのガイド・進行パネルを足さない（D-33）。ステージビューの配置・S1 のシナリオ定義は変えない（FR-025）
- 予約の登録に If-None-Exist を付けない（D-40）。Slot の状態遷移の規則をサーバーに置かない（research.md R-01）
