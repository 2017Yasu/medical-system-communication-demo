# Research: S2 排他制御①：同時受付

**Feature**: [spec.md](spec.md) | **Plan**: [plan.md](plan.md) | **Date**: 2026-10-02

S1（[specs/001-lab-order-workflow/research.md](../001-lab-order-workflow/research.md)）の技術選定（HAPI FHIR 8.12.1 plain server、
インメモリのリポジトリ、React + TypeScript、Vitest / Playwright / JUnit 5）はそのまま使う。本書は S2 で新たに決めることだけを扱う。
Technical Context に NEEDS CLARIFICATION は無い。以下は、S1 のコードを読んだうえで設計上の選択肢を比較した結果である。

## R-01 検体検査システムの「版の確認を付ける／付けない」の置き場所（FR-006）

- **Decision**: サーバーのデモのポリシー（`DemoPolicy`）に `labSendsIfMatch`（既定 `true`）を追加し、`GET/PUT /demo/policy` で読み書きする。
  変更は既存の `demo.policy` メッセージ（`/ws/monitor`）で全ウィンドウに配信し、初期化（`/demo/reset`）で既定値に戻す。
  サーバーはこの値で判定を変えない（If-Match の判定は従来どおり `ifMatchRequired` だけで行う）。値を読むのは検体検査システムの画面だけ。
- **Rationale**: 技師 A・技師 B・デモ制御パネルは別々のウィンドウ（D-29）なので、設定をウィンドウ間で共有する必要がある。
  原則 I はブラウザ間メッセージ・共有ストレージを禁じており、例外は `/demo/*`（初期化・ポリシー変更）だけ。
  既存の `demo.policy` 配信に相乗りすれば、新しい経路を作らずに済み、変更が通信モニタにも「ポリシーの変更」として記録される（原則 III）。
- **Alternatives considered**:
  - `localStorage` / `BroadcastChannel` で共有：原則 I 違反。
  - URL パラメータ（`/lis?tech=tech-a&ifMatch=omit`）：ウィンドウを開き直さないと切り替えられず、準備ボタン（D-30）で一括して切り替えられない。
  - FHIR リソース（例：`Basic`）に保存：業務データではない設定を FHIR に混ぜることになり、デモの説明が濁る。

## R-02 準備ボタンの処理をどこで実行するか（FR-001、D-30）

- **Decision**: デモ制御パネルのウィンドウ（ブラウザ）で順に実行する：
  `POST /demo/reset` → `PUT /demo/policy`（シナリオの設定）→ 依頼（`X-Demo-Client: ehr-doctor` の Transaction）→ 採血（`ehr-nurse` の Transaction）。
  依頼・採血は S1 の `placeOrder` / `recordCollection`（`ui/src/fhir/labActions.ts`）をそのまま使う。
  途中で失敗したら、失敗した段階と業務上のエラーをパネルに表示して止める（やり直しは準備ボタンを押し直す）。
- **Rationale**: S1 のシナリオの自動実行（R-13）と同じく、ブラウザから FHIR の要求として送れば、通信記録フィルタを通り、
  通信モニタに「電子カルテ（医師 X）」「電子カルテ（看護師 D）」の通信として現れる（原則 I・III）。
- **Alternatives considered**:
  - サーバー側に `/demo/prepare` を作り、サーバー内部でリソースを書き込む：`/fhir/*` を通らないため通信モニタに出ない（原則 III 違反）。
    初期データ（seed）に「採取済」の依頼を含める案も、依頼・採血の通信が見えなくなるため採らない。
  - ステージビューの ScenarioRunner を流用：S2 はステップ送り・完了判定を持たない（D-30）ため過剰。

## R-03 受付の 2 段階化と、読み込んだ版の保持（FR-003、D-27）

- **Decision**:
  - 「受付」ボタン（受付を始める）で `GET /Task/{id}` を送り、応答のリソースと ETag を**受付中の作業**（`AcceptDraft`）として画面の状態に保持する。
    受付の確認欄（行の下に開く。受付不可の理由入力欄と同じ形）に、患者・検査・作業の状態・担当者・**読み込んだ版**を表示する。
  - 「受付を確定」で、`AcceptDraft` の ETag を If-Match に使って `PATCH /Task/{id}` を送る（`labSendsIfMatch = false` なら If-Match を付けない）。
    「取りやめ」で `AcceptDraft` を破棄する（通信は無い）。
  - 確認欄は、通知で一覧が取り直されて行の状態が変わっても閉じない（行の状態ではなく `AcceptDraft` の有無で表示する）。
    確定の結果（成功・412・400）を受けてから閉じる。
- **Rationale**: 現在の一覧の行は通知のたびに最新の ETag に置き換わる（`loadLabOrders`）。行の ETag を使うと、技師 B は確定の直前に版 2 を受け取ってしまい、
  412 が起きない（S2-2 が再現できない）。docs/02 の時刻表（T1/T2 の GET → T3/T4 の PATCH）とも一致する。
  確認欄を行の状態から切り離さないと、技師 A の受付が通知で反映された瞬間に技師 B の確認欄が消え、競合を見せられない。
- **Alternatives considered**:
  - 通知による取り直しを S2 の間だけ止める：通信モニタの ping と画面の動きが食い違い、不自然（clarify Q1 で不採用）。
  - `FhirClient` に ETag のキャッシュを持たせる：一覧の取り直しでキャッシュが更新され、同じ問題が起きる。

## R-04 412 を受けたときの表示（FR-013）

- **Decision**: 412 を受けたら `GET /Task/{id}` で最新を取り直し、最新の `status` が `accepted` 以降で `owner` が技師なら
  「この依頼は既に {担当者名} が受付済みです（412 Precondition Failed）」を表示する。それ以外（例：取消済み）は従来の
  「他の利用者が先に更新しました。最新の状態を表示します（412 Precondition Failed）」を表示する。いずれも一覧を取り直し、自動ではやり直さない。
  担当者名は既存の `ownerLabel`（`PractitionerRole/tech-a` → 「技師 A」）で表す。
- **Rationale**: 412 の応答本文（OperationOutcome）には誰が更新したかが無い。最新を取り直すのは FR-004 の既定の動きで、追加の通信は GET 1 回だけ。
- **Alternatives considered**: OperationOutcome の diagnostics に担当者を入れる：サーバーが業務の意味を持つことになり、412 の汎用性が下がる。

## R-05 400（版の確認が無い）の文言（FR-015）

- **Decision**: `errors.ts` の 400（If-Match 無し）の文言を「版の確認（If-Match）が無い更新はサーバーが受け付けません」に変える（S1 の
  「更新の前提となる版が指定されていません」を置き換え）。判定は従来どおり OperationOutcome の diagnostics に `If-Match` を含むかで行う。
- **Rationale**: S2-3 の主題は「サーバーがルールを強制する」ことなので、主語をサーバーにした文言のほうが伝わる。S1 では 400 は通常発生しないため影響は小さい。
- **Alternatives considered**: S2 専用の文言を別に用意する：同じ応答に 2 つの文言があると説明が揺れる。

## R-06 変更のアニメーション（FR-009、D-28）

- **Decision**: 検体検査システムの一覧で、取得のたびに作業ごとの `status`・`businessStatus`・`owner` を直前の表示と比べる純粋関数
  （`diffRows(prev, next)`）を作り、変わった行に「変更前 → 変更後」（例：「担当：技師 A → 技師 B」）を表示する。
  - 行の背景を 2 回点滅させる CSS アニメーション（1.2 秒 × 2）。`prefers-reduced-motion: reduce` では点滅させず、文字だけを表示する。
  - 「変更前 → 変更後」の表示は 10 秒間残す（講演者が指し示す時間）。次の変更が来たら置き換える。
  - 初回の表示と初期化（`demo.reset`）の直後は比較しない（全行が「変更」になるのを防ぐ）。
  - 自分の操作による変更も、通知による変更も区別せずに示す（取得の契機を区別しない）。エラー・警告の見た目（赤・アイコン）は使わない。
- **Rationale**: 比較を純粋関数にすれば Vitest で検証でき、電子カルテにも後から流用できる。自分の操作の結果も同じ表示にしたほうが、
  「変わったことは見えるが、なぜ変わったか（上書き）は分からない」という S2-1 の論点が際立つ。
- **Alternatives considered**: 通知（ping）を受けた取得だけを比較する：自分の操作の後の取得と ping による取得が近接して区別が不安定になる。

## R-07 通信モニタでの版の確認の表示と、版の履歴の差分（FR-010、FR-021）

- **Decision**:
  - シーケンス図の矢印の注記に、`PUT`・`PATCH` では `If-Match: W/"1"` または `If-Match なし` を付ける（Transaction はエントリごとの ifMatch を詳細欄で見る。S1 のまま）。
  - 応答の表示：412 は「412 他の利用者が先に更新済み」（S1 のまま）、If-Match が無いための 400（応答本文の diagnostics に `If-Match` を含む）は
    「400 版の確認が必要」、それ以外の 400 は「400 要求の形式が不正」を、失敗として表示する（`sequenceModel.ts` の `resultText` に応答本文を渡す）。
  - 版の履歴（`HistoryView`）で、各版の `status`・`businessStatus`・`owner` を 1 つ前の版と比べ、変わったセルを強調表示する（`diffVersions`、純粋関数）。
    「この版を作った通信」の列に送信元の画面名を出す（既存の `findCause` の結果の `client` を表示名にする）。
- **Rationale**: S2-1（両方 200、版 2 → 版 3 で担当者が変わる）と S2-2（同じ `W/"1"` を 2 回送り、後が 412）の違いは、If-Match の値と履歴の差分を並べると一目で分かる。
- **Alternatives considered**: 詳細欄（`TrafficDetail`）だけで見せる：1 件ずつ開く必要があり、5 分の枠（D-24）に収まらない。

## R-08 デモ制御パネルの画面（FR-005〜FR-007、FR-018）

- **Decision**: 新しいルート `/control`（デモ制御パネル）を作る。内容：
  初期化ボタン（既存の `ResetButton`）、「S2-1 の準備」「S2-2 の準備」「S2-3 の準備」ボタンと実行中・結果の表示、
  サーバーの版の確認（必須／任意）と検体検査システムの版の確認（付ける／付けない）の切り替えと現在値。
  現在値は開いた時点で `GET /demo/policy`、以後は `demo.policy` / `demo.reset` で更新する。
  入口（`/`）の個別ウィンドウの一覧に「デモ制御パネル」を加え、「S2 同時受付」の小見出しで S2 で開く 4 つのウィンドウを並べる（案内ではなくリンクの一覧）。
  検体検査システムの見出しにも、現在の「版の確認：付ける／付けない（デモ設定）」を小さく表示する（設定の取り違えに気付けるように。操作の案内はしない）。
- **Rationale**: ステージビューを使わない（D-29）ため、ポリシーの切り替えを置く画面が別に必要。進行パネルに置くとステージビューを開くことになる。
- **Alternatives considered**: 通信モニタの画面に切り替えを同居させる：通信モニタは見せる画面であり、操作部品を置くと講演中に画面が煩雑になる。

## R-09 S1 への影響（D-27）

- **Decision**:
  - `labActions.ts` に `beginAccept(client, taskId)`（GET）と `confirmAccept(client, draft, techRoleId, sendIfMatch)`（PATCH）を追加し、
    `acceptTask` はこの 2 つを順に呼ぶ形に変える（シナリオの自動実行・バリエーションも画面と同じ GET → PATCH を送る）。
  - `s1Main.ts` のステップ 4 の `target.control` を `accept-{id},accept-confirm-{id}` にする（自習モードの案内は 2 つのボタンを順に強調）。
    通信の条件は従来どおり `http lis-tech-a PATCH Task`（GET は一覧の取り直しと区別できないため条件にしない）。
  - E2E（`s1-manual`・`self-study`・`variations`・`presentation`）の受付操作を「受付 → 受付を確定」に直す（`tests/e2e/pages.ts` の共通操作を変える）。
  - specs/001 の contracts/ui-screens.md のステップ 4 と画面の更新の流れに、D-27 による変更である旨を追記する。
- **Rationale**: 画面操作とシナリオの自動実行が同じ処理を共有する S1 の設計（`labActions.ts`）を保つ。

## R-10 同時性の検証（SC-002、SC-003、docs/05 V-07）

- **Decision**:
  - サーバーの結合テスト `S2ScenarioIT`：S2-1・S2-2・S2-3 を HTTP で再現する（`X-Demo-Client` 付き）。
    S2-2 の「ほぼ同時」は、2 つのスレッドが `CountDownLatch` で揃ってから同じ `If-Match: W/"1"` の PATCH を送る形で 100 回繰り返し、
    毎回ちょうど 1 つが 200・1 つが 412 で、最終の担当者が 200 を受けた側であることを確かめる。回数は `-Ds2.repeat`（既定 100）。
    S2-1・S2-3 は既定 20 回（同じプロパティで変更可）。
  - UI の E2E `s2-concurrent.spec.ts`：S1 の `PageBag`（画面ごとに別のブラウザコンテキスト＝別ウィンドウ相当）で 4 つの画面（制御パネル・技師 A・技師 B・通信モニタ）を開き、手順書どおりに S2-1〜S2-3 を操作する。
    加えて、両方の「受付を確定」を `Promise.all` で同時に押す確認を `S2_REPEAT` 回（既定 5、検証時に 100）繰り返す。
- **Rationale**: 判定の決定性（原則 IV）はサーバーの直列化（S1 R-06）で保証済みなので、HTTP 経由の 100 回で十分に確かめられる。
  UI の 100 回は 1 回あたり数秒かかるため、日常の実行では回数を減らし、検証（validation-results.md）で 100 回を記録する。

## R-11 デモ手順書の構成（FR-020）

- **Decision**: `docs/06-demo-procedures.md` を新設する。S2 の節の構成：
  1. 準備（起動、開く 4 つのウィンドウの URL と並べ方の例：1920×1080 で左右 2 × 上下 2）
  2. S2-1・S2-2・S2-3 のそれぞれ：準備ボタン → 操作の表（# / 操作する画面 / 操作 / 画面の期待結果 / 通信モニタの期待結果 / 話すこと（業務・FHIR））
  3. 締めの解説（ETag と If-Match、Task.status + owner による論理ロック、遷移チェックでは Lost Update を防げないこと）
  4. うまくいかないとき（設定が違う、順序を間違えた、ウィンドウが反応しない → 準備ボタンを押し直す／初期化）
  5. 所要時間の目安（S2 全体で 5 分。D-24）
  ファイル名は今後のシナリオ（S3 以降の手操作の手順）も同じファイルに節を足せるよう、シナリオ名を含めない。docs/README.md の一覧に加える。
- **Rationale**: 画面上の案内を出さない（D-29）代わりに、講演者と展示ブースの来場者が同じ手順書を使う。期待結果を表にすれば E2E の確認項目とも対応付けられる。
