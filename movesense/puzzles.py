import json
import random
from pathlib import Path

import chess

PUZZLE_FILE = Path(__file__).resolve().parent.parent / "puzzles.json"


def load_puzzles():
    with PUZZLE_FILE.open(encoding="utf-8") as f:
        return json.load(f)


PUZZLES = load_puzzles()


def puzzle_board(puzzle):
    return chess.Board(puzzle["fen"])


def get_puzzles_by_difficulty(mate_in):
    return [p for p in PUZZLES if p["mate_in"] == mate_in]


def mate_label(puzzle):
    return f"mate in {puzzle['mate_in']}"


def find_puzzle_by_id(puzzle_id):
    for puzzle in PUZZLES:
        if puzzle["id"] == puzzle_id:
            return puzzle
    return None


def pick_puzzle_three(board, correct_move):
    choices = [(correct_move, 0, "green")]
    rest = [m for m in board.legal_moves if m != correct_move]
    random.shuffle(rest)
    choices += [(m, 0, "yellow") for m in rest[:2]]
    random.shuffle(choices)
    return choices
