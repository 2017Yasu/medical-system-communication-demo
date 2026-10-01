# Contract: `scripts/fetch-jp-packages.sh`

JP Core と JP Terminology の FHIR パッケージを取得・検証・展開するシェルスクリプト（[research.md R-20](../research.md#r-20-jp-core--jp-terminology-パッケージの取得)）。
取得したファイルと展開したパッケージはリポジトリに含めない。

## 対象パッケージ

スクリプト内に固定で定義する。版を変えるときはスクリプトの定義と SHA-256 を更新し、docs/05 に記録する。

| パッケージ | name#version | 取得元 | SHA-256 |
|---|---|---|---|
| JP Core | `jp-core.r4#1.2.0` | `https://jpfhir.jp/fhir/core/1.2.0/jp-core.r4-1.2.0.tgz` | `39c4ade9c32ea815a6c5889f9ee89f80efe02d5bbc8236a6b02ec573a28a2c70` |
| JP Terminology | `jpfhir-terminology#2.2609.0` | `https://jpfhir.jp/fhir/core/terminology/jpfhir-terminology.r4-2.2609.0.tgz` | `aff833151afbef9d6127868ba94e20f29e88ab4500af080e896b651e3999efd5` |

## 使い方

```text
scripts/fetch-jp-packages.sh [--dest DIR] [--force] [--check] [--help]
```

| オプション | 内容 |
|---|---|
| （なし） | 未取得・不完全なパッケージだけを取得・検証・展開する。取得済みで検証に通るものは何もしない |
| `--dest DIR` | 保存先。既定は環境変数 `JP_FHIR_PACKAGE_DIR`、無ければ `{リポジトリのルート}/.cache/fhir-packages` |
| `--force` | 取得済みでも取得し直し、展開し直す |
| `--check` | 取得・展開をせず、保存先のパッケージが揃っていて検証に通るかだけを確認する（テスト・CI 用） |
| `--help` | 使い方を表示する |

- リポジトリ内のどのディレクトリから実行してもよい（ルートはスクリプトの位置から求める）。
- 必要なコマンド：`bash`、`curl` または `wget`、`tar`、`sha256sum` または `shasum`（macOS）。

## 保存先の配置

```text
.cache/fhir-packages/
├── downloads/
│   ├── jp-core.r4-1.2.0.tgz
│   └── jpfhir-terminology.r4-2.2609.0.tgz
├── jp-core.r4#1.2.0/
│   └── package/                 # tgz の中身（package.json、StructureDefinition-*.json など）
└── jpfhir-terminology#2.2609.0/
    └── package/
```

## 処理

各パッケージについて次を行う。

1. `downloads/` の tgz の SHA-256 を確認する。一致すれば 3. へ。
2. 取得元からダウンロードする（一時ファイル `*.part` に保存し、完了後に名前を変える）。SHA-256 が一致しなければ一時ファイルを消して失敗する。
3. 展開先 `{name}#{version}/package/package.json` があり、`name` と `version` が期待どおりなら何もしない。
   無ければ一時ディレクトリに展開し、`package/package.json` の `name`・`version` を確認してから展開先へ移す。
4. 結果を 1 行ずつ表示する（例：`[済] jp-core.r4#1.2.0`、`[取得] jpfhir-terminology#2.2609.0`）。

保存先の外のファイルは変更しない。

## 終了コード

| コード | 意味 | 表示するメッセージの例 |
|---|---|---|
| 0 | すべて揃っている | `JP パッケージの準備ができました: .cache/fhir-packages` |
| 1 | オプションの誤り | 使い方 |
| 2 | 必要なコマンドが無い | `curl または wget が必要です` |
| 3 | ダウンロードに失敗（ネットワークに接続できない等） | `取得できませんでした: {URL}（ネットワーク接続を確認してください）` |
| 4 | SHA-256 が一致しない | `SHA-256 が一致しません: {ファイル}（取得元で内容が変更された可能性があります。内容を確認し、スクリプトの値を更新してください）` |
| 5 | 展開の失敗、または package.json の name / version が期待と違う | `パッケージの内容が想定と異なります: {ファイル}` |
| 6 | `--check` で揃っていない | `未取得のパッケージがあります。scripts/fetch-jp-packages.sh を実行してください` |

## リポジトリ・Docker への取り込み防止

| ファイル | 追加する行 |
|---|---|
| `.gitignore`（ルート） | `.cache/` |
| `.dockerignore`（ルート） | `.cache/` |

パッケージは開発・テスト時の参照データであり、Docker イメージにも実行時にも使わない（R-20）。
