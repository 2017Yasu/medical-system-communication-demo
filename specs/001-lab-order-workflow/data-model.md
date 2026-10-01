# Data Model: S1 検体検査ワークフロー

**Feature**: [spec.md](spec.md) | **Plan**: [plan.md](plan.md) | **Research**: [research.md](research.md)

FHIR R4（4.0.1）のリソースのうち、本機能で使う要素だけを定義する。表に無い要素は使わない（設定しない）。
独自のコード体系・識別子の system URI は `https://demo.example.jp/fhir/` 配下（R-19）。以下、`demo:` と略記する。

## 1. 初期データ（seed）

初期化のたびに同じ内容で投入する。すべて架空（原則 II）。

| リソース | id | 内容 |
|---|---|---|
| Organization | `hospital` | デモ総合病院 |
| Organization | `lab-dept` | 検査部（`partOf` → `Organization/hospital`） |
| Patient | `demo-taro` | デモ 太郎、男性、1966-04-01 生、患者番号 `00000001` |
| Patient | `demo-hanako` | デモ 花子、女性、1985-07-15 生、患者番号 `00000002` |
| Practitioner | `dr-x` | 医師 X（内科） |
| Practitioner | `ns-d` | 看護師 D（内科外来） |
| Practitioner | `tech-a` / `tech-b` | 技師 A / 技師 B（臨床検査技師） |
| PractitionerRole | `dr-x` | 医師、`organization` → `hospital` |
| PractitionerRole | `ns-d` | 看護師、`organization` → `hospital` |
| PractitionerRole | `tech-a` / `tech-b` | 臨床検査技師、`organization` → `lab-dept` |

- Subscription は初期データに含めない。各画面が開いた時点で登録する（R-10）。
- `meta.profile` には JP Core 1.2.0 のプロファイルを設定する（サーバー側の検証は行わない。D-05）。canonical URL は JP Core 1.2.0 パッケージで確認済み。

  | リソース | `meta.profile` |
  |---|---|
  | Patient | `http://jpfhir.jp/fhir/core/StructureDefinition/JP_Patient` |
  | Practitioner | `http://jpfhir.jp/fhir/core/StructureDefinition/JP_Practitioner` |
  | PractitionerRole | `http://jpfhir.jp/fhir/core/StructureDefinition/JP_PractitionerRole` |
  | Organization | `http://jpfhir.jp/fhir/core/StructureDefinition/JP_Organization` |
  | ServiceRequest | `http://jpfhir.jp/fhir/core/StructureDefinition/JP_ServiceRequest_Common` |
  | Specimen | `http://jpfhir.jp/fhir/core/StructureDefinition/JP_Specimen_Common` |
  | Observation | `http://jpfhir.jp/fhir/core/StructureDefinition/JP_Observation_LabResult` |
  | DiagnosticReport | `http://jpfhir.jp/fhir/core/StructureDefinition/JP_DiagnosticReport_LabResult` |
  | Task / Subscription | 設定しない（JP Core 1.2.0 にプロファイルが無い） |

- 画面が作成するリソースのプロファイル・検査項目・固定の coding は **FHIR マスタ `ui/src/master/fhir-master.json`** にまとめ、
  UI はこれを読み込んで使う。サーバーのテスト（R-21）は同じファイルを読んで JP パッケージとの整合性を確認する。

### 依頼可能な検査項目

| セット（`orderDetail`） | 項目 | JLAC10（確認済み） | 単位（UCUM） | 基準値（男性） | デモ 太郎 の結果値 |
|---|---|---|---|---|---|
| 血算 `demo:CodeSystem/lab-set#CBC` | 白血球数 | `2A990000001930952` | `10*3/uL` | 3.3–8.6 | 9.8（H） |
| | 赤血球数 | `2A990000001930951` | `10*6/uL` | 4.35–5.55 | 4.80 |
| | ヘモグロビン | `2A990000001930953` | `g/dL` | 13.7–16.8 | 14.6 |
| | ヘマトクリット | `2A990000001930954` | `%` | 40.7–50.1 | 44.2 |
| | 血小板数 | `2A990000001930955` | `10*3/uL` | 158–348 | 231 |
| 生化学 `demo:CodeSystem/lab-set#BIO` | AST | `3B035000002327201` | `U/L` | 13–30 | 24 |
| | ALT | `3B045000002327201` | `U/L` | 10–42 | 58（H） |
| | クレアチニン | `3C015000002327101` | `mg/dL` | 0.65–1.07 | 0.92 |

- JLAC10 の system は `http://medis.or.jp/CodeSystem/master-JLAC10-17digits`。8 項目とも JP Terminology 2.2609.0 の JLAC10 マスタと
  CLINS コア検査項目に存在することを確認済み（R-15）。血算は「末梢血液一般検査_全血(添加物入り)_自動機械法」、生化学は血清・定量値のコード。
- 基準値は JCCLS 共用基準範囲を参考にした値。
- 結果値は講演モードの自動実行で使う既定値。手動操作では技師が任意の値を入力できる。

## 2. リソース定義

### ServiceRequest（検査依頼）

| 要素 | 値・規則 |
|---|---|
| `identifier` | オーダー番号。system `demo:sid/order-number`、値 `L-{yyyyMMdd}-{4 桁}`（電子カルテが採番） |
| `status` | `active` → `completed` / `revoked`（§3.2） |
| `intent` | `order` 固定 |
| `category` | SNOMED CT `108252007`（Laboratory procedure）、text「検体検査」 |
| `code` | `demo:CodeSystem/order-code#LAB`「検体検査」 |
| `orderDetail` | 選んだセット（`CBC` 血算 / `BIO` 生化学）。1 件以上（FR-005） |
| `subject` | `Patient/{id}` |
| `requester` | `Practitioner/dr-x` |
| `performer` | `Organization/lab-dept` |
| `authoredOn` | 依頼日時 |
| `specimen` | `Specimen/{id}`（同じ Transaction で作成） |

### Task（作業）

| 要素 | 値・規則 |
|---|---|
| `status` | §3.1 の状態遷移に従う |
| `businessStatus` | §3.3 のコード（`demo:CodeSystem/lab-business-status`）と日本語 text |
| `statusReason` | 受付不可の理由（text。例：「溶血のため再採血が必要」） |
| `intent` | `order` 固定 |
| `code` | `http://hl7.org/fhir/CodeSystem/task-code#fulfill` |
| `focus` | `ServiceRequest/{id}` |
| `for` | `Patient/{id}` |
| `requester` | `Practitioner/dr-x`（電子カルテの Subscription の条件に使う） |
| `owner` | 作成時 `Organization/lab-dept`、受付時に `PractitionerRole/tech-a` などへ変更（docs/04 Task.owner の扱い） |
| `authoredOn` / `lastModified` | 作成日時 / 最終更新日時（更新のたびに画面が設定） |
| `output` | 結果報告時に追加。`type.text` = "DiagnosticReport"、`valueReference` → `DiagnosticReport/{id}` |

### Specimen（検体）

| 要素 | 値・規則 |
|---|---|
| `status` | 作成時は設定しない（未採取）、採血の記録時に `available` |
| `type` | `http://terminology.hl7.org/CodeSystem/v2-0487#BLD`、text「血液」 |
| `subject` | `Patient/{id}` |
| `request` | `ServiceRequest/{id}` |
| `collection.collector` | `Practitioner/ns-d`（採血の記録時） |
| `collection.collectedDateTime` | 採取日時（採血の記録時） |

### Observation（結果項目）

| 要素 | 値・規則 |
|---|---|
| `status` | `final` |
| `category` | `http://jpfhir.jp/fhir/core/CodeSystem/JP_SimpleObservationCategory_CS#laboratory` |
| `code` | JLAC10（§1 の表）、display・text は日本語の項目名 |
| `subject` / `basedOn` / `specimen` | 患者 / 依頼 / 検体 |
| `effectiveDateTime` | 検体の採取日時 |
| `issued` | 報告日時 |
| `performer` | `PractitionerRole/tech-a` など（承認した技師） |
| `valueQuantity` | 値と UCUM 単位 |
| `referenceRange` | `low` / `high` |
| `interpretation` | `v3-ObservationInterpretation#H` / `#L` / `#N`（基準値との比較で画面が設定） |

### DiagnosticReport（検査報告）

| 要素 | 値・規則 |
|---|---|
| `status` | `partial`（一部報告）→ `final`（全項目確定）（§3.4） |
| `category` | LOINC `LP29693-6`（Lab）。JP_DiagnosticReport_LabResult で固定 |
| `code` | `http://jpfhir.jp/fhir/core/CodeSystem/JP_DocumentCodes_CS#11502-2`「検体検査報告書」。JP_DiagnosticReport_LabResult で固定 |
| `basedOn` / `subject` / `specimen` | 依頼 / 患者 / 検体 |
| `issued` | 報告日時（更新のたびに設定） |
| `performer` | `Organization/lab-dept` |
| `resultsInterpreter` | 承認した技師の `PractitionerRole` |
| `result` | 報告済みの Observation の参照（一部報告時はその分のみ） |

### Subscription（通知登録）

| 要素 | 値・規則 |
|---|---|
| `id` | 画面ごとに固定（contracts/ui-screens.md）。例：`ehr-dr-x`、`lis-lab-dept` |
| `status` | 画面が `requested` で登録し、サーバーが保存時に `active` にする（criteria を解析できない場合は 422 で登録しない。§7） |
| `reason` | 日本語の説明（例：「検査部宛て・検査部の技師が担当する作業の通知」） |
| `criteria` | 電子カルテ：`Task?requester=Practitioner/dr-x`、検体検査システム：`Task?owner=Organization/lab-dept,PractitionerRole/tech-a,PractitionerRole/tech-b` |
| `channel.type` | `websocket` 固定 |

## 3. 状態遷移

### 3.1 Task.status

docs/04 の状態遷移マトリクスのうち、本機能で使う遷移。状態遷移チェックが ON のとき、マトリクスに無い遷移は 422（FR-019）。

```
requested ──(受付: 技師)──────────▶ accepted ──(測定開始)──▶ in-progress ──(全項目報告)──▶ completed
    │                                  │                    │    ▲
    │(受付不可: 技師)                   │                    │    │(再検後の再開)
    ▼                                  │                    ▼    │
 rejected                              │                  on-hold
                                       │
 requested / accepted / in-progress / on-hold ──(取消: 医師)──▶ cancelled
```

- `requested` のまま採血を記録する（status は変えず businessStatus だけ変える）。
- 終了状態（`completed` / `rejected` / `cancelled`、および本機能では使わない `failed`）からの遷移は不可。status を変えない更新（businessStatus・owner などのみの変更）も拒否する（§7）。

### 3.2 ServiceRequest.status

| 遷移 | 契機 | 同じ Transaction で更新するもの |
|---|---|---|
| （作成）→ `active` | 医師の依頼 | Task（作成）、Specimen（作成） |
| `active` → `completed` | 全項目の結果報告（D-13） | Observation（作成）、DiagnosticReport（作成 or `final` へ更新）、Task（`completed`） |
| `active` → `revoked` | 医師の取消 | Task（`cancelled`） |

### 3.3 Task.businessStatus（`demo:CodeSystem/lab-business-status`）

| コード | 表示 | 設定する操作 | Task.status |
|---|---|---|---|
| `not-collected` | 未採取 | 依頼 | `requested` |
| `collected` | 採取済 | 採血の記録（看護師） | `requested` |
| `received` | 検体到着 | 受付（技師） | `accepted` |
| `measuring` | 測定中 | 測定開始・再検後の再開 | `in-progress` |
| `rerun` | 再検中 | 再検 | `on-hold` |
| `partial-reported` | 一部報告済 | 一部の結果の先行報告 | `in-progress` |
| `reported` | 報告済 | 全項目の結果報告 | `completed` |

- `partial-reported`（一部報告済）と `reported`（報告済）は本計画で docs/04 の businessStatus の表に追加した。
- 一部報告の Transaction では Task に `output` を追加し businessStatus を `partial-reported` にする。
  Task.status は変えない（FR-016）。これにより電子カルテの Subscription（Task が条件）にも通知が届く。

### 3.4 DiagnosticReport.status

| 遷移 | 契機 |
|---|---|
| （作成）→ `partial` | 一部の結果の先行報告 |
| （作成）→ `final` | 一部報告を経ない全項目の結果報告 |
| `partial` → `final` | 残りの項目の結果報告（`result` に全項目の参照） |

### 3.5 業務の段階との対応（spec.md、docs/02）

| 業務の段階 | ServiceRequest | Task.status / businessStatus | Specimen | DiagnosticReport |
|---|---|---|---|---|
| オーダー発行 | `active` | `requested` / 未採取 | 作成（status 無し） | — |
| 採血・検体採取 | `active` | `requested` / 採取済 | `available`、採取者・日時 | — |
| 検体受付 | `active` | `accepted` / 検体到着 | | — |
| 測定 | `active` | `in-progress` / 測定中 | | — |
| （一部報告） | `active` | `in-progress` / 一部報告済 | | `partial` |
| 結果確定・報告・完了 | `completed` | `completed` / 報告済 | | `final` |

## 4. 操作ごとの更新内容

| 操作（画面） | 方式 | 内容 |
|---|---|---|
| 依頼（医師） | Transaction | POST ServiceRequest、POST Task、POST Specimen（`urn:uuid` で相互参照） |
| 採血の記録（看護師） | Transaction | PUT Specimen（`ifMatch`）、PUT Task（`ifMatch`、businessStatus = `collected`） |
| 受付（技師） | PATCH Task + If-Match | status = `accepted`、businessStatus = `received`、owner = 自分、lastModified |
| 測定開始（技師） | PATCH Task + If-Match | status = `in-progress`、businessStatus = `measuring` |
| 一部報告（技師） | Transaction | POST Observation × n、POST DiagnosticReport（`partial`）、PUT Task（`ifMatch`、output 追加、`partial-reported`） |
| 全項目報告（技師） | Transaction | POST Observation × n、POST または PUT（`ifMatch`）DiagnosticReport（`final`）、PUT Task（`ifMatch`、`completed`、`reported`、output）、PUT ServiceRequest（`ifMatch`、`completed`） |
| 受付不可（技師） | PATCH Task + If-Match | status = `rejected`、statusReason |
| 再検（技師） | PATCH Task + If-Match | status = `on-hold`、businessStatus = `rerun` → 続けて PATCH で `in-progress` / `measuring` |
| 取消（医師） | Transaction | PUT ServiceRequest（`ifMatch`、`revoked`）、PUT Task（`ifMatch`、`cancelled`） |

## 5. 画面側の業務ルール（サーバーでは判定しない）

| ルール | 根拠 |
|---|---|
| 未採取（`not-collected`）の依頼は検体検査システムで受付できない | spec Edge Cases |
| 取消は DiagnosticReport が無い依頼（結果報告前）に限る | FR-010 |
| 一部報告は、依頼された全項目のうち 1 項目以上・全項目未満を報告する場合 | FR-016 |
| 基準値外の判定（H / L）は `referenceRange` との比較で設定する | FR-009 |

## 6. デモ用のデータ（FHIR 以外）

### 通信記録（TrafficRecord）

| 項目 | 内容 |
|---|---|
| `seq` | 初期化からの連番。`http` は要求の受信時に採番する（contracts/websocket.md） |
| `timestamp` | 記録時刻 |
| `kind` | `http`（FHIR の要求と応答） / `notification`（Subscription の ping） / `demo`（初期化・ポリシー変更） |
| `client` | 送信元（`X-Demo-Client` の値。無ければ `unknown`） |
| `request` | `method`、`url`、主要ヘッダ（`If-Match`、`If-None-Exist`、`Content-Type`、`Prefer`）、本文 |
| `response` | `status`、主要ヘッダ（`ETag`、`Location`、`Content-Location`、`Last-Modified`）、本文、所要時間（ms） |
| `notification` | `subscriptionId`、通知先の `client`、きっかけになったリソースの参照と版 |
| `demoEvent` | `reset` / `policy`（変更後の値） |

### デモのポリシー（DemoPolicy）

| 項目 | 既定値 | 本機能での扱い |
|---|---|---|
| `ifMatchRequired` | `true` | 既定値のまま使う（切替 UI は S2） |
| `taskTransitionCheck` | `true` | 既定値のまま使う |

## 7. 検証規則（サーバー）

| 規則 | 応答 | 関連 |
|---|---|---|
| 更新・PATCH で If-Match が無い（`ifMatchRequired = true`） | 400 | FR-004 |
| If-Match の版が最新版と一致しない | 412 | FR-004 |
| Task.status の遷移がマトリクスに無い（`taskTransitionCheck = true`） | 422 | FR-019 |
| 終了状態（`completed` / `rejected` / `failed` / `cancelled`）の Task への更新。status を変えない更新も含む（`taskTransitionCheck = true`）。例：取消済みの依頼への採血の記録 | 422 | FR-019、spec Edge Cases |
| PATCH で `resourceType` / `id` が変わる、またはパッチを適用できない | 422 | — |
| Transaction の参照先が存在しない・`urn:uuid` を解決できない | 400 | FR-006 |
| Transaction の 1 件でも失敗 | 失敗したエントリの理由を含む OperationOutcome（400 / 412 / 422）。全件を反映しない | FR-006、FR-010、FR-011、FR-015 |
| Subscription の `channel.type` が `websocket` 以外、または criteria を解析できない | 422（作成しない） | FR-021 |
