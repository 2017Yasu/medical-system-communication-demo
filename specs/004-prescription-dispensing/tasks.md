---

description: "S4 処方調剤（外来・入院）の実装タスク"
---

# Tasks: S4 処方調剤（外来・入院）

**Input**: Design documents from `specs/004-prescription-dispensing/`

**Prerequisites**: [plan.md](plan.md)、[spec.md](spec.md)、[research.md](research.md)、[data-model.md](data-model.md)、[contracts/](contracts/)、[quickstart.md](quickstart.md)

**Tests**: 含める。constitution の開発ワークフロー（「各シナリオは MUST 自動結合テストでステップを再現」）と、SC-004（外来・入院を 20 回連続）・SC-007（コードが JP Terminology に含まれる）・
SC-008（S1〜S3 の回帰）が自動テストを要求しているため。テストは対応する実装より先に書き、失敗することを確認してから実装する。
ただしサーバーは S4 に固有の処理を持たない（Provider と検索パラメータの追加だけ）ので、`S4ScenarioIT` は Phase 2 の実装だけで通る想定である（通らなければ原因を直す）。

**Organization**: ユーザーストーリーごとにフェーズを分ける。US1（外来の手動操作）が MVP。US2（入院）は US1 の画面に入院の分を足す。
US3（講演モード）は US1・US2 の画面と操作を使ってシナリオとステージビューを作る。US4（自習モード）は US3 のシナリオ定義を使う。

## Format: `[ID] [P?] [Story] Description`

- **[P]**: 並行して実施できる（別ファイル、未完了タスクへの依存なし）
- **[Story]**: 対応するユーザーストーリー（US1〜US4）
- パスはリポジトリのルートからの相対パス

## Path Conventions

- サーバー（Java）：`server/src/main/java/jp/example/demo/`、テスト：`server/src/test/java/jp/example/demo/`
- UI（React + TypeScript）：`ui/src/`、テスト：`ui/tests/unit/`（Vitest）、`ui/tests/e2e/`（Playwright）
- コード上の識別子は英語、UI 文言・ドキュメントは日本語（constitution 開発ワークフロー）
- E2E は起動済みのサーバーに対して実行する。UI を変えたら UI をビルドして `server/src/main/resources/static/` にコピーし、`mvn -DskipTests package` で JAR を作り直す（CLAUDE.md）
- コード（HOT9・JAMI 用法・MERIT9）は FHIR マスタ `ui/src/master/fhir-master.json` に置き、UI とサーバーのテスト（`PharmacyFlow`・`JpPackageConsistencyTest`）が同じファイルを読む
- 日付（オーダー番号の `yyyymmdd`）は日本時間（`Asia/Tokyo`）で決める（`ui/src/fhir/builders/ctBooking.ts` の `nextCtOrderNumber` と同じ）

---

## Phase 1: Setup

**Purpose**: 変更前の状態が緑であることを確かめ、S4 で画面に出る既存の誤りを直す

- [ ] T001 変更前の基準を記録する：`server/` で `mvn verify`、`ui/` で `npm ci && npm test && npm run typecheck` を実行し、すべて成功することを確認する。`.cache/fhir-packages/` に JP のパッケージがあることを確認する（無ければ `scripts/fetch-jp-packages.sh`）。失敗があれば本機能の作業前に原因を報告する（`server/`、`ui/`）
- [ ] T002 `server/src/main/resources/seed/practitioner-dr-y.json` の `name[0].text` を「医師 X」から「医師 Y」に直す（S3 の初期データの誤り。research.md R-02）。`server/` で `mvn verify -Dit.test=S3ScenarioIT` が通ることを確認する

---

## Phase 2: Foundational (Blocking Prerequisites)

**Purpose**: すべてのストーリーが使う土台 —— MedicationRequest・MedicationDispense・Encounter・Location の API と検索パラメータ、初期データ、薬剤のマスタ、
表示ラベル、送信元の値、処方・受付・監査・お渡し・払出の組み立てと送信、一覧の取得と結合、シナリオの型の拡張

**⚠️ CRITICAL**: このフェーズが終わるまで US1〜US4 に着手しない

### サーバー：検索パラメータ（research.md R-01、contracts/fhir-api.md）

- [ ] T003 [P] `server/src/test/java/jp/example/demo/unit/SearchMatcherTest.java` にテストを追加する：MedicationRequest の `requester`（`Practitioner/dr-x`）・`subject`（`Patient/demo-taro`）・`encounter`（`Encounter/adm-saburo`）・`status`（`active`）、
  MedicationDispense の `prescription`（`authorizingPrescription` の `MedicationRequest/1`）・`subject`、Task の `encounter`（`Encounter/adm-saburo`。`encounter` の無い Task には一致しない）、
  Encounter の `patient`（`subject`）・`location`（`location[].location`。`Location/ward-surgery`）・`status`（`in-progress`）。カンマ区切りが OR になること（例：`encounter=Encounter/a,Encounter/adm-saburo`）。
  Location はパラメータ無しの全件検索に対応すること（`SearchParameters.supportsType("Location")`）
- [ ] T004 `server/src/main/java/jp/example/demo/fhir/search/SearchParameters.java` に T003 のパラメータを実装する（MedicationRequest・MedicationDispense・Encounter の定義を追加し、Task に `encounter` を加え、Location をパラメータ無しの種別に加える。参照は既存の `ref`・`refs` で `Type/id` に正規化する）。T003 を通す

### サーバー：初期データ（research.md R-02、data-model.md §1）

- [ ] T005 [P] 静的な初期データを追加する（`server/src/main/resources/seed/`、data-model.md §1 の表。すべて架空。既存の `organization-lab-dept.json`・`practitioner-ns-d.json`・`practitionerrole-ns-d.json`・`patient-demo-jiro.json` と同じ形）：
  `organization-pharmacy-dept.json`（`name` 薬剤部、`partOf` → `Organization/hospital`、JP_Organization）、
  `practitioner-ph-c.json`・`practitionerrole-ph-c.json`（薬剤師 C。PractitionerRole の `code` = `https://demo.example.jp/fhir/CodeSystem/staff-role#pharmacist`「薬剤師」、`text`「薬剤師」、`organization` → `Organization/hospital`）、
  `practitioner-ph-e.json`・`practitionerrole-ph-e.json`（薬剤師 E。同上）、
  `practitioner-ns-f.json`・`practitionerrole-ns-f.json`（看護師 F。`code` = `staff-role#nurse`「看護師」、`location` → `Location/ward-surgery`）、
  `location-ward-surgery.json`（`name` 外科病棟、`status = active`、`mode = instance`、`type` = `http://terminology.hl7.org/CodeSystem/v3-RoleCode#WARD`、`physicalType` = `http://terminology.hl7.org/CodeSystem/location-physical-type#wa`、`managingOrganization` → `Organization/hospital`、`meta.profile` = `http://jpfhir.jp/fhir/core/StructureDefinition/JP_Location`）、
  `patient-demo-saburo.json`（デモ 三郎、患者番号 `00000005`、男性、架空の生年月日、JP_Patient）、
  `encounter-adm-saburo.json`（`status = in-progress`、`class` = `http://terminology.hl7.org/CodeSystem/v3-ActCode#IMP`、`subject` → `Patient/demo-saburo`、`location[0]` = `{ location: { reference: "Location/ward-surgery", display: "外科病棟" }, status: "active" }`、
  `participant[0].individual` → `Practitioner/dr-y`、`serviceProvider` → `Organization/hospital`、**`period` を持たない**、`meta.profile` = `http://jpfhir.jp/fhir/core/StructureDefinition/JP_Encounter`）。
  `index.txt` に 10 ファイルを追記する。外来（デモ 太郎）には Encounter を作らない（D-44）
- [ ] T006 [P] `server/src/test/java/jp/example/demo/integration/FhirApiContractIT.java` にテストを追加する：`GET /fhir/Encounter/adm-saburo`・`/fhir/Location/ward-surgery`・`/fhir/Organization/pharmacy-dept`・`/fhir/PractitionerRole/ph-c` が 200。
  `GET /fhir/Encounter?location=Location/ward-surgery&status=in-progress` が 1 件。`GET /fhir/Practitioner/dr-y` の名前が「医師 Y」。
  `POST /fhir/MedicationRequest`（`status = active`）が 201 で `ETag: W/"1"`、`PUT /fhir/MedicationRequest/{id}`（`If-Match: W/"1"`、`status = completed`）が 200、同じ `If-Match: W/"1"` の 2 回目が 412。
  `POST /fhir/MedicationDispense` が 201、`GET /fhir/MedicationDispense?prescription=MedicationRequest/{id}` が 1 件。
  Encounter・Location への `PUT` が成功しない（4xx。読み取り専用）。`Task?encounter=Encounter/adm-saburo` を criteria に持つ Subscription の `PUT` が 201 で `active` になる。`POST /demo/reset` の後、MedicationRequest・MedicationDispense が 0 件に戻る
- [ ] T007 Provider を追加する：`server/src/main/java/jp/example/demo/fhir/provider/MedicationRequestProvider.java`・`MedicationDispenseProvider.java`（`AppointmentProvider` と同じく read・history・search・create・update）、
  `EncounterProvider.java`・`LocationProvider.java`（`ScheduleProvider` と同じく read・history・search だけ）。
  `server/src/main/java/jp/example/demo/fhir/ResourceWriter.java` の `WRITABLE` に `"MedicationRequest"`・`"MedicationDispense"` を加える（Encounter・Location は加えない）。
  `server/src/main/java/jp/example/demo/DemoServerMain.java` の `providers` に 4 つを登録する。T004・T005 の後に実施し、T006 を通す

### FHIR マスタとコードの確認（research.md R-03、data-model.md §2.1）

- [ ] T008 [P] `ui/src/master/fhir-master.json` に追加する（data-model.md §2.1）：
  `profiles` に `MedicationRequest`（`…/JP_MedicationRequest`）・`MedicationDispense`（`…/JP_MedicationDispense`）・`Encounter`・`Location`、
  `systems` に `hot9`（`http://medis.or.jp/CodeSystem/master-HOT9`）・`jamiUsage`（`http://jami.jp/CodeSystem/MedicationUsage`）・`jamiMethod`（`http://jami.jp/CodeSystem/MedicationMethodDetailUsage`）・
  `routeCodes`（`http://jpfhir.jp/fhir/core/CodeSystem/route-codes`）・`merit9Category`（`http://jpfhir.jp/fhir/core/CodeSystem/JP_MedicationCategoryMERIT9_CS`）・
  `merit9Unit`（`http://jpfhir.jp/fhir/core/mhlw/CodeSystem/MedicationUnitMERIT9Code`）・`strengthType`（`http://jpfhir.jp/fhir/core/mhlw/CodeSystem/MedicationIngredientStrengthStrengthType`）・
  `dispensePerformer`（`http://terminology.hl7.org/CodeSystem/medicationdispense-performer-function`）・`pharmBusinessStatus`（`https://demo.example.jp/fhir/CodeSystem/pharm-business-status`）・
  `rpNumber`（`http://jpfhir.jp/fhir/core/mhlw/IdSystem/Medication-RPGroupNumber`）・`orderInRp`（`http://jpfhir.jp/fhir/core/mhlw/IdSystem/MedicationAdministrationIndex`）、
  `medications` に 4 種（research.md R-03 の表：`amlodipine` `103299401` ノルバスク錠５ｍｇ・1 錠・`1011000400000000` 内服 １日１回 朝食後・1 日 1 回・14 日／`loxoprofen` `100988001` ロキソニン錠６０ｍｇ・1 錠・`1013044400000000` 内服 １日３回 朝昼夕食後・3 回・3 日／
  `rebamipide` `104528401` ムコスタ錠１００ｍｇ・1 錠・`1013044400000000`・3 回・3 日／`magnesium-oxide` `114778001` マグミット錠３３０ｍｇ・1 錠・`1012040400000000` 内服 １日２回 朝夕食後・2 回・7 日。
  各薬剤は `key`・`display`・`coding`（system + code + display）・`doseValue`・`doseUnit`（MERIT9 単位の coding：`TAB` 錠）・`usage`（JAMI の coding）・`usageText`（例：「内服・経口・１日１回朝食後」）・`timesPerDay`・`defaultDays`）、
  `prescriptionDefaults`（`dr-x` → `{ patientId: "demo-taro", medication: "amlodipine" }`、`dr-y` → `{ patientId: "demo-saburo", medication: "loxoprofen" }`）、
  `codings` に `categoryOutpatient`（OHP 外来処方）・`categoryInHospital`（OHI 院内処方）・`categoryInpatient`（IHP 入院処方）・`categoryTemporary`（XTR 臨時処方）・`routeOral`（PO 口）・`methodOral`（10 経口）・
  `strengthProduct`（1 製剤量）・`performerPackager`（packager）・`performerChecker`（checker）、`pharmBusinessStatuses`（`dispensing` 調剤中、`auditing` 監査中）。
  `_comment` に「HOT9・JAMI 用法・MERIT9 区分・単位は JP Terminology 2.2609.0 で確認済み（specs/004 research R-03）」を加える
- [ ] T009 [P] `server/src/test/java/jp/example/demo/jp/JpPackageConsistencyTest.java` の `codingsInSeedAndMasterExistInTheirCodeSystemsWhenThePackagesDefineThem` に、確認が空振りしていないことの表明を加える：
  `http://medis.or.jp/CodeSystem/master-HOT9` がちょうど 4 件、`http://jami.jp/CodeSystem/MedicationUsage`・`JP_MedicationCategoryMERIT9_CS`・`MedicationUnitMERIT9Code`・`route-codes`・`MedicationMethodDetailUsage` が `verifiedPerSystem` に含まれること。
  `masterProfilesExistInJpCore` の件数の下限を 12 にする。T005・T008 の後に実施し、`mvn test -Dtest=JpPackageConsistencyTest` が（パッケージがあれば）通ることを確認する

### UI：表示ラベル・送信元・通信モニタの列（contracts/ui-screens.md「表示ラベル」、contracts/websocket.md）

- [ ] T010 [P] `ui/tests/unit/labels.test.ts` にテストを追加し、`ui/src/fhir/labels.ts` を更新する：`StatusKind` に `"medicationRequest"`（ServiceRequest と同じラベル：`formatStatus("medicationRequest", "active")` が「有効（依頼中） active」）を加える。
  `dispenseLabel(md)` が `destination` ありなら「払出済み」、`receiver` ありなら「お渡し済み」。`pharmBusinessStatusLabel("dispensing")` が「調剤中」、`"auditing"` が「監査中」（FHIR マスタの `pharmBusinessStatuses` から）。
  `prescriptionKind(mr)` が `category` に `IHP` があれば `"inpatient"`、それ以外は `"outpatient"`。`categoryLabel(mr)` が「外来処方・院内処方」「入院処方・臨時処方」（MERIT9 の `display` を「・」でつなぐ）
- [ ] T011 [P] `ui/tests/unit/sequence.test.ts` にテストを追加し、通信モニタを更新する：`ui/src/fhir/client.ts` の `ClientId` に `"ehr-nurse-f"`・`"pharmacy"`・`"pharmacy-ph-c"`・`"pharmacy-ph-e"` を加える。
  `ui/src/monitor/sequenceModel.ts` の `Lane` に `"pharmacy"`、`laneOf` で `pharmacy` と `pharmacy-` で始まる送信元を `"pharmacy"` に、`NAMES` に `ehr-nurse-f` 看護師 F・`pharmacy` 薬剤部門システム・`pharmacy-ph-c` 薬剤師 C・`pharmacy-ph-e` 薬剤師 E を加え、
  `lanesFor` が記録に薬剤部門システムがあるときだけ `pharmacy` の列を含めること（検体検査・放射線の列の既存の判定は変えない）。`ui/src/monitor/SequenceDiagram.tsx` の列の見出しと位置に「薬剤部門システム」を加える。既存の S1〜S3 のテストが通ること

### UI：処方・受付・監査・お渡し・払出の組み立て（research.md R-04、data-model.md §2、contracts/fhir-api.md）

- [ ] T012 [P] `ui/tests/unit/prescriptionBuilders.test.ts` を作る：
  `buildPrescriptionTransaction({ doctor: "dr-x", patientId: "demo-taro", encounterId: null, medicationKey: "amlodipine", doseValue: 1, days: 14, orderNumber, now })` の entry が `POST MedicationRequest`（fullUrl `urn:uuid:…`）・`POST Task` の 2 件。
  MedicationRequest は `status = active`・`intent = order`・`category` が OHP と OHI の 2 つの CodeableConcept・`medicationCodeableConcept` が HOT9 `103299401`・`subject` → `Patient/demo-taro`・`requester` → `Practitioner/dr-x`・`encounter` なし・
  `identifier` が Rp 番号 `1`・Rp 内の順番 `1`・オーダー番号（`https://demo.example.jp/fhir/sid/order-number`）の 3 件・`dosageInstruction[0]` の `timing.code` が JAMI `1011000400000000`・`route` が PO・`method` が 10・`doseAndRate[0].doseQuantity` が 1 `TAB`・
  拡張 `http://jpfhir.jp/fhir/core/Extension/StructureDefinition/JP_MedicationDosage_UsageDuration` が 14 `d`・`dispenseRequest.quantity` が **14**（1 × 1 × 14）`TAB`・`expectedSupplyDuration` が 14 `d`・`meta.profile` が JP_MedicationRequest。
  Task は `status = requested`・`intent = order`・`code` = fulfill・`focus` → MedicationRequest の `urn:uuid`・`for` → 患者・`requester` → `Practitioner/dr-x`・`owner` → `Organization/pharmacy-dept`・**`businessStatus` なし**・`encounter` なし。
  入院（`doctor: "dr-y"`、`patientId: "demo-saburo"`、`encounterId: "adm-saburo"`、`loxoprofen`、3 日）では `category` が IHP と XTR、MedicationRequest と Task の両方に `encounter` → `Encounter/adm-saburo`、数量が **9**（1 × 3 × 3）。
  `buildAcceptPatch("ph-c", now)` が `replace /status in-progress`・`add /businessStatus`（`pharm-business-status#dispensing`「調剤中」、`text` 調剤中）・`replace /owner PractitionerRole/ph-c`・`add /lastModified` の 4 操作。
  `buildAuditPatch("ph-e", now)` が `/status` を含まず、`businessStatus` を `auditing`「監査中」、`owner` を `PractitionerRole/ph-e` にする。
  `buildHandOverTransaction({ mr, mrEtag: 'W/"1"', task, taskEtag: 'W/"3"', packager: "ph-c", checker: "ph-e", now })` の entry が `POST MedicationDispense`・`PUT Task/{id}`（`ifMatch: W/"3"`）・`PUT MedicationRequest/{id}`（`ifMatch: W/"1"`、`status = completed`）の 3 件。
  MedicationDispense は `status = completed`・`performer` が `packager` → `PractitionerRole/ph-c` と `checker` → `PractitionerRole/ph-e`・`authorizingPrescription` → `MedicationRequest/{id}`・`quantity`・`daysSupply` が処方と同じ・`whenHandedOver` = now・`receiver` → 患者・`destination` なし・`context` なし・
  `identifier` が Rp 番号・Rp 内の順番・`meta.profile` が JP_MedicationDispense。Task は `status = completed`・`businessStatus` を持たない・`owner` 変えず・`output[0]` が `{ type: { text: "調剤の記録" }, valueReference: MedicationDispense の urn:uuid }`。
  `buildWardDispenseTransaction({ … })` の entry が **2 件**（MedicationRequest の PUT が無い）、MedicationDispense は `destination` → `Location/ward-surgery`・`context` → `Encounter/adm-saburo`・`receiver` なし。
  **どのエントリにも `ifNoneExist` が無い**。`nextPrescriptionOrderNumber(new Date("2026-10-08T16:00:00Z"), 0)` が `P-20261009-0001`（日本時間の日付）
- [ ] T013 `ui/src/fhir/builders/prescription.ts` を作り、T012 の関数を実装する（`ui/src/fhir/builders/labOrder.ts` の `post`・`put` と同じ形、コードは FHIR マスタから読む、日付は `ctBooking.ts` と同じく日本時間）。
  `PHARMACY_DEPT = "Organization/pharmacy-dept"`、`WARD_LOCATION = "Location/ward-surgery"`、`PHARMACISTS = { "ph-c": "薬剤師 C", "ph-e": "薬剤師 E" }`、`PRESCRIBERS = { "dr-x": "医師 X", "dr-y": "医師 Y" }` を export する。T012 を通す
- [ ] T014 [P] `ui/tests/unit/prescriptionActions.test.ts` を作る（`fetch` を差し替えた `FhirClient`。`ui/tests/unit/ctActions.test.ts` の書き方に合わせる）：
  純粋関数 `dispenserOf(history)` が、版の履歴（新しい順・古い順のどちらでも）のうち `businessStatus` が `dispensing` だった**最後の版**の `owner` の id（`ph-c`）を返し、無ければ null を返す。
  `placePrescription(client, "dr-x", { patientId, medicationKey, doseValue, days })` が `MedicationRequest?requester=Practitioner/dr-x` の件数でオーダー番号を採番し、`Encounter?patient=Patient/{id}&status=in-progress` の結果で外来・入院を決めて Transaction を送る。
  `acceptPrescription(client, row, "ph-c")`・`startAudit(client, row, "ph-e")` が**一覧の行の ETag** を If-Match に付けた `PATCH /fhir/Task/{id}` を送る（受付は 1 回の操作。research.md R-04）。
  `handOver(client, row, "ph-e")` が `GET /fhir/Task/{id}/_history` → Transaction（3 件）の順に送り、調剤者を履歴から決める。`dispenseToWard(client, row, "ph-e")` が同じ順で 2 件の Transaction を送る。
  履歴に調剤中の版が無いときは要求を送らずに「調剤した薬剤師が分かりません（作業の版の履歴に調剤中の記録がありません）」のエラーにする
- [ ] T015 `ui/src/fhir/prescriptionActions.ts` を作り、T014 の関数と `fetchLatestPrescription(client, doctorRef)`（その医師の最新の MedicationRequest と、`Task?focus=MedicationRequest/{id}` の作業）を実装する（画面とシナリオの自動実行が共有する。`labActions.ts` と同じ位置付け）。
  版の履歴は既存の `FhirClient.history<T>(type, id)`（`ui/src/fhir/client.ts`）で取得する。T013 の後に実施し、T014 を通す

### UI：一覧の取得と結合（research.md R-05・R-06、contracts/ui-screens.md）

- [ ] T016 [P] `ui/tests/unit/prescriptions.test.ts` を作る：純粋関数 `joinPrescriptions(mrs, tasks, dispenses, patients, encounters)` が MedicationRequest を起点に、`focus` で作業、`authorizingPrescription` で調剤の記録、`subject` で患者名、`encounter` で病棟名（Encounter の `location[0].location.display`）を結び付けた行を新しい順に返すこと。
  作業の無い処方・調剤の記録の無い処方も行になること。`diffPrescriptionRows(prev, next)` が状態・業務上の状態・担当・お渡し／払出の有無が変わった行を `rowChanges` と同じ形で返し、`prev` が null なら空を返すこと。
  定数 `PHARMACY_OWNERS` が `"Organization/pharmacy-dept,PractitionerRole/ph-c,PractitionerRole/ph-e"`、`WARD_ENCOUNTERS` が `"Encounter/adm-saburo"` であること
- [ ] T017 `ui/src/systems/shared/prescriptions.ts` を作る：T016 の関数・定数と、取得の関数
  `loadDoctorPrescriptions(client, doctor)`（`MedicationRequest?requester=Practitioner/{doctor}`、`Task?requester=…`、`MedicationDispense`（全件）、患者、Encounter（全件）を並行に取得）、
  `loadWardPrescriptions(client)`（`Encounter?location=Location/ward-surgery&status=in-progress` → その id で `MedicationRequest?encounter=…`・`Task?encounter=…`・`MedicationDispense?prescription=…`、患者）、
  `loadPharmacyPrescriptions(client)`（`Task?owner=PHARMACY_OWNERS`、MedicationRequest（全件。作業の `focus` で絞る）、患者、Encounter（全件））。
  `ui/src/systems/shared/rowChanges.ts` の `useRowChanges` に比べる関数として `diffPrescriptionRows` を渡せること（S3 で広げた引数を使う）。T016 を通す

### UI：エラーとシナリオの型（contracts/ui-screens.md「エラーの操作名」、data-model.md §4.1）

- [ ] T018 [P] `ui/tests/unit/errors.test.ts` にテストを追加し、`ui/src/fhir/errors.ts` に `dispenseConflictError(operation: "お渡し" | "払出")` を加える：412 の文言「他の利用者が先に更新しました。最新の状態を表示します」に「{操作}は取り消されました。調剤の記録は登録されていません」を併記する。
  `toDisplayError({ status: 422, … }, "お渡し")` が「この状態からはお渡しできません」になること（既存の規則のまま）
- [ ] T019 シナリオの型を広げる（data-model.md §4.1）：`ui/src/scenario/types.ts` の `ScenarioId` に `"s4-outpatient"`・`"s4-inpatient"`、`ScenarioClient` に `"ehr-doctor-y"`・`"ehr-nurse-f"`・`"pharmacy"`・`"pharmacy-ph-c"`・`"pharmacy-ph-e"`、
  `ScenarioState` に `medicationRequest?: string`・`medicationDispense?: "none" | "completed"`、`target.screen` に `"pharmacy"`、`target.role` に `"dr-x" | "dr-y" | "ns-f"`、`target.pharmacist?: "ph-c" | "ph-e"`、
  `Scenario` に `stage?: "lab" | "pharmacy"`・`loadState?: (client: FhirClient) => Promise<ScenarioState>`・`fastForward?: { to: number; label: string }` を加える。
  `ui/src/scenario/progress.ts` の `matchesData` で `medicationRequest`・`medicationDispense` を比べる（未指定なら比べない）。
  `ui/src/scenario/runner.ts` の `RunnerDeps.loadState` を `(scenario: Scenario) => Promise<ScenarioState>` にし、`ui/src/scenario/ScenarioProvider.tsx` で `(scenario.loadState ?? loadScenarioState)(monitor)` を渡す。
  `ScenarioProvider` の `clients` に新しい 5 つの `FhirClient` を加える。`ui/tests/unit/scenarioRunner.test.ts`（`loadState` の引数）と `progress` のテストを合わせ、S1 の振る舞いが変わらないこと（`npm test` が通る）

**Checkpoint**: サーバーで処方・調剤の API と初期データが使え、UI に処方の組み立て・送信・一覧の取得がそろう。S1〜S3 のテストは緑のまま

---

## Phase 3: User Story 1 - 外来の処方 → 調剤 → 監査 → お渡しを通しで実演する (Priority: P1) 🎯 MVP

**Goal**: 電子カルテ（医師 X）と薬剤部門システム（薬剤師 C・E）を画面で操作し、デモ 太郎への処方からお渡し済みの確認までを通しで実演できる

**Independent Test**: 初期化した状態から個別ウィンドウ（`/ehr/rx?role=dr-x`、`/pharmacy`、`/monitor`）で外来の 6 ステップを操作し、各ステップ後に両画面で処方・作業・調剤の記録の状態が data-model.md §3.1 のとおりに表示されること（quickstart.md §4）

### Tests for User Story 1

- [ ] T020 [P] [US1] `server/src/test/java/jp/example/demo/integration/PharmacyFlow.java` を作る（`LabFlow`・`SlotFlow` と同じ形。FHIR マスタからコードを読み、UI の `builders/prescription.ts` と同じ要求を組み立てる）：
  `prescribe(String client, String doctor, String patientId, String encounterIdOrNull, String medicationKey)`（Transaction。MedicationRequest と Task の id を返す）、
  `accept(String client, String taskId, String pharmacist, String etag)`・`startAudit(…)`（PATCH）、`dispenserFromHistory(String client, String taskId)`（`GET Task/{id}/_history` から `dispensing` の最後の版の owner）、
  `handOver(String client, String mrId, String mrEtag, String taskId, String taskEtag, String packager, String checker)`（3 件の Transaction）、`dispenseToWard(…)`（2 件の Transaction）、
  `dispenses(String mrId)`（`MedicationDispense?prescription=MedicationRequest/{id}` の件数）。どれも `HttpResponse<String>` を返し、`X-Demo-Client` を付ける
- [ ] T021 [P] [US1] `server/src/test/java/jp/example/demo/integration/S4ScenarioIT.java` を作り、外来のテストを書く（`-Ds4.repeat`、既定 20 回。各回の始めに `/demo/reset`）：
  処方（`ehr-doctor`）→ 処方 `active`・作業 `requested`・`owner` 薬剤部、受付（`pharmacy-ph-c`）→ `in-progress`・`dispensing`・`PractitionerRole/ph-c`、監査（`pharmacy-ph-e`）→ `auditing`・`PractitionerRole/ph-e`、
  履歴から調剤者が `ph-c`、お渡し（`pharmacy-ph-e`）→ 処方 `completed`（版 2）・作業 `completed`（`businessStatus` なし・`output` → `MedicationDispense/{id}`）・調剤の記録がちょうど 1 件（`performer` が `packager` = ph-c と `checker` = ph-e、`receiver` = `Patient/demo-taro`、`destination` なし）。
  加えて：(a) お渡しの直前に処方を別の要求で更新しておくと、お渡しの Transaction が **412** で、調剤の記録が 0 件・作業は監査中のまま（全体の取り消し）。
  (b) お渡しの後、最新の版を指定してもう一度お渡しすると **422**、調剤の記録は 1 件のまま。
  (c) `/demo/traffic` で、MedicationRequest を版 2 にした Transaction の記録の `client` が `pharmacy-ph-e` であること（US1 AS7）。
  (d) 検体検査の画面の条件（`Task?owner=Organization/lab-dept,PractitionerRole/tech-a,PractitionerRole/tech-b`）に処方の作業が一致しないこと（FR-009）。
  (e) `pharmacy-dept`（`Task?owner=…薬剤部…`）・`ehr-rx-dr-x`（`Task?requester=Practitioner/dr-x`）の Subscription に bind した WebSocket に、処方・受付・監査・お渡しのたびに ping が届くこと
  (f) 取りこぼし 0 件（SC-006）：各回の始め（`/demo/reset` の直後）に `/demo/traffic` の最大 `seq` を控え、外来の 6 ステップ分の操作を終えた後で、テストが送った `/fhir` の要求（Subscription の登録・版の履歴の取得を含む）の件数が、`kind = "http"` かつ `seq` が控えより大きい記録の件数と一致すること。`seq` に重複が無く、記録を `seq` 順に並べて数えること（`seq` は要求の受信時に採番されるため）
- [ ] T022 [P] [US1] `ui/tests/unit/pharmacyRules.test.ts` を作る：純粋関数 `pharmacyActions(row, me)` が data-model.md §3.2 の表のとおりに、行の状態と操作する薬剤師から「表示する操作」「押せるか」「押せない理由」を返すこと：
  `requested` → 受付・調剤開始（押せる）。`in-progress`/`dispensing`・`owner` = 自分 → 監査を開始（押せない、「調剤した薬剤師とは別の薬剤師が監査します（薬剤師 E に切り替えてください）」）。`owner` ≠ 自分 → 押せる。
  `in-progress`/`auditing`・`owner` = 自分 → 外来は「監査を終えてお渡し」、入院は「監査を終えて払出」（押せる）。`owner` ≠ 自分 → 押せない、「監査を始めた薬剤師（薬剤師 E）が操作します」。
  `requested` の行に「監査を開始」を出さない。`completed` → 操作なし

### Implementation for User Story 1

- [ ] T023 [US1] `ui/src/systems/pharmacy/pharmacyRules.ts` を作り、`pharmacyActions` を実装する（理由の文言の薬剤師の名前は `PHARMACISTS` から。切り替え先は「調剤した薬剤師ではないほう」）。T022 を通す
- [ ] T024 [US1] 電子カルテの処方画面を作る（contracts/ui-screens.md「電子カルテ 処方」）：
  `ui/src/systems/ehr/PrescriptionForm.tsx`（患者 `data-guide="rx-patient"`・薬剤 `data-guide="rx-drug"`（表示名と HOT9 を併記）・1 回量と日数（変更可）・用法（表示のみ、JAMI コードを併記）・数量（表示のみ）・区分（患者に入院中の Encounter があるかで決まる表示。変更不可）・「処方する」`data-guide="rx-submit"`。既定値は `prescriptionDefaults`）、
  `ui/src/systems/ehr/PrescriptionScreen.tsx`（`/ehr/rx?role=dr-x|dr-y|ns-f`。props `role?`・`embedded?`。医師の役割では `useLiveData`（`clientId`：dr-x は `ehr-doctor`、dr-y は `ehr-doctor-y`、Subscription `ehr-rx-dr-x` / `ehr-rx-dr-y`、criteria `Task?requester=Practitioner/{dr}`、`load` は `loadDoctorPrescriptions`）で
  処方の一覧（`data-testid="rx-list"`、行 `data-testid="rx-row-{id}"`、列はオーダー番号・患者・薬剤と用法・区分・処方・作業（業務上の状態を併記）・担当・お渡し／払出）を表示し、`useRowChanges` で変化を示す。
  見出し「電子カルテ（医師 X）処方」、医師 X のときだけ「検体検査」（`/ehr?role=doctor`）へのリンク。`ns-f` は T032 で作るまで「準備中」を表示）。
  処方の失敗は `ErrorBanner` に表示して取り直す（自動でやり直さない）
- [ ] T025 [US1] 薬剤部門システムを作る（contracts/ui-screens.md「薬剤部門システム」）：`ui/src/systems/pharmacy/PharmacyScreen.tsx`（`/pharmacy?pharmacist=ph-c|ph-e`。props `embedded?`・`pharmacist?`・`onPharmacistChange?`（ステージビューから制御するとき。無ければ URL の値を初期値にした画面内の状態））。
  `useLiveData`（`clientId: "pharmacy"`、Subscription `pharmacy-dept`、criteria `Task?owner=${PHARMACY_OWNERS}`、`load` は `loadPharmacyPrescriptions`）で一覧（`data-testid="pharmacy-list"`）を表示する。
  操作は薬剤師ごとの `FhirClient`（`pharmacy-ph-c`・`pharmacy-ph-e`）で送る。薬剤師の切り替えボタン「薬剤師 C」「薬剤師 E」（`aria-pressed`、**選択中のボタンは `disabled`**、`data-guide="pharmacist-ph-c"`・`data-guide="pharmacist-ph-e"` を**文字列のまま**書く）。
  行の操作は `pharmacyActions` に従い、「受付・調剤開始」`data-guide={\`rx-accept-${id}\`}`・「監査を開始」`rx-audit-${id}`・「監査を終えてお渡し」`rx-handover-${id}`、押せない理由を `data-testid="rx-hint-{id}"` に出す。
  412 は `dispenseConflictError`（お渡し）・既存の 412 表示（受付・監査）で示して取り直す。`demo.reset` を受けたら薬剤師 C に戻す（`monitorSocket.subscribe`。`LisScreen` の受付中の破棄と同じ書き方）
- [ ] T026 [US1] 画面の入口をつなぐ：`ui/src/app/routes.tsx` に `/ehr/rx`（`PrescriptionScreen`）・`/pharmacy`（`PharmacyScreen`）を加える。`ui/src/systems/ehr/EhrScreen.tsx` の見出しに「処方」（`/ehr/rx?role=dr-x`）へのリンクを加える。
  `ui/src/app/Launcher.tsx` の「個別のウィンドウで開く」に「電子カルテ 処方（医師 X）」（`/ehr/rx?role=dr-x`）・「薬剤部門システム」（`/pharmacy`）を加える
- [ ] T027 [P] [US1] 版の履歴の表示を更新する：`ui/src/monitor/HistoryView.tsx` の `KIND` に `MedicationRequest: "medicationRequest"` を加え、MedicationDispense の状態は `dispenseLabel` で表示する。`ui/tests/unit/history.test.ts` に、MedicationRequest の版 1 → 版 2（`active` → `completed`）の違いが「処方の状態」として出ることのテストを加える
- [ ] T028 [US1] E2E を作る：`ui/tests/e2e/pages.ts` に処方（患者・薬剤を選んで「処方する」）・薬剤部門システム（薬剤師の切り替え、行の操作）の共通操作を加え、`ui/tests/e2e/s4-prescription.spec.ts` に
  「外来：個別ウィンドウで処方からお渡しまで」（`/ehr/rx?role=dr-x` と `/pharmacy` の 2 ページ。各操作の後に両ページの行が data-model.md §3.1 の状態になること。薬剤師 C のまま「監査を開始」が押せず理由が出ること、
  薬剤師 C に戻すと「監査を終えてお渡し」が押せないこと。最後に医師 X の行が「完了」「完了」「お渡し済み」）と、「検体検査の画面に処方が混ざらない」（`/lis?tech=tech-a` と `/ehr?role=doctor` の一覧に処方が出ない）を書く。
  UI をビルドして JAR を作り直してから実行する

**Checkpoint**: 外来の処方からお渡し済みの確認までを個別ウィンドウで実演できる（MVP）。`mvn verify -Dit.test=S4ScenarioIT` の外来と、E2E の外来が緑

---

## Phase 4: User Story 2 - 入院の臨時処方 → 病棟への払出（S4-a） (Priority: P2)

**Goal**: 医師 Y がデモ 三郎に臨時処方し、外来と同じ手順で調剤・監査を経て病棟へ払い出す。作業は完了しても処方は有効のまま残り、看護師 F の画面に払出済みが表示される

**Independent Test**: 初期化した状態から `/ehr/rx?role=dr-y`・`/pharmacy`・`/ehr/rx?role=ns-f`・`/monitor` で入院の流れを操作し、払出の後に作業「完了」・処方「有効（依頼中）」・看護師 F の画面に「払出済み」と表示されること。通信モニタの払出の中身の表に PUT MedicationRequest が無いこと（quickstart.md §3）

### Tests for User Story 2

- [ ] T029 [P] [US2] `server/src/test/java/jp/example/demo/integration/S4ScenarioIT.java` に入院のテストを加える（`-Ds4.repeat`、既定 20 回）：処方（`ehr-doctor-y`、`encounter` = `adm-saburo`）→ 受付 → 監査 → 払出（`pharmacy-ph-e`、2 件の Transaction）で、
  処方が **`active`・版 1 のまま**、作業 `completed`、調剤の記録がちょうど 1 件（`destination` = `Location/ward-surgery`、`context` = `Encounter/adm-saburo`、`receiver` なし、`performer` は外来と同じ）。
  Transaction の応答のエントリが 2 件であること。`ehr-ward-surgery`（`Task?encounter=Encounter/adm-saburo`）と `ehr-rx-dr-y` に bind した WebSocket に、処方・受付・監査・払出のたびに ping が届き、
  同じ回の外来の操作（デモ 太郎の処方）では `ehr-ward-surgery` に ping が届かないこと
  (d) 取りこぼし 0 件（SC-006）：外来の (f) と同じ確認を入院の操作に対して行う
- [ ] T030 [P] [US2] `ui/tests/unit/prescriptions.test.ts` に純粋関数 `progressText(row)` のテストを加える：調剤の記録が無く作業が `requested` →「薬剤部で受付待ち」、`dispensing` →「薬剤部で調剤中」、`auditing` →「薬剤部で監査中」、
  外来で調剤の記録あり →「お渡し済み {時刻}」、入院で調剤の記録あり・処方 `active` →「払出済み {時刻}・投与中」（時刻は日本時間の `HH:mm`）

### Implementation for User Story 2

- [ ] T031 [US2] `ui/src/systems/shared/prescriptions.ts` に `progressText` を実装し（T030 を通す）、医師の処方一覧の「お渡し・払出」の列に使う。`PrescriptionForm.tsx` で、入院中の患者を選んだときの区分の表示を「入院処方・臨時処方（外科病棟）」にする（病棟名は Encounter の `location[0].location.display`）
- [ ] T032 [US2] 看護師 F の画面を作る：`ui/src/systems/ehr/WardView.tsx`（`useLiveData`：`clientId: "ehr-nurse-f"`、Subscription `ehr-ward-surgery`、criteria `Task?encounter=${WARD_ENCOUNTERS}`、`load` は `loadWardPrescriptions`）。
  見出し「電子カルテ（看護師 F）外科病棟」、一覧 `data-testid="ward-list"`（患者・薬剤・用法・処方の状態・作業の状態・払出（`progressText`））、払出済みの行に「病棟に届いています（処方は投与中のため有効のままです）」。操作のボタンは置かない（D-48）。
  `PrescriptionScreen.tsx` の `ns-f` で `WardView` を表示する
- [ ] T033 [US2] `ui/src/systems/pharmacy/PharmacyScreen.tsx` に入院の分を加える：区分の列に「入院（外科病棟）」、監査中の入院の行に「監査を終えて払出」（`data-guide={\`rx-ward-dispense-${id}\`}`、`dispenseToWard` を呼ぶ。412 は `dispenseConflictError("払出")`）
- [ ] T034 [US2] `ui/src/app/Launcher.tsx` の「個別のウィンドウで開く」に「電子カルテ 処方（医師 Y）」（`/ehr/rx?role=dr-y`）・「電子カルテ 病棟（看護師 F）」（`/ehr/rx?role=ns-f`）を加える
- [ ] T035 [US2] `ui/tests/e2e/s4-prescription.spec.ts` に「入院：個別ウィンドウで処方から払出まで」を加える（`/ehr/rx?role=dr-y`・`/pharmacy`・`/ehr/rx?role=ns-f`・`/monitor` の 4 ページ）：
  薬剤部門システムの行に「入院（外科病棟）」、払出の後に看護師 F の行が「払出済み」・処方「有効（依頼中）」・作業「完了」、医師 Y の行が「払出済み・投与中」。
  通信モニタで払出の Transaction を開き、中身の表が `POST MedicationDispense`・`PUT Task/1` の 2 行で `PUT MedicationRequest` が無いこと。UI を変えたら JAR を作り直してから実行する

**Checkpoint**: 外来と入院の両方を個別ウィンドウで実演でき、最後の Transaction の違い（処方の更新の有無）を通信モニタで見比べられる

---

## Phase 5: User Story 3 - 講演モードでステップごとに解説しながら進める (Priority: P2)

**Goal**: ステージビュー（電子カルテ・薬剤部門システム・通信モニタ）で外来・入院のシナリオを「次へ」と解説で進められ、入院はステップ 1〜4 を 1 回の操作で送れる。電子カルテの列は払出の後に看護師 F に切り替わる

**Independent Test**: 講演モードで外来を初期化から「次へ」で最後まで進め、各ステップで解説が出ること。入院を選び「ステップ 4 まで進める」で 1 分以内に監査中になり、「次へ」2 回で電子カルテの列が看護師 F になること（quickstart.md §2・§3）

### Tests for User Story 3

- [ ] T036 [P] [US3] `ui/tests/unit/stageRoles.test.ts` を作る：純粋関数 `stageTargets(scenario, completed, mode)` が data-model.md §5 のとおりに `{ role, pharmacist }` を返すこと。
  基準のステップは講演モードで `max(0, completed - 1)`、自習モードで `min(completed, steps.length - 1)`。そのステップまでで最後に指定された `target.role`・`target.pharmacist` を使う。
  外来：講演モードで `completed = 3`（ステップ 3 を解説中）→ 薬剤師 `ph-c`、`completed = 4` → `ph-e`、電子カルテは常に `dr-x`。入院：講演モードで `completed = 5` → 電子カルテ `dr-y`、`completed = 6` → `ns-f`。
  **自習モードでは `pharmacist` を返さない**（`undefined`）。S1 のシナリオ（`stage` が `lab`）では講演モードで `role` を返さない（S1 の振る舞いを変えない）
- [ ] T037 [P] [US3] `ui/tests/unit/scenarioRunner.test.ts` に `runTo(n)` のテストを加える：完了したステップが n になるまで「次へ」と同じ処理（`run` → 完了の判定）を続ける。途中のステップが完了しない（期限切れ）・失敗したときはそこで止まり、`waiting` / `error` が「次へ」と同じに設定される。
  既に n 以上なら何もしない。実行中は `busy` が true で、`next`・`back` が無視される
- [ ] T038 [P] [US3] `ui/tests/unit/scenarios.test.ts` を更新する：シナリオの一覧が `["s1-main", "s1-cancel", "s1-reject", "s1-rerun", "s1-partial", "s4-outpatient", "s4-inpatient"]`。
  `existsInScreens` の正規表現に `ph-c|ph-e` を加えない代わりに、`pharmacist-ph-c`・`pharmacist-ph-e` は文字列の `data-guide` として存在することを確かめる（T025 で文字列のまま書く）。
  S4 の 2 つは `stage = "pharmacy"`・ステップ 6 つ・`loadState` を持つ。`fastForward` は入院だけにあり `to = 4`。ステップ 2〜4 の `title`・`expected`（データの条件と通信の条件）が外来と入院で同じ。
  外来のステップ 5 の `expected.medicationRequest` が `completed`、入院が `active`。解説（業務・FHIR）に「MedicationRequest」「Task」「作業」「依頼」の語が、入院のステップ 5 に「active」が含まれる（FR-030）

### Implementation for User Story 3

- [ ] T039 [US3] `ui/src/scenario/runner.ts` に `runTo(n: number)` を実装する（`back()` の再実行の部分と同じく `advance()` を繰り返す。初期化はしない）。T037 を通す
- [ ] T040 [US3] シナリオを作る：`ui/src/scenario/s4State.ts`（`loadPrescriptionScenarioState(doctorRef)(client)`：data-model.md §4.4。`fetchLatestPrescription` と `MedicationDispense?prescription=…` から `medicationRequest`・`task`（status・`businessStatusCode`・`owner`）・`medicationDispense` を返す。処方が無ければ `{ medicationDispense: "none" }`）と、
  `ui/src/scenario/s4Prescription.ts`（`s4Outpatient`・`s4Inpatient`。data-model.md §4.2・§4.3 の actor・target・通信の条件・期待するデータの状態（§3.1）。ステップ 2〜4 は共通の関数で作る。
  `run` は `prescriptionActions.ts` の関数を、そのステップの送信元の `FhirClient`（`ctx.clients[...]`）で呼ぶ。入院の `fastForward` = `{ to: 4, label: "ステップ 4 まで進める（外来と同じ部分）" }`。
  解説は docs/02 S4 の「解説ポイント」を業務上の意味・FHIR 上の意味に分けて書く：依頼のリソースが部門で異なる（ServiceRequest／MedicationRequest）、作業の仕組みは共通、別の薬剤師が監査する（Task.owner の変化、MedicationDispense.performer、版の履歴から調剤者を読む）、
  外来は処方まで完了・入院は処方が active のまま（「作業が終わった」と「依頼がすべて済んだ」は別）、MERIT9 区分・HOT コード・JAMI 用法コード）。
  `ui/src/scenario/ScenarioProvider.tsx` の `SCENARIOS` の末尾に 2 つを加える。T038 を通す
- [ ] T041 [US3] `ui/src/app/stageRoles.ts` を作り `stageTargets` を実装する（T036 を通す）。`ui/src/app/StageView.tsx` を更新する：
  `?scenario=` を `ScenarioProvider` の初期のシナリオに渡す（不正なら `s1-main`）。選ばれたシナリオの `stage` が `pharmacy` のとき、列を「電子カルテ」（タブはシナリオのステップに出てくる `target.role` だけ：外来は「医師 X」、入院は「医師 Y」「看護師 F（外科病棟）」。
  タブの画面（`PrescriptionScreen embedded role=…`）は**すべて配置し `hidden` で表示だけを切り替える**）・「薬剤部門システム（薬剤師 C / 薬剤師 E）」（`PharmacyScreen embedded`、薬剤師はステージの状態で制御）・「通信モニタ」にし、`data-guide-region` を `ehr`・`pharmacy` にする。
  `stageTargets` の値が**変わったときだけ**役割・薬剤師を切り替える（手の切り替えを上書きし続けない）。`stage` が `lab` のときは今までの描画とまったく同じにする（FR-033）
- [ ] T042 [US3] `ui/src/app/ProgressPanel.tsx` に、シナリオに `fastForward` があり完了したステップが `to` 未満のとき `fastForward.label` のボタン（`data-testid="btn-fast-forward"`、`busy` の間は押せない）を加え、`runner.runTo(to)` を呼ぶ
- [ ] T043 [US3] `ui/src/app/Launcher.tsx` に「S4 処方調剤」の欄（`aria-label="S4 処方調剤"`）を加える：講演モード（`/stage?mode=presentation&scenario=s4-outpatient`）、自習モード 外来（`/stage?mode=self-study&scenario=s4-outpatient`）・入院（`…&scenario=s4-inpatient`）、
  個別ウィンドウ（`/ehr/rx?role=dr-x`・`dr-y`・`ns-f`、`/pharmacy`）へのリンク
- [ ] T044 [US3] `ui/tests/e2e/s4-prescription.spec.ts` に講演モードのテストを加える：
  「外来：次へで最後まで」（`/stage?mode=presentation&scenario=s4-outpatient`。列の見出しが電子カルテ・薬剤部門システム・通信モニタ、各ステップで `explanation` が変わること、ステップ 4 の後に薬剤部門システムが薬剤師 E になること、最後に医師 X の行が「お渡し済み」。
  「戻る」でステップ 5 の完了時点に戻ること）、「入院：まとめて送ってから払出」（シナリオの選択で入院に切り替え、`btn-fast-forward` を押して **60 秒以内**にステップ 4 まで完了、通信モニタに処方・受付・監査の通信があること、
  「次へ」2 回で電子カルテの列が看護師 F になり「払出済み」が見えること）、「手動の操作に追従する」（講演モードの外来で、画面のボタンで処方・受付をしてステップの表示が進むこと）。
  「画面に収まる」：ビューポート 1920×1080 と 1280×720 で `/stage?mode=presentation&scenario=s4-outpatient` を開き、電子カルテ・薬剤部門システム・通信モニタの 3 領域（`data-guide-region="ehr"`・`"pharmacy"`、通信モニタ）がすべて表示され、ページに横スクロールが無いこと（`document.documentElement.scrollWidth <= innerWidth`）。状態表示（処方・作業の状態バッジ）の文字サイズが S1 のステージビューと同じトークンを使っていることは、T051 の実機確認（プロジェクタ）で目視する。
  既存の `ui/tests/e2e/presentation.spec.ts`（S1）が変わらず通ること。UI を変えたら JAR を作り直してから実行する

**Checkpoint**: 45 分版の S4（外来 + 入院の違い）を講演モードだけで実演できる

---

## Phase 6: User Story 4 - 自習モードでガイドに従って自分で操作する (Priority: P3)

**Goal**: 自習モードで S4 の外来・入院を選び、画面上の案内（強調表示・解説・薬剤師の切り替えの案内）だけを頼りに最後まで操作できる

**Independent Test**: 自習モードで入院を選び、ガイドだけで処方から看護師 F の払出済みの確認まで進められること。監査の場面で薬剤師 C のままなら薬剤師 E への切り替えが案内されること。「最初から」で初期状態に戻ること（quickstart.md §5）

### Tests for User Story 4

- [ ] T045 [P] [US4] `ui/tests/unit/guide.test.ts` にテストを加える：純粋関数 `guideInstruction(step, currentPharmacist)` が、`target.screen = "pharmacy"` で「薬剤部門システム（薬剤師 C）の、枠が点滅している部分を操作してください。」、電子カルテは役割の名前（医師 X・医師 Y・看護師 F）を併記し、
  `target.pharmacist` と `currentPharmacist` が違うときは「薬剤師 E に切り替えてください。」を加えること。`applyHighlight` が `disabled` の切り替えボタン（選択中の薬剤師）を強調しないこと（既存の振る舞いの確認）。
  促しの画面名に `pharmacy` →「薬剤部門システム」があること

### Implementation for User Story 4

- [ ] T046 [US4] `ui/src/guide/useGuide.ts` の `REGION_NAME` に `pharmacy: "薬剤部門システム"` を加え、`guideInstruction` を実装する（T045 を通す）。`ui/src/guide/GuideOverlay.tsx` を更新する：
  進行パネルと同じシナリオの選択（`data-testid="scenario-select"`、`busy` の間は押せない）を置き、案内の文言を `guideInstruction` にする。現在の薬剤師は `StageView` から props（`currentPharmacist`）で受け取る（`ui/src/app/StageView.tsx` で渡す）。
  S1 の自習モードの文言（「電子カルテ（医師 X）の、…」「検体検査システムの、…」）が変わらないこと
- [ ] T047 [US4] `ui/tests/e2e/s4-prescription.spec.ts` に自習モードのテストを加える：「入院をガイドどおりに最後まで」（`/stage?mode=self-study&scenario=s4-inpatient`。各ステップで強調表示された要素だけを押して進む。
  ステップ 4 で薬剤部門システムが薬剤師 C のままだと案内に「薬剤師 E に切り替えてください」が出て `pharmacist-ph-e` が強調されること、最後に「最初から」で初期状態に戻ること）。
  既存の `ui/tests/e2e/self-study.spec.ts`（S1）が変わらず通ること。UI を変えたら JAR を作り直してから実行する

**Checkpoint**: S4 の外来・入院を講演・自習の両モードで提供できる（原則 V、D-42）

---

## Phase 7: Polish & Cross-Cutting Concerns

**Purpose**: 文書の更新、回帰、オフラインの確認、検証結果の記録

- [ ] T048 [P] `CLAUDE.md` を更新する：実装範囲を「S1・S2・S3・S4」に（S5 は `docs/` に設計のみ）、コマンドに `mvn verify -Dit.test=S4ScenarioIT -Ds4.repeat=20`（外来・入院を既定 20 回）と `npx playwright test tests/e2e/s4-prescription.spec.ts` を加え、
  「S4（処方調剤）の要点」の節を加える（ステージビューの `stage`、`/ehr/rx`・`/pharmacy`、薬剤部門システムは通知の受信が `pharmacy`・更新が `pharmacy-ph-c/e`、調剤した薬剤師は Task の版の履歴から読む（D-51）、
  入院のステップ 1〜4 を送る `runTo`（D-52）、外来は処方まで `completed`・入院は `active` のまま（D-43）、看護師 F の条件は `Task?encounter=`、画面側の制限はサーバーで判定しない（D-46））
- [ ] T049 [P] docs と実装の食い違いを確認する（原則 VIII）：`docs/02-demo-scenarios.md` の S4 のステップの表・`docs/03-architecture.md` の検索パラメータの表・`docs/04-design-rules.md` の Transaction の表・表示ラベル・コード体系が、実装（`builders/prescription.ts`・`SearchParameters.java`・`labels.ts`）と一致すること。
  食い違いがあれば、どちらを正とするか判断して同じ変更の中で両者を合わせる。`docs/01-overview.md` の講演の構成（45 分版 = S1〜S4、S4 は 12 分）が D-32・D-49 と一致することも確認する
- [ ] T050 回帰とオフラインを確認する：`server/` で `mvn verify`（S1〜S4 の結合テスト、`-Ds4.repeat=20`）、`ui/` で `npm test && npm run typecheck`、UI をビルドして JAR を作り直し `npx playwright test`（S1〜S4 の E2E 全件）。
  `docker compose build` の後、`docker run --network none` で起動し、quickstart.md §2〜§5 を実行して外部への通信が無いこと（SC-005、`ui/tests/e2e/offline.spec.ts` の考え方）を確認する
- [ ] T051 `specs/004-prescription-dispensing/validation-results.md` を作る（S3 の `validation-results.md` と同じ形）：T050 の結果（テストの件数・繰り返し回数と成功率（SC-004）、入院のステップ 1〜4 を送った時間（SC-002）、外来を解説なしで操作した時間（SC-001）、
  反映までの時間（SC-003）、コードの確認の件数（SC-007）、オフライン（SC-005））と、実装中に docs を変えた点を記録する。SC-009・SC-010（医療従事者・来場者の試行）は実施予定として残す

---

## Dependencies & Execution Order

### Phase Dependencies

- **Setup (Phase 1)**：依存なし。
- **Foundational (Phase 2)**：Phase 1 の後。US1〜US4 のすべてをブロックする。
- **US1 (Phase 3)**：Phase 2 の後。MVP。
- **US2 (Phase 4)**：US1 の画面（`PrescriptionScreen`・`PharmacyScreen`）に入院の分を足すため、US1 の後。サーバーのテスト T029 は Phase 2 の後ならいつでも書ける。
- **US3 (Phase 5)**：US1・US2 の画面と操作を使うため、US2 の後。
- **US4 (Phase 6)**：US3 のシナリオ定義・ステージビューを使うため、US3 の後。
- **Polish (Phase 7)**：すべてのストーリーの後。

### Within Each User Story

- テストを先に書き、失敗することを確かめてから実装する（サーバーの結合テストは Phase 2 の実装で通る想定。通らなければ原因を直す）
- 純粋関数（`pharmacyActions`・`progressText`・`stageTargets`・`runTo`・`guideInstruction`）→ 画面への組み込み → E2E の順
- UI を変えたら JAR を作り直してから E2E を実行する

### Parallel Opportunities

- Phase 2：T003・T005・T006・T008・T010・T011・T012・T014・T016・T018 は互いに並行できる（別ファイル）。
  T004 は T003、T007 は T004・T005・T006、T009 は T005・T008、T013 は T008・T012、T015 は T013・T014、T017 は T016・T013、T019 は T011 の後
- US1：T020・T021・T022 は並行。T023 → T025（T025 は T023 の後）、T024 は T023 と並行、T026 は T024・T025 の後、T027 は並行、T028 は最後
- US2：T029・T030 は並行。T031 → T032、T033・T034 は T031 と並行、T035 は最後
- US3：T036・T037・T038 は並行。T039 は T037、T040 は T038、T041 は T036・T040 の後、T042 は T039 の後、T043 は並行、T044 は最後
- US4：T045 → T046 → T047
- Polish：T048・T049 は並行。T050 → T051

---

## Parallel Example: Phase 2

```bash
# サーバーのテストと初期データを並行して作る
Task: "T003 検索パラメータのテスト（server/src/test/java/jp/example/demo/unit/SearchMatcherTest.java）"
Task: "T005 初期データ（server/src/main/resources/seed/）"
Task: "T006 FHIR API のテスト（server/src/test/java/jp/example/demo/integration/FhirApiContractIT.java）"

# UI の純粋関数のテストを並行して書く
Task: "T010 表示ラベルのテスト（ui/tests/unit/labels.test.ts）"
Task: "T012 処方・お渡し・払出の組み立てのテスト（ui/tests/unit/prescriptionBuilders.test.ts）"
Task: "T014 操作の送信と調剤した薬剤師の読み取りのテスト（ui/tests/unit/prescriptionActions.test.ts）"
Task: "T016 一覧の結合のテスト（ui/tests/unit/prescriptions.test.ts）"
```

## Parallel Example: User Story 1

```bash
# テストを並行して書く
Task: "T020 HTTP の手順の補助（server/src/test/java/jp/example/demo/integration/PharmacyFlow.java）"
Task: "T021 外来の結合テスト（server/src/test/java/jp/example/demo/integration/S4ScenarioIT.java）"
Task: "T022 画面側の制限のテスト（ui/tests/unit/pharmacyRules.test.ts）"

# 電子カルテと版の履歴は別ファイルなので並行
Task: "T024 電子カルテの処方画面（ui/src/systems/ehr/PrescriptionForm.tsx、PrescriptionScreen.tsx）"
Task: "T027 版の履歴の表示（ui/src/monitor/HistoryView.tsx）"
```

## Parallel Example: User Story 3

```bash
# 純粋関数のテストを並行して書く
Task: "T036 ステージの役割の決め方（ui/tests/unit/stageRoles.test.ts）"
Task: "T037 runTo（ui/tests/unit/scenarioRunner.test.ts）"
Task: "T038 シナリオの定義（ui/tests/unit/scenarios.test.ts）"
```

---

## Implementation Strategy

### MVP First (User Story 1 Only)

1. Phase 1・Phase 2 を終える（S1〜S3 の回帰が緑のまま、処方・調剤の API・初期データ・組み立てが動く）
2. Phase 3（US1：外来の手動操作）を終える
3. **止めて確認する**：quickstart.md §4 を個別ウィンドウで実演する（S4 の中心メッセージ「依頼のリソースは違うが作業の仕組みは共通」が伝わる）
4. 講演（45 分版）に使うには US3 まで進める

### Incremental Delivery

1. Phase 2 → API・初期データ・マスタ・組み立て（S1〜S3 は変わらない）
2. US1 → 外来を画面で実演（MVP）
3. US2 → 入院と病棟の画面（「作業の完了」と「依頼の完了」の違いが見せられる）
4. US3 → 講演モード（ステージビュー・解説・まとめて送るボタン。45 分版がそろう）
5. US4 → 自習モード（展示で使える状態）
6. Polish → CLAUDE.md、docs の照合、回帰・オフライン、検証結果

---

## Notes

- [P] = 別ファイルで、未完了のタスクに依存しない
- [Story] でタスクとユーザーストーリーを対応付ける
- 各タスクまたはまとまりごとにコミットする（コミットメッセージは既存の形式 `feat:` / `test:` / `docs:` に合わせる）
- 各チェックポイントで、そのストーリーを単独で確認できる
- サーバーに S4 専用の規則・API・ポリシーを加えない（調剤者と監査者が別人かどうかは画面で制限する。D-46）。MedicationRequest・MedicationDispense の状態遷移の規則も置かない（research.md R-01）
- S1 のステージビュー・シナリオ・画面（`/ehr`・`/lis`）の振る舞いを変えない（FR-033）。S4 の画面は `/ehr/rx`・`/pharmacy` に分ける
- お渡し・払出の Transaction に `ifNoneExist` を付けない。412・422 は自動でやり直さない（D-15）
