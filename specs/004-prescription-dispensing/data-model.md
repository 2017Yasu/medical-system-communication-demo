# Data Model: S4 処方調剤（外来・入院）

**Feature**: [spec.md](spec.md) | **Plan**: [plan.md](plan.md) | **Research**: [research.md](research.md)

S1 の [data-model.md](../001-lab-order-workflow/data-model.md)・S3 の [data-model.md](../003-ct-slot-booking/data-model.md) に対する追加だけを書く。
記載の無い事項（版・ETag、Task の状態遷移マトリクス、通信記録、デモのポリシー）は S1〜S3 のまま。S4 はデモのポリシーに項目を加えない。

## 1. 初期データ（seed）— 追加

`server/src/main/resources/seed/` に JSON を置き、`index.txt` に加える（research.md R-02）。すべて架空。プロファイルは JP Core 1.2.0。

| ファイル | 種別 / id | 主な内容 |
|---|---|---|
| `organization-pharmacy-dept.json` | Organization/`pharmacy-dept` | `name` = 薬剤部、`partOf` = Organization/hospital |
| `practitioner-ph-c.json`・`practitionerrole-ph-c.json` | Practitioner・PractitionerRole/`ph-c` | 薬剤師 C。`code` = `staff-role#pharmacist`「薬剤師」、`organization` = 病院 |
| `practitioner-ph-e.json`・`practitionerrole-ph-e.json` | Practitioner・PractitionerRole/`ph-e` | 薬剤師 E（同上） |
| `practitioner-ns-f.json`・`practitionerrole-ns-f.json` | Practitioner・PractitionerRole/`ns-f` | 看護師 F。`code` = `staff-role#nurse`、`location` = Location/ward-surgery |
| `location-ward-surgery.json` | Location/`ward-surgery` | `name` = 外科病棟、`status` = active、`mode` = instance、`type` = v3-RoleCode `WARD`、`physicalType` = location-physical-type `wa`、`managingOrganization` = 病院 |
| `patient-demo-saburo.json` | Patient/`demo-saburo` | デモ 三郎、患者番号 `00000005`、男性、生年月日は架空 |
| `encounter-adm-saburo.json` | Encounter/`adm-saburo` | `status` = `in-progress`、`class` = v3-ActCode `IMP`、`subject` = デモ 三郎、`location[0].location` = Location/ward-surgery（`display` = 外科病棟）・`status` = active、`participant[0].individual` = Practitioner/dr-y、`serviceProvider` = 病院。`period` は持たない |

- 修正：`practitioner-dr-y.json` の `name.text` を「医師 Y」にする（S3 の初期データの誤り）。
- 外来（デモ 太郎）には Encounter を作らない（D-44）。

## 2. リソース定義 — 追加

### MedicationRequest（処方。1 剤 = 1 件。D-45）

| 項目 | 値 | 備考 |
|---|---|---|
| `meta.profile` | `JP_MedicationRequest` | |
| `identifier` | Rp 番号 `1`（`…/mhlw/IdSystem/Medication-RPGroupNumber`）、Rp 内の順番 `1`（`…/mhlw/IdSystem/MedicationAdministrationIndex`）、オーダー番号 `P-yyyymmdd-nnnn`（`https://demo.example.jp/fhir/sid/order-number`） | JP Core の必須（2 件以上）を満たす |
| `status` | `active` → `completed`（外来のお渡しのみ） | 入院は `active` のまま（D-43） |
| `intent` | `order` | |
| `category` | 外来：`[{coding: OHP 外来処方}, {coding: OHI 院内処方}]`／入院：`[{coding: IHP 入院処方}, {coding: XTR 臨時処方}]` | MERIT9 区分（D-44）。2 つの CodeableConcept |
| `medicationCodeableConcept` | HOT9（例：`103299401` ノルバスク錠５ｍｇ） | §2.1 |
| `subject` | Patient/demo-taro・Patient/demo-saburo | |
| `encounter` | 入院のみ Encounter/adm-saburo | |
| `authoredOn` | 処方した日時 | |
| `requester` | Practitioner/dr-x・Practitioner/dr-y | S1 の ServiceRequest と同じく Practitioner |
| `dosageInstruction[0]` | `text`（例：「内服・経口・１日１回朝食後」）、`timing.code` = JAMI 用法コード、`route` = route-codes `PO`、`method` = JAMI 用法詳細 `10`、`doseAndRate[0].type` = 力価区分 `1`（製剤量）・`doseQuantity`（例：1 `TAB` 錠）、拡張 `JP_MedicationDosage_UsageDuration`（日数、UCUM `d`） | JP Core の例に合わせる |
| `dispenseRequest` | `quantity`（1 回量 × 1 日の回数 × 日数。例：14 錠）、`expectedSupplyDuration`（日数） | |

### Task（薬剤部宛ての作業）

S1 の Task と同じ形（`code` = `fulfill`、`intent` = `order`）。違いだけを書く。

| 項目 | 処方の時点 | 受付・調剤開始 | 監査開始 | お渡し・払出 |
|---|---|---|---|---|
| `status` | `requested` | `in-progress` | `in-progress` | `completed` |
| `businessStatus` | なし | 調剤中 `dispensing` | 監査中 `auditing` | なし（削除。D-47） |
| `owner` | Organization/pharmacy-dept | PractitionerRole/ph-c | PractitionerRole/ph-e | PractitionerRole/ph-e |
| `output` | なし | なし | なし | `[{type.text: "調剤の記録", valueReference: MedicationDispense/{id}}]` |
| 共通 | `focus` = MedicationRequest、`for` = 患者、`requester` = 医師、`encounter` = 入院のみ Encounter/adm-saburo、`authoredOn`、`lastModified`（更新のたび） | | | |

- 業務上の状態のコード体系：`https://demo.example.jp/fhir/CodeSystem/pharm-business-status`（`dispensing` 調剤中、`auditing` 監査中）。`text` に日本語を入れる（S1 と同じ）。
- 状態遷移は docs/04 のマトリクス（`requested` → `in-progress` → `completed`）。`completed` の Task の更新は 422（S1 のまま）。

### MedicationDispense（調剤の記録。お渡し・払出の時点で 1 回だけ作る。D-47）

| 項目 | 外来（お渡し） | 入院（払出） |
|---|---|---|
| `meta.profile` | `JP_MedicationDispense` | 同左 |
| `identifier` | Rp 番号 `1`、Rp 内の順番 `1`（処方と同じ体系） | 同左 |
| `status` | `completed` | `completed` |
| `medicationCodeableConcept` | 処方と同じ | 同左 |
| `subject` | Patient/demo-taro | Patient/demo-saburo |
| `context` | なし | Encounter/adm-saburo |
| `performer` | `[{function: packager, actor: PractitionerRole/ph-c}, {function: checker, actor: PractitionerRole/ph-e}]`（`medicationdispense-performer-function`） | 同左 |
| `authorizingPrescription` | `[MedicationRequest/{id}]` | 同左 |
| `quantity`・`daysSupply` | 処方の `dispenseRequest` と同じ | 同左 |
| `whenHandedOver` | お渡しの日時 | 払出の日時 |
| `receiver` | `[Patient/demo-taro]` | なし |
| `destination` | なし | Location/ward-surgery |
| `dosageInstruction` | 処方と同じ | 同左 |

- 調剤者（`packager`）は、Task の版の履歴のうち `businessStatus` が調剤中（`dispensing`）だった最後の版の `owner`（research.md R-04、D-51）。
  監査者（`checker`）は現在の `owner`（= 操作する薬剤師）。

### Encounter・Location（読み取り専用）

§1 のとおり。Encounter は入院の処方（MedicationRequest・Task の `encounter`、MedicationDispense の `context`）から参照され、Location は Encounter と払出先（`destination`）から参照される。

### 2.1 薬剤のマスタ（FHIR マスタ `ui/src/master/fhir-master.json` に追加）

| 項目 | 内容 |
|---|---|
| `profiles` | `MedicationRequest`・`MedicationDispense`・`Encounter`・`Location` の JP Core の URL を加える |
| `systems` | `hot9`、`jamiUsage`、`jamiMethod`、`routeCodes`、`merit9Category`、`merit9Unit`、`strengthType`、`dispensePerformer`、`pharmBusinessStatus`、`rpNumber`、`orderInRp` |
| `medications` | `key`、`display`、`coding`（HOT9）、`doseValue`・`doseUnit`（MERIT9 単位）、`usage`（JAMI 用法コードと表示）、`timesPerDay`、`defaultDays`。4 種（research.md R-03） |
| `prescriptionDefaults` | 医師ごとの既定：`dr-x` → `demo-taro`・`amlodipine`、`dr-y` → `demo-saburo`・`loxoprofen` |
| `codings` | `categoryOutpatient`（OHP）・`categoryInHospital`（OHI）・`categoryInpatient`（IHP）・`categoryTemporary`（XTR）、`routeOral`（PO）、`methodOral`（10）、`strengthProduct`（1）、`performerPackager`・`performerChecker` |
| `pharmBusinessStatuses` | `dispensing` 調剤中、`auditing` 監査中 |

- 数量の計算：`dispenseRequest.quantity` = `doseValue` × `timesPerDay` × 日数（例：外来 1 × 1 × 14 = 14 錠、入院 1 × 3 × 3 = 9 錠）。

## 3. 状態の変化

### 3.1 外来（`s4-outpatient`）と入院（`s4-inpatient`）

| # | 段階 | MedicationRequest | Task（status / businessStatus / owner） | MedicationDispense |
|---|---|---|---|---|
| 1 | 処方 | `active`（版 1） | `requested` / なし / 薬剤部 | なし |
| 2 | 薬剤部に届く | 変化なし | 変化なし | なし |
| 3 | 受付・調剤開始 | `active`（版 1） | `in-progress` / 調剤中 / 薬剤師 C | なし |
| 4 | 監査開始 | `active`（版 1） | `in-progress` / 監査中 / 薬剤師 E | なし |
| 5 外来 | お渡し | **`completed`（版 2）** | `completed` / なし / 薬剤師 E（output → MD） | `completed`（receiver = デモ 太郎） |
| 5 入院 | 払出 | **`active`（版 1 のまま）** | `completed` / なし / 薬剤師 E（output → MD） | `completed`（destination = 外科病棟） |
| 6 | 結果が見える | 変化なし | 変化なし | 変化なし |

- お渡し・払出の Transaction の `ifMatch` が合わない（作業、外来では処方も、が他の操作で更新されていた）とき：`412`、**何も変わらない**（調剤の記録も作られない）。
- 完了した作業へのお渡し・払出：最新の版を指定しても Task の更新が `422`（終了状態）で、何も変わらない。

### 3.2 画面側の制限（薬剤部門システム。D-46、research.md R-05）

操作する薬剤師を `me` とする。サーバーはこの制限を判定しない。

| 行の状態 | 表示する操作 | 押せる条件 | 押せないときの表示 |
|---|---|---|---|
| `requested` | 受付・調剤開始 | 常に | — |
| `in-progress` / 調剤中 | 監査を開始 | `owner` ≠ `me` | 「調剤した薬剤師とは別の薬剤師が監査します（薬剤師 E に切り替えてください）」 |
| `in-progress` / 監査中 | 監査を終えてお渡し（外来）／監査を終えて払出（入院） | `owner` = `me` | 「監査を始めた薬剤師（薬剤師 E）が操作します」 |
| `completed` など | なし | — | お渡し済み／払出済み と日時（調剤の記録が無ければ状態だけ） |

- 「外来／入院」は MedicationRequest の `category` に `OHP` があるか `IHP` があるかで決める。
- 押せない理由の文言は `data-testid="rx-hint-{MedicationRequest id}"` に出す。

## 4. シナリオの定義 — 追加

### 4.1 型の追加（contracts/ui-screens.md「シナリオ定義の形式」の差分）

| 型 | 追加 |
|---|---|
| `ScenarioId` | `s4-outpatient`、`s4-inpatient` |
| `ScenarioClient` | `ehr-doctor-y`、`ehr-nurse-f`、`pharmacy`、`pharmacy-ph-c`、`pharmacy-ph-e` |
| `ScenarioState` | `medicationRequest?: string`（status）、`medicationDispense?: "none" \| "completed"` |
| `ScenarioStep.target` | `screen` に `pharmacy`、`role` に `dr-x`・`dr-y`・`ns-f`、`pharmacist?: "ph-c" \| "ph-e"` |
| `Scenario` | `stage?: "lab" \| "pharmacy"`（既定 `lab`）、`loadState?: (client) => Promise<ScenarioState>`（既定は S1 の取得）、`fastForward?: { to: number; label: string }` |

### 4.2 ステップ（外来）

期待するデータの状態は §3.1。`Bundle` は Transaction（`POST /fhir`）。

| # | ステップ | actor | target（control） | 通信の条件 |
|---|---|---|---|---|
| 1 | 医師 X がデモ 太郎に処方 | `ehr-doctor` | ehr / `dr-x`（`rx-patient,rx-drug,rx-submit`） | `http` `ehr-doctor` `POST` `Bundle` |
| 2 | 薬剤部の画面に新しい処方が届く | `auto` | pharmacy | `notification` → `pharmacy`、`http` `pharmacy` `GET` `Task` |
| 3 | 薬剤師 C が受付・調剤を開始 | `pharmacy-ph-c` | pharmacy / `ph-c`（`pharmacist-ph-c,rx-accept-1`） | `http` `pharmacy-ph-c` `PATCH` `Task` |
| 4 | 薬剤師 E が監査を開始 | `pharmacy-ph-e` | pharmacy / `ph-e`（`pharmacist-ph-e,rx-audit-1`） | `http` `pharmacy-ph-e` `PATCH` `Task` |
| 5 | 薬剤師 E が監査を終え、患者にお渡し | `pharmacy-ph-e` | pharmacy / `ph-e`（`pharmacist-ph-e,rx-handover-1`） | `http` `pharmacy-ph-e` `POST` `Bundle` |
| 6 | 電子カルテにお渡し済みと表示 | `auto` | ehr / `dr-x` | `notification` → `ehr-doctor`、`http` `ehr-doctor` `GET` `Task` |

### 4.3 ステップ（入院）

ステップ 2〜4 は外来と同じ（同じ関数で作る）。`fastForward` = `{ to: 4, label: "ステップ 4 まで進める（外来と同じ部分）" }`。

| # | ステップ | actor | target（control） | 通信の条件 |
|---|---|---|---|---|
| 1 | 医師 Y がデモ 三郎に臨時処方 | `ehr-doctor-y` | ehr / `dr-y`（`rx-patient,rx-drug,rx-submit`） | `http` `ehr-doctor-y` `POST` `Bundle` |
| 5 | 薬剤師 E が監査を終え、病棟へ払出 | `pharmacy-ph-e` | pharmacy / `ph-e`（`pharmacist-ph-e,rx-ward-dispense-1`） | `http` `pharmacy-ph-e` `POST` `Bundle` |
| 6 | 看護師 F の画面に払出済みと表示 | `auto` | ehr / `ns-f` | `notification` → `ehr-nurse-f`、`http` `ehr-nurse-f` `GET` `Task` |

- `control` の `pharmacist-*` は薬剤師の切り替えボタン。選択中の薬剤師のボタンは押せない（`disabled`）ため強調されず、切り替えが必要なときだけ強調される。
- `-1` は MedicationRequest の id（初期化の後の最初の処方は `1`。S1 の `collect-1` などと同じ規則）。

### 4.4 シナリオの状態の取得（`loadState`）

監視用のクライアント（`monitor`）で、シナリオの医師（外来：`Practitioner/dr-x`、入院：`Practitioner/dr-y`）の最新の MedicationRequest → `Task?focus=MedicationRequest/{id}` →
`MedicationDispense?prescription=MedicationRequest/{id}` を取得し、`medicationRequest`・`task`（status・businessStatus のコード・owner）・`medicationDispense` を返す。処方が無ければ `{ medicationDispense: "none" }`。

## 5. ステージビューの列（research.md R-07）

| | `stage = "lab"`（S1） | `stage = "pharmacy"`（S4） |
|---|---|---|
| 左の列 | 電子カルテ（医師 X / 看護師 D） | 電子カルテ 処方（外来：医師 X、入院：医師 Y / 看護師 F） |
| 中央の列 | 検体検査システム（技師 A） | 薬剤部門システム（薬剤師 C / 薬剤師 E） |
| 右の列 | 通信モニタ | 通信モニタ |
| 役割の自動の切り替え | 自習モードだけ（S1 のまま） | 講演・自習の両方（薬剤師は講演モードだけ） |

役割・薬剤師の決め方（純粋関数）：基準のステップ `k`（講演モード：`max(0, completed - 1)`、自習モード：`min(completed, steps.length - 1)`）までのステップのうち、
最後に `target.role`（`target.pharmacist`）を指定したものの値。値が変わったときだけ画面を切り替える（手の切り替えを上書きし続けない）。
