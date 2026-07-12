import random
import types

import chess
import pytest

from thrie_raed_chess.puzzles import PUZZLES
from thrie_raed_chess.session import (
    BattlePhase,
    BattleSession,
    PuzzlePhase,
    PuzzleSession,
    outcome_message,
)


EVALUATED = [
    (chess.Move.from_uci("h2h3"), 0, "green"),
    (chess.Move.from_uci("a2a3"), 80, "yellow"),
    (chess.Move.from_uci("b1c3"), 200, "red"),
]


def _stub_battle_evaluation(monkeypatch, evaluated=EVALUATED, position_eval="White +0.1"):
    monkeypatch.setattr("thrie_raed_chess.session.evaluate_all_moves", lambda engine, board: evaluated)
    monkeypatch.setattr("thrie_raed_chess.session.evaluate_position", lambda engine, board: position_eval)
    monkeypatch.setattr(random, "shuffle", lambda items: None)


def test_prepare_choices_uses_pick_three_and_sets_human_choosing(monkeypatch):
    _stub_battle_evaluation(monkeypatch)
    session = BattleSession()

    choices = session.prepare_choices(engine=None)

    assert choices == EVALUATED
    assert session.phase is BattlePhase.HUMAN_CHOOSING
    assert session.focused_idx is None
    assert session.chosen_idx is None


def test_focus_only_applies_during_human_choosing_and_in_range(monkeypatch):
    _stub_battle_evaluation(monkeypatch)
    session = BattleSession()
    session.prepare_choices(engine=None)

    session.focus(5)
    assert session.focused_idx is None

    session.focus(1)
    assert session.focused_idx == 1

    session.apply_choice(1)
    session.focus(0)
    assert session.focused_idx == 1  # REVEALED中は変化しない


def test_apply_choice_reveals_all_three_pushes_move_and_records_stats(monkeypatch):
    _stub_battle_evaluation(monkeypatch)
    session = BattleSession()
    session.prepare_choices(engine=None)

    revealed = session.apply_choice(1)

    assert [r.is_chosen for r in revealed] == [False, True, False]
    assert revealed[1].san == "a3"
    assert revealed[1].loss == 80
    assert revealed[1].color == "yellow"
    assert session.board.move_stack[-1] == chess.Move.from_uci("a2a3")
    assert session.stats.moves == 1
    assert session.stats.counts["yellow"] == 1
    assert session.phase is BattlePhase.REVEALED
    assert session.chosen_idx == 1


def test_apply_choice_that_delivers_checkmate_goes_straight_to_game_over(monkeypatch):
    # フールズメイト直前: 黒番、Qh4# が指せる局面
    board = chess.Board()
    for san in ["f3", "e5", "g4"]:
        board.push_san(san)
    mate_move = chess.Move.from_uci("d8h4")
    evaluated = [(mate_move, 0, "green")]
    monkeypatch.setattr("thrie_raed_chess.session.evaluate_all_moves", lambda engine, board: evaluated)
    monkeypatch.setattr("thrie_raed_chess.session.evaluate_position", lambda engine, board: "Black +9.0")
    monkeypatch.setattr(random, "shuffle", lambda items: None)
    session = BattleSession(board=board)
    session.prepare_choices(engine=None)

    session.apply_choice(0)

    assert session.phase is BattlePhase.GAME_OVER
    assert session.board.is_checkmate()
    assert session.result == "0-1"  # Black(CPU) がメイトを決めた
    assert session.termination == "Game over"


def test_apply_cpu_move_pushes_engine_move_and_returns_to_human_choosing(monkeypatch):
    board = chess.Board()
    cpu_move = chess.Move.from_uci("e7e5")

    class FakeEngine:
        def play(self, board, limit, options=None):
            return types.SimpleNamespace(move=cpu_move)

    session = BattleSession(board=board)
    session.phase = BattlePhase.REVEALED

    played = session.apply_cpu_move(FakeEngine())

    assert played == cpu_move
    assert session.board.move_stack[-1] == cpu_move
    assert session.phase is BattlePhase.HUMAN_CHOOSING


def test_apply_cpu_move_passes_session_skill_and_depth_to_engine():
    board = chess.Board()
    cpu_move = chess.Move.from_uci("e7e5")

    class FakeEngine:
        def __init__(self):
            self.limit = None
            self.options = None

        def play(self, board, limit, options=None):
            self.limit = limit
            self.options = options
            return types.SimpleNamespace(move=cpu_move)

    engine = FakeEngine()
    session = BattleSession(board=board, cpu_skill=15, cpu_depth=9)
    session.phase = BattlePhase.REVEALED

    session.apply_cpu_move(engine)

    assert engine.limit.depth == 9
    assert engine.options == {"Skill Level": 15}


def test_begin_cpu_turn_moves_phase_to_cpu_thinking():
    session = BattleSession()
    session.phase = BattlePhase.REVEALED

    session.begin_cpu_turn()

    assert session.phase is BattlePhase.CPU_THINKING


def test_resign_and_abandon_set_result_and_termination():
    session = BattleSession()

    session.resign()
    assert session.phase is BattlePhase.GAME_OVER
    assert session.result == "0-1"
    assert session.termination == "White resigned"

    session2 = BattleSession()
    session2.abandon()
    assert session2.phase is BattlePhase.GAME_OVER
    assert session2.result == "*"
    assert session2.termination == "Abandoned"


def test_outcome_message_covers_checkmate_and_stalemate():
    checkmate_board = chess.Board()
    for san in ["f3", "e5", "g4", "Qh4#"]:
        checkmate_board.push_san(san)
    assert "チェックメイト" in outcome_message(checkmate_board)
    assert "CPU" in outcome_message(checkmate_board)  # Black(CPU) がメイトを決めた

    stalemate_board = chess.Board("7k/5Q2/6K1/8/8/8/8/8 b - - 0 1")
    assert outcome_message(stalemate_board) == "ステイルメイト(引き分け)"


def test_puzzle_session_starts_with_first_step_choices():
    puzzle = next(p for p in PUZZLES if p["mate_in"] == 2)

    session = PuzzleSession(puzzle)

    assert session.phase is PuzzlePhase.CHOOSING
    correct = chess.Move.from_uci(puzzle["solution"][0])
    assert any(mv == correct for mv, _, _ in session.choices)
    assert len(session.choices) == 3


def test_puzzle_session_correct_choice_advances_through_reply_to_next_step():
    puzzle = next(p for p in PUZZLES if p["mate_in"] == 2)
    session = PuzzleSession(puzzle)
    correct = chess.Move.from_uci(puzzle["solution"][0])
    correct_idx = next(i for i, (mv, _, _) in enumerate(session.choices) if mv == correct)

    status = session.apply_choice(correct_idx)

    assert status == "correct"
    assert session.phase is PuzzlePhase.CHOOSING
    assert session.board.move_stack[-1] == chess.Move.from_uci(puzzle["solution"][1])
    assert session.idx == 2
    final_correct = chess.Move.from_uci(puzzle["solution"][2])
    assert any(mv == final_correct for mv, _, _ in session.choices)


def test_puzzle_session_final_correct_choice_reaches_success():
    puzzle = next(p for p in PUZZLES if p["mate_in"] == 2)
    session = PuzzleSession(puzzle)
    for expected_idx in (0, 2):
        correct = chess.Move.from_uci(puzzle["solution"][expected_idx])
        idx = next(i for i, (mv, _, _) in enumerate(session.choices) if mv == correct)
        status = session.apply_choice(idx)

    assert status == "correct"
    assert session.phase is PuzzlePhase.SUCCESS
    assert session.board.is_checkmate()
    assert session.final_choice_idx == idx


def test_puzzle_session_abandon_sets_aborted_phase():
    puzzle = next(p for p in PUZZLES if p["mate_in"] == 2)
    session = PuzzleSession(puzzle)

    session.abandon()

    assert session.phase is PuzzlePhase.ABORTED


def test_puzzle_session_wrong_choice_goes_to_miss():
    puzzle = next(p for p in PUZZLES if p["mate_in"] == 2)
    session = PuzzleSession(puzzle)
    correct = chess.Move.from_uci(puzzle["solution"][0])
    wrong_idx = next(i for i, (mv, _, _) in enumerate(session.choices) if mv != correct)

    status = session.apply_choice(wrong_idx)

    assert status == "miss"
    assert session.phase is PuzzlePhase.MISS
    assert session.final_choice_idx == wrong_idx
