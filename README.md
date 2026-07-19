<p align="center">
  <img src="web/public/icons/pwa-512x512.png" alt="Thrie Raed Chess" width="160">
</p>

<h1 align="center">Thrie Raed Chess</h1>

<p align="center">
  「3択で覚えるチェス」— チェス初心者向けトレーナー<br>
  <a href="README.en.md">English version</a>
</p>

ゼロから指し手を考えるのではなく、**3つの候補手から選ぶ**ことで最善手の感覚を身につけます。[Textual](https://textual.textualize.io/) と [python-chess](https://python-chess.readthedocs.io/) 製。

## Web版（スマホ対応）

**▶ https://hnsol.github.io/thrie-raed-chess/**

- **インストール不要** — ブラウザで開くだけ。iOS / Android 対応
- **PWA** — ホーム画面に追加してアプリのように起動
- **オフライン可** — 一度読み込めばネット接続なしで遊べます
- **エンジン内蔵** — Stockfish（WebAssembly）を同梱。別途インストール不要

### ローカル開発

Node.js 18+ が必要です。

```sh
cd web
npm install
npm run dev
```

## 特徴

- **対戦モード** — CPU と対局。開始時に難易度を5段階（入門・初級・中級・上級・最強）から `h` / `j` / `k` / `l` / `;` で選択できます。自分の手番ごとに Stockfish が候補手を3つ提示し、`j` / `k` / `l` の1キーで選択。選んだ手はセンチポーン損失に応じて 緑（ほぼ最善）/ 黄 / 赤 で評価され、統計も表示されます。
- **コーチコメント** — 手を指すたびにコーチが褒めて励ましてくれます。最善手は絶賛、悪手でも前向きに勇気づけ。局面（序盤・中盤・終盤）や手の内容（駒取り・王手など）、好手の連続に応じて表現が変わり、同じ言い回しは繰り返しません。
- **パズルモード** — Lichess パズルデータベース由来の 2手/3手/4手詰めを3択クイズで出題。
- **対局レビュー出力** — 終局後、PGN 付きのレビュー用プロンプトを書き出して AI アシスタントに貼り付けられます。
- ブロックアートの駒をターミナルにそのまま描画。

### 対戦モード

CPU と対局し、3択で最善手を学ぶ:

![対戦モード](docs/images/battle-mode.png)

### パズルモード

3択で詰み手順を当てる:

![詰めチェスモード](docs/images/puzzle-mode.png)

## ターミナル版（TUI）の動作要件

- Python 3.11+
- ターミナル: **92×30 以上**推奨（それ未満でも動作しますが、サイドパネルが狭まったり駒が簡易表示になります）
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
