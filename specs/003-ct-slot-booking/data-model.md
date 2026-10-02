# Data Model: S3 放射線：CT 検査の予約枠の取り合い

**Feature**: [spec.md](spec.md) | **Research**: [research.md](research.md)

S1 の [data-model.md](../001-lab-order-workflow/data-model.md) と S2 の [data-model.md](../002-concurrent-acceptance/data-model.md) に対する追加・変更を書く。
記載の無い事項（検体検査のリソース、Task の状態遷移、通信記録の HTTP・通知・デモの種別）は S1・S2 のまま。
`demo:` は `https://demo.example.jp/fhir/` を表す（S1 と同じ）。

## 1. 初期データ（seed）— 追加

### 1.1 静的な初期データ（`server/src/main/resources/seed/`）

| リソース | id | 内容 |
|---|---|---|
| Practitioner | `dr-y` | 医師 Y（外科）。JP_Practitioner |
| PractitionerRole | `dr-y` | 医師（`demo:CodeSystem/staff-role#doctor`）、所属 `Organization/hospital`。JP_PractitionerRole |
| Organization | `rad-dept` | 放射線部（`partOf` → `Organization/hospital`）。JP_Organization |
| Device | `ct-1` | CT-1 号機。`deviceName` = 「CT-1 号機」、`type` = DICOM `DCM#CT`「Computed Tomography」、`owner` → `Organization/rad-dept`。JP Core にプロファイルが無いため `meta.profile` を付けない |
| Schedule | `ct-1` | CT-1 号機の予約表。`active = true`、`actor` → `Device/ct-1`（display「CT-1 号機」）、`serviceType.text` = 「CT 検査」、`comment` = 「30 分枠」 |
| Patient | `demo-jiro` | デモ 次郎（患者番号 `00000003`、男性）。初期の予約（9:00）の患者 |
| Patient | `demo-sakurako` | デモ 桜子（患者番号 `00000004`、女性）。初期の予約（11:00）の患者 |

- すべて架空（原則 II）。docs/02 の登場人物の表に、デモ 次郎・デモ 桜子・CT-1 号機を加える（plan.md「docs への反映」）。

### 1.2 初期化のたびに生成する初期データ（`SlotSeedGenerator`、research.md R-02）

基準日 D = 初期化した時点の日本時間（`Asia/Tokyo`）の翌日。

| リソース | id | `start` – `end` | `status` | 備考 |
|---|---|---|---|---|
| Slot | `ct1-0900` | D 09:00 – 09:30 | `busy` | 予約済み（デモ 次郎） |
| Slot | `ct1-0930` | D 09:30 – 10:00 | `free` | |
| Slot | `ct1-1000` | D 10:00 – 10:30 | `free` | **S3 で取り合う枠** |
| Slot | `ct1-1030` | D 10:30 – 11:00 | `free` | |
| Slot | `ct1-1100` | D 11:00 – 11:30 | `busy` | 予約済み（デモ 桜子） |
| Slot | `ct1-1130` | D 11:30 – 12:00 | `free` | |
| Appointment | `seed-0900` | D 09:00 – 09:30 | `booked` | `slot` → `Slot/ct1-0900`、患者デモ 次郎 |
| Appointment | `seed-1100` | D 11:00 – 11:30 | `booked` | `slot` → `Slot/ct1-1100`、患者デモ 桜子 |

- 時刻は `+09:00` 付きで保持する（例：`2026-10-03T10:00:00+09:00`）。画面は日本時間の「10/3（土）10:00」の形で表示する。
- 初期の予約には ServiceRequest・Task を付けない（放射線部門システムの一覧では「初期データの予約」と表示する）。
- 版はすべて 1。初期化で作り直す（id は同じ、日付は初期化した時点で決まる）。

## 2. リソース定義 — 追加

### Slot（予約枠）

| 要素 | 値・規則 |
|---|---|
| `schedule` | `Schedule/ct-1` |
| `status` | `free` / `busy-tentative` / `busy`（§3.1） |
| `start` / `end` | §1.2 |
| `comment` | 仮押さえ中だけ「仮押さえ：医師 X」「仮押さえ：医師 Y」。`free`・`busy` では持たない（D-35）。**表示用で、サーバー・画面とも判定に使わない** |

### Appointment（予約）

| 要素 | 値・規則 |
|---|---|
| `status` | `booked` 固定（取消は扱わない。D-34） |
| `serviceType` | 選んだ検査内容（§2.1 の coding） |
| `start` / `end` | 予約した Slot と同じ |
| `slot` | `Slot/{id}`（1 件） |
| `basedOn` | `ServiceRequest/{id}`（同じ Transaction で作成。`urn:uuid` で参照） |
| `participant` | 患者（`actor` → `Patient/{id}`、`status = accepted`）、依頼した医師（`actor` → `Practitioner/dr-x` または `dr-y`、`status = accepted`）、CT-1 号機（`actor` → `Device/ct-1`、`status = accepted`） |
| `created` | 予約日時 |

### ServiceRequest（画像検査の依頼）

S1 の検体検査の依頼と同じ要素を使い、次の点が違う。

| 要素 | 値・規則 |
|---|---|
| `identifier` | オーダー番号。system `demo:sid/order-number`、値 `R-{yyyyMMdd}-X{3 桁}`（医師 X）・`R-{yyyyMMdd}-Y{3 桁}`（医師 Y）（電子カルテが採番。医師ごとに連番。2 人の医師が同時に採番しても重ならない） |
| `status` | `active`（S3 では変えない） |
| `category` | SNOMED CT `363679005`（Imaging）、text「画像検査」 |
| `code` | 選んだ検査内容（§2.1） |
| `orderDetail` | モダリティ DICOM `DCM#CT`「Computed Tomography」（JP_RadiologyModality_VS に含まれる） |
| `subject` | `Patient/{id}` |
| `requester` | `Practitioner/dr-x` または `Practitioner/dr-y` |
| `performer` | `Organization/rad-dept` |
| `occurrencePeriod` | 予約した Slot の `start` – `end` |
| `authoredOn` | 依頼日時 |
| `meta.profile` | JP_ServiceRequest_Common |

### Task（放射線部宛ての作業）

| 要素 | 値・規則 |
|---|---|
| `status` | `requested`（S3 では変えない。D-34） |
| `businessStatus` | `demo:CodeSystem/rad-business-status#booked`「予約済み」（docs/04 の放射線の業務上の状態） |
| `intent` / `code` | S1 と同じ（`order`、`task-code#fulfill`） |
| `focus` | `ServiceRequest/{id}` |
| `for` | `Patient/{id}` |
| `requester` | 依頼した医師（`Practitioner/dr-x` / `dr-y`） |
| `owner` | `Organization/rad-dept` |
| `authoredOn` / `lastModified` | 依頼日時 |

### 2.1 検査内容（FHIR マスタ `ui/src/master/fhir-master.json` に追加）

JJ1017 は JP Terminology 2.2609.0 に含まれないため、デモ用の独自コード（`demo:CodeSystem/radiology-procedure`）とする（D-39）。

| code | display |
|---|---|
| `CT-HEAD` | 頭部 CT（単純） |
| `CT-CHEST` | 胸部 CT（単純） |
| `CT-ABD-C` | 腹部 CT（造影） |

FHIR マスタには、ほかに `systems.radiologyProcedure`・`systems.radBusinessStatus`、`codings.imagingCategory`（SNOMED CT 363679005）・`codings.modalityCT`（DCM#CT）、
`radBusinessStatuses`（`booked` 予約済み）を加える。`JpPackageConsistencyTest` は DCM#CT が JP_RadiologyModality_VS に含まれることを確かめる。

## 3. 状態の変化

### 3.1 Slot.status

| 変化 | 契機 | 送信元 | 版の確認 |
|---|---|---|---|
| `free` → `busy-tentative` | 仮押さえ（`PUT /Slot/{id}`） | 電子カルテ（医師） | If-Match = 枠を選んだときの版 |
| `busy-tentative` → `busy` | 確定（Transaction の `PUT Slot`） | 電子カルテ（医師） | `ifMatch` = 仮押さえの応答の版 |
| `busy-tentative` → `free` | 取りやめ（`PUT /Slot/{id}`） | 電子カルテ（医師） | If-Match = 仮押さえの応答の版 |
| `busy-tentative` → `free` | 期限切れ（§5） | FHIR サーバー（仮押さえの期限切れ） | サーバーが書き込みロックの中で版と `lastUpdated` を確かめる |

- サーバーは Slot の状態遷移を検査しない（research.md R-01）。上の表は電子カルテが守る手順である。
- 直接予約する方式（S3-1）は Slot を更新しない。

### 3.2 S3 の各シナリオでの変化（10:00 の枠 `Slot/ct1-1000`）

| 時点 | S3-1 直接予約 | S3-2 仮押さえ → 確定 | S3-3 期限切れ |
|---|---|---|---|
| 準備後 | 版 1 `free`、予約 0 件 | 同左 | 同左 |
| 医師 X・医師 Y が枠を選ぶ | 両者が版 1 を保持 | 両者が版 1 を保持 | 医師 X が版 1 を保持 |
| 医師 X の操作 | 予約を確定 → 200。予約 1 件、**枠は版 1 `free` のまま** | 仮押さえ → 200。版 2 `busy-tentative`（医師 X） | 仮押さえ → 200。版 2 `busy-tentative`（医師 X） |
| 医師 Y の操作 | 予約を確定 → 200。**予約 2 件**、枠は版 1 `free` のまま | 仮押さえ（If-Match: 版 1）→ **412**。版 2 のまま | — |
| 期限 | — | — | 期限切れ → 版 3 `free`（`comment` なし） |
| 医師 X の確定 | — | 確定（`ifMatch`: 版 2）→ 200。版 3 `busy`、予約 1 件（デモ 太郎） | 確定（`ifMatch`: 版 2）→ **412**。版 3 `free` のまま、予約 0 件 |

## 4. デモのポリシー（サーバー、`DemoPolicy`）— 変更

| 項目 | 型 | 既定値 | 意味 | 変更 |
|---|---|---|---|---|
| `ifMatchRequired` | boolean | `true` | S1 のまま（S3 では切り替えない） | — |
| `taskTransitionCheck` | boolean | `true` | S1 のまま | — |
| `labSendsIfMatch` | boolean | `true` | S2 のまま | — |
| `ehrUsesSlotHold` | boolean | `true` | 電子カルテが仮押さえを使うか。`false` は直接予約する（S3-1）。**サーバーの判定には使わない**（電子カルテの CT 予約画面だけが読む。D-36） | **追加** |
| `slotHoldSeconds` | 整数（1〜300） | 30（環境変数 `SLOT_HOLD_SECONDS` で変更可） | 仮押さえの期限（秒）。サーバーの期限切れの処理が、仮押さえを受け付けた時点の値を使う | **追加** |

- 初期化（`POST /demo/reset`）とサーバーの起動で、すべて既定値に戻る。
- S3 の準備ボタンが設定する値：

  | シナリオ | `ehrUsesSlotHold` | `slotHoldSeconds` |
  |---|---|---|
  | S3-1 直接予約 | `false` | 既定（30） |
  | S3-2 仮押さえ → 確定 | `true` | 既定（30） |
  | S3-3 期限切れ | `true` | 既定（30） |

## 5. 仮押さえの保持（サーバー、`SlotHoldExpiry`）— 追加

サーバーのメモリ上だけに持つ。FHIR のリソースではない（research.md R-05）。

| 項目 | 型 | 内容 |
|---|---|---|
| `slotId` | string | 対象の Slot の id |
| `versionId` | long | 仮押さえで作られた版 |
| `lastUpdated` | Instant | その版の `meta.lastUpdated` |
| `deadline` | Instant | `lastUpdated` + 仮押さえを受け付けた時点の `slotHoldSeconds` |

- コミットされた Slot の版が `busy-tentative` なら登録（同じ Slot の古い保持は置き換える）、それ以外なら削除する。
- 250 ミリ秒ごとに `deadline` を過ぎた保持を処理する：書き込みロックの中で、最新の版の `versionId` と `lastUpdated` が保持と同じで `busy-tentative` のときだけ、
  `status = free`・`comment` なしの新しい版を書き込む。違えば何もせず保持を消す。
- 初期化ですべて消す。

## 6. 通信記録（TrafficRecord）— 変更

| 項目 | 型 | 内容 | 変更 |
|---|---|---|---|
| `kind` | string | `"http"` / `"notification"` / `"demo"` / **`"server"`** | `server` を追加 |
| `client` | string | `server` 種別では `server-slot-expiry` | — |
| `serverAction` | object \| null | `server` 種別のときだけ（下表） | **追加** |

`serverAction` の形：

| 項目 | 型 | 例 |
|---|---|---|
| `action` | string | `"slot-hold-expired"` |
| `resource` | string | `"Slot/ct1-1000/_history/3"`（期限切れで作った版） |
| `before` | object | `{ "status": "busy-tentative", "versionId": "2", "comment": "仮押さえ：医師 X" }` |
| `after` | object | `{ "status": "free", "versionId": "3" }` |
| `holdSeconds` | number | `30`（その仮押さえに適用した期限） |

- seq は書き込みの前に採番し、コミット後に記録する。期限切れで送られる ping の記録はこの記録より後の seq を持つ（S1 の「seq 順に並べて扱う」規則のまま）。

## 7. 予約中の枠（画面、`BookingDraft`）— 追加

電子カルテの CT 予約画面の各ウィンドウが持つ一時的な状態。サーバーには保存しない（research.md R-04）。

| 項目 | 型 | 内容 |
|---|---|---|
| `slotId` | string | 対象の枠の id |
| `selected` | `Versioned<Slot>` | 「枠を選ぶ」の `GET /Slot/{id}` の応答（リソースと ETag） |
| `held` | `Versioned<Slot>` \| null | 仮押さえの応答（成功したとき） |
| `heldAt` | string \| null | 仮押さえの応答の `meta.lastUpdated`（残り時間の起点） |
| `holdSeconds` | number \| null | 仮押さえの時点の `slotHoldSeconds`（残り時間の表示用。判定はサーバー） |
| `patientId` | string | 予約する患者（既定：医師 X は `demo-taro`、医師 Y は `demo-hanako`） |
| `procedureCode` | string | 検査内容（既定：`CT-CHEST`） |
| `mode` | `"hold"` \| `"direct"` | 枠を選んだ時点の予約方式（`ehrUsesSlotHold`）。予約欄を開いている間は変えない |

- 状態の遷移：

  | 状態 | 操作・結果 | 次の状態 |
  |---|---|---|
  | 無し | 枠を選ぶ（GET 成功） | 選択中 |
  | 選択中 | 仮押さえする → 200 | 仮押さえ中 |
  | 選択中 | 仮押さえする → 412 | 無し（エラー欄に R-09 の文言） |
  | 選択中（`direct`） | 予約を確定する → 200 | 無し（「予約しました（オーダー番号 …）」） |
  | 仮押さえ中 | 確定する → 200 | 無し（「予約しました（オーダー番号 …）」） |
  | 仮押さえ中 | 確定する → 412 | 無し（「仮押さえの期限が切れました…」） |
  | 仮押さえ中 | 取りやめる → 200 / 412 | 無し |
  | 選択中 | 取りやめる（通信なし） | 無し |
  | いずれか | 初期化（`demo.reset`） | 無し |

- 通知で一覧が取り直されても `selected`・`held` を変えない。残り時間が 0 になっても「確定する」は押せる（S3-3 で期限切れ後の確定を見せるため）。残り時間の表示は「期限切れ（サーバーの処理を待っています）」に変わる。
- 1 つのウィンドウで同時に持てる `BookingDraft` は 1 つ。持っている間は、ほかの行の「枠を選ぶ」を押せない。

## 8. 準備の処理（デモ制御パネル、`PrepareRun`）— 変更

| 項目 | 型 | 内容 |
|---|---|---|
| `scenario` | `"s2-1"` \| `"s2-2"` \| `"s2-3"` \| **`"s3-1"` \| `"s3-2"` \| `"s3-3"`** | 準備するシナリオ |
| `stage` | `"reset"` \| `"policy"` \| `"order"` \| `"collect"` \| `"done"` | S3 は `reset → policy → done` |
| `error` | `DisplayError` \| null | S2 のまま |
