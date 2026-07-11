# Thrie Raed Chess

*[日本語版はこちら / Japanese version](README.md)*

A terminal (TUI) chess trainer for beginners: instead of finding moves from scratch, you learn by picking the best move out of **three choices**. Built with [Textual](https://textual.textualize.io/) and [python-chess](https://python-chess.readthedocs.io/).

## Screenshots

Battle mode (play a CPU and learn the best move via 3 choices)

![Battle mode](docs/images/battle-mode.png)

Puzzle mode (find the mating sequence via 3 choices)

![Puzzle mode](docs/images/puzzle-mode.png)

## Features

- **Battle mode** — play against a CPU opponent. On each of your turns, Stockfish proposes three candidate moves; pick one with a single key (`j` / `k` / `l`). Your choice is graded green (near-best), yellow, or red by centipawn loss, with running stats.
- **Puzzle mode** — mate-in-2/3/4 puzzles from the Lichess puzzle database, presented as 3-choice quizzes.
- **Game review export** — export the finished game as a PGN-based review prompt you can paste into an AI assistant.
- Block-art chess pieces rendered right in your terminal.

## Requirements

- Python 3.11+
- [Stockfish](https://stockfishchess.org/) on your `PATH` (required for battle mode; puzzle mode works without it)
  - macOS: `brew install stockfish`
  - Debian/Ubuntu: `apt install stockfish`

## Installation

With [uv](https://docs.astral.sh/uv/):

```sh
git clone https://github.com/hnsol/thrie-raed-chess.git
cd thrie-raed-chess
uv sync
```

## Usage

```sh
uv run python -m thrie_raed_chess
```

Or, after installing the package (`uv tool install .` or `pip install .`):

```sh
thrie-raed-chess
```

### Keys

- `j` / `k` / `l` — pick the left / middle / right choice
- `q` — back / quit

## Development

```sh
uv sync
uv run pytest
```

### Regenerating the bundled puzzles

The puzzles in `thrie_raed_chess/data/puzzles.json` are extracted from the [Lichess puzzle database](https://database.lichess.org/#puzzles) (CC0):

```sh
zstd -dc lichess_db_puzzle.csv.zst | uv run python tools/extract_lichess_puzzles.py thrie_raed_chess/data/puzzles.json
```

## License

MIT — see [LICENSE](LICENSE). Third-party attributions (Lichess puzzle database, chess-tui glyphs) are listed in [THIRD_PARTY_LICENSES](THIRD_PARTY_LICENSES).
