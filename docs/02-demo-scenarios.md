# 02. デモシナリオ

## シナリオ一覧

| ID | 優先度 | シナリオ | 医療従事者に伝わること | 主な FHIR 要素 |
|---|---|---|---|---|
| S1 | P1 | 検体検査（オーダー → 受付 → 実施 → 結果返却） | 「依頼」と「作業の進み具合」は別に管理されている | Transaction Bundle, Task PATCH, Subscription |
| S2 | P1 | 排他制御①：2 人の技師が同じ依頼を同時に受付 | 仕組みが無いと後から操作した人の内容で上書きされる | ETag, If-Match, 412 |
| S3 | P2 | 放射線：CT 検査の予約枠の取り合い | 予約枠は「仮押さえ → 確定」で二重予約を防ぐ | Slot, Appointment, If-None-Exist, Transaction |
| S4 | P2 | 処方調剤（処方 → 調剤 → 払出） | 部門によって「依頼」のリソースは異なる | MedicationRequest, Task, MedicationDispense |
| S5 | P3 | Message Bundle による連携との比較 | HL7 v2 の電文との対応関係、移行の考え方 | MessageHeader, `$process-message` |

P1 は S1 + S2。S1 だけで Request/Task 分離・Transaction Bundle・PATCH・Subscription を一通り説明でき、
S2 で S1 と同じ場面を使って排他制御を見せられる。

## 登場人物・システム（共通）

すべて架空。

| 種別 | 名称（案） | FHIR リソース |
|---|---|---|
| 患者 | デモ 太郎（60 歳 男性）、デモ 花子 | Patient |
| 医師 | 田中 医師（内科）、鈴木 医師（外科） | Practitioner / PractitionerRole |
| 看護師 | 看護師 D（内科外来） | Practitioner / PractitionerRole |
| 臨床検査技師 | 技師 A、技師 B | Practitioner / PractitionerRole |
| 薬剤師 | 薬剤師 C | Practitioner / PractitionerRole |
| 部門 | 検査部、放射線部、薬剤部 | Organization |
| システム | 電子カルテ（HIS）、検体検査システム（LIS）、放射線情報システム（RIS）、薬剤部門システム | 画面（ブラウザ）。FHIR 上は Device または MessageHeader.source で表現 |

---

## S1. 検体検査ワークフロー（P1）

### 事前状態

- Patient / Practitioner / Organization が登録済み。
- LIS が Subscription を登録済み：`Task?owner=Organization/lab-dept,PractitionerRole/tech-a,PractitionerRole/tech-b`
  （検査部宛て・検査部の技師が担当する Task の作成・更新を通知。[04-design-rules.md](04-design-rules.md#taskowner-の扱い) 参照）。
- 電子カルテが Subscription を登録済み：`Task?requester=Practitioner/dr-tanaka`（自分が出した依頼の進捗を通知）。

### 業務の段階と FHIR の状態の対応

一般的な検体検査の流れ（[05-decisions.md](05-decisions.md) D-13）を FHIR の状態に対応付ける。

| 段階 | 業務上の状態 | 主な更新者 | ServiceRequest | Task.status / businessStatus | その他 |
|---|---|---|---|---|---|
| オーダー発行 | 発行済・未実施 | 医師（指示医） | `active` | `requested` / 未採取 | Specimen 作成（未採取） |
| 採血・検体採取 | 実施済・採取済 | 看護師（病棟・外来）、採血室の担当者 | `active` | `requested` / 採取済 | Specimen.collection に採取者・採取日時 |
| 検体受付 | 受付済・検査中 | 臨床検査技師（検査部門システムで受付） | `active` | `accepted` → `in-progress` / 検体到着 → 測定中 | |
| 結果確定・報告 | 報告済・結果確定 | 臨床検査技師（結果承認）、LIS から自動連携 | `active` → `completed` | `completed` | Observation / DiagnosticReport: `final` |
| 完了 | 完了 | システムが自動更新 | `completed` | `completed` | |

**全項目の結果が確定・報告された時点**で ServiceRequest を `completed` にする。
デモでは、LIS が結果を報告する Transaction Bundle に ServiceRequest の更新を含め、結果の確定と同時にシステムが自動で更新する。
サーバー内部の隠れた自動処理にしないのは、通信モニタ上で「誰がいつ完了にしたか」を見せるため。

### ステップ

| # | 業務上の出来事 | 操作する画面 | 通信 | リソースの状態変化 |
|---|---|---|---|---|
| 1 | 田中医師が血算を依頼 | 電子カルテ（医師） | `POST /`（Transaction Bundle：ServiceRequest + Task + Specimen） | SR: `active` / Task: `requested`、未採取（owner = 検査部） |
| 2 | 検査部の画面に新着依頼が届く | （自動） | Subscription 通知 → LIS が `GET /Task/{id}` で中身を取得 | 変化なし |
| 3 | 看護師 D が採血 | 電子カルテ（看護師） | `POST /`（Transaction Bundle：Specimen 更新 + Task 更新、どちらも `ifMatch`） | Specimen: 採取者・採取日時 / Task: `requested`、採取済 |
| 4 | 技師 A が検体を受付 | LIS（技師 A） | `PATCH /Task/{id}` + `If-Match`（status・owner・businessStatus を更新） | Task: `accepted`、検体到着（owner = 技師 A） |
| 5 | 電子カルテに「受付済み」と表示 | （自動） | Subscription 通知 → 電子カルテが Task を取得 | 変化なし |
| 6 | 測定開始 | LIS（技師 A） | `PATCH /Task/{id}` + `If-Match` | Task: `in-progress`、測定中 |
| 7 | 結果を承認・報告 | LIS（技師 A） | `POST /`（Transaction Bundle：Observation × n + DiagnosticReport + Task 更新 + ServiceRequest 更新、更新はすべて `ifMatch`） | Obs/DR: `final` / Task: `completed`（output → DR） / SR: `completed` |
| 8 | 電子カルテで結果を確認 | 電子カルテ（医師） | Subscription 通知 → DiagnosticReport / Observation を取得 | 変化なし |

### 解説ポイント

- ステップ 1〜6 の間、**ServiceRequest.status は `active` のまま**で、進んでいくのは Task だけ。
  「医師の指示は有効なまま、看護師・検査部の作業だけが進む」という業務の感覚と一致することを強調する。
- 採血（ステップ 3）は Task.status を変えず、businessStatus と Specimen で表す。Task.status は「検査部が引き受けたか・実施中か」を表す。
- ステップ 7 で全項目の結果が揃い、ServiceRequest が `completed` になる。結果・Task・ServiceRequest は 1 つの Transaction で「全部成功か全部失敗か」になるので、「結果は無いのに完了」という食い違いは起きない。
- ステップ 2・5 の通知は「何か変わった」という合図だけで、中身は受け取った側が取りに行く（R4 Subscription websocket 方式。[03-architecture.md](03-architecture.md#subscription) 参照）。

### バリエーション（任意）

| ID | 内容 | 状態変化 |
|---|---|---|
| S1-a | 医師が依頼を取消 | SR: `revoked`、Task: `cancelled`（Transaction で同時更新） |
| S1-b | 検査部が受付拒否（検体不備など） | Task: `rejected`、statusReason に理由 |
| S1-c | 再検（測定やり直し） | Task: `on-hold` → `in-progress`、businessStatus: 再検中 |
| S1-d | 一部の項目だけ先に報告（複数項目のオーダー） | 先行分は DiagnosticReport: `partial`、Task: `in-progress`、SR: `active` のまま。全項目が確定した時点で DR: `final`、Task・SR: `completed` |

---

## S2. 排他制御①：同時受付（P1）

S1 のステップ 4（検体受付）を、技師 A と技師 B が**ほぼ同時に**行う場面。LIS 画面を 2 つ並べて操作する。

### S2-1. ルール無し（If-Match 任意・クライアントが付けない）→ Lost Update

| 時刻 | 技師 A | 技師 B | サーバー上の Task |
|---|---|---|---|
| T1 | `GET /Task/1` → ETag `W/"1"` | | v1: requested |
| T2 | | `GET /Task/1` → ETag `W/"1"` | v1: requested |
| T3 | `PATCH`（owner = 技師 A、accepted）→ `200` | | v2: accepted / 技師 A |
| T4 | | `PATCH`（owner = 技師 B、accepted）→ `200` | v3: accepted / 技師 B |

- 技師 A の画面は「自分が担当」と思い込んだまま。実際の担当は技師 B に上書きされている（**後勝ち**）。
- 通信モニタで Task の履歴（`_history`）を表示し、v2 が v3 で上書きされたことを見せる。

### S2-2. If-Match あり → 先勝ち・後発は 412

| 時刻 | 技師 A | 技師 B | サーバー上の Task |
|---|---|---|---|
| T3 | `PATCH` + `If-Match: W/"1"` → `200`、ETag `W/"2"` | | v2: accepted / 技師 A |
| T4 | | `PATCH` + `If-Match: W/"1"` → **`412 Precondition Failed`** | v2 のまま |

- 技師 B の画面には「この依頼は既に 技師 A が受付済みです」と表示し、最新の状態を取り直して表示する。
- **自動リトライはしない**（業務上の判断を利用者に委ねる）。

### S2-3. If-Match 必須ポリシー → ヘッダ無しは 400

- サーバーのポリシーを「If-Match 必須」に切り替えると、ヘッダ無しの更新要求は `400 Bad Request` で拒否される。
- 「サーバー側でルールを強制できる」ことを示す。デモ制御パネルで ON/OFF する。

### 解説ポイント

- ETag は「自分が読んだ版から変わっていないか」を確認する仕組み（楽観的ロック）。
- 「誰が処理中か」は Task.status + Task.owner で表現する（論理ロック）。FHIR には「編集中ロック」の標準 API は無い。

---

## S3. 放射線：CT 検査予約枠の取り合い（P2）

田中医師（外来 1 診）と鈴木医師（外来 2 診）が、同じ CT 枠（明日 10:00）に**同時に**予約を入れようとする。

### 追加リソース

- Schedule（CT-1 号機）、Slot（30 分枠、`free`）
- ServiceRequest（category: imaging）、Appointment、Task（放射線部宛て）

### S3-1. NG パターン：Appointment を直接 POST → 二重予約

| 時刻 | 田中医師 | 鈴木医師 | 結果 |
|---|---|---|---|
| T1 | `POST /Appointment`（slot = Slot/A）→ `201` | | 予約 1 件 |
| T2 | | `POST /Appointment`（slot = Slot/A）→ `201` | **予約 2 件（二重予約成立）** |

- POST には If-Match が使えず、Slot 自体は更新していないので ETag では検知できない。
- 「ETag は 1 つのリソースの版を守る仕組みであり、数に限りがある枠の取り合いは別に設計が必要」と解説する。

### S3-2. 推奨パターン：仮押さえ → 確定 → タイムアウト

| # | 段階 | 通信 | 状態 |
|---|---|---|---|
| 1 | 仮押さえ | `PUT /Slot/A` + `If-Match`（status = `busy-tentative`） | 先に到達した側だけ成功、後発は `412` |
| 2 | 確定 | `POST /`（Transaction：`PUT Slot/A`（`busy`、`ifMatch`）+ `POST Appointment`（`ifNoneExist: Appointment?slot=Slot/A&status=booked`）+ ServiceRequest + Task） | Slot: `busy`、Appointment: `booked` |
| 3 | タイムアウト | サーバー内のジョブ | 仮押さえのまま一定時間経過した Slot を `free` に戻す |

- 後発の医師の画面には「この枠は他の利用者が予約中です」と表示し、別の枠を選ぶ画面へ誘導する（自動リトライはしない）。
- タイムアウトはデモでは **30 秒**程度に短縮し、仮押さえを放置すると枠が戻る様子を見せる。

### 拡張案（P3）

- IHE SWF on FHIR に沿った階層化：ServiceRequest（imaging-order）→ ServiceRequest（requested-procedure、basedOn）→ Task（Scheduled Procedure Step）。
- モダリティ側（DICOM MWL / MPPS）は画面上の模擬操作で代替し、DICOM 通信は実装しない。

---

## S4. 処方調剤（P2）

| # | 業務上の出来事 | 通信 | 状態 |
|---|---|---|---|
| 1 | 医師が処方 | `POST /`（Transaction：MedicationRequest + Task） | MR: `active` / `order`、Task: `requested`（owner = 薬剤部） |
| 2 | 薬剤部が受付・調剤開始 | `PATCH /Task` + `If-Match` | Task: `in-progress`、businessStatus: 調剤中 |
| 3 | 監査 | `PATCH /Task` + `If-Match` | businessStatus: 監査中 |
| 4 | 払出 | `POST /`（Transaction：MedicationDispense + Task 更新） | MD: `completed`（authorizingPrescription → MR）、Task: `completed`（output → MD） |

### 解説ポイント

- 検体検査は ServiceRequest、処方は **MedicationRequest** と、依頼のリソースが部門で異なる。
- 進捗管理の仕組み（Task）は共通なので、部門システム側の作り方は揃えられる。
- コードは HOT コード（薬剤）・JAMI 用法コードを使う（[04-design-rules.md](04-design-rules.md#コード体系と-jp-core) 参照）。

### 拡張案（P3）

- 疑義照会：Task: `on-hold` + Communication で薬剤部から医師へ問い合わせ → 医師が回答 → 処方修正 → `in-progress` に戻す。

---

## S5. Message Bundle との比較（P3）

- S1 のステップ 1 と同じオーダーを Message Bundle（先頭に MessageHeader、eventCoding = O21）で送り、
  Transaction Bundle 版と**並べて**表示する。
- MessageHeader と HL7 v2 の MSH セグメント、ServiceRequest と ORC/OBR の対応を表で示す。
- 受信側は `$process-message` を実装する（HAPI plain server には既定の実装が無いため自作）。

---

## 画面構成（案）

| 画面 | 役割 | 主な表示 |
|---|---|---|
| 電子カルテ | 依頼を出す・進捗と結果を見る | 患者情報、オーダー画面、依頼一覧（進捗表示付き）、結果表示 |
| 検体検査システム（技師 A / 技師 B） | 依頼を受けて処理する | 受付待ち一覧、受付・実施・結果入力 |
| 放射線部門システム | 予約枠と検査実施 | 予約枠カレンダー、検査一覧 |
| 薬剤部門システム | 処方を受けて調剤 | 処方一覧、調剤・監査・払出 |
| 通信モニタ | 通信の見える化 | システム間のシーケンス図（アニメーション）、リクエスト/レスポンス詳細（JSON）、リソースの版履歴 |
| デモ制御パネル | 進行と設定 | シナリオ選択、ステップ送り/戻し、初期化、ポリシー切替（If-Match 必須、状態遷移チェック）、タイムアウト秒数 |

- **ステージビュー**：講演用に、電子カルテ・部門システム・通信モニタを 1 画面に並べたレイアウト。
- **個別ウィンドウ**：各画面を別タブ・別ウィンドウで開くこともできる（自習・展示で外部モニタがある場合など）。
