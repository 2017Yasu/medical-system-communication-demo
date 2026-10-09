# Contract: FHIR API（S4 での追加）

S1 の [contracts/fhir-api.md](../../001-lab-order-workflow/contracts/fhir-api.md)・S3 の [contracts/fhir-api.md](../../003-ct-slot-booking/contracts/fhir-api.md) に対する追加だけを書く。
記載の無い事項（共通の要求・応答ヘッダ、エラー応答、If-Match の規則、Transaction の処理順と全体の取り消し、Task の状態遷移、capabilities）は S1〜S3 のまま。

## インスタンス・型レベルの操作（追加・変更）

| リソース | read | vread | `_history`（インスタンス） | create | update | patch | search |
|---|---|---|---|---|---|---|---|
| MedicationRequest | ✓ | ✓ | ✓ | ✓ | ✓ | | `requester`、`subject`、`encounter`、`status` |
| MedicationDispense | ✓ | ✓ | ✓ | ✓ | ✓ | | `prescription`、`subject` |
| Encounter | ✓ | ✓ | ✓ | | | | `patient`、`location`、`status` |
| Location | ✓ | ✓ | ✓ | | | | パラメータ無し（全件） |
| Task | S1 のまま | | | | | | S1 の `owner`、`requester`、`status`、`focus`、`patient` に **`encounter`** を追加 |

- 参照のパラメータ（`requester`・`subject`・`encounter`・`prescription`・`patient`・`location`）は `Type/id` で比べる（例：`encounter=Encounter/adm-saburo`）。
  `prescription` は `authorizingPrescription`、`location`（Encounter）は `location.location`。カンマ区切りは OR（S1 と同じ）。
- MedicationRequest・MedicationDispense の update は S1 の If-Match の規則に従う（既定は必須。版が違えば 412）。サーバーは両者の状態遷移を検査しない（research.md R-01）。
- 両者の create（POST）・update は、単独の要求と Transaction のエントリの両方で受け付ける。Encounter・Location は書き込みの操作を持たない（読み取り専用。S3 の Schedule・Device と同じ）。
- Subscription の criteria に、上表の検索パラメータを使える（例：`Task?encounter=Encounter/adm-saburo`）。

## 例：処方（外来、医師 X）

```jsonc
// POST /fhir （X-Demo-Client: ehr-doctor）
{
  "resourceType": "Bundle",
  "type": "transaction",
  "entry": [
    { "fullUrl": "urn:uuid:…a",
      "resource": { "resourceType": "MedicationRequest", "status": "active", "intent": "order",
        "category": [
          { "coding": [{ "system": "http://jpfhir.jp/fhir/core/CodeSystem/JP_MedicationCategoryMERIT9_CS", "code": "OHP", "display": "外来処方" }] },
          { "coding": [{ "system": "http://jpfhir.jp/fhir/core/CodeSystem/JP_MedicationCategoryMERIT9_CS", "code": "OHI", "display": "院内処方" }] } ],
        "medicationCodeableConcept": { "coding": [{ "system": "http://medis.or.jp/CodeSystem/master-HOT9", "code": "103299401", "display": "ノルバスク錠５ｍｇ" }] },
        "subject": { "reference": "Patient/demo-taro" }, "requester": { "reference": "Practitioner/dr-x" },
        "dosageInstruction": [{ "text": "内服・経口・１日１回朝食後",
          "timing": { "code": { "coding": [{ "system": "http://jami.jp/CodeSystem/MedicationUsage", "code": "1011000400000000" }] } },
          "doseAndRate": [{ "doseQuantity": { "value": 1, "unit": "錠", "system": "http://jpfhir.jp/fhir/core/mhlw/CodeSystem/MedicationUnitMERIT9Code", "code": "TAB" } }],
          "…": "…" }],
        "dispenseRequest": { "quantity": { "value": 14, "unit": "錠", "…": "…" }, "expectedSupplyDuration": { "value": 14, "unit": "日", "system": "http://unitsofmeasure.org", "code": "d" } },
        "…": "…" },
      "request": { "method": "POST", "url": "MedicationRequest" } },
    { "fullUrl": "urn:uuid:…b",
      "resource": { "resourceType": "Task", "status": "requested", "intent": "order",
        "focus": { "reference": "urn:uuid:…a" }, "for": { "reference": "Patient/demo-taro" },
        "requester": { "reference": "Practitioner/dr-x" }, "owner": { "reference": "Organization/pharmacy-dept" }, "…": "…" },
      "request": { "method": "POST", "url": "Task" } }
  ]
}
```

- 成功：`200`、`transaction-response`（2 件とも `201 Created`、`location` と `etag` 付き）。
- 入院（医師 Y、`X-Demo-Client: ehr-doctor-y`）は、`category` が `IHP`・`XTR`、MedicationRequest と Task に `"encounter": { "reference": "Encounter/adm-saburo" }`。ほかは同じ。

## 例：受付・調剤開始（薬剤師 C）

```http
PATCH /fhir/Task/1
X-Demo-Client: pharmacy-ph-c
If-Match: W/"1"
Content-Type: application/json-patch+json

[
  { "op": "replace", "path": "/status", "value": "in-progress" },
  { "op": "add", "path": "/businessStatus", "value": { "coding": [{ "system": "https://demo.example.jp/fhir/CodeSystem/pharm-business-status", "code": "dispensing", "display": "調剤中" }], "text": "調剤中" } },
  { "op": "replace", "path": "/owner", "value": { "reference": "PractitionerRole/ph-c" } },
  { "op": "add", "path": "/lastModified", "value": "2026-10-09T10:05:00+09:00" }
]
```

- 成功：`200`、`ETag: W/"2"`。版が違う：`412`。
- 監査開始（薬剤師 E、`X-Demo-Client: pharmacy-ph-e`、`If-Match: W/"2"`）は、`businessStatus` を `auditing`（監査中）、`owner` を `PractitionerRole/ph-e` にする（`status` は送らない）。

## 例：お渡し（外来、薬剤師 E）

1. `GET /fhir/Task/1/_history`（`X-Demo-Client: pharmacy-ph-e`）：調剤した薬剤師（業務上の状態が `dispensing` だった最後の版の `owner`）を読み取る。
2. Transaction：

```jsonc
// POST /fhir （X-Demo-Client: pharmacy-ph-e）
{
  "resourceType": "Bundle",
  "type": "transaction",
  "entry": [
    { "fullUrl": "urn:uuid:…d",
      "resource": { "resourceType": "MedicationDispense", "status": "completed",
        "subject": { "reference": "Patient/demo-taro" },
        "performer": [
          { "function": { "coding": [{ "system": "http://terminology.hl7.org/CodeSystem/medicationdispense-performer-function", "code": "packager" }] }, "actor": { "reference": "PractitionerRole/ph-c" } },
          { "function": { "coding": [{ "system": "http://terminology.hl7.org/CodeSystem/medicationdispense-performer-function", "code": "checker" }] }, "actor": { "reference": "PractitionerRole/ph-e" } } ],
        "authorizingPrescription": [{ "reference": "MedicationRequest/1" }],
        "whenHandedOver": "2026-10-09T10:20:00+09:00",
        "receiver": [{ "reference": "Patient/demo-taro" }], "…": "…" },
      "request": { "method": "POST", "url": "MedicationDispense" } },
    { "resource": { "resourceType": "Task", "id": "1", "status": "completed",
        "owner": { "reference": "PractitionerRole/ph-e" },
        "output": [{ "type": { "text": "調剤の記録" }, "valueReference": { "reference": "urn:uuid:…d" } }], "…": "…（businessStatus は含めない）" },
      "request": { "method": "PUT", "url": "Task/1", "ifMatch": "W/\"3\"" } },
    { "resource": { "resourceType": "MedicationRequest", "id": "1", "status": "completed", "…": "…" },
      "request": { "method": "PUT", "url": "MedicationRequest/1", "ifMatch": "W/\"1\"" } }
  ]
}
```

- 成功：`200`、`transaction-response`（MedicationDispense は `201 Created`、Task・MedicationRequest は `200 OK`）。`urn:uuid:…d` は `MedicationDispense/{id}` に書き換えられる。
- いずれかの `ifMatch` が違う：`412`。**何も登録・更新されない**（調剤の記録も作られない）。OperationOutcome の `expression` は失敗したエントリ（例：`Bundle.entry[2]`）。
- Task が既に `completed`：`422`（「この作業は完了のため変更できません（completed）」）。何も登録されない。

## 例：払出（入院、薬剤師 E）

お渡しとの違いだけを書く。

- MedicationDispense：`receiver` を入れず、`"destination": { "reference": "Location/ward-surgery" }` と `"context": { "reference": "Encounter/adm-saburo" }` を入れる。
- **MedicationRequest の PUT を含めない**（エントリは MedicationDispense の POST と Task の PUT の 2 件）。処方は `active`・版 1 のまま（D-43）。
