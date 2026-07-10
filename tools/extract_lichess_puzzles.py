#!/usr/bin/env python3
import csv
import json
import sys

import chess


TARGETS = {2: 1000, 3: 1000, 4: 1000}


def row_mate_in(row):
    themes = set(row["Themes"].split())
    for mate_in in TARGETS:
        if f"mateIn{mate_in}" in themes:
            return mate_in
    return None


def build_puzzle(row, mate_in):
    moves = row["Moves"].split()
    if len(moves) < 2:
        return None

    board = chess.Board(row["FEN"])
    first = chess.Move.from_uci(moves[0])
    if first not in board.legal_moves:
        return None
    board.push(first)

    solution = moves[1:]
    if len(solution) != 2 * mate_in - 1:
        return None

    check = board.copy()
    for uci in solution:
        move = chess.Move.from_uci(uci)
        if move not in check.legal_moves:
            return None
        check.push(move)
    if not check.is_checkmate():
        return None

    return {
        "id": row["PuzzleId"],
        "mate_in": mate_in,
        "title": f"Lichess {row['PuzzleId']}",
        "fen": board.fen(),
        "solution": solution,
        "rating": int(row["Rating"]),
        "source": row["GameUrl"],
    }


def main():
    if len(sys.argv) != 2:
        raise SystemExit("usage: extract_lichess_puzzles.py OUTPUT_JSON")

    counts = {mate_in: 0 for mate_in in TARGETS}
    puzzles = []
    reader = csv.DictReader(sys.stdin)

    for row in reader:
        mate_in = row_mate_in(row)
        if mate_in is None or counts[mate_in] >= TARGETS[mate_in]:
            continue
        puzzle = build_puzzle(row, mate_in)
        if puzzle is None:
            continue
        puzzles.append(puzzle)
        counts[mate_in] += 1
        if all(counts[n] >= TARGETS[n] for n in TARGETS):
            break

    if counts != TARGETS:
        raise SystemExit(f"not enough puzzles: {counts}")

    with open(sys.argv[1], "w", encoding="utf-8") as f:
        json.dump(puzzles, f, ensure_ascii=False, indent=2)
        f.write("\n")

    print(counts)


if __name__ == "__main__":
    main()
