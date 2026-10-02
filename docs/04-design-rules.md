# 04. 設計ルール

FHIR は状態遷移の強制方法・If-Match を必須にするか・ロックの方式などを規定しておらず、実装側に任せている。
このデモで採用するルールをここで定める。各項目の位置付け（決定 / 提案 / 未決）は [05-decisions.md](05-decisions.md) で管理する。

## リソースの役割分担

| 役割 | リソース | status の意味 |
|---|---|---|
| 依頼（何をしてほしいか） | ServiceRequest（検査・画像）、MedicationRequest（処方） | **認可・意図の状態**。依頼が有効か、取り消されたか |
| 履行（誰がどこまで実行したか） | Task（`focus` → 依頼リソース） | **作業の進捗**。受付・実施中・完了など |
| 結果（何が起きたか） | Observation、DiagnosticReport、MedicationDispense、ImagingStudy | 結果の確定状態 |
| 枠（希少資源） | Schedule、Slot、Appointment | 空き・仮押さえ・予約済み |

- Task は依頼 1 件につき 1 件作成する（放射線の階層化は S3 拡張案で扱う）。
- 依頼の発行時に Task も同じ Transaction で作成する（作成者は電子カルテ）。

## Task の状態遷移マトリクス

R4 の Task.status のうち、デモで使う値に絞る（`received` / `ready` / `entered-in-error` は使わない）。
状態遷移チェック（F9）が ON のとき、表に無い遷移は `422 Unprocessable Entity`（OperationOutcome 付き）で拒否する。

| 現在 \ 遷移先 | requested | accepted | rejected | in-progress | on-hold | completed | failed | cancelled |
|---|---|---|---|---|---|---|---|---|
| **requested** | — | 部門 | 部門 | 部門 | | | | 依頼元 |
| **accepted** | | — | | 部門 | 部門 | | | 依頼元 / 部門 |
| **in-progress** | | | | — | 部門 | 部門 | 部門 | 依頼元 / 部門 |
| **on-hold** | | | | 部門 | — | | 部門 | 依頼元 / 部門 |
| **completed** / **rejected** / **failed** / **cancelled** | 終了状態。遷移不可。status を変えない更新（businessStatus・owner などのみ）も含め、**一切の更新を 422 で拒否する** |

- 「部門」= Task.owner 側のシステム、「依頼元」= Task.requester 側のシステム。
  操作者による制限は画面側で行い、サーバー側では遷移の可否だけを判定する（認証が無いため）。
- `requested` → `in-progress`（受付を省略して即実施）は検体検査の現場運用を考慮して許可する。

### ServiceRequest / MedicationRequest の status

| 状態 | 契機 |
|---|---|
| `active` | 依頼の発行時 |
| `revoked` | 依頼元による取消（Task の `cancelled` と同じ Transaction で更新） |
| `completed` | **全項目の結果が確定・報告された時点**。部門システムが結果報告の Transaction に含めて自動更新する（検体検査。処方の MedicationRequest をいつ完了にするかは S4 の詳細化時に決める） |

### businessStatus（部門ごとの業務上の細かい状態）

Task.status だけでは表せない段階を Task.businessStatus（`text` に日本語）で表す。

| 部門 | 値（案） |
|---|---|
| 検体検査 | 未採取 / 採取済 / 検体到着 / 測定中 / 再検中 / 一部報告済 / 報告済 |
| 放射線 | 予約済み / 受付済み / 撮影中 / 読影中 |
| 薬剤 | 調剤中 / 監査中 / 払出待ち / 疑義照会中 |

## Task.owner の扱い

- 依頼の発行時：`owner` = 部門の Organization（例：`Organization/lab-dept`）。
- 受付時：`owner` = 担当者の PractitionerRole（例：技師 A）に変更する。**status と owner を 1 回の PATCH で同時に更新し、If-Match を付ける。**
- 部門の受付待ち一覧は `Task?owner=Organization/lab-dept&status=requested` で取得する。
- 受付後は owner が担当者に変わるため、部門全体の一覧と Subscription の criteria は、部門と所属技師を OR で列挙する。
  例：`Task?owner=Organization/lab-dept,PractitionerRole/tech-a,PractitionerRole/tech-b`
  （部門システムは自部門の職員を知っている前提。チェーン検索は実装しない）

## 楽観的ロック（If-Match）

| 項目 | ルール |
|---|---|
| ETag の形式 | `W/"{versionId}"` |
| If-Match の扱い | 既定は**必須**（ヘッダ無しの update / patch は `400`）。S2-1 のデモ時だけ「任意」に切り替える |
| 版の不一致 | `412 Precondition Failed`（OperationOutcome 付き） |
| 412 を受けたクライアント | **自動リトライしない**。「他の利用者が先に更新しました」と表示し、最新の状態を取り直して画面に反映する。続けるかどうかは利用者が判断する |
| Transaction 内 | 更新するエントリには `entry.request.ifMatch` を付ける。1 件でも不一致なら全体を元に戻し `412` |
| 対象外 | create（POST）には If-Match が使えない。If-None-Exist は一致するものがあれば作らずに既存を返す（成功）ため、同じものの二重登録の防止には使えるが、数に限りがある枠の取り合いの拒否には使えない。枠の取り合いは Slot の版の確認で防ぐ（D-40） |

## Transaction Bundle の利用単位

| 操作 | Bundle の中身 |
|---|---|
| 検査依頼 | ServiceRequest（POST）+ Task（POST）+ Specimen（POST） |
| 採血・検体採取 | Specimen（PUT、`ifMatch`、collection）+ Task（PUT、`ifMatch`、businessStatus = 採取済） |
| 検査結果（全項目確定） | Observation × n（POST）+ DiagnosticReport（POST、`final`）+ Task（PUT、`ifMatch`、`completed`、output）+ ServiceRequest（PUT、`ifMatch`、`completed`） |
| 検査結果（一部先行） | Observation × n（POST）+ DiagnosticReport（POST、`partial`）。Task・ServiceRequest は更新しない |
| 依頼の取消 | ServiceRequest（PUT、`revoked`）+ Task（PUT、`cancelled`）、どちらも `ifMatch` |
| CT 予約の確定 | Slot（PUT、`busy`、`ifMatch`）+ Appointment（POST）+ ServiceRequest（POST）+ Task（POST） |
| 処方 | MedicationRequest（POST）+ Task（POST） |
| 払出 | MedicationDispense（POST）+ Task（PUT、`ifMatch`、`completed`、output） |

進捗の更新（受付・実施中・businessStatus の変更）は Bundle にせず、Task 単体の PATCH で行う。

## 予約枠（Slot）

- 状態の流れ：`free` →（仮押さえ）`busy-tentative` →（確定）`busy`。
- 仮押さえ中は `Slot.comment` に押さえた人を書く（例：「仮押さえ：医師 X」）。表示用であり、確定できるかどうかは版（`ifMatch`）だけで判定する。`free` に戻すときは消す（D-35）。
- 仮押さえのタイムアウト：既定 **30 秒**（デモ用。デモ制御パネルで変更可）。超過したら `free` に戻す。この更新は通信記録に送信元「FHIR サーバー（仮押さえの期限切れ）」として残す（D-37）。
- 確定の Transaction の Slot の更新には、仮押さえで得た版の `ifMatch` を付ける。期限切れ・他の利用者の更新で版が変わっていれば全体が `412` になる。Appointment に If-None-Exist は付けない（D-40）。
- 仮押さえに失敗した画面（412）は自動リトライせず、別の枠の選択を促す。

## コード体系と JP Core

目的はワークフローの説明であり、JP Core への準拠は**必要な範囲に留める**。

| 項目 | ルール |
|---|---|
| 採用する版 | **JP Core 1.2.0**（`jp-core.r4#1.2.0`）、**JP Terminology 2.2609.0**（`jpfhir-terminology#2.2609.0`）。`scripts/fetch-jp-packages.sh` で取得し、リポジトリには含めない |
| プロファイル | JP Core にプロファイルがあるリソースは `meta.profile` に設定する。サーバー側での検証は行わない。コード・プロファイルの存在はテストで確認する |
| JP Core に無いもの | Task、Subscription、Slot、Appointment など（JP Core 1.2.0 にプロファイルが無い）は FHIR R4 の基本定義に従う |
| 検体検査の項目 | JLAC10（`http://medis.or.jp/CodeSystem/master-JLAC10-17digits`、日本語の表示名を `display` に設定）。CLINS コア検査項目に含まれるコードを優先する。LOINC の併記は任意 |
| 薬剤 | HOT コード |
| 用法 | JAMI 用法コード |
| 単位 | UCUM |
| 画像検査 | モダリティは DICOM のコード（例：`DCM#CT`。JP_RadiologyModality_VS に含まれる）。検査内容は JJ1017 が JP Terminology 2.2609.0 に含まれないため、デモ用の独自コード（`https://demo.example.jp/fhir/CodeSystem/radiology-procedure`、日本語の `display` 付き）とする（D-39）。放射線の業務上の状態は `https://demo.example.jp/fhir/CodeSystem/rad-business-status`（S3 は `booked` 予約済みだけを使う） |
| system URI | 上記の版が定める URI を使う。S1 で使うものは specs/001-lab-order-workflow/data-model.md に一覧化 |

## 表示ラベル

画面には業務用語を主に表示し、FHIR のコード値を併記する（例：「受付済み `accepted`」）。

### Task.status

| コード | 表示 |
|---|---|
| `requested` | 依頼済み |
| `accepted` | 受付済み |
| `rejected` | 受付不可 |
| `in-progress` | 実施中 |
| `on-hold` | 保留 |
| `completed` | 完了 |
| `failed` | 中断（失敗） |
| `cancelled` | 取消 |

### ServiceRequest / MedicationRequest.status

| コード | 表示 |
|---|---|
| `active` | 有効（依頼中） |
| `revoked` | 取消 |
| `completed` | 完了 |
| `on-hold` | 保留 |

### Slot.status / Appointment.status

| コード | 表示 |
|---|---|
| `free` | 空き |
| `busy-tentative` | 仮押さえ中 |
| `busy` | 予約済み |
| `booked`（Appointment） | 予約確定 |
| `cancelled`（Appointment） | 予約取消 |

### HTTP ステータス

| コード | 表示 |
|---|---|
| `200` / `201` | 成功 |
| `400` | 要求の形式が不正（例：If-Match が無い） |
| `412` | 他の利用者が先に更新済み |
| `422` | 業務ルール違反（例：許可されない状態遷移） |
