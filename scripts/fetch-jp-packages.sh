#!/usr/bin/env bash
# Fetch, verify (SHA-256) and extract the JP Core / JP Terminology FHIR packages.
# The packages are NOT stored in the repository (see .gitignore: .cache/).
# Contract: specs/001-lab-order-workflow/contracts/fetch-jp-packages.md
set -euo pipefail

# name#version | URL | SHA-256
PACKAGES=(
  "jp-core.r4#1.2.0|https://jpfhir.jp/fhir/core/1.2.0/jp-core.r4-1.2.0.tgz|39c4ade9c32ea815a6c5889f9ee89f80efe02d5bbc8236a6b02ec573a28a2c70"
  "jpfhir-terminology#2.2609.0|https://jpfhir.jp/fhir/core/terminology/jpfhir-terminology.r4-2.2609.0.tgz|aff833151afbef9d6127868ba94e20f29e88ab4500af080e896b651e3999efd5"
)

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
DEST="${JP_FHIR_PACKAGE_DIR:-$ROOT/.cache/fhir-packages}"
FORCE=0
CHECK=0

usage() {
  cat <<USAGE
使い方: scripts/fetch-jp-packages.sh [--dest DIR] [--force] [--check] [--help]

  --dest DIR  保存先（既定: \$JP_FHIR_PACKAGE_DIR、無ければ $ROOT/.cache/fhir-packages）
  --force     取得済みでも取得し直して展開し直す
  --check     取得・展開をせず、揃っていて検証に通るかだけ確認する
  --help      この表示

終了コード: 0 成功 / 1 オプション誤り / 2 必要なコマンド無し / 3 ダウンロード失敗
            4 SHA-256 不一致 / 5 展開失敗・内容が想定と違う / 6 --check で未取得
USAGE
}

while [[ $# -gt 0 ]]; do
  case "$1" in
    --dest) [[ $# -ge 2 ]] || { usage >&2; exit 1; }; DEST="$2"; shift 2 ;;
    --force) FORCE=1; shift ;;
    --check) CHECK=1; shift ;;
    --help|-h) usage; exit 0 ;;
    *) echo "不明なオプション: $1" >&2; usage >&2; exit 1 ;;
  esac
done

if command -v sha256sum >/dev/null 2>&1; then
  sha256() { sha256sum "$1" | cut -d' ' -f1; }
elif command -v shasum >/dev/null 2>&1; then
  sha256() { shasum -a 256 "$1" | cut -d' ' -f1; }
else
  echo "sha256sum または shasum が必要です" >&2; exit 2
fi
command -v tar >/dev/null 2>&1 || { echo "tar が必要です" >&2; exit 2; }
if command -v curl >/dev/null 2>&1; then
  download() { curl -fsSL --retry 2 -o "$2" "$1"; }
elif command -v wget >/dev/null 2>&1; then
  download() { wget -q -O "$2" "$1"; }
else
  echo "curl または wget が必要です" >&2; exit 2
fi

# package.json の name / version が期待どおりか（python3 や jq に依存しない）
package_matches() { # $1=package.json $2=name $3=version
  [[ -f "$1" ]] || return 1
  local flat; flat="$(tr -d '\n\r\t ' < "$1")"
  [[ "$flat" == *"\"name\":\"$2\""* && "$flat" == *"\"version\":\"$3\""* ]]
}

mkdir_dest() { mkdir -p "$DEST/downloads"; }
missing=0

for entry in "${PACKAGES[@]}"; do
  IFS='|' read -r key url sum <<<"$entry"
  name="${key%%#*}"; version="${key##*#}"
  file="$DEST/downloads/$(basename "$url")"
  target="$DEST/$key"

  ready=0
  if [[ $FORCE -eq 0 ]] && package_matches "$target/package/package.json" "$name" "$version" \
     && [[ -f "$file" && "$(sha256 "$file")" == "$sum" ]]; then
    ready=1
  fi

  if [[ $CHECK -eq 1 ]]; then
    if [[ $ready -eq 1 ]]; then echo "[済] $key"; else echo "[未] $key"; missing=1; fi
    continue
  fi

  if [[ $ready -eq 1 ]]; then echo "[済] $key"; continue; fi

  mkdir_dest
  if [[ $FORCE -eq 1 || ! -f "$file" || "$(sha256 "$file")" != "$sum" ]]; then
    rm -f "$file.part"
    if ! download "$url" "$file.part"; then
      rm -f "$file.part"
      echo "取得できませんでした: $url（ネットワーク接続を確認してください）" >&2; exit 3
    fi
    if [[ "$(sha256 "$file.part")" != "$sum" ]]; then
      rm -f "$file.part"
      echo "SHA-256 が一致しません: $url（取得元で内容が変更された可能性があります。内容を確認し、スクリプトの値を更新してください）" >&2; exit 4
    fi
    mv "$file.part" "$file"
  fi

  tmp="$(mktemp -d "$DEST/.extract.XXXXXX")"
  if ! tar -xzf "$file" -C "$tmp" || ! package_matches "$tmp/package/package.json" "$name" "$version"; then
    rm -rf "$tmp"
    echo "パッケージの内容が想定と異なります: $file" >&2; exit 5
  fi
  rm -rf "$target"
  mkdir -p "$target"
  mv "$tmp/package" "$target/package"
  rm -rf "$tmp"
  echo "[取得] $key"
done

if [[ $CHECK -eq 1 && $missing -eq 1 ]]; then
  echo "未取得のパッケージがあります。scripts/fetch-jp-packages.sh を実行してください" >&2; exit 6
fi
echo "JP パッケージの準備ができました: $DEST"
