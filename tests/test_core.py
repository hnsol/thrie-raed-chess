import chess

from thrie_raed_chess.boardmodel import CellRole, choice_model
from thrie_raed_chess.evaluation import format_position_eval, pick_three
from thrie_raed_chess.puzzles import PUZZLES, mate_label, pick_puzzle_three, puzzle_board
from thrie_raed_chess.review import game_review_text
from thrie_raed_chess.stats import BattleStats, movement_help_lines
from thrie_raed_chess.tui import theme


def test_bundled_puzzles_cover_mate_in_2_3_4_only():
    assert {p["mate_in"] for p in PUZZLES} == {2, 3, 4}
    counts = {mate_in: 0 for mate_in in (2, 3, 4)}
    for puzzle in PUZZLES:
        counts[puzzle["mate_in"]] += 1
        board = puzzle_board(puzzle)
        for uci in puzzle["solution"]:
            move = chess.Move.from_uci(uci)
            assert move in board.legal_moves
            board.push(move)
        assert board.is_checkmate()
    assert counts == {2: 1000, 3: 1000, 4: 1000}


def test_puzzle_three_choices_include_correct_move(monkeypatch):
    monkeypatch.setattr("thrie_raed_chess.puzzles.random.shuffle", lambda items: None)
    puzzle = [p for p in PUZZLES if p["mate_in"] == 2][0]
    board = puzzle_board(puzzle)
    correct = chess.Move.from_uci(puzzle["solution"][0])

    choices = pick_puzzle_three(board, correct)

    assert len(choices) == 3
    assert any(move == correct for move, _, _ in choices)


def test_mate_labels_use_chess_terms():
    assert {mate_label(p) for p in PUZZLES} == {"mate in 2", "mate in 3", "mate in 4"}


def test_battle_stats_lines_include_counts_average_and_last():
    stats = BattleStats()
    stats.record("green", 10)
    stats.record("red", 210)

    lines = stats.lines()
    text = "\n".join(lines)

    assert "Stats" in text
    assert "Moves 2" in text
    assert "G/Y/R 1/0/1" in text
    assert "Avg loss 110" in text
    assert "Last red 210" in text


def test_format_position_eval_outputs_side_advantage_and_mate():
    assert format_position_eval(80) == "White +0.8"
    assert format_position_eval(-120) == "Black +1.2"
    assert format_position_eval(10) == "互角"
    assert format_position_eval(None, mate=3) == "White mate in 3"
    assert format_position_eval(None, mate=-2) == "Black mate in 2"


def test_battle_panel_includes_eval_stats_and_move_guide():
    stats = BattleStats()
    stats.record("yellow", 80)

    lines = movement_help_lines(stats=stats, position_eval="White +0.8", panel_mode="stats")
    text = "\n".join(lines)

    assert "形勢 White +0.8" in text
    assert "Stats" in text
    assert "x: 動き" in text
    assert "♟ Pawn" not in text

    help_lines = movement_help_lines(stats=stats, position_eval="White +0.8", panel_mode="help")
    help_text = "\n".join(help_lines)

    assert "形勢 White +0.8" not in help_text
    assert "♟ Pawn" in help_text
    assert "x: Stats" not in help_text


def test_puzzle_panel_keeps_move_guide_only():
    text = "\n".join(movement_help_lines())

    assert "♟ Pawn" in text
    assert "Stats" not in text
    assert "形勢" not in text


def test_game_review_text_contains_pgn_and_llm_request():
    board = chess.Board()
    board.push_san("e4")
    board.push_san("e5")

    text = game_review_text(board, result="0-1", termination="White resigned")

    assert '[Event "Thrie Raed Chess"]' in text
    assert '[Result "0-1"]' in text
    assert '[Termination "White resigned"]' in text
    assert "1. e4 e5 0-1" in text
    assert "この棋譜を見て" in text
    assert "改善点" in text


def test_movement_help_lines_are_short_enough_for_side_panel():
    assert all(len(line) <= 22 for line in movement_help_lines())


def test_pick_three_always_includes_exact_best_move(monkeypatch):
    monkeypatch.setattr("thrie_raed_chess.evaluation.random.choice", lambda items: items[-1])
    monkeypatch.setattr("thrie_raed_chess.evaluation.random.shuffle", lambda items: None)
    evaluated = [
        ("best", 0, "green"),
        ("also_good", 10, "green"),
        ("yellow", 80, "yellow"),
        ("red", 250, "red"),
    ]

    choices = pick_three(evaluated)

    assert any(move == "best" for move, _, _ in choices)


def test_pick_three_prefers_yellow_and_red_with_best_move():
    evaluated = [
        ("best", 0, "green"),
        ("also_good", 10, "green"),
        ("yellow", 80, "yellow"),
        ("red", 250, "red"),
    ]

    choices = pick_three(evaluated)
    colors = {color for _, _, color in choices}

    assert len(choices) == 3
    assert colors == {"green", "yellow", "red"}


def test_identity_colors_are_distinct_for_each_choice_key():
    # 旧CLIのANSI直接検査(48;5;45/213/214)に相当。j/k/l が混同されない3色である
    # ことをTextualテーマの定数レベルで確認する。
    assert len(set(theme.IDENTITY_BG)) == 3


def test_choice_model_preserves_piece_color_independent_of_identity_bg():
    # 旧CLIの「識別色の背景でも黒駒は黒駒色のまま」というANSI直接検査に相当。
    board = chess.Board(None)
    board.set_piece_at(chess.A1, chess.Piece(chess.KING, chess.WHITE))
    board.set_piece_at(chess.F6, chess.Piece(chess.KING, chess.BLACK))
    board.turn = chess.BLACK
    choices = [(chess.Move.from_uci("f6e6"), 0, "green")]

    model = choice_model(board, choices)

    # from_square(移動前の駒の位置)にまだ駒があり、色情報は黒のまま保持される
    from_cell = model[chess.F6]
    assert from_cell.role == CellRole.CHOICE
    assert from_cell.piece.color == chess.BLACK


def test_choice_model_focused_not_overwritten_by_dimmed_on_shared_square():
    board = chess.Board("8/8/8/8/8/8/8/R5K1 w - - 0 1")
    choices = [
        (chess.Move.from_uci("a1a8"), 0, "green"),
        (chess.Move.from_uci("a1a4"), 80, "yellow"),
        (chess.Move.from_uci("a1h1"), 200, "red"),
    ]
    model = choice_model(board, choices, focused_index=0)
    cell = model[chess.A1]
    assert cell.role == CellRole.CHOICE_FOCUSED
    assert cell.choice_index == 0
