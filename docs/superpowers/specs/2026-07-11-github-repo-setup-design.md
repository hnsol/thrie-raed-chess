# GitHub 公開に向けたリポジトリ整備

日付: 2026-07-11 / 承認済み

## 目的

movesense-chess を GitHub に public リポジトリとして公開できる状態に整える。

## 決定事項

- 公開範囲: Public
- ライセンス: MIT
- README: 英語 (README.md) + 日本語 (README.ja.md)
- ディレクトリ: 標準構成に再編

## 変更内容

1. `puzzles.json` → `movesense/data/puzzles.json`（パッケージデータ化、`movesense/puzzles.py` のパス修正）
2. `test_*.py` → `tests/` に移動
3. `LICENSE`（MIT, hnsol）追加
4. `THIRD_PARTY_LICENSES` に Lichess puzzle DB（CC0）の帰属を追記
5. `README.md`（英）+ `README.ja.md`（日）: 概要 / インストール（uv）/ 使い方 / Stockfish 要件 / パズル生成手順 / ライセンス
6. `pyproject.toml`: license・authors・readme・`[project.scripts] movesense`・build-system（hatchling）追加
7. `.gitignore` に `.pytest_cache/` 追記
8. ブランチ `master` → `main` にリネーム
9. pytest 全通過を確認

## 対象外

- コードのリファクタリング、CI 設定、PyPI 公開
