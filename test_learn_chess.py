import chess

from learn_chess import (
    APP_NAME,
    PUZZLES,
    IDENTITY,
    BattleStats,
    draw_human_choice_screen,
    format_position_eval,
    game_review_text,
    mate_label,
    movement_help_lines,
    pick_three,
    pick_puzzle_three,
    puzzle_board,
    read_menu_choice,
    render_annotated_board,
    render_board_lines,
    render_puzzle_choices_board,
    show_title,
)


def test_menu_choice_uses_home_keys_and_ignores_asdf(monkeypatch):
    keys = iter(["a", "s", "d", "f", "k"])
    monkeypatch.setattr("learn_chess.read_key", lambda: next(keys))

    assert read_menu_choice({"j", "k", "l", "q"}) == "k"


def test_puzzle_result_menu_uses_q_to_quit(monkeypatch):
    import learn_chess

    keys = iter(["l", "q"])
    monkeypatch.setattr("learn_chess.read_key", lambda: next(keys))

    assert learn_chess.puzzle_result_menu("success", PUZZLES[0]) == "q"


def test_success_result_shows_final_board_before_message(monkeypatch, capsys):
    import learn_chess

    puzzle = [p for p in PUZZLES if p["mate_in"] == 2][0]
    board = puzzle_board(puzzle)
    for uci in puzzle["solution"]:
        board.push(chess.Move.from_uci(uci))
    keys = iter(["q"])
    monkeypatch.setattr("learn_chess.read_key", lambda: next(keys))

    assert learn_chess.puzzle_result_menu("success", puzzle, board) == "q"

    out = capsys.readouterr().out
    assert out.rindex("\n8 ") < out.rindex("成功。チェックメイトです。")


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
    monkeypatch.setattr("learn_chess.random.shuffle", lambda items: None)
    puzzle = [p for p in PUZZLES if p["mate_in"] == 2][0]
    board = puzzle_board(puzzle)
    correct = chess.Move.from_uci(puzzle["solution"][0])

    choices = pick_puzzle_three(board, correct)

    assert len(choices) == 3
    assert any(move == correct for move, _, _ in choices)


def test_mate_labels_use_chess_terms():
    assert {mate_label(p) for p in PUZZLES} == {"mate in 2", "mate in 3", "mate in 4"}


def test_l_candidate_color_is_not_blue_like_j():
    assert "48;5;45" in IDENTITY[0][0]
    assert "48;5;213" in IDENTITY[1][0]
    assert "48;5;214" in IDENTITY[2][0]


def test_candidate_board_does_not_place_keys_on_destination(capsys):
    board = chess.Board()
    choices = [
        (chess.Move.from_uci("g1f3"), 0, "green"),
        (chess.Move.from_uci("b1c3"), 80, "yellow"),
        (chess.Move.from_uci("a2a3"), 200, "red"),
    ]

    render_annotated_board(board, choices)

    out = capsys.readouterr().out
    assert " j " not in out
    assert " k " not in out
    assert " l " not in out


def test_puzzle_choices_board_does_not_place_keys_on_destination(capsys):
    puzzle = PUZZLES[0]
    board = puzzle_board(puzzle)
    choices = pick_puzzle_three(board, chess.Move.from_uci(puzzle["solution"][0]))

    render_puzzle_choices_board(board, choices)

    out = capsys.readouterr().out
    assert " j " not in out
    assert " k " not in out
    assert " l " not in out


def test_puzzle_choices_board_shows_last_reply(capsys):
    puzzle = [p for p in PUZZLES if p["mate_in"] == 2][0]
    board = puzzle_board(puzzle)
    board.push(chess.Move.from_uci(puzzle["solution"][0]))
    board.push(chess.Move.from_uci(puzzle["solution"][1]))
    choices = pick_puzzle_three(board, chess.Move.from_uci(puzzle["solution"][2]))

    render_puzzle_choices_board(board, choices)

    assert "直近応手" in capsys.readouterr().out


def test_title_text_is_mode_specific(capsys):
    show_title("puzzle")
    puzzle_title = capsys.readouterr().out
    assert APP_NAME in puzzle_title
    assert "Mode: Puzzle" in puzzle_title
    assert "評価は開示しません" in puzzle_title
    assert "色の意味" not in puzzle_title

    show_title("battle")
    battle_title = capsys.readouterr().out
    assert "Mode: Battle" in battle_title
    assert "評価を開示" in battle_title


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
    assert "x: Stats" in help_text


def test_battle_choice_screen_mentions_x_toggle(capsys):
    stats = BattleStats()
    board = chess.Board()
    choices = [
        (chess.Move.from_uci("g1f3"), 0, "green"),
        (chess.Move.from_uci("a2a3"), 80, "yellow"),
        (chess.Move.from_uci("a2a4"), 120, "yellow"),
    ]

    draw_human_choice_screen(board, choices, stats, "White +0.5")

    out = capsys.readouterr().out
    assert "x で表示切替" in out
    assert "Stats" in out
    assert "♟ Pawn" not in out


def test_puzzle_panel_keeps_move_guide_only():
    text = "\n".join(movement_help_lines())

    assert "♟ Pawn" in text
    assert "Stats" not in text
    assert "形勢" not in text


def test_game_review_text_contains_pgn_and_llm_request():
    import chess

    board = chess.Board()
    board.push_san("e4")
    board.push_san("e5")

    text = game_review_text(board, result="0-1", termination="White resigned")

    assert "[Event \"MoveSense Chess\"]" in text
    assert "[Result \"0-1\"]" in text
    assert "[Termination \"White resigned\"]" in text
    assert "1. e4 e5 0-1" in text
    assert "この棋譜を見て" in text
    assert "改善点" in text


def test_render_board_lines_includes_movement_help_panel():
    import chess

    lines = render_board_lines(chess.Board(), {})
    text = "\n".join(lines)

    assert "動き" in text
    assert "♟ Pawn" in text
    assert "取る=斜め" in text
    assert "♞ Knight" in text
    assert "L字" in text


def test_movement_help_lines_are_short_enough_for_side_panel():
    assert all(len(line) <= 22 for line in movement_help_lines())


def test_result_screen_keeps_board_before_move_summary(monkeypatch, capsys):
    import chess
    import learn_chess

    board = chess.Board()
    evaluated = [
        (chess.Move.from_uci("h2h3"), 0, "green"),
        (chess.Move.from_uci("a2a3"), 80, "yellow"),
        (chess.Move.from_uci("b1c3"), 200, "red"),
    ]
    monkeypatch.setattr("learn_chess.evaluate_all_moves", lambda engine, board: evaluated)
    monkeypatch.setattr("learn_chess.random.shuffle", lambda items: None)
    monkeypatch.setattr("learn_chess.read_key", lambda: "j")
    monkeypatch.setattr("learn_chess.pause", lambda msg="": None)

    learn_chess.human_turn(None, board)

    out = capsys.readouterr().out
    assert out.rindex("\n8 ") < out.rindex("  あなたの手:")


def test_pick_three_always_includes_exact_best_move(monkeypatch):
    monkeypatch.setattr("learn_chess.random.choice", lambda items: items[-1])
    monkeypatch.setattr("learn_chess.random.shuffle", lambda items: None)
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
