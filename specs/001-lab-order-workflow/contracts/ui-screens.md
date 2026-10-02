# Contract: 画面（UI）

講演・自習で使う画面の入口（ルート）、各画面が FHIR サーバーに対して名乗る識別子、シナリオ定義の形式を定義する。

## ルート

| パス | 画面 | 備考 |
|---|---|---|
| `/` | 起動画面 | 講演モード / 自習モード / 個別ウィンドウの選択 |
| `/stage?mode=presentation` | ステージビュー（講演モード） | 電子カルテ・検体検査システム・通信モニタを 1 画面に並べ、進行パネルを表示（FR-026〜FR-028） |
| `/stage?mode=self-study` | ステージビュー（自習モード） | 同じ配置で、進行パネルの代わりにガイドを表示（FR-029） |
| `/ehr?role=doctor` | 電子カルテ（医師） | 個別ウィンドウ |
| `/ehr?role=nurse` | 電子カルテ（看護師） | 個別ウィンドウ |
| `/lis?tech=tech-a` / `/lis?tech=tech-b` | 検体検査システム（技師 A / 技師 B） | 個別ウィンドウ。S1 では技師 A を使う |
| `/monitor` | 通信モニタ | 個別ウィンドウ |

- ステージビュー内の各領域は、個別ウィンドウと同じ画面部品を使う。電子カルテ領域では医師 / 看護師を切り替える。
- 個別ウィンドウ同士・ステージビューとの間で状態は共有せず、各画面が FHIR サーバーから取得する（原則 I）。
- 表示は 1920×1080 のプロジェクタで後方から読める文字の大きさを基準にし、1280×720 でも横スクロール無しで表示できる。

## `X-Demo-Client` の値と Subscription

| 画面 | `X-Demo-Client` | 通信モニタ上の名前 | Subscription id | criteria |
|---|---|---|---|---|
| 電子カルテ（医師） | `ehr-doctor` | 電子カルテ（医師 X） | `ehr-dr-x` | `Task?requester=Practitioner/dr-x` |
| 電子カルテ（看護師） | `ehr-nurse` | 電子カルテ（看護師 D） | `ehr-nurse` | `Task?owner=Organization/lab-dept,PractitionerRole/tech-a,PractitionerRole/tech-b`（採血待ちの一覧は画面で `requested` かつ未採取に絞る） |
| 検体検査システム（技師 A） | `lis-tech-a` | 検体検査システム（技師 A） | `lis-lab-dept` | `Task?owner=Organization/lab-dept,PractitionerRole/tech-a,PractitionerRole/tech-b` |
| 検体検査システム（技師 B） | `lis-tech-b` | 検体検査システム（技師 B） | `lis-lab-dept` | 同上（同じ Subscription に bind する） |
| 通信モニタ | `monitor` | 通信モニタ | — | — |
| シナリオの自動実行 | 実行するステップの画面の値 | その画面の名前 | — | — |

- criteria は「更新後の状態」で評価されるため、状態が変わると外れる条件（例：`status=requested`）は使わない。
  受付や取消の後も通知が届くよう、変わらない要素（`requester`、検査部と技師の `owner`）を条件にする。
- 電子カルテ（医師）の依頼一覧は、ServiceRequest の `category` が検体検査（SNOMED CT `108252007`）のものだけに絞る。医師 X が CT 予約（specs/003）で出した画像検査の依頼を、検体検査の一覧に出さないため（specs/003 research R-08）。
- 電子カルテ（医師）と（看護師）を 1 つのシステムとして表示するため、通信モニタのシーケンス図では両者を同じ列「電子カルテ」に置き、
  矢印の注記で操作者を示す。
- 通信モニタ自身が版の履歴などを取得する通信（`monitor`）は、既定では図に表示しない（切り替えで表示できる）。記録自体は行う（原則 III）。

## 画面の更新の流れ

1. 開いたとき：自分の Subscription を `GET` → 404 なら `PUT` で作成 → `/ws/subscription` で `bind` → 表示データを検索で取得。
2. `ping` を受けたとき：表示データを取り直す。
3. 操作するとき：表示中のリソースの `ETag` を保持し、更新には `If-Match`（Transaction では `ifMatch`）を付ける。受付だけは、受付を始めた時点で取得した ETag を確定まで使う（specs/002、D-27）。
4. `412` のとき：「他の利用者が先に更新しました」と表示して最新を取り直す。自動でやり直さない（FR-004）。
5. `demo.reset` を受けたとき：表示を初期状態に戻し、1. からやり直す。

## エラーの表示（FR-032）

| 応答 | 表示 |
|---|---|
| 400（If-Match 無し） | 「更新の前提となる版が指定されていません」 |
| 400（その他） | 「要求の内容に誤りがあります」+ OperationOutcome の理由 |
| 404 | 「対象のデータが見つかりません（初期化された可能性があります）」 |
| 412 | 「他の利用者が先に更新しました。最新の状態を表示します」 |
| 422（状態遷移） | 「この状態からは {操作名} できません」+ 現在の状態 |
| 通信できない | 「FHIR サーバーに接続できません」 |

いずれも HTTP ステータスとコード値を併記する（例：「… `412 Precondition Failed`」）。状態の表示ラベルは docs/04 の表に従う。

## シナリオ定義の形式

講演モード・自習モードは同じシナリオ定義を使う（R-13）。UI のソースに TypeScript のデータとして置く。

```ts
type ScenarioId = "s1-main" | "s1-cancel" | "s1-reject" | "s1-rerun" | "s1-partial";
type Client = "ehr-doctor" | "ehr-nurse" | "lis-tech-a" | "lis-tech-b";

interface Scenario {
  id: ScenarioId;
  title: string;                 // 例：「検体検査（通常の流れ）」
  steps: ScenarioStep[];
}

interface ScenarioStep {
  no: number;                    // 1 始まり
  title: string;                 // 例：「技師 A が検体を受付」
  actor: Client | "auto";       // auto = 利用者の操作が無く、通知を受けた画面が自動で取り直すステップ
  target: { screen: "ehr" | "lis"; control?: string; role?: "doctor" | "nurse" };  // 自習モードで強調する画面とボタン。control は data-guide 属性の値（カンマ区切りで複数）、role は電子カルテの役割（案内が医師／看護師を切り替える）。auto は画面のみ
  run?: (ctx: ScenarioContext) => Promise<void>;         // 自動実行の処理（画面と同じ FHIR 要求を送る）。auto のステップには無い
  expected: ExpectedState;       // このステップ完了時の期待状態（ステップの判定、テストに使う）
  explanation: {
    business: string;            // 業務上の意味（医療従事者向け）
    fhir: string;                // FHIR 上の意味（技術者向け）
  };
}

interface ExpectedState {
  serviceRequest?: string;       // status
  task?: { status: string; businessStatus?: string; owner?: string };
  specimen?: "not-collected" | "collected";
  diagnosticReport?: "none" | "partial" | "final";
  traffic?: TrafficCondition[];  // 前のステップの完了後に観測されるべき通信（通信記録で判定）
}

type TrafficCondition =
  | { kind: "notification"; targetClient: Client }                        // その画面への ping
  | { kind: "http"; client: Client; method: "GET" | "POST" | "PUT" | "PATCH"; resourceType: string }; // その画面の要求
```

### ステップの判定

データの状態だけでは、通知による自動反映（auto）や結果の確認のように**データが変わらないステップ**を前後のステップと区別できない。
そのため、ステップの完了は次の 2 つで判定する。

1. **データの条件**：`expected` のうち `traffic` 以外の項目が、FHIR サーバーから取得した現在の状態と一致する。
2. **通信の条件**：`expected.traffic` の各条件に一致する通信記録（TrafficRecord）が、**前のステップの基準 `seq` より大きい `seq`** で存在する。
   基準 `seq` は、前のステップの各通信の条件について「基準より後で**最初に**一致した記録」の `seq` の最大値（最初のステップでは、シナリオ開始時点で受信済みの最大の `seq`）。
   最後の記録ではなく最初のものを使うのは、後続のステップの操作で同じ種類の通知・取得が再び起きても、基準が先へずれないようにするため。
   通信記録は `/demo/traffic` と `/ws/monitor` から得る（contracts/websocket.md）。
   `http` の `seq` は要求の受信時に採番されるため、要求の処理中に送られた ping はその要求より大きい `seq` を持つ。

- ステップは先頭から順に判定し、完了したステップの次を「現在のステップ」とする。判定は通信記録を受け取るたびに行う（手動操作・自習モード）。
- 講演モードの「次へ」：操作のあるステップは `run` を実行してから、auto のステップはそのまま、完了の判定を最大 5 秒待つ。
  5 秒以内に完了しなければ「通知を待っています」と表示し、ステップを進めない。
- 自習モード：auto のステップでは `target.screen` の画面を強調し「通知が届くのを待っています」と表示する。完了すると自動で次のステップへ進む。
- `s1-main` の各ステップの actor と通信の条件：

  | # | ステップ | actor | 通信の条件（`traffic`） |
  |---|---|---|---|
  | 1 | 医師 X が血算を依頼 | `ehr-doctor` | `http` `ehr-doctor` `POST` `Bundle` |
  | 2 | 検査部の画面に新着依頼が届く | `auto` | `notification` → `lis-tech-a`、`http` `lis-tech-a` `GET` `Task` |
  | 3 | 看護師 D が採血 | `ehr-nurse` | `http` `ehr-nurse` `POST` `Bundle` |
  | 4 | 技師 A が検体を受付（受付を始める `GET` → 確定 `PATCH` の 2 段階。specs/002、D-27） | `lis-tech-a` | `http` `lis-tech-a` `PATCH` `Task` |
  | 5 | 電子カルテに「受付済み」と表示 | `auto` | `notification` → `ehr-doctor`、`http` `ehr-doctor` `GET` `Task` |
  | 6 | 測定開始 | `lis-tech-a` | `http` `lis-tech-a` `PATCH` `Task` |
  | 7 | 結果を承認・報告 | `lis-tech-a` | `http` `lis-tech-a` `POST` `Bundle` |
  | 8 | 医師 X が結果を確認 | `ehr-doctor`（`run` は結果表示を開く） | `http` `ehr-doctor` `GET` `DiagnosticReport` |

  ステップ 8 は、電子カルテの結果表示が開いていれば、ステップ 7 の通知を受けた自動の取り直しでも完了する（医師の画面に結果が表示されたことを表す）。
  `Bundle` は Transaction（`POST /fhir`）を表す。

| シナリオ | ステップ |
|---|---|
| `s1-main` | docs/02 S1 の 8 ステップ（上表） |
| `s1-cancel` | 依頼 → 採血 → 受付 → 医師が取消 |
| `s1-reject` | 依頼 → 採血 → 技師が受付不可（理由入力） |
| `s1-rerun` | 依頼 → 採血 → 受付 → 測定開始 → 再検 → 再開 → 全項目報告 |
| `s1-partial` | 依頼（血算 + 生化学）→ 採血 → 受付 → 測定開始 → 血算のみ報告 → 生化学を報告 |

バリエーションのシナリオでも、データが変わらないステップ（通知による反映、結果や理由の確認）には `traffic` の条件を付ける。
