# Research: S3 放射線：CT 検査の予約枠の取り合い

**Feature**: [spec.md](spec.md) | **Plan**: [plan.md](plan.md) | **Date**: 2026-10-02

S1（[specs/001-lab-order-workflow/research.md](../001-lab-order-workflow/research.md)）・S2（[specs/002-concurrent-acceptance/research.md](../002-concurrent-acceptance/research.md)）の
技術選定（HAPI FHIR 8.12.1 plain server、インメモリのリポジトリ、React + TypeScript、Vitest / Playwright / JUnit 5）はそのまま使う。
本書は S3 で新たに決めることだけを扱う。Technical Context に NEEDS CLARIFICATION は無い。以下は、S1・S2 のコードを読んだうえで設計上の選択肢を比較した結果である。

## R-01 サーバーに加えるリソース種別と検索パラメータ

- **Decision**:
  - 書き込み可能な種別（`ResourceWriter.WRITABLE`）に **Slot・Appointment** を加える。**Schedule・Device** は読み取り専用（初期データ）として Provider を加える。
    Patient などと同じく、Provider は `AbstractRepositoryProvider` を継承する（read / vread / history / search、書き込み可能な種別は create / update）。
  - 検索パラメータ（`SearchParameters`）を加える：
    Slot `schedule`・`status`、Appointment `slot`・`status`・`patient`・`practitioner`、ServiceRequest `category`（トークン。coding の code）。
    Schedule・Device はパラメータ無し（全件）。
  - Slot・Appointment には状態遷移の規則（Task の `TaskTransitionRule` に当たるもの）を**作らない**。
- **Rationale**: 予約の確定は Transaction の PUT（Slot）と POST（Appointment・ServiceRequest・Task）で行い（docs/04）、単独の PUT は仮押さえと取りやめに使う。
  Subscription の条件（R-07）と画面の一覧に必要な検索パラメータだけを、S1 と同じく種別ごとに明示的に実装する。
  Slot の状態遷移の規則をサーバーに置くと、S3-1（直接予約。Slot を更新しない）とは無関係だが、「サーバーの規則を変えない」（D-36）・「版の確認だけで防ぐ」（D-40）という
  S3 の説明に余計な要素が加わる。二重予約の防止は版の確認で行い、規則はクライアントの手順（仮押さえ → 確定）として見せる。
- **Alternatives considered**:
  - Slot の状態遷移チェック（`busy → busy-tentative` を 422 など）：上記の理由で採らない。将来 S2-3 のように「サーバー側でも守る」を見せる場合の拡張候補とする。
  - Schedule の actor を表示名だけの参照にして Device を作らない：参照先が存在しないデータを初期データに含めることになる。Device は 1 件だけなので作る。

## R-02 日付に依存する初期データ（予約枠）の生成（FR-001、D-39）

- **Decision**: `SeedLoader` が読む静的な JSON（`seed/index.txt`）に、医師 Y・放射線部・CT-1 号機（Device）・予約表（Schedule）・架空の患者 2 人を加える。
  予約枠（Slot）と初期の予約（Appointment）は、新しいクラス `SlotSeedGenerator` が初期化のたびに生成する。
  - 基準日は初期化した時点の**日本時間（`Asia/Tokyo`）の翌日**。サーバー・コンテナのタイムゾーン（UTC の場合がある）に依存しないよう、`ZoneId` を明示する。
  - 枠は 9:00〜12:00 の 30 分 × 6。id は時刻から決める固定値（`ct1-0900`〜`ct1-1130`）にし、日付を含めない（テスト・手順書・E2E が同じ id を使える）。
  - `start`・`end` は `+09:00` 付きの instant（例：`2026-10-03T10:00:00+09:00`）で保持する。画面は日本時間で表示する。
  - 9:00 と 11:00 の枠は `busy` とし、それぞれ架空の患者の Appointment（`booked`）を 1 件ずつ置く。10:00 を含むほかの枠は `free`。
  - 時刻の取得は `java.time.Clock` を受け取る形にし、単体テストで基準日を固定できるようにする。
- **Rationale**: 固定の日付の JSON はいずれ過去の日付になる（D-39）。id に日付を含めないことで、テスト・手順書を日付から独立させられる。
  初期化（`replaceAll`）は従来どおり 1 回の差し替えで行い、生成したリソースもそこに含める。
- **Alternatives considered**:
  - JSON に日付のプレースホルダを書いて置換する：置換の規則が JSON とコードに分かれ、読みにくい。
  - 予約済みの枠に患者を付けない（Appointment を置かない）：Slot の `busy` だけでは放射線部門システムの一覧が空になり、「予約済み」の意味が伝わらない。
  - 予約済みの枠の患者をデモ 太郎・デモ 花子にする：S3 の操作で同じ患者を同じ日に重ねて予約することになり、説明が紛らわしい。

## R-03 予約方式と仮押さえの期限の置き場所（FR-003、D-36）

- **Decision**: デモのポリシー（`DemoPolicy`）に次の 2 項目を加え、`GET/PUT /demo/policy` と `demo.policy` で配信する。初期化で既定値に戻す。
  - `ehrUsesSlotHold`（boolean、既定 `true`）：電子カルテが仮押さえを使うか。`false` は「直接予約する」（S3-1）。**サーバーの判定には使わない**（電子カルテの画面だけが読む）。
  - `slotHoldSeconds`（整数、既定 30）：仮押さえの期限（秒）。サーバーの期限切れの処理（R-05）が使う。既定値は環境変数 `SLOT_HOLD_SECONDS` で変えられる（docs/03 の運用。未設定なら 30）。
    `PUT` で受け付ける範囲は 1〜300（範囲外・整数でない値は 400）。デモ制御パネルの入力は 10〜300 に制限する（FR-003）。1〜9 はテストのために API だけが受け付ける。
- **Rationale**: S2 の `labSendsIfMatch`（specs/002 R-01）と同じく、別々のウィンドウ（医師 X・医師 Y・デモ制御パネル）で設定を共有できる唯一の経路が `/demo/*` である（原則 I）。
  予約方式を boolean にすると既存の部分更新（未知の項目・型の違う値は無視）の規則をそのまま使える。
  期限はサーバーの振る舞いを変える設定なので、ポリシーとして変更が通信モニタに記録されることにも意味がある（原則 III）。
- **Alternatives considered**:
  - 予約方式を文字列（`"hold"` / `"direct"`）にする：値の検証が増える。2 択なので boolean で足りる。
  - `slotHoldSeconds` の範囲外を無視する（S1 の未知の項目と同じ扱い）：講演者が入力を誤ったことに気付けない。数値は 400 で返し、パネルにエラーを出す。
  - 統合テストで 30 秒待つ：S3-3 を 20 回繰り返すと 10 分を超える。API で 1〜2 秒に縮めて確認する。

## R-04 電子カルテの CT 予約画面の操作（FR-006〜FR-014、D-27 と同じ考え方）

- **Decision**: 新しいルート `/ehr/ct?doctor=dr-x|dr-y`（電子カルテの CT 予約画面）を作る。予約は**予約中の枠**（`BookingDraft`）を画面の状態として持つ、段階的な操作にする。
  1. **枠を選ぶ**：枠の一覧の行のボタンで `GET /Slot/{id}` を送り、応答のリソースと ETag を `BookingDraft` として保持し、予約欄を開く（S2 の「受付を始める」と同じ。specs/002 R-03）。
     予約欄では患者（既定：医師 X はデモ 太郎、医師 Y はデモ 花子）と検査内容を選ぶ。
  2. 仮押さえを使う方式（`ehrUsesSlotHold = true`）：
     - **仮押さえする**：`PUT /Slot/{id}`（If-Match は 1. の ETag、`status = busy-tentative`、`comment = 「仮押さえ：医師 X」`）。成功したら応答の ETag と `meta.lastUpdated` を `BookingDraft` に保持し、残り時間を表示する。
     - **確定する**：Transaction（`PUT Slot`（`busy`、`ifMatch` = 仮押さえの応答の ETag、`comment` を消す）+ `POST Appointment` + `POST ServiceRequest` + `POST Task`）。
     - **取りやめる**：`PUT /Slot/{id}`（If-Match = 仮押さえの応答の ETag、`status = free`、`comment` を消す）。仮押さえ前の取りやめは通信を伴わない。
  3. 直接予約する方式（`ehrUsesSlotHold = false`）：
     - **予約を確定する**：Transaction（`POST Appointment` + `POST ServiceRequest` + `POST Task`。**Slot の更新を含めない**。D-40）。枠の状態は確認しないので、`free` 以外の枠でも選べる。
  - `BookingDraft` は、通知で枠の一覧が取り直されても変わらない（行の状態ではなく `BookingDraft` の有無で予約欄を表示する）。初期化（`demo.reset`）で破棄する。
  - 仮押さえを使う方式では、一覧の `free` の行だけ「枠を選ぶ」を押せる。直接予約する方式では、すべての行で押せる（edge case「直接予約は枠の状態を確認しない」）。
- **Rationale**: 一覧の行の ETag は通知のたびに最新になるため、行の ETag を使うと医師 Y は仮押さえの直前に医師 X の版を受け取ってしまい、412 が起きない（S2 と同じ理由。specs/002 R-03）。
  「選ぶ → 仮押さえ → 確定」の段階を分けると、通信モニタでも 1 段階ずつ説明できる。
- **Alternatives considered**:
  - 既存の `/ehr?role=doctor` に CT 予約を同居させる：医師 X の検体検査の画面（S1・ステージビューでも使う）が変わり、医師 Y の画面に検体検査の依頼の機能が必要か、という論点が増える。
    CT 予約は別のルートにし、電子カルテの見出しから行き来できるリンクを置く。
  - 「枠を選ぶ」を省き、一覧の行から直接仮押さえする：S2 と同じく、選んでから送るまでの間に他の人の更新が入ったことを見せられない。

## R-05 仮押さえの期限切れの処理（FR-016〜FR-019、D-17、D-37）

- **Decision**: 新しいクラス `SlotHoldExpiry`（`jp.example.demo.slot`）をサーバーに置く。
  - `InMemoryRepository.CommitListener` として登録し、コミットのたびに Slot の変更を見る。`busy-tentative` になった Slot は
    「Slot の id・版・`meta.lastUpdated`・期限（`lastUpdated` + その時点の `slotHoldSeconds`）」を保持し、それ以外の状態になった Slot は保持を消す。
    期限は仮押さえを受け付けた時点の秒数で決まる（edge case「仮押さえ中に秒数を変えても、その仮押さえには変更前の秒数」）。
  - 単一スレッドの `ScheduledExecutorService` で 250 ミリ秒ごとに期限を確かめる。期限を過ぎた保持ごとに、`repo.write` の中で
    「最新の版と `lastUpdated` が保持したものと同じで、`busy-tentative` のまま」のときだけ、`status = free`・`comment` を消した新しい版を書き込む。
    書き込みは通常の書き込みと同じロック・版の採番・コミット通知（Subscription の ping）を通る（D-37）。
  - 確定・取りやめとの同時発生は、書き込みロックで直列化される。先に確定・取りやめがコミットされていれば版が変わっているので期限切れの処理は何もしない。
    期限切れが先なら、確定の Transaction の `ifMatch` が合わず 412 で全体が取り消される（FR-019）。
  - 初期化（`DemoControl.reset`）では保持をすべて消す。初期化の直前に読み取った保持が残っていても、初期化後の Slot は `lastUpdated` が違うので書き換えない（FR-004）。
  - サーバーを止めるとき（テストの後始末を含む）に実行器を止める。
- **Rationale**: 期限を「その時点の秒数で決めて保持する」方式なら、秒数の変更が進行中の仮押さえに影響しない。
  状態の判定を書き込みロックの中で行うので、期限切れと確定が同時に起きても中途半端な状態が残らない（原則 IV）。
  250 ミリ秒ごとの確認なら、期限から反映まで 2 秒以内（SC-005）に十分収まる。
- **Alternatives considered**:
  - 仮押さえごとに `schedule(…, delay)` で単発のタイマーを積む：初期化・取りやめ・確定のたびにタイマーの取り消しが必要になり、取り消し漏れが初期化後のデータを書き換える危険がある。
  - 毎回すべての Slot を走査し、`lastUpdated` + 現在の `slotHoldSeconds` で判定する：秒数の変更が進行中の仮押さえにも効いてしまう（spec の edge case と異なる）。
  - 期限を Slot の拡張（extension）に保存する：独自拡張を避ける方針（D-35）に反する。期限はサーバー内部の運用規則で、業務データではない。

## R-06 期限切れの通信記録と通信モニタの表示（FR-017、D-37、原則 III）

- **Decision**: 通信記録（`TrafficRecord`）に新しい種別 `kind = "server"`（サーバー内の処理）を加える。
  - `client` は `server-slot-expiry`、通信モニタ上の名前は「FHIR サーバー（仮押さえの期限切れ）」。
  - 新しい要素 `serverAction`：`{ action: "slot-hold-expired", resource: "Slot/ct1-1000/_history/3", before: { status, versionId, comment }, after: { status, versionId }, holdSeconds }`。
  - seq は書き込みの前に採番し（`reserveSeq`）、コミットの後に記録する（HTTP の記録と同じ規則）。期限切れで送られる ping の記録は、この記録より後の seq を持つ。
  - 通信モニタのシーケンス図では、FHIR サーバーの列の中に閉じた矢印（自分自身への矢印）として表示し、注記に「仮押さえの期限切れ：Slot/ct1-1000 仮押さえ中 → 空き（版 2 → 3）」を出す。
    詳細欄には「サーバーの規則による自動の更新です（期限 30 秒）」と変更前後を表示する。
  - 版の履歴の「この版を作った通信」は、`serverAction.resource` が一致する記録も対象にする（`findCause` の拡張）。
- **Rationale**: 憲章の原則 III は、サーバー内部の自動処理で業務データを書き換えることを禁じ、例外を「ルールとして明示し通信モニタに表示する仕組み」に限っている。
  HTTP の要求ではないので既存の `http` 種別には入らず、デモ制御のイベント（`demo`）とも性質が違う（業務データを変える）。種別を分けて、画面で区別できるようにする。
- **Alternatives considered**:
  - サーバー内部から自分自身へ HTTP で PUT する：送信元の偽装に近く、「誰が送ったか」の説明が不正確になる。If-Match の扱いも利用者の要求と混ざる。
  - `demo` 種別のイベントとして記録する：初期化・ポリシー変更と同じ見た目になり、業務データの変更であることが伝わらない。

## R-07 画面の識別子と Subscription（FR-005、FR-015）

- **Decision**:

  | 画面 | `X-Demo-Client` | 通信モニタ上の名前 | Subscription id | criteria |
  |---|---|---|---|---|
  | 電子カルテ CT 予約（医師 X） | `ehr-doctor` | 医師 X | `ehr-ct-slots` | `Slot?schedule=Schedule/ct-1` |
  | 電子カルテ CT 予約（医師 Y） | `ehr-doctor-y` | 医師 Y | `ehr-ct-slots`（同じ Subscription に bind する） | 同上 |
  | 放射線部門システム | `ris` | 放射線部門システム | `ris-slots`、`ris-tasks` | `Slot?schedule=Schedule/ct-1`、`Task?owner=Organization/rad-dept` |

  - `useLiveData` を、Subscription を複数受け取れるように広げる（`subscription: SubscriptionSpec | SubscriptionSpec[]`）。どれかの ping で取り直す。
    放射線部門システムは、枠の変化（仮押さえ・期限切れ）と予約の登録（S3-1 では Slot が変わらない）の両方で取り直す必要がある。
  - 医師 X の CT 予約画面の `X-Demo-Client` は、S1 の医師 X と同じ `ehr-doctor` にする（同じ人・同じシステムとして表示する）。
- **Rationale**: criteria は「更新後の状態」で評価される（S1）。`schedule` は Slot の状態が変わっても変わらない要素なので、仮押さえ・期限切れ・確定のすべてで通知が届く。
  `Task?owner=Organization/rad-dept` は、S3-1 と S3-2 のどちらの方式でも予約の登録と同じ Transaction で作られる Task を捉える。
- **Alternatives considered**:
  - 放射線部門システムを `Appointment?…` で購読する：Appointment に「この予約表の予約」を表す変わらない要素が無く（`slot` は予約ごとに違う）、条件が作れない。
  - 画面ごとに別の useLiveData を 2 つ持つ：枠のカレンダーで「同じ枠に予約が 2 件」を示すには、枠と予約の両方の変化で同じ表示を取り直す必要があり、2 つに分けると表示が食い違う。

## R-08 S1 への影響（FR-025）

- **Decision**:
  - 医師 X が CT 予約で作る ServiceRequest・Task は `requester = Practitioner/dr-x` を持つため、S1 の医師 X の画面（`loadDoctorOrders`、Subscription `ehr-dr-x`）にも現れる。
    `loadDoctorOrders` を、ServiceRequest の `category` が検体検査（SNOMED CT `108252007`）のものだけに絞る（検索パラメータ `category` を使う）。
  - 検体検査システム・看護師の画面は `owner` が検査部・技師の Task だけを見るので影響しない。
  - 初期データの患者が 4 人になる（R-02）。S1 の依頼画面の患者の既定（患者番号順の先頭 = デモ 太郎）は変わらない。新しい患者の患者番号は `00000003`・`00000004` にする。
  - ステージビュー・S1 のシナリオ定義・S2 の準備ボタンは変えない。
- **Rationale**: S1・S2 の自動確認（E2E・統合テスト）の結果を変えない（FR-025）。S3 の後に初期化せず S1 の画面を開いても、検体検査の一覧に CT の依頼が混ざらない。
- **Alternatives considered**: CT の依頼の requester を PractitionerRole にして S1 の条件から外す：S1 と表現がそろわず、医師 Y の S1 相当の画面を作る将来の拡張でも同じ問題が出る。種別（category）で絞るほうが意味が明確。

## R-09 エラーの表示（FR-012、FR-018）

- **Decision**:
  - **仮押さえ**が 412：`GET /Slot/{id}` で最新を取り直し、最新が `busy-tentative` なら「この枠は {comment から取り出した名前} が仮押さえ中です。別の枠を選んでください」、
    `busy` なら「この枠は既に予約済みです。別の枠を選んでください」、それ以外は S1 の 412 の文言。予約欄を閉じ、一覧を取り直す。自動ではやり直さない。
    名前は `comment` の「仮押さえ：」以降を表示用に使う（D-35。判定には使わない）。
  - **確定**（仮押さえを使う方式）が 412：「仮押さえの期限が切れました。枠を選び直してください」。この Transaction で版の確認をするのは自分が仮押さえした Slot だけなので、
    412 は「自分の仮押さえの後に枠が変わった」ことを意味する（期限切れ、またはその後の他の医師の仮押さえ・予約）。予約欄を閉じ、一覧を取り直す。
  - **取りやめ**が 412：期限切れで既に戻っているので、エラーにせず「仮押さえの期限が切れていました」を表示し、予約欄を閉じる。
  - 文言は `errors.ts` に関数（`slotHoldConflictError`・`slotHoldExpiredError`）として置き、Vitest で確かめる。
- **Rationale**: 412 の応答本文には誰が更新したかが無い（specs/002 R-04 と同じ）。取り直しは 1 回の GET で済む。

## R-10 通信モニタの変更（FR-023、FR-024）

- **Decision**:
  - シーケンス図の列：表示する列を、通信記録に現れた画面の種類から決める。電子カルテ・FHIR サーバーは常に表示し、検体検査システム・放射線部門システムは記録があるときだけ表示する
    （S1・S2 では従来どおり 3 列、S3 では「電子カルテ・FHIR サーバー・放射線部門システム」の 3 列）。`laneOf` に `ris` を加える。
  - Transaction の概要：詳細欄に、要求の各エントリ（`PUT Slot/ct1-1000（ifMatch: W/"2"）`、`POST Appointment` など）と、応答の各エントリの結果（`200 OK`・`201 Created`）を表にして表示する。
    Transaction が失敗した場合は、応答の OperationOutcome の `Bundle.entry[n]` から失敗したエントリを示し、「全体を取り消し（何も登録されていない）」と表示する。
  - 矢印の注記：Transaction のうち Slot の更新を含むものは「POST Transaction（一括登録・枠の版の確認あり）」、含まないものは「POST Transaction（一括登録）」。
  - 版の履歴：対象の候補に、Transaction の要求の `entry.request.url`（PUT）、応答の `location`、Appointment の `slot` の参照を加える（S3-1 で一度も直接更新されない Slot も選べるようにする）。
    比べる項目に Slot の `comment` を加え、Slot では「状態・押さえた人」を表示する。
- **Rationale**: S3 の説明の中心は「一括送信の中に枠の版の確認が入っているか」であり、S3-1 と S3-2 の違いは Transaction の中身を並べると一目で分かる。
  列を固定で 4 つにすると、S1 のステージビューの通信モニタが狭くなる。

## R-11 デモ制御パネルと準備ボタン（FR-002、FR-003）

- **Decision**:
  - デモ制御パネル（`/control`）に「S3 予約枠の取り合いの準備」の節を加える：「S3-1 の準備（直接予約）」「S3-2 の準備（仮押さえ）」「S3-3 の準備（期限切れ）」のボタンと状況の表示、
    電子カルテの予約方式（仮押さえを使う／直接予約する（デモ専用））の切り替え、仮押さえの期限（秒）の入力と現在値。
  - 準備ボタンは `POST /demo/reset` → `PUT /demo/policy`（`ehrUsesSlotHold`）の 2 段階。S2 と違い、FHIR に送る準備の通信は無い（S3 の操作は枠の選択から始まる）。
    `prepare.ts` を S2・S3 の両方を扱える形に広げる（シナリオごとに段階の並びを持つ）。
  - 入口（`/`）に「S3 予約枠の取り合いで開くウィンドウ」の小見出しを置き、5 つのウィンドウへのリンクを並べる（案内ではなくリンクの一覧。S2 と同じ）。
  - 電子カルテの CT 予約画面の見出しにも、現在の予約方式（「予約方式：仮押さえを使う」「予約方式：直接予約する（デモ設定）」）と期限の秒数を小さく表示する（設定の取り違えに気付けるように）。
- **Rationale**: S2 の準備ボタン（D-30）と同じ操作感にする。S3 の前提は「初期状態 + 予約方式」だけなので、準備は初期化と設定の切り替えで足りる。

## R-12 同時性と期限切れの検証（SC-002、SC-003、SC-005）

- **Decision**:
  - サーバーの結合テスト `S3ScenarioIT`（`X-Demo-Client` 付きの HTTP）：
    - S3-1：直接予約の Transaction を 2 回送り、どちらも 200、`Appointment?slot=Slot/ct1-1000&status=booked` が 2 件、Slot は版 1 の `free` のまま。既定 20 回（`-Ds3.repeat`）。
    - S3-2：2 つのスレッドが `CountDownLatch` で揃ってから同じ `If-Match: W/"1"` で仮押さえの PUT を送り、ちょうど 1 つが 200・1 つが 412 になること、
      その後の確定で予約が 1 件だけになることを既定 100 回（`-Ds3.repeat` で変更）。
    - S3-3：`slotHoldSeconds = 1` にして仮押さえし、2 秒以内に `free` に戻ること（SC-005）、`kind = "server"` の通信記録と ping が出ること、
      その後の確定の Transaction が 412 で、Appointment・ServiceRequest・Task が増えないことを既定 20 回。
    - 期限切れと確定の競合：期限の直前・直後に確定を送り、「予約済み + 予約 1 件」か「空き + 412」のどちらかになり、食い違いが無いことを繰り返す。
  - 単体テスト：`SlotHoldExpiryTest`（固定の `Clock` と手動の確認で、期限・秒数の変更・取りやめ・確定・初期化後の無視）、`SlotSeedGeneratorTest`（基準日・タイムゾーン・id・予約済みの枠）、
    `SearchParametersTest` 相当の追加（Slot・Appointment・ServiceRequest `category`）、`DemoControl` のポリシーの検証（範囲外の 400）。
  - UI の E2E `s3-slot-booking.spec.ts`：別々のブラウザコンテキストで 5 つの画面（制御パネル・医師 X・医師 Y・放射線部門システム・通信モニタ）を開き、手順書どおりに S3-1〜S3-3 を操作する。
    S3-3 は API で期限を 2 秒にしてから操作する（手順書の 30 秒は手で確認する）。画面からの同時の仮押さえを `S3_REPEAT` 回（既定 5、検証時に 100）繰り返す。
  - Vitest：CT 予約の組み立て（Transaction の中身・直接予約で Slot を含まないこと）、`BookingDraft` の状態遷移、エラーの文言、シーケンス図の列・Transaction の概要・`kind = "server"` の表示、
    版の履歴の候補と `comment` の比較、準備の段階。
- **Rationale**: 判定の決定性（原則 IV）は S1 の書き込みの直列化で保証済みであり、S2（specs/002 R-10）と同じ形で確かめる。期限切れは API で秒数を縮めて時間を節約する。

## R-13 デモ手順書（FR-022）

- **Decision**: `docs/06-demo-procedures.md` に「S3 予約枠の取り合い（排他制御②）」の節を加える。構成は S2 の節（specs/002 R-11）と同じ：
  1. 準備（開く 5 つのウィンドウの URL と並べ方の例：1920×1080 で上段に医師 X・医師 Y・放射線部門システム、下段に通信モニタ・デモ制御パネル）
  2. S3-1・S3-2・S3-3 のそれぞれ：準備ボタン → 操作の表（# / 操作する画面 / 操作 / 画面の期待結果 / 通信モニタの期待結果 / 話すこと（業務・FHIR））
  3. 締めの解説（S2 の版の確認は 1 つのリソースを守る仕組みであること、仮押さえ → 確定、Transaction の全部か無しか、If-None-Exist は取り合いの拒否に使えないこと（D-40））
  4. うまくいかないとき（予約方式が違う、期限が切れてしまった、順序を間違えた → 準備ボタンを押し直す／初期化）
  5. 所要時間の目安（S3 全体で 10 分。D-32。S1・S2 と合わせた 30 分版の構成の例）
- **Rationale**: S2 と同じ形にすることで、講演者・展示ブースの来場者が同じ読み方で使える。期待結果の表を E2E の確認項目と対応付ける。
