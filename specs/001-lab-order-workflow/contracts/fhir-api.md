# Contract: FHIR REST API

**Base URL**: `http://localhost:8080/fhir`（FHIR R4 4.0.1、`application/fhir+json` のみ）

本機能で提供する範囲だけを定義する。ここに無い操作・パラメータは 400 または 404 を返す（HAPI の既定の挙動）。
リソースの要素は [data-model.md](../data-model.md) に従う。

## 共通

### 要求ヘッダ

| ヘッダ | 必須 | 内容 |
|---|---|---|
| `Content-Type` | 本文がある場合 | `application/fhir+json`。PATCH は `application/json-patch+json` |
| `Accept` | 任意 | `application/fhir+json` |
| `If-Match` | update / patch で必須（`ifMatchRequired = true` のとき） | `W/"{versionId}"` |
| `X-Demo-Client` | 任意（UI は必ず付ける） | 送信元の画面（[ui-screens.md](ui-screens.md)）。FHIR の処理には影響せず、通信記録にだけ使う |

### 応答ヘッダ

| ヘッダ | 対象 | 内容 |
|---|---|---|
| `ETag` | read / vread / create / update / patch | `W/"{versionId}"` |
| `Location` / `Content-Location` | create / update / patch | `{base}/{type}/{id}/_history/{versionId}` |
| `Last-Modified` | read / create / update / patch | `meta.lastUpdated` |

### エラー応答

すべて OperationOutcome を本文に含む。`issue.diagnostics` は日本語で理由を書く（UI は業務上の意味に変換して表示する）。

| ステータス | 条件 |
|---|---|
| 400 | If-Match が無い（必須時）、要求の形式が不正、参照を解決できない |
| 404 | リソースが存在しない |
| 412 | If-Match の版が最新版と一致しない |
| 422 | Task.status の不正な遷移、終了状態の Task への更新（status を変えない更新を含む）、適用できない PATCH、受け付けられない Subscription |

## インスタンス・型レベルの操作

| リソース | read | vread | `_history`（インスタンス） | create | update | patch | search |
|---|---|---|---|---|---|---|---|
| Patient | ✓ | ✓ | ✓ | | | | `identifier`、パラメータ無し（全件） |
| Practitioner / PractitionerRole / Organization | ✓ | ✓ | ✓ | | | | パラメータ無し（全件） |
| ServiceRequest | ✓ | ✓ | ✓ | ✓ | ✓ | | `subject`、`requester`、`status` |
| Task | ✓ | ✓ | ✓ | ✓ | ✓ | ✓（JSON Patch） | `owner`、`requester`、`status`、`focus`、`patient` |
| Specimen | ✓ | ✓ | ✓ | ✓ | ✓ | | — |
| Observation | ✓ | ✓ | ✓ | ✓ | | | `based-on` |
| DiagnosticReport | ✓ | ✓ | ✓ | ✓ | ✓ | | `based-on` |
| Subscription | ✓ | ✓ | ✓ | | ✓（update as create を含む） | | — |

- 参照型のパラメータは `{Type}/{id}` 形式。トークン型・参照型ともカンマ区切りで OR（例：`owner=Organization/lab-dept,PractitionerRole/tech-a`）。
- 検索結果は `searchset` Bundle（`total` 付き、ページングなし、`meta.lastUpdated` の降順）。
- update：存在しない id への PUT は新規作成（201、If-Match 不要）。存在する id への PUT は If-Match の規則に従う（200）。
- patch：本文は RFC 6902 JSON Patch の配列。適用後の `resourceType` と `id` は変更できない。Task のみ。
- Subscription の update：`channel.type = websocket` と、解析できる `criteria`（上表の検索パラメータの範囲）が必須。
  保存時に `status` を `active` にする。

### 例：受付（技師 A）

```http
PATCH /fhir/Task/{id}
Content-Type: application/json-patch+json
If-Match: W/"2"
X-Demo-Client: lis-tech-a

[
  { "op": "replace", "path": "/status", "value": "accepted" },
  { "op": "replace", "path": "/businessStatus",
    "value": { "coding": [{ "system": "https://demo.example.jp/fhir/CodeSystem/lab-business-status",
                            "code": "received", "display": "検体到着" }], "text": "検体到着" } },
  { "op": "replace", "path": "/owner", "value": { "reference": "PractitionerRole/tech-a" } },
  { "op": "replace", "path": "/lastModified", "value": "2026-10-01T10:15:00+09:00" }
]
```

→ `200 OK`、`ETag: W/"3"`、本文は更新後の Task。版が一致しなければ `412`。

## システムレベルの操作

### transaction（`POST /fhir`）

- 本文は `Bundle.type = transaction`。応答は `Bundle.type = transaction-response`（200）。
- 対応するエントリ：`POST`（`ifNoneExist` 対応）、`PUT`（`ifMatch` 対応）、`GET`。`DELETE`・`PATCH` エントリは本機能では使わない（400）。
- `fullUrl` の `urn:uuid:` は同じ Bundle 内の参照で使える。処理順序と失敗時の扱いは [research.md R-08](../research.md#r-08-transaction-bundle-の処理)。
- 失敗時は全エントリを反映せず、失敗したエントリの位置（`issue.expression` に `Bundle.entry[n]`）と理由を含む OperationOutcome を返す。

### capabilities（`GET /fhir/metadata`）

- HAPI が自動生成する CapabilityStatement。
- `rest[0].extension` に websocket の URL を示す：
  `{"url": "http://hl7.org/fhir/StructureDefinition/capabilitystatement-websocket", "valueUri": "ws://localhost:8080/ws/subscription"}`
  （ホスト名は要求の Host ヘッダから組み立てる）。
