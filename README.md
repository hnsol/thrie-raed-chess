# Thrie Raed Chess

*[English version](README.en.md)*

「3択で覚えるチェス」— ターミナル（TUI）で動くチェス初心者向けトレーナーです。ゼロから指し手を考えるのではなく、**3つの候補手から選ぶ**ことで最善手の感覚を身につけます。[Textual](https://textual.textualize.io/) と [python-chess](https://python-chess.readthedocs.io/) 製。

## スクリーンショット

対戦モード（CPU と対局し、3択で最善手を学ぶ）

![対戦モード](docs/images/battle-mode.png)

詰めチェスモード（3択で詰み手順を当てる）

![詰めチェスモード](docs/images/puzzle-mode.png)

## 特徴

- **対戦モード** — CPU と対局。自分の手番ごとに Stockfish が候補手を3つ提示し、`j` / `k` / `l` の1キーで選択。選んだ手はセンチポーン損失に応じて 緑（ほぼ最善）/ 黄 / 赤 で評価され、統計も表示されます。
- **パズルモード** — Lichess パズルデータベース由来の 2手/3手/4手詰めを3択クイズで出題。
- **対局レビュー出力** — 終局後、PGN 付きのレビュー用プロンプトを書き出して AI アシスタントに貼り付けられます。
- ブロックアートの駒をターミナルにそのまま描画。

## 動作要件

- Python 3.11+
- [Stockfish](https://stockfishchess.org/)（対戦モードに必須。パズルモードは不要）
  - macOS: `brew install stockfish`
  - Debian/Ubuntu: `apt install stockfish`

## インストール

[uv](https://docs.astral.sh/uv/) を使う場合:

```sh
git clone https://github.com/hnsol/thrie-raed-chess.git
cd thrie-raed-chess
uv sync
```

## 使い方

```sh
uv run python -m thrie_raed_chess
```

パッケージとしてインストール（`uv tool install .` または `pip install .`）した場合:

```sh
thrie-raed-chess
```

### キー操作

- `j` / `k` / `l` — 左 / 中 / 右 の選択肢を選ぶ
- `q` — 戻る / 終了

## 開発

```sh
uv sync
uv run pytest
```

### 同梱パズルの再生成

`thrie_raed_chess/data/puzzles.json` は [Lichess パズルデータベース](https://database.lichess.org/#puzzles)（CC0）から抽出しています:

```sh
zstd -dc lichess_db_puzzle.csv.zst | uv run python tools/extract_lichess_puzzles.py thrie_raed_chess/data/puzzles.json
```

## ライセンス

MIT — [LICENSE](LICENSE) を参照。サードパーティの帰属表示（Lichess パズルデータベース、chess-tui の駒グリフ）は [THIRD_PARTY_LICENSES](THIRD_PARTY_LICENSES) に記載しています。
