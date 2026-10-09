# Quickstart: S4 処方調剤の動作確認

本機能が端から端まで動くことを確認する手順。仕様は [spec.md](spec.md)、設計判断は [research.md](research.md)、
画面と API は [contracts/](contracts/)、リソース・状態の変化・シナリオのステップは [data-model.md](data-model.md) を参照。
S4 はステージビューと講演・自習モードで見せるため、手順書（docs/06）は作らない（D-42）。

## 前提

S1 の [quickstart.md](../001-lab-order-workflow/quickstart.md)「前提」「1. ビルドと起動」と同じ。
コードの確認（`JpPackageConsistencyTest`）には JP のパッケージが要る：`scripts/fetch-jp-packages.sh`。
UI を変えたら JAR（または Docker イメージ）を作り直してから E2E を実行する（CLAUDE.md）。

## 1. 自動テスト

```bash
# サーバー：単体テスト（検索パラメータ・JP のコードの実在）
cd server && mvn test -Dtest='SearchMatcherTest,JpPackageConsistencyTest'

# サーバー：S4 の結合テスト（外来・入院を既定 20 回ずつ、お渡しの競合・完了後のお渡し・通知の条件）
cd server && mvn verify -Dit.test=S4ScenarioIT

# 回数を変える
cd server && mvn verify -Dit.test=S4ScenarioIT -Ds4.repeat=50

# S1〜S3 の回帰を含む全テスト（FR-033、SC-008）
cd server && mvn verify

# UI の単体テスト（処方・お渡し・払出の組み立て、調剤した薬剤師の読み取り、画面側の制限、ステージの役割の決め方、runTo、シナリオの定義、通信モニタ）
cd ui && npm test && npm run typecheck

# E2E：S4 の講演モード・自習モード・手動操作（起動済みのサーバーに対して実行）
cd ui && npx playwright test tests/e2e/s4-prescription.spec.ts

# E2E：S1〜S3 の回帰
cd ui && npx playwright test
```

**期待結果**: すべて成功。`S4ScenarioIT` は各回で、外来は処方 `completed`、入院は処方 `active`（版 1）、作業はどちらも `completed`、
調剤の記録はどちらもちょうど 1 件（調剤者 = 薬剤師 C、監査者 = 薬剤師 E、外来は受け取った患者、入院は外科病棟）になる（SC-004）。
`JpPackageConsistencyTest` は HOT9 4 件・JAMI 用法コード・MERIT9 区分 4 種・MERIT9 単位を確認する（SC-007。パッケージが無ければスキップ）。

## 2. 講演モード（外来）— US1・US3

1. `docker compose up`（または JAR）で起動し、入口の「S4 処方調剤」→ 講演モードを開く（`/stage?mode=presentation&scenario=s4-outpatient`）。
2. 列が「電子カルテ（医師 X）」「薬剤部門システム（薬剤師 C）」「通信モニタ」であることを確認する。
3. 「次へ」を 6 回押す。各ステップで次を確認する（data-model.md §3.1・§4.2）。
   - 1：処方一覧に「有効（依頼中）」「依頼済み」「薬剤部」の行。通信モニタに POST Transaction（中身の表：POST MedicationRequest・POST Task）。
   - 2：薬剤部門システムの一覧に区分「外来」の行が自動で現れる（ping → GET）。
   - 3：薬剤部門システムが薬剤師 C のまま、行が「実施中・調剤中」「薬剤師 C」。電子カルテの行も自動で変わる。処方は「有効（依頼中）」のまま。
   - 4：薬剤部門システムが薬剤師 E に切り替わり、行が「監査中」「薬剤師 E」。
   - 5：通信モニタに GET Task の履歴と POST Transaction（中身の表に PUT MedicationRequest/1 がある）。
   - 6：電子カルテの行が「完了」「完了」「お渡し済み」。
4. 通信モニタで MedicationRequest/1 の版の履歴を開き、版 2（`completed`）の送信元が薬剤師 E（薬剤部門システム）であることを確認する（US1 AS7）。
5. 「戻る」でステップ 5 の完了時点に戻ること、「初期化」ですべてが初期状態に戻ることを確認する（US1 AS8、US3 AS2）。

**期待結果**: 解説なしの操作だけで 2 分以内（SC-001）。各操作の結果がほかの列と通信モニタに 2 秒以内に反映される（SC-003）。

## 3. 講演モード（入院）— US2・US3

1. 進行パネルのシナリオで「処方調剤（入院：病棟へ払出）」を選ぶ。電子カルテのタブが「医師 Y」「看護師 F（外科病棟）」になる。
2. 「ステップ 4 まで進める（外来と同じ部分）」を押す。**1 分以内**に監査中の状態になり、通信モニタにステップ 1〜4 の通信（処方・通知・受付・監査）がすべて並ぶ（SC-002、US3 AS6）。
   薬剤部門システムの一覧に「入院（外科病棟）」と表示される。
3. 「次へ」でステップ 5（払出）を実行する。通信モニタの中身の表が POST MedicationDispense・PUT Task の 2 行で、**PUT MedicationRequest が無い**ことを確認する（US2 AS6）。
4. 「次へ」でステップ 6。電子カルテの列が自動で看護師 F になり、デモ 三郎の行が「払出済み」、処方「有効（依頼中）」、作業「完了」（US2 AS4、US3 AS5）。
5. 電子カルテの「医師 Y」タブで、同じ処方が「有効（依頼中）」「完了」「払出済み・投与中」と表示されることを確認する（US2 AS5）。

## 4. 画面の手動操作と画面側の制限 — Edge Cases

1. 講演モードの外来を初期化し、電子カルテ（医師 X）で処方を出す。
2. 薬剤部門システム（薬剤師 C）で「受付・調剤開始」を押す。続けて薬剤師 C のまま行を見ると、「監査を開始」が押せず「調剤した薬剤師とは別の薬剤師が監査します」と表示される。
3. 薬剤師 E に切り替えて「監査を開始」→ 薬剤師 C に切り替えると「監査を終えてお渡し」が押せない（「監査を始めた薬剤師（薬剤師 E）が操作します」）。
4. 薬剤師 E に戻して「監査を終えてお渡し」。進行パネルのステップが手の操作に追従して進む（US3 AS3）。
5. 検体検査（`/ehr?role=doctor`、`/lis?tech=tech-a`）を別ウィンドウで開き、処方が混ざらないことを確認する（FR-009）。

## 5. 自習モード（入院）— US4

1. 入口から自習モード（入院）を開く。最初に電子カルテ（医師 Y）の患者・薬剤・「処方する」が強調される。
2. ガイドに従って操作する。監査の開始の場面で、薬剤部門システムが薬剤師 C のままなら「薬剤師 E に切り替えてください」と案内され、「薬剤師 E」のボタンが強調される（US4 AS3）。
3. 最後（看護師 F の画面に払出済み）まで進み、「最初から」で初期状態に戻ることを確認する（US4 AS4）。

## 6. オフライン

S1 の quickstart と同じ（`docker run --network none` で起動し、2〜5 を実行する。SC-005）。
