from learn_chess import movement_help_lines, pick_three, render_board_lines


def test_render_board_lines_includes_movement_help_panel():
    import chess

    lines = render_board_lines(chess.Board(), {})
    text = "\n".join(lines)

    assert "動き" in text
    assert "Pawn" in text
    assert "取る=斜め" in text
    assert "Knight" in text
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
