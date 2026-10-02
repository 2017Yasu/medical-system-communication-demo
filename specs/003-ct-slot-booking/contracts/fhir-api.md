# Contract: FHIR API（S3 での追加）

S1 の [contracts/fhir-api.md](../../001-lab-order-workflow/contracts/fhir-api.md) に対する追加だけを書く。
記載の無い事項（共通の要求・応答ヘッダ、エラー応答、If-Match の規則、Transaction の処理順と全体の取り消し、capabilities）は S1 のまま。

## インスタンス・型レベルの操作（追加・変更）

| リソース | read | vread | `_history`（インスタンス） | create | update | patch | search |
|---|---|---|---|---|---|---|---|
| Schedule | ✓ | ✓ | ✓ | | | | パラメータ無し（全件） |
| Device | ✓ | ✓ | ✓ | | | | パラメータ無し（全件） |
| Slot | ✓ | ✓ | ✓ | ✓ | ✓ | | `schedule`、`status` |
| Appointment | ✓ | ✓ | ✓ | ✓ | ✓ | | `slot`、`status`、`patient`、`practitioner` |
| ServiceRequest | S1 のまま | | | | | | S1 の `subject`、`requester`、`status` に **`category`** を追加 |

- `category`（ServiceRequest）はトークン型で、`category.coding.code` と比べる（例：`category=108252007`）。
- `practitioner`（Appointment）は `participant.actor` のうち Practitioner の参照（例：`practitioner=Practitioner/dr-y`）。`patient` は Patient の参照。
- Slot・Appointment の update は S1 の If-Match の規則に従う（既定は必須。版が違えば 412）。サーバーは Slot・Appointment の状態遷移を検査しない（research.md R-01）。
- Slot・Appointment の create（POST）・update は、単独の要求と Transaction のエントリの両方で受け付ける。
- Subscription の criteria に、上表の Slot・Appointment の検索パラメータを使える（例：`Slot?schedule=Schedule/ct-1`）。

## 例：仮押さえ（医師 X）

```http
PUT /fhir/Slot/ct1-1000
X-Demo-Client: ehr-doctor
If-Match: W/"1"
Content-Type: application/fhir+json

{ "resourceType": "Slot", "id": "ct1-1000", "schedule": { "reference": "Schedule/ct-1" },
  "status": "busy-tentative", "start": "2026-10-03T10:00:00+09:00", "end": "2026-10-03T10:30:00+09:00",
  "comment": "仮押さえ：医師 X" }
```

- 成功：`200`、`ETag: W/"2"`、本文は版 2 の Slot（`meta.lastUpdated` が期限の起点）。
- 版が違う：`412`（OperationOutcome。「他の利用者が先に更新しました（Slot/ct1-1000 の現在の版: 2、指定された版: 1）」）。
- If-Match が無く、版の確認が必須：`400`（S1 のまま）。

## 例：確定（仮押さえを使う方式、医師 X）

```jsonc
// POST /fhir （X-Demo-Client: ehr-doctor）
{
  "resourceType": "Bundle",
  "type": "transaction",
  "entry": [
    { "resource": { "resourceType": "Slot", "id": "ct1-1000", "status": "busy", "…": "…" },
      "request": { "method": "PUT", "url": "Slot/ct1-1000", "ifMatch": "W/\"2\"" } },
    { "fullUrl": "urn:uuid:…a", "resource": { "resourceType": "Appointment", "status": "booked",
        "slot": [{ "reference": "Slot/ct1-1000" }], "basedOn": [{ "reference": "urn:uuid:…b" }], "…": "…" },
      "request": { "method": "POST", "url": "Appointment" } },
    { "fullUrl": "urn:uuid:…b", "resource": { "resourceType": "ServiceRequest", "…": "…" },
      "request": { "method": "POST", "url": "ServiceRequest" } },
    { "fullUrl": "urn:uuid:…c", "resource": { "resourceType": "Task", "focus": { "reference": "urn:uuid:…b" }, "…": "…" },
      "request": { "method": "POST", "url": "Task" } }
  ]
}
```

- 成功：`200`、`transaction-response`（各エントリの `response.status` は Slot が `200 OK`、ほかは `201 Created`。`location` と `etag` 付き）。
- Slot の版が違う（期限切れ・他の医師の更新の後）：`412`。**何も登録されない**（Appointment・ServiceRequest・Task も作られない）。
  OperationOutcome の `diagnostics` は「Bundle.entry[0]（PUT Slot/ct1-1000）: 他の利用者が先に更新しました（…）」、`expression` は `Bundle.entry[0]`。
- 予約の登録に `ifNoneExist` は付けない（D-40）。

## 例：直接予約（S3-1、医師 Y）

確定の Transaction から Slot の PUT を除いたもの（Appointment・ServiceRequest・Task の POST だけ）。Slot は更新されない。
サーバーは同じ枠を参照する予約がすでにあっても受け付ける（`200`）。

## 取りやめ

`PUT /fhir/Slot/{id}`（If-Match = 仮押さえの応答の ETag、`status = free`、`comment` なし）。仮押さえと同じ規則。

## 仮押さえの期限切れ（サーバー内の処理。FHIR の API ではない）

- サーバーは、仮押さえ（`busy-tentative`）の版が作られてから `slotHoldSeconds` 秒が過ぎても同じ版のままの Slot を、
  `status = free`・`comment` なしの新しい版に更新する（data-model.md §5）。
- この更新は HTTP の要求ではないが、版の履歴（`_history`）に残り、Subscription の通知（ping）が送られ、通信記録（`kind = "server"`）に残る（contracts/websocket.md）。
- 期限切れで作られた版の `meta` は通常の版と同じ（版の番号が 1 増え、`lastUpdated` が更新される）。
