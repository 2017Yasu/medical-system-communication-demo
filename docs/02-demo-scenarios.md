# 02. デモシナリオ

## シナリオ一覧

| ID | 優先度 | シナリオ | 医療従事者に伝わること | 主な FHIR 要素 |
|---|---|---|---|---|
| S1 | P1 | 検体検査（オーダー → 受付 → 実施 → 結果返却） | 「依頼」と「作業の進み具合」は別に管理されている | Transaction Bundle, Task PATCH, Subscription |
| S2 | P1 | 排他制御①：2 人の技師が同じ依頼を同時に受付 | 仕組みが無いと後から操作した人の内容で上書きされる | ETag, If-Match, 412 |
| S3 | P2 | 放射線：CT 検査の予約枠の取り合い | 予約枠は「仮押さえ → 確定」で二重予約を防ぐ | Slot, Appointment, If-Match, Transaction |
| S4 | P2 | 処方調剤（処方 → 調剤 → 監査 → お渡し・払出。外来と入院） | 部門によって「依頼」のリソースは異なるが、進捗の管理（Task）は共通。作業の完了と依頼の完了は別 | MedicationRequest, Task, MedicationDispense |
| S5 | P3 | Message Bundle による連携との比較 | HL7 v2 の電文との対応関係、移行の考え方 | MessageHeader, `$process-message` |

P1 は S1 + S2。S1 だけで Request/Task 分離・Transaction Bundle・PATCH・Subscription を一通り説明でき、
S2 で S1 と同じ場面を使って排他制御を見せられる。

## 登場人物・システム（共通）

すべて架空。患者は「デモ 〇〇」、職員は「職種 + 英字」（医師 X、技師 A など）とし、実在の人物と取り違えない名前にする（constitution 原則 II）。

| 種別 | 名称（案） | FHIR リソース |
|---|---|---|
| 患者 | デモ 太郎（60 歳 男性）、デモ 花子、デモ 次郎・デモ 桜子（S3 の初期データの予約の患者）、デモ 三郎（S4 の入院の患者。外科病棟に入院中） | Patient / Encounter（デモ 三郎の入院だけ） |
| 医師 | 医師 X（内科）、医師 Y（外科） | Practitioner / PractitionerRole |
| 看護師 | 看護師 D（内科外来）、看護師 F（外科病棟） | Practitioner / PractitionerRole |
| 臨床検査技師 | 技師 A、技師 B | Practitioner / PractitionerRole |
| 薬剤師 | 薬剤師 C（調剤）、薬剤師 E（監査） | Practitioner / PractitionerRole |
| 部門 | 検査部、放射線部、薬剤部 | Organization |
| 病棟 | 外科病棟（S4 の入院の払出先） | Location |
| 機器 | CT-1 号機（放射線部。予約表と 30 分の予約枠を持つ） | Device / Schedule / Slot |
| システム | 電子カルテ（HIS）、検体検査システム（LIS）、放射線情報システム（RIS）、薬剤部門システム | 画面（ブラウザ）。FHIR 上は Device または MessageHeader.source で表現 |

---

## S1. 検体検査ワークフロー（P1）

### 事前状態

- Patient / Practitioner / PractitionerRole / Organization が初期データとして登録済み。
- 各画面は**開いた時点で**自分の Subscription を登録し（既にあればそれを使う）、通知の受け口に接続する。
  登録の通信も通信モニタに表示される（「通知の条件を登録する」ことも説明の対象にする）。

  | 画面 | Subscription の criteria | 目的 |
  |---|---|---|
  | 電子カルテ（医師） | `Task?requester=Practitioner/dr-x` | 自分が出した依頼の進捗を知る |
  | 電子カルテ（看護師） | `Task?owner=Organization/lab-dept,PractitionerRole/tech-a,PractitionerRole/tech-b` | 採血待ちの依頼を知る（画面で未採取のものに絞る） |
  | 検体検査システム | `Task?owner=Organization/lab-dept,PractitionerRole/tech-a,PractitionerRole/tech-b` | 検査部宛て・検査部の技師が担当する作業を知る（[04-design-rules.md](04-design-rules.md#taskowner-の扱い) 参照） |

  criteria は更新後のリソースで評価されるため、状態が変わると外れる条件（例：`status=requested`）は使わない。

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
| 1 | 医師 X が血算を依頼 | 電子カルテ（医師） | `POST /`（Transaction Bundle：ServiceRequest + Task + Specimen） | SR: `active` / Task: `requested`、未採取（owner = 検査部） |
| 2 | 検査部の画面に新着依頼が届く | （自動） | Subscription 通知 → LIS が `GET /Task/{id}` で中身を取得 | 変化なし |
| 3 | 看護師 D が採血 | 電子カルテ（看護師） | `POST /`（Transaction Bundle：Specimen 更新 + Task 更新、どちらも `ifMatch`） | Specimen: 採取者・採取日時 / Task: `requested`、採取済 |
| 4 | 技師 A が検体を受付 | LIS（技師 A） | 受付画面を開くと `GET /Task/{id}`（ETag を保持）→ 確定で `PATCH /Task/{id}` + `If-Match`（status・owner・businessStatus を更新）（D-27） | Task: `accepted`、検体到着（owner = 技師 A） |
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
受付は「受付画面を開く（Task を GET して版を保持）→ 確定（PATCH）」の 2 段階で（D-27）、両者が同じ版 v1 を開いてから確定することで、人の操作でも同時受付を再現できる。
実演はステージビューを使わず、個別ウィンドウ（技師 A・技師 B・通信モニタ・デモ制御パネル）を並べ、手順書 [06-demo-procedures.md](06-demo-procedures.md) に従って手で操作する（D-29）。依頼・採血と設定の切り替えは、デモ制御パネルの「S2-x の準備」ボタンで行う（D-30）。

### S2-1. ルール無し（If-Match 任意・クライアントが付けない）→ Lost Update

| 時刻 | 技師 A | 技師 B | サーバー上の Task |
|---|---|---|---|
| T1 | `GET /Task/1` → ETag `W/"1"` | | v1: requested |
| T2 | | `GET /Task/1` → ETag `W/"1"` | v1: requested |
| T3 | `PATCH`（owner = 技師 A、accepted）→ `200` | | v2: accepted / 技師 A |
| T4 | | `PATCH`（owner = 技師 B、accepted）→ `200` | v3: accepted / 技師 B |

- 技師 A・技師 B のどちらにもエラーや警告は出ない。実際の担当は技師 B に上書きされている（**後勝ち**）。
- 技師 A の一覧は Subscription 通知で取り直され、担当者が「技師 A → 技師 B」に変わったことをアニメーションで示す（D-28）。ただしこれは「表示が変わった」ことの強調であって、サーバーが上書きを検知したわけではない。
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

医師 X（外来 1 診）と医師 Y（外来 2 診）が、同じ CT 枠（明日 10:00）に**同時に**予約を入れようとする。
医師 X はデモ 太郎、医師 Y はデモ 花子の予約を入れる。目安の所要時間は解説込み 10 分（D-32。30 分版は S1 + S2 + S3）。

S2 と同じく**ステージビューを使わず**、医師 X・医師 Y の電子カルテ、放射線部門システム、通信モニタ、デモ制御パネルを
別ウィンドウで並べ、[06-demo-procedures.md](06-demo-procedures.md) に従って手で操作する（D-33）。
準備はデモ制御パネルの「S3-x の準備」ボタンで行い、電子カルテの予約方式（仮押さえを使う / Appointment を直接作る）もここで切り替える（D-36）。

### 追加リソース

- Schedule（CT-1 号機）、Slot（30 分枠、`free`。初期化した時点の翌日 9:00〜12:00 の 6 枠を生成し、一部は予約済み。D-39）
- ServiceRequest（category: imaging）、Appointment、Task（放射線部宛て）

### 放射線部門システムの範囲

予約枠カレンダーと、通知で届く予約・Task の一覧の表示まで（D-34）。受付・撮影・読影の操作は作らない。

### S3-1. NG パターン：枠を確認せずに Appointment を作る → 二重予約

電子カルテの予約方式を「直接予約する」にする。確定の Transaction から Slot の更新を除いたもの（Appointment + ServiceRequest + Task の POST）を送る。

| 時刻 | 医師 X | 医師 Y | 結果 |
|---|---|---|---|
| T1 | `POST /`（Transaction：Appointment（slot = Slot/A）+ ServiceRequest + Task）→ `200` | | 予約 1 件。Slot/A は `free` のまま |
| T2 | | `POST /`（同上、slot = Slot/A）→ `200` | **予約 2 件（二重予約成立）**。Slot/A は `free` のまま |

- POST には If-Match が使えず、Slot 自体は更新していないので ETag では検知できない。
- 「ETag は 1 つのリソースの版を守る仕組みであり、数に限りがある枠の取り合いは別に設計が必要」と解説する。

### S3-2. 推奨パターン：仮押さえ → 確定（後発は 412）

| # | 段階 | 通信 | 状態 |
|---|---|---|---|
| 1 | 仮押さえ | `PUT /Slot/A` + `If-Match`（status = `busy-tentative`、comment = 「仮押さえ：医師 X」） | 先に到達した側だけ成功、後発は `412` |
| 2 | 確定 | `POST /`（Transaction：`PUT Slot/A`（`busy`、`ifMatch`）+ `POST Appointment` + ServiceRequest + Task） | Slot: `busy`、Appointment: `booked` |

- 後発の医師の画面には「この枠は他の利用者が予約中です」と表示し、別の枠を選ぶ画面へ誘導する（自動リトライはしない）。
- 押さえた人は `Slot.comment` に表示用として書く。確定できるかどうかは版だけで判定する（D-35）。
- 二重予約は Slot の版の確認（`ifMatch`）だけで防ぐ。If-None-Exist は使わない（D-40）。If-None-Exist は「一致するものがあれば作らずに既存を返す（成功）」仕組みで、
  同じものを二重に作らないためのものであり、取り合いを拒否する仕組みではないことを解説で触れる。

### S3-3. 仮押さえの期限切れ → 確定は Transaction 全体が 412

| # | 段階 | 通信 | 状態 |
|---|---|---|---|
| 1 | 仮押さえ | S3-2 の 1 と同じ | Slot: `busy-tentative` |
| 2 | タイムアウト | サーバー内の処理（通信モニタに送信元「FHIR サーバー（仮押さえの期限切れ）」として表示。D-37） | 仮押さえのまま一定時間経過した Slot を `free` に戻す（版が上がる） |
| 3 | 確定 | S3-2 の 2 と同じ Transaction | Slot の `ifMatch` が合わず `412`。Appointment・ServiceRequest・Task も**作られない** |

- タイムアウトはデモでは **30 秒**程度に短縮し（D-17。デモ制御パネルで変更可）、仮押さえを放置すると枠が戻る様子を見せる。
- 「Transaction は全部成功するか、全部取り消されるか」を見せる場面でもある。

### 拡張案（P3）

- IHE SWF on FHIR に沿った階層化：ServiceRequest（imaging-order）→ ServiceRequest（requested-procedure、basedOn）→ Task（Scheduled Procedure Step）。
- モダリティ側（DICOM MWL / MPPS）は画面上の模擬操作で代替し、DICOM 通信は実装しない。

---

## S4. 処方調剤（P2）

医師が処方し、薬剤部が受付・調剤・監査を経て、外来では患者にお渡し（交付）し、入院では病棟へ払い出す。
**外来（院内処方）を本線、入院（臨時処方）を変化形**とする（D-41）。処方から監査までは同じ手順で、最後の操作とその結果だけが異なる。
S1 と同じく**ステージビューと講演・自習モード**で見せ、部門システムの列（S1 の検体検査システム）を薬剤部門システムに差し替える。入院では電子カルテの列を病棟の看護師の画面に切り替える（D-42）。
目安の所要時間は解説込み 12 分（外来 8 分 + 入院の違い 4 分。D-49。45 分版は S1〜S4）。どちらの場面も初期化から始める（D-50）。

### 追加リソース・初期データ

- MedicationRequest（`intent = order`、1 剤。D-45）、Task（薬剤部宛て）、MedicationDispense。
- 初期データ：薬剤部の Organization、薬剤師 C・薬剤師 E、看護師 F、外科病棟の Location、デモ 三郎と入院中の Encounter（class `IMP`）（D-44・D-46・D-48・D-50）。

### 外来と入院の違い

| | 外来（本線） | 入院（変化形） |
|---|---|---|
| 患者・処方する医師 | デモ 太郎・医師 X（内科外来） | デモ 三郎・医師 Y（外科病棟に入院中） |
| `MedicationRequest.category`（JP Core MERIT9 区分） | `OHP` 外来処方 + `OHI` 院内処方 | `IHP` 入院処方 + `XTR` 臨時処方 |
| `MedicationRequest.encounter` | なし（S1 と同じ） | 入院の Encounter |
| 処方から監査まで | 同じ通信・同じ Task の状態 | 同じ通信・同じ Task の状態 |
| 最後の操作 | 患者に**お渡し（交付）** | 病棟へ**払出** |
| MedicationDispense | `completed`、`receiver` = 患者 | `completed`、`destination` = 外科病棟（`receiver` なし） |
| Task | `completed` | `completed` |
| MedicationRequest | **`completed`**（指示がすべて済んだ） | **`active` のまま**（投与が続く） |
| 結果を見る画面 | 電子カルテ（医師 X） | 電子カルテ（看護師 F、外科病棟） |

### 業務の段階と FHIR の状態の対応

| 段階 | 主な更新者 | MedicationRequest | Task.status / businessStatus（owner） | その他 |
|---|---|---|---|---|
| 処方 | 医師 | `active` | `requested`（薬剤部） | |
| 受付・調剤 | 薬剤師 C | `active` | `in-progress` / 調剤中（薬剤師 C） | |
| 監査 | 薬剤師 E | `active` | `in-progress` / 監査中（薬剤師 E） | |
| お渡し（外来） | 薬剤師 E | `active` → `completed` | `completed` | MedicationDispense: `completed` |
| 払出（入院） | 薬剤師 E | `active`（変えない） | `completed` | MedicationDispense: `completed` |

調剤した薬剤師とは別の薬剤師が監査する運用に合わせ、監査の開始で Task.owner を薬剤師 E に変える。
MedicationDispense の `performer` には調剤者（`packager`：薬剤師 C）と監査者（`checker`：薬剤師 E）の両方を記録する（D-46）。
監査の完了とお渡し・払出は 1 つの操作とし、「払出待ち」の段階は設けない（D-47）。

### ステップ（外来）

| # | 業務上の出来事 | 操作する画面 | 通信 | リソースの状態変化 |
|---|---|---|---|---|
| 1 | 医師 X がデモ 太郎に処方 | 電子カルテ（医師 X） | `POST /`（Transaction：MedicationRequest + Task） | MR: `active` / `order`、外来・院内処方 / Task: `requested`（owner = 薬剤部） |
| 2 | 薬剤部の画面に新着処方が届く | （自動） | Subscription 通知 → 薬剤部門システムが取得 | 変化なし |
| 3 | 薬剤師 C が受付・調剤を開始 | 薬剤部門システム（薬剤師 C） | `PATCH /Task/{id}` + `If-Match`（status・owner・businessStatus） | Task: `in-progress`、調剤中（owner = 薬剤師 C） |
| 4 | 薬剤師 E が監査を開始 | 薬剤部門システム（薬剤師 E） | `PATCH /Task/{id}` + `If-Match`（owner・businessStatus） | Task: `in-progress`、監査中（owner = 薬剤師 E） |
| 5 | 薬剤師 E が監査を終え、患者にお渡し | 薬剤部門システム（薬剤師 E） | `GET /Task/{id}/_history`（調剤した薬剤師の確認。D-51）→ `POST /`（Transaction：MedicationDispense（POST）+ Task（PUT、`ifMatch`）+ MedicationRequest（PUT、`ifMatch`）） | MD: `completed`（authorizingPrescription → MR、performer = 薬剤師 C・E、receiver = 患者）/ Task: `completed`（output → MD）/ MR: `completed` |
| 6 | 電子カルテにお渡し済みと表示 | （自動） | Subscription 通知 → 電子カルテが取得 | 変化なし |

### S4-a. 入院（臨時処方 → 病棟へ払出）

ステップ 1〜4 は、患者（デモ 三郎）・処方する医師（医師 Y）・区分（入院処方・臨時処方）・`encounter` を除いて外来と同じ。

| # | 業務上の出来事 | 操作する画面 | 通信 | リソースの状態変化 |
|---|---|---|---|---|
| 5 | 薬剤師 E が監査を終え、病棟へ払出 | 薬剤部門システム（薬剤師 E） | `GET /Task/{id}/_history` → `POST /`（Transaction：MedicationDispense（POST）+ Task（PUT、`ifMatch`））。**MedicationRequest は含めない** | MD: `completed`（destination = 外科病棟）/ Task: `completed`（output → MD）/ MR: **`active` のまま** |
| 6 | 病棟の看護師 F の画面に払出済みと表示 | （自動） | Subscription 通知 → 電子カルテ（看護師 F）が取得 | 変化なし |

- 病棟での受領の操作と与薬（MedicationAdministration）は作らない（D-48）。
- 講演では、ステップ 1〜4 を進行パネルの「ステップ 4 まで進める（外来と同じ部分）」で 1 回の操作で送り、ステップ 5・6 と外来との違いを解説する。
  送る間の通信（処方・通知・受付・監査）はすべて実際に送られ、通信モニタに残る（D-52）。

### 解説ポイント

- 検体検査は ServiceRequest、処方は **MedicationRequest** と、依頼のリソースが部門で異なる。
- 進捗管理の仕組み（Task の状態・担当者・businessStatus、If-Match、Subscription）は共通なので、部門システム側の作り方は揃えられる。
- 外来も入院も Task（薬剤部の作業）は `completed` になるが、MedicationRequest（処方の指示）は外来では `completed`、入院では `active` のまま（D-43）。
  **「作業が終わった」と「依頼がすべて済んだ」は別**であることを、S1 よりはっきり示せる。入院の処方は、投与期間の終了や医師の中止の時点で電子カルテが `completed` / `stopped` にする（S4 では作らない）。
- 外来の MedicationRequest を完了にするのは、S1 の ServiceRequest と同じく、部門システムが完了を報告する Transaction に含めて行う（通信モニタで「誰がいつ完了にしたか」が見える）。
- 調剤と監査を別の薬剤師が行うことは、Task.owner の変化と MedicationDispense の `performer` で表す。
  監査の開始で Task.owner は監査する薬剤師に変わるため、調剤した薬剤師はお渡し・払出の前に **Task の版の履歴（`_history`）** から読み取る（D-51）。
  版の履歴が「誰がいつ担当したか」の記録になっていることを示せる。
- コードは HOT コード（薬剤）・JAMI 用法コード・MERIT9 の処方区分を使う（[04-design-rules.md](04-design-rules.md#コード体系と-jp-core) 参照）。

### 拡張案（P3）

- 疑義照会：Task: `on-hold` + Communication で薬剤部から医師へ問い合わせ → 医師が回答 → 処方修正 → `in-progress` に戻す。
- 複数の剤を 1 枚の処方箋にまとめる（`groupIdentifier` に処方箋番号、Task 1 件の `basedOn` に全剤の MedicationRequest）。
- 病棟での受領・与薬（MedicationAdministration）と、入院の処方の終了（電子カルテが `completed` / `stopped` にする）。
- 処方の取消（MedicationRequest: `revoked`、Task: `cancelled`）、定期処方。

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
| 薬剤部門システム（薬剤師 C / 薬剤師 E） | 処方を受けて調剤 | 処方一覧（外来・入院）、受付・調剤・監査・お渡し（外来）／払出（入院） |
| 通信モニタ | 通信の見える化 | システム間のシーケンス図（アニメーション）、リクエスト/レスポンス詳細（JSON）、リソースの版履歴 |
| デモ制御パネル | 進行と設定 | シナリオ選択、ステップ送り/戻し、初期化、ポリシー切替（If-Match 必須、状態遷移チェック）、タイムアウト秒数 |

- **ステージビュー**：講演用に、電子カルテ・部門システム・通信モニタを 1 画面に並べた 3 列のレイアウト。講演はこの 1 画面だけで行う（D-26）。ただし S2・S3 はステージビューを使わず、個別ウィンドウを並べて手順書（[06-demo-procedures.md](06-demo-procedures.md)）に従って操作する（D-29、D-33）。S4 はステージビューを使い、部門システムの列を薬剤部門システムにする（D-42）。
- **個別ウィンドウ**：各画面を別タブ・別ウィンドウで開くこともできる（自習・展示で外部モニタがある場合、S2・S3 の実演など）。
