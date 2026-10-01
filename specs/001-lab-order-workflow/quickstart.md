# Quickstart: S1 検体検査ワークフローの動作確認

本機能が端から端まで動くことを確認する手順。実装の詳細は tasks.md、仕様は [spec.md](spec.md)、
API は [contracts/](contracts/)、データは [data-model.md](data-model.md) を参照。

## 前提

| 用途 | 必要なもの |
|---|---|
| デモの実行（講演者の PC） | Docker（Docker Compose v2 を含む）、Chrome または Edge の最新版 |
| 開発・テスト | 上記に加えて JDK 21、Maven 3.9 以上、Node.js 22 以上、`curl` または `wget`、`tar`、`sha256sum` または `shasum` |

## 0. JP パッケージの取得（開発・テスト時、オンライン環境で 1 回）

```bash
scripts/fetch-jp-packages.sh
```

**期待結果**: `.cache/fhir-packages/` に `jp-core.r4#1.2.0/package/` と `jpfhir-terminology#2.2609.0/package/` が展開され、終了コード 0。
もう一度実行すると `[済]` と表示され、何も取得しない。`git status` に `.cache/` が現れない（`.gitignore` 済み）。
詳細は [contracts/fetch-jp-packages.md](contracts/fetch-jp-packages.md)。

デモの実行（1.）には不要。Docker イメージにも含まれない。

## 1. ビルドと起動（Docker）

オンライン環境で事前にビルドする。

```bash
docker compose build
docker compose up -d
```

**期待結果**: `http://localhost:8080/` に起動画面が表示される。`http://localhost:8080/fhir/metadata` が CapabilityStatement（R4）を返し、
`rest[0].extension` に websocket の URL が含まれる。

停止は `docker compose down`（データはインメモリのため次回は初期状態）。

## 2. 自動テスト

```bash
# サーバーの単体・結合テスト（S1 の全シナリオを含む）
cd server && mvn verify

# シナリオの繰り返し実行（SC-004：20 回連続）
cd server && mvn verify -Dit.test='S1ScenarioIT' -Ds1.repeat=20

# JP パッケージとの整合性テスト（0. の取得後。未取得ならスキップされる）
cd server && mvn verify -Dtest='JpPackageConsistencyTest'

# UI の単体テスト
cd ui && npm ci && npm test

# E2E（Docker で起動した状態で実行）
cd ui && npx playwright test
```

**期待結果**: すべて成功。JpPackageConsistencyTest は初期データと FHIR マスタ（`ui/src/master/fhir-master.json`）のプロファイル・コードが
JP Core 1.2.0 / JP Terminology 2.2609.0 に存在することを確認する（パッケージが無い場合はスキップと表示される）。S1ScenarioIT は `s1-main`・`s1-cancel`・`s1-reject`・`s1-rerun`・`s1-partial` の各ステップ後に、
ServiceRequest・Task・Specimen・DiagnosticReport の状態が [data-model.md §3.5](data-model.md#35-業務の段階との対応specmddocs02) のとおりであることを確認する。

## 3. API の手動確認（任意）

`http://localhost:8080/fhir` に対して確認する（curl や REST クライアント）。

| # | 確認 | 期待結果 |
|---|---|---|
| 1 | `POST /demo/reset` | `200`、初期データ 12 件 |
| 2 | `GET /fhir/Patient` | デモ 太郎・デモ 花子の 2 件 |
| 3 | 依頼の Transaction を `POST /fhir`（[data-model.md §4](data-model.md#4-操作ごとの更新内容)） | `200`、`transaction-response` に 3 件の `201`。Task は `requested` / `not-collected` |
| 4 | Task を If-Match 無しで `PATCH` | `400` |
| 5 | Task を古い版の If-Match で `PATCH` | `412`、Task は変わらない |
| 6 | Task を `requested` から `completed` へ `PATCH` | `422` |
| 7 | `GET /fhir/Task/{id}/_history` | 更新した回数分の版 |
| 8 | `GET /demo/traffic` | 上記の要求がすべて順に記録されている |

## 4. 画面での通し確認（講演モード）

1. `http://localhost:8080/stage?mode=presentation` を開く。
2. 進行パネルでシナリオ「検体検査（通常の流れ）」を選び、「次へ」を 8 回押す。

| ステップ後 | 電子カルテ | 検体検査システム | 通信モニタ |
|---|---|---|---|
| 1 依頼 | 一覧に「有効（依頼中） / 依頼済み・未採取」 | — | 電子カルテ → FHIR の Transaction 1 件 |
| 2 新着 | — | 一覧に「採取待ち」で表示 | FHIR → 検体検査システム の通知、続いて取得 |
| 3 採血 | 「採取済」 | 「採取済」（受付可能になる） | Transaction 1 件、通知 |
| 4 受付 | 「受付済み・検体到着、担当 技師 A」 | 担当 技師 A | PATCH 1 件（If-Match 付き）、通知 |
| 5 自動反映 | （ステップ 4 の表示が通知で反映されたことを解説） | — | — |
| 6 測定開始 | 「実施中・測定中」 | 「実施中・測定中」 | PATCH 1 件、通知 |
| 7 結果報告 | 依頼が「完了」 | 「完了・報告済」 | Transaction 1 件（Observation 8 件 + 報告 + 作業 + 依頼） |
| 8 結果確認 | 結果 8 項目。白血球数・ALT に「H」 | — | 結果の取得 |

3. 「戻る」を押す → ステップ 7 完了時点の状態が再現される（通信モニタには再実行の通信が表示される）。
4. 通信モニタで Task の履歴を開く → 版ごとの状態・担当者・更新日時が表示される。
5. 進行パネルの「初期化」を押す → 10 秒以内に全領域が初期状態に戻る。

各ステップの所要時間：操作が他の領域に反映されるまで 2 秒以内（SC-002）。

## 5. 自習モードの確認

1. `http://localhost:8080/stage?mode=self-study` を開き「開始」を押す。
2. 強調表示された画面・ボタンを順に操作して最後まで進める。案内と違うボタンを押すと、案内に戻るよう促される。
3. 「最初から」で初期状態に戻る。

## 6. 個別ウィンドウでの確認

`/ehr?role=doctor`、`/ehr?role=nurse`、`/lis?tech=tech-a`、`/monitor` を別々のウィンドウで開き、手動で 4. と同じ操作を行う。
各ウィンドウの表示が通知で更新されること、講演モードと同じ結果になることを確認する。

## 7. オフラインの確認（V-06、SC-005）

1. ビルド済みのイメージがある状態で、PC のネットワークを切断する。
2. `docker compose up -d` で起動し、4.〜6. を実行する。

**期待結果**: すべての画面・フォントが表示され、全ステップを実行できる。ブラウザの開発者ツールで外部への通信が 0 件。
