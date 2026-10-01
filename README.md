# 医療システム連携デモ

医療機関の **FHIR Repository サーバー** と **部門システム**（電子カルテ・検体検査システム）が、FHIR を介して連携する様子を、
**医療従事者にも分かりやすく**見せるデモです。講演（講演モード）と自習（自習モード）の両方に対応します。

- 「依頼」（ServiceRequest）と「作業の進み具合」（Task）を分けて管理する
- オーダー発行・結果返却は Transaction Bundle、進捗は Task の更新、通知は Subscription（合図だけ送り、中身は取りに行く）
- すべての通信を通信モニタで見える化する
- データはすべて**架空**です。認証・認可はスコープ外です。

現在の実装範囲は **S1 検体検査ワークフロー**（依頼 → 採血 → 受付 → 測定 → 結果報告 → 確認、取消・受付不可・再検・一部先行報告）です。
放射線の予約枠、処方調剤、排他制御の事故の再現（S2〜S5）は、設計ドキュメントに記録済みで、これから実装します。

## 起動（講演者のノート PC・オフライン）

必要なもの：Docker（Docker Compose v2 を含む）、最新の Chrome または Edge。

```bash
docker compose build     # オンライン環境で事前に 1 回
docker compose up        # 以降はオフラインで起動できる（http://localhost:8080/）
docker compose down      # 停止（データはインメモリ。次回は初期状態）
```

| URL | 画面 |
|---|---|
| `http://localhost:8080/` | 入口（講演モード・自習モード・個別ウィンドウ） |
| `/stage?mode=presentation` | 講演モード：3 つの画面と進行パネルを 1 画面に並べ、「次へ」で解説しながら進める |
| `/stage?mode=self-study` | 自習モード：画面上の案内に従って自分で操作する |
| `/ehr?role=doctor` `/ehr?role=nurse` | 電子カルテ（医師 X・看護師 D） |
| `/lis?tech=tech-a` `/lis?tech=tech-b` | 検体検査システム（技師 A・B） |
| `/monitor` | 通信モニタ（シーケンス図・通信の詳細・版の履歴） |
| `/fhir/metadata` | FHIR サーバー（R4）の CapabilityStatement |

## 開発

| 場所 | 内容 | 主なコマンド |
|---|---|---|
| `server/` | FHIR サーバー（Java 21、HAPI FHIR 8.12.1 R4、組み込み Jetty） | `mvn verify`（単体＋統合テスト）、`mvn verify -Ds1.repeat=20`（シナリオを 20 回繰り返す） |
| `ui/` | 画面（React 19 + TypeScript + Vite） | `npm ci`、`npm test`、`npm run dev`（`/fhir`・`/ws`・`/demo` を `localhost:8080` へプロキシ）、`npm run build` |
| `ui/tests/e2e/` | Playwright の E2E（`docker compose up` したアプリに対して実行） | `npx playwright install chromium`、`npx playwright test` |
| `scripts/` | 補助スクリプト | `scripts/fetch-jp-packages.sh`（下記） |
| `docs/` | 設計ドキュメント（目的・シナリオ・アーキテクチャ・設計ルール・決定事項） | [docs/README.md](docs/README.md) |
| `specs/001-lab-order-workflow/` | S1 の仕様・計画・タスク（Spec Kit） | [spec.md](specs/001-lab-order-workflow/spec.md)、[quickstart.md](specs/001-lab-order-workflow/quickstart.md) |

### JP Core / JP Terminology（開発・テスト時のみ）

初期データとコードの整合性テスト（`JpPackageConsistencyTest`）は、JP Core 1.2.0 と JP Terminology 2.2609.0 を参照します。
これらは**リポジトリに含めず**、スクリプトで取得します（SHA-256 を検証。取得先は jpfhir.jp）。

```bash
scripts/fetch-jp-packages.sh          # .cache/fhir-packages/ に取得・展開（取得済みなら何もしない）
scripts/fetch-jp-packages.sh --check  # 揃っているかだけ確認
```

デモの実行には不要で、Docker イメージにも含まれません。パッケージが無い環境では、このテストはスキップされます。

### E2E を Linux で動かすとき

Playwright の Chromium が共有ライブラリ（例：`libasound.so.2`）を必要とする環境では、`npx playwright install-deps`（要 root）を実行するか、
該当ライブラリを展開して `LD_LIBRARY_PATH` に追加してください。

## 構成

```
ブラウザ ──FHIR REST／WebSocket──▶ 1 つの Java プロセス（組み込み Jetty）
  電子カルテ・検体検査・通信モニタ      /fhir/*  HAPI RestfulServer（R4）＋通信記録フィルタ
  （React の静的ファイル）               /ws/*    Subscription 通知（R4 websocket）・通信ログ配信
                                         /demo/*  初期化・ポリシー・通信記録
                                         /        UI（JAR に同梱）
```

詳しくは [docs/03-architecture.md](docs/03-architecture.md) と [specs/001-lab-order-workflow/plan.md](specs/001-lab-order-workflow/plan.md) を参照してください。
プロジェクトの原則は [.specify/memory/constitution.md](.specify/memory/constitution.md) にあります。

## ライセンス・第三者の著作物

[fhirstarters](https://github.com/FirelyTeam/fhirstarters) の `hapi-fhirstarters-rest-server-skeleton` を元にした部分があります。
著作権表示とライセンスは [THIRD_PARTY_NOTICES.md](THIRD_PARTY_NOTICES.md) にあります。同梱フォント（Noto Sans JP）は SIL Open Font License 1.1 です。
