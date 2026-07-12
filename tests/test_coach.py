import random

import chess

from thrie_raed_chess.coach import CoachCommenter, game_phase, tier_of


def test_tier_of_respects_loss_boundaries():
    assert tier_of(0) == "BRILLIANT"
    assert tier_of(1) == "EXCELLENT"
    assert tier_of(30) == "EXCELLENT"
    assert tier_of(31) == "GOOD"
    assert tier_of(80) == "GOOD"
    assert tier_of(81) == "SOSO"
    assert tier_of(150) == "SOSO"
    assert tier_of(151) == "ROUGH"
    assert tier_of(300) == "ROUGH"
    assert tier_of(301) == "BLUNDER"


def test_all_tiers_return_nonempty_string():
    coach = CoachCommenter(rng=random.Random(0))
    board = chess.Board()
    for loss, color in [(0, "green"), (20, "green"), (60, "yellow"),
                        (120, "yellow"), (250, "red"), (500, "red")]:
        text = coach.comment(loss, color, [], board)
        assert isinstance(text, str)
        assert text


def test_no_identical_comment_repeats_consecutively():
    coach = CoachCommenter(rng=random.Random(42))
    board = chess.Board()
    prev = None
    for _ in range(30):
        text = coach.comment(60, "yellow", [], board)
        assert text != prev
        prev = text


def test_streak_escalation_appears_and_resets():
    board = chess.Board()
    seen_streak = False
    for seed in range(50):
        coach = CoachCommenter(rng=random.Random(seed))
        coach.comment(0, "green", [], board)
        coach.comment(0, "green", [], board)
        assert coach._green_streak == 2
        text = coach.comment(0, "green", [], board)
        assert coach._green_streak == 3
        if "連続" in text or "止まらない" in text or "絶好調" in text \
                or "波に乗ってる" in text or "勢い" in text or "ノリノリ" in text \
                or "手が付けられない" in text:
            seen_streak = True
    assert seen_streak

    # 非緑でリセット
    coach = CoachCommenter(rng=random.Random(1))
    coach.comment(0, "green", [], board)
    coach.comment(0, "green", [], board)
    coach.comment(0, "green", [], board)
    assert coach._green_streak == 3
    coach.comment(200, "red", [], board)
    assert coach._green_streak == 0


def test_fact_capture_mention_can_appear_on_good_move():
    board = chess.Board()
    seen = False
    for seed in range(50):
        coach = CoachCommenter(rng=random.Random(seed))
        text = coach.comment(10, "green", ["駒を取る"], board)
        if "駒得" in text or "得した" in text:
            seen = True
            break
    assert seen


def test_game_phase_classifies_positions():
    assert game_phase(chess.Board()) == "opening"
    # 少駒(キング+ポーンのみ) = 終盤
    assert game_phase(chess.Board("4k3/4p3/8/8/8/8/4P3/4K3 w - - 0 30")) == "endgame"
    # 中間(11手目以降、駒は多い) = 中盤
    assert game_phase(chess.Board(
        "r1bqkbnr/pppp1ppp/2n5/4p3/4P3/5N2/PPPP1PPP/RNBQKB1R w KQkq - 0 11"
    )) == "middlegame"
