import asyncio
import types

import chess
import pytest
from textual.app import App, ComposeResult
from textual.widgets import Input

from movesense.boardmodel import choice_model, lastmove_model
from movesense.config import KEYS
from movesense.puzzles import PUZZLES
from movesense.session import BattlePhase, PuzzlePhase
from movesense.stats import BattleStats
from movesense.tui.app import MoveSenseApp
from movesense.tui.screens import (
    BattleScreen,
    MenuScreen,
    PuzzleDifficultyScreen,
    PuzzleNumberScreen,
    PuzzleScreen,
    PuzzleSelectScreen,
    _choice_line,
    _puzzle_choice_line,
)
from movesense.tui import theme
from movesense.tui import glyphs
from movesense.tui.widgets import BoardWidget, SidePanel, _square_visual


EVALUATED = [
    (chess.Move.from_uci("g1f3"), 0, "green"),
    (chess.Move.from_uci("b1c3"), 80, "yellow"),
    (chess.Move.from_uci("a2a3"), 200, "red"),
]


class FakeEngine:
    """evaluate_all_moves/evaluate_position をmonkeypatchする前提の空エンジン。"""

    def __init__(self, cpu_move=None):
        self.cpu_move = cpu_move
        self.quit_called = False

    def play(self, board, limit, options=None):
        move = self.cpu_move or next(iter(board.legal_moves))
        return types.SimpleNamespace(move=move)

    def quit(self):
        self.quit_called = True


def _stub_battle_evaluation(monkeypatch, evaluated=None, position_eval="White +0.1"):
    monkeypatch.setattr(
        "movesense.session.evaluate_all_moves", lambda engine, board: evaluated or EVALUATED
    )
    monkeypatch.setattr("movesense.session.evaluate_position", lambda engine, board: position_eval)
    import random

    monkeypatch.setattr(random, "shuffle", lambda items: None)


async def _wait_until(condition, timeout=2.0, interval=0.01):
    elapsed = 0.0
    while not condition():
        await asyncio.sleep(interval)
        elapsed += interval
        if elapsed >= timeout:
            raise AssertionError("condition not met within timeout")


class _BattleHarness(App):
    def __init__(self, screen, **kwargs):
        super().__init__(**kwargs)
        self._screen = screen

    def on_mount(self):
        self.push_screen(self._screen)


class _BoardHarness(App):
    def compose(self) -> ComposeResult:
        yield BoardWidget(id="board")


class _SidePanelHarness(App):
    def compose(self) -> ComposeResult:
        yield SidePanel(id="side")


@pytest.mark.asyncio
async def test_board_widget_compact_renders_three_lines_per_rank_with_block_art():
    app = _BoardHarness()
    async with app.run_test(size=(90, 45)):  # 高い端末 → compact(3行)駒
        widget = app.query_one("#board", BoardWidget)
        assert widget._size_name() == "compact"
        widget.update_board(chess.Board())

        text = str(widget.render())

        lines = text.split("\n")
        assert len(lines) == 8 * 3 + 1  # 8ランク x 3行 + ファイルラベル行
        file_label = lines[-1].strip()
        assert list("abcdefgh") == [c for c in file_label if c != " "]
        assert "█" in text  # ブロックアート文字


@pytest.mark.asyncio
async def test_board_widget_falls_back_to_single_glyph_on_short_terminal():
    app = _BoardHarness()
    async with app.run_test(size=(90, 18)):  # 低い端末 → small(1文字)
        widget = app.query_one("#board", BoardWidget)
        assert widget._size_name() == "small"
        widget.update_board(chess.Board())

        text = str(widget.render())

        lines = text.split("\n")
        assert len(lines) == 8 * 1 + 1
        assert "♜" in text and "♛" in text


@pytest.mark.asyncio
async def test_board_widget_focused_choice_uses_distinct_bg_but_piece_own_fg_color():
    app = _BoardHarness()
    async with app.run_test():
        board = chess.Board()
        choices = [
            (chess.Move.from_uci("g1f3"), 0, "green"),
            (chess.Move.from_uci("b1c3"), 80, "yellow"),
            (chess.Move.from_uci("a2a3"), 200, "red"),
        ]
        model = choice_model(board, choices, focused_index=1)

        bg0, fg0, art0 = _square_visual(board, model, chess.G1, 6, 0, "compact")
        bg1, fg1, art1 = _square_visual(board, model, chess.B1, 1, 0, "compact")
        bg2, fg2, art2 = _square_visual(board, model, chess.A2, 0, 1, "compact")

        knight_art = glyphs.piece_art(chess.Piece(chess.KNIGHT, chess.WHITE), "compact")
        pawn_art = glyphs.piece_art(chess.Piece(chess.PAWN, chess.WHITE), "compact")
        assert art0 == art1 == knight_art
        assert art2 == pawn_art
        # 3択それぞれ異なる識別色の背景
        assert len({bg0, bg1, bg2}) == 3
        # フォーカス中(b1)は識別色そのまま+bold、非フォーカス(g1)は「沈んだ」識別色の
        # 背景になる(駒自体の彩度=文字色は変えない、症状⑤対応)
        assert "bold" in fg1
        assert bg1 == theme.IDENTITY_BG[1]
        assert bg0 == theme.IDENTITY_BG_DIM[0]
        assert "dim" not in fg0  # 駒の文字色自体はdimにしない
        white_knight_fg = theme.piece_fg(chess.Piece(chess.KNIGHT, chess.WHITE))
        assert fg0.endswith(white_knight_fg)
        assert fg1.endswith(white_knight_fg)


@pytest.mark.asyncio
async def test_board_widget_lastmove_clears_from_square_and_shows_piece_on_to_square():
    app = _BoardHarness()
    async with app.run_test():
        board = chess.Board()
        board.push_san("e4")
        model = lastmove_model(board, board.peek())
        widget = app.query_one("#board", BoardWidget)
        widget.update_board(board, model)

        from_bg, from_fg, from_art = _square_visual(board, model, chess.E2, 4, 1, "compact")
        to_bg, to_fg, to_art = _square_visual(board, model, chess.E4, 4, 3, "compact")

        assert all(row == "" for row in from_art)  # 出発点は空き表示
        assert to_art == glyphs.piece_art(chess.Piece(chess.PAWN, chess.WHITE), "compact")
        assert from_bg == to_bg  # 淡黄背景で統一


@pytest.mark.asyncio
async def test_side_panel_defaults_to_movelog_and_cycles_through_three_modes():
    app = _SidePanelHarness()
    async with app.run_test() as pilot:
        panel = app.query_one("#side", SidePanel)
        assert panel.mode == "movelog"
        assert panel.query_one("#movelog").display is True
        assert panel.query_one("#stats-body").display is False
        assert panel.query_one("#guide-body").display is False

        panel.cycle_mode()
        await pilot.pause()
        assert panel.mode == "stats"
        assert panel.query_one("#stats-body").display is True
        assert panel.query_one("#movelog").display is False

        panel.cycle_mode()
        await pilot.pause()
        assert panel.mode == "guide"
        assert panel.query_one("#guide-body").display is True

        panel.cycle_mode()
        await pilot.pause()
        assert panel.mode == "movelog"


@pytest.mark.asyncio
async def test_side_panel_movelog_keeps_full_history_across_mode_switches():
    app = _SidePanelHarness()
    async with app.run_test() as pilot:
        panel = app.query_one("#side", SidePanel)
        panel.move_log.add_move("e4")
        panel.move_log.add_move("e5", color="green")
        await pilot.pause()

        panel.cycle_mode()  # movelog -> stats
        await pilot.pause()
        panel.cycle_mode()  # stats -> guide
        await pilot.pause()
        panel.cycle_mode()  # guide -> movelog
        await pilot.pause()

        assert panel.mode == "movelog"
        lines = [str(line) for line in panel.move_log.lines]
        assert any("e4" in line for line in lines)
        assert any("e5" in line and "🟢" in line for line in lines)


@pytest.mark.asyncio
async def test_side_panel_stats_body_reflects_battle_stats():
    app = _SidePanelHarness()
    async with app.run_test() as pilot:
        panel = app.query_one("#side", SidePanel)
        stats = BattleStats()
        stats.record("yellow", 80)
        panel.update_stats(stats, "White +0.8")
        await pilot.pause()

        body = str(panel.query_one("#stats-body").render())
        assert "形勢 White +0.8" in body
        assert "G/Y/R 0/1/0" in body


@pytest.mark.asyncio
async def test_menu_screen_shows_title_and_options():
    app = MoveSenseApp()
    async with app.run_test() as pilot:
        body = str(app.screen.query_one("#menu-body").render())
        assert "MoveSense Chess" in body
        assert "対戦モード" in body
        assert "詰めチェス" in body


@pytest.mark.asyncio
async def test_q_quits_the_app():
    app = MoveSenseApp()
    async with app.run_test() as pilot:
        await pilot.press("q")
        await pilot.pause()
        assert app.is_running is False


def _choice_list_text(app):
    return str(app.screen.query_one("#choice-list").render())


async def _wait_for_choices(app, timeout=2.0):
    """session.phase はワーカースレッド内で先に変わり、実際のウィジェット更新は
    call_from_thread 経由で遅れてメインスレッドに届くため、内部状態ではなく
    描画結果そのもの(choice-listに何か表示されたか)を待機条件にする。"""
    await _wait_until(lambda: _choice_list_text(app).strip() != "", timeout=timeout)


@pytest.mark.asyncio
async def test_battle_screen_boots_and_shows_three_choices_always_visible(monkeypatch):
    _stub_battle_evaluation(monkeypatch)
    screen = BattleScreen(engine_factory=lambda: FakeEngine())
    app = _BattleHarness(screen)
    async with app.run_test() as pilot:
        await _wait_for_choices(app)

        body = _choice_list_text(app)
        assert "j) ♞ Nf3 (g1→f3)" in body
        assert "k) ♞ Nc3 (b1→c3)" in body
        assert "l) ♟ a3 (a2→a3)" in body
        # 症状②の前提: 開示前は色/差が見えない
        assert "🟢" not in body and "🟡" not in body and "🔴" not in body


@pytest.mark.asyncio
async def test_battle_side_panel_stats_are_populated_once_choices_shown(monkeypatch):
    """症状④: xキーで戦績に切り替えても中身が空にならないことを確認する
    (以前は update_stats が一度も呼ばれず空のままだった)。"""
    _stub_battle_evaluation(monkeypatch, position_eval="White +0.3")
    screen = BattleScreen(engine_factory=lambda: FakeEngine())
    app = _BattleHarness(screen)
    async with app.run_test() as pilot:
        await _wait_for_choices(app)
        side = app.screen.query_one("#side", SidePanel)

        side.cycle_mode()  # movelog -> stats
        await pilot.pause()

        body = str(app.screen.query_one("#stats-body").render())
        assert "形勢 White +0.3" in body
        assert "Stats" in body


@pytest.mark.asyncio
async def test_pressing_key_once_focuses_and_twice_commits(monkeypatch):
    _stub_battle_evaluation(monkeypatch)
    screen = BattleScreen(engine_factory=lambda: FakeEngine())
    app = _BattleHarness(screen)
    async with app.run_test() as pilot:
        await _wait_for_choices(app)

        await pilot.press("k")
        await pilot.pause()
        assert screen.session.focused_idx == 1
        assert screen.session.phase == BattlePhase.HUMAN_CHOOSING  # まだ確定していない
        body = _choice_list_text(app)
        assert "→ k) ♞ Nc3 (b1→c3)" in body

        await pilot.press("k")
        await _wait_until(lambda: "🟡" in _choice_list_text(app))
        assert screen.session.phase == BattlePhase.REVEALED
        assert screen.session.chosen_idx == 1
        body = _choice_list_text(app)
        assert "🟡 普通" in body
        assert "← 選んだ手" in body


@pytest.mark.asyncio
async def test_switching_focus_before_commit_does_not_commit_the_first_choice(monkeypatch):
    _stub_battle_evaluation(monkeypatch)
    screen = BattleScreen(engine_factory=lambda: FakeEngine())
    app = _BattleHarness(screen)
    async with app.run_test() as pilot:
        await _wait_for_choices(app)

        await pilot.press("j")
        await pilot.pause()
        await pilot.press("l")
        await pilot.pause()

        assert screen.session.phase == BattlePhase.HUMAN_CHOOSING
        assert screen.session.focused_idx == 2


@pytest.mark.asyncio
async def test_escape_deselects_focused_choice(monkeypatch):
    _stub_battle_evaluation(monkeypatch)
    screen = BattleScreen(engine_factory=lambda: FakeEngine())
    app = _BattleHarness(screen)
    async with app.run_test() as pilot:
        await _wait_for_choices(app)

        await pilot.press("k")
        await pilot.pause()
        assert screen.session.focused_idx == 1

        await pilot.press("escape")
        await pilot.pause()
        assert screen.session.focused_idx is None
        body = _choice_list_text(app)
        assert "→ " not in body


@pytest.mark.asyncio
async def test_any_key_advances_from_revealed_phase(monkeypatch):
    _stub_battle_evaluation(monkeypatch)
    cpu_move = chess.Move.from_uci("e7e5")
    screen = BattleScreen(engine_factory=lambda: FakeEngine(cpu_move=cpu_move))
    app = _BattleHarness(screen)
    async with app.run_test() as pilot:
        await _wait_for_choices(app)
        await pilot.press("j")
        await pilot.pause()
        await pilot.press("j")
        await _wait_until(lambda: not screen._flashing)
        assert screen.session.phase == BattlePhase.REVEALED

        await pilot.press("space")
        await _wait_until(lambda: screen.last_cpu_move == cpu_move)
        await _wait_for_choices(app, timeout=3.0)
        assert screen.session.phase == BattlePhase.HUMAN_CHOOSING


@pytest.mark.asyncio
async def test_commit_then_continue_key_advances_to_cpu_move_and_flashes(monkeypatch):
    _stub_battle_evaluation(monkeypatch)
    cpu_move = chess.Move.from_uci("e7e5")
    screen = BattleScreen(engine_factory=lambda: FakeEngine(cpu_move=cpu_move))
    app = _BattleHarness(screen)
    async with app.run_test() as pilot:
        await _wait_for_choices(app)
        await pilot.press("j")
        await pilot.pause()
        await pilot.press("j")
        await _wait_until(lambda: not screen._flashing)
        assert screen.session.phase == BattlePhase.REVEALED

        await pilot.press("j")
        await _wait_until(lambda: screen.last_cpu_move == cpu_move)
        await _wait_for_choices(app, timeout=3.0)
        assert screen.session.phase == BattlePhase.HUMAN_CHOOSING

        assert screen.session.board.move_stack[-1] == cpu_move
        moves = [str(line) for line in app.screen.query_one("#side", SidePanel).move_log.lines]
        assert any("Nf3" in line for line in moves)
        assert any("e5" in line for line in moves)


@pytest.mark.asyncio
async def test_x_toggles_side_panel_mode(monkeypatch):
    _stub_battle_evaluation(monkeypatch)
    screen = BattleScreen(engine_factory=lambda: FakeEngine())
    app = _BattleHarness(screen)
    async with app.run_test() as pilot:
        await _wait_for_choices(app)
        side = app.screen.query_one("#side", SidePanel)
        assert side.mode == "movelog"

        await pilot.press("x")
        await pilot.pause()
        assert side.mode == "stats"


@pytest.mark.asyncio
async def test_resign_shows_export_screen_and_quits_engine(monkeypatch):
    _stub_battle_evaluation(monkeypatch)
    engine = FakeEngine()
    screen = BattleScreen(engine_factory=lambda: engine)
    app = _BattleHarness(screen)
    async with app.run_test() as pilot:
        await _wait_for_choices(app)

        await pilot.press("r")
        await _wait_until(
            lambda: len(app.screen_stack) > 0 and app.screen.query("#export-body")
        )

        assert screen.session.result == "0-1"
        assert screen.session.termination == "White resigned"
        assert engine.quit_called is True
        body = str(app.screen.query_one("#export-body").render())
        assert "この棋譜を見て" in body


@pytest.mark.asyncio
async def test_missing_stockfish_shows_error_status(monkeypatch):
    screen = BattleScreen(engine_factory=lambda: None)
    app = _BattleHarness(screen)
    async with app.run_test() as pilot:
        await _wait_until(
            lambda: "Stockfish" in str(app.screen.query_one("#status-bar").render())
        )


@pytest.mark.asyncio
async def test_menu_k_opens_puzzle_select_screen():
    app = MoveSenseApp()
    async with app.run_test() as pilot:
        await pilot.press("k")
        await pilot.pause()
        assert isinstance(app.screen, PuzzleSelectScreen)


@pytest.mark.asyncio
async def test_puzzle_select_random_pushes_puzzle_screen_with_visible_choices():
    app = MoveSenseApp()
    async with app.run_test() as pilot:
        await pilot.press("k")
        await pilot.pause()
        await pilot.press("j")
        await pilot.pause()

        assert isinstance(app.screen, PuzzleScreen)
        body = str(app.screen.query_one("#choice-list").render())
        assert "j)" in body and "k)" in body
        # パズルは評価を開示しない: 色バッジは出ない
        assert "🟢" not in body and "🟡" not in body and "🔴" not in body


@pytest.mark.asyncio
async def test_puzzle_select_difficulty_picks_requested_mate_in():
    app = MoveSenseApp()
    async with app.run_test() as pilot:
        await pilot.press("k")  # メニュー -> パズル選択
        await pilot.pause()
        await pilot.press("k")  # 難易度指定
        await pilot.pause()
        assert isinstance(app.screen, PuzzleDifficultyScreen)

        await pilot.press("l")  # mate in 4
        await pilot.pause()

        assert isinstance(app.screen, PuzzleScreen)
        assert app.screen.puzzle["mate_in"] == 4


@pytest.mark.asyncio
async def test_puzzle_select_by_number_finds_specific_puzzle():
    app = MoveSenseApp()
    async with app.run_test() as pilot:
        await pilot.press("k")
        await pilot.pause()
        await pilot.press("l")  # 番号指定
        await pilot.pause()
        assert isinstance(app.screen, PuzzleNumberScreen)

        target = next(p for p in PUZZLES if p["mate_in"] == 2)
        app.screen.query_one("#puzzle-number-input", Input).value = target["id"]
        await pilot.press("enter")
        await pilot.pause()

        assert isinstance(app.screen, PuzzleScreen)
        assert app.screen.puzzle["id"] == target["id"]


@pytest.mark.asyncio
async def test_puzzle_number_screen_shows_error_for_unknown_id():
    app = MoveSenseApp()
    async with app.run_test() as pilot:
        await pilot.press("k")
        await pilot.pause()
        await pilot.press("l")
        await pilot.pause()

        app.screen.query_one("#puzzle-number-input", Input).value = "doesnotexist"
        await pilot.press("enter")
        await pilot.pause()

        assert isinstance(app.screen, PuzzleNumberScreen)
        assert "見つかりません" in str(app.screen.query_one("#puzzle-number-error").render())


@pytest.mark.asyncio
async def test_puzzle_screen_has_guide_side_panel_visible_by_default():
    """症状③: 詰めモードに駒の動きガイドが復活していることを確認する。"""
    puzzle = next(p for p in PUZZLES if p["mate_in"] == 2)
    screen = PuzzleScreen(puzzle)
    app = _BattleHarness(screen)
    async with app.run_test() as pilot:
        await pilot.pause()
        side = app.screen.query_one("#side", SidePanel)
        assert side.mode == "guide"
        assert side.query_one("#guide-body").display is True
        body = str(side.query_one("#guide-body").render())
        assert "♟ Pawn" in body


@pytest.mark.asyncio
async def test_puzzle_screen_shows_opponent_reply_highlight_on_next_step():
    """症状②: 詰めモードで正解後、相手(前段)の応手が淡黄でハイライトされることを
    確認する(以前は choice_model しか合成しておらず消えていた)。"""
    puzzle = next(p for p in PUZZLES if p["mate_in"] == 2)
    screen = PuzzleScreen(puzzle)
    app = _BattleHarness(screen)
    async with app.run_test() as pilot:
        await pilot.pause()
        correct = chess.Move.from_uci(puzzle["solution"][0])
        idx = next(i for i, (mv, _, _) in enumerate(screen.session.choices) if mv == correct)
        key = KEYS[idx]
        await pilot.press(key)
        await pilot.pause()
        await pilot.press(key)
        await _wait_until(lambda: not screen._flashing, timeout=5.0)

        assert screen.session.phase == PuzzlePhase.CHOOSING
        reply = screen.session.board.peek()
        assert reply == chess.Move.from_uci(puzzle["solution"][1])

        board_widget = app.screen.query_one("#board", BoardWidget)
        rendered_model = board_widget._model
        # 3択の識別色に上書きされていない限り、応手の from/to は LASTMOVE のまま
        for sq in (reply.from_square, reply.to_square):
            cell = rendered_model.get(sq)
            assert cell is not None
            if cell.choice_index is None:
                assert cell.role.name == "LASTMOVE"


@pytest.mark.asyncio
async def test_puzzle_screen_correct_choices_advance_through_reply_to_success():
    puzzle = next(p for p in PUZZLES if p["mate_in"] == 2)
    screen = PuzzleScreen(puzzle)
    app = _BattleHarness(screen)
    async with app.run_test() as pilot:
        await pilot.pause()

        for step_idx in (0, 2):
            correct = chess.Move.from_uci(puzzle["solution"][step_idx])
            idx = next(i for i, (mv, _, _) in enumerate(screen.session.choices) if mv == correct)
            key = KEYS[idx]
            await pilot.press(key)
            await pilot.pause()
            await pilot.press(key)
            await _wait_until(lambda: not screen._flashing, timeout=5.0)

        assert isinstance(app.screen, PuzzleScreen)
        assert screen.session.phase == PuzzlePhase.SUCCESS
        body = str(app.screen.query_one("#status-bar").render())
        assert "成功" in body


@pytest.mark.asyncio
async def test_puzzle_screen_wrong_choice_reaches_miss_result():
    puzzle = next(p for p in PUZZLES if p["mate_in"] == 2)
    screen = PuzzleScreen(puzzle)
    app = _BattleHarness(screen)
    async with app.run_test() as pilot:
        await pilot.pause()
        correct = chess.Move.from_uci(puzzle["solution"][0])
        wrong_idx = next(i for i, (mv, _, _) in enumerate(screen.session.choices) if mv != correct)
        key = KEYS[wrong_idx]

        await pilot.press(key)
        await pilot.pause()
        await pilot.press(key)
        await _wait_until(lambda: not screen._flashing, timeout=5.0)

        assert isinstance(app.screen, PuzzleScreen)
        assert screen.session.phase == PuzzlePhase.MISS
        assert "失敗" in str(app.screen.query_one("#status-bar").render())


@pytest.mark.asyncio
async def test_puzzle_screen_q_aborts_to_result_screen():
    puzzle = next(p for p in PUZZLES if p["mate_in"] == 2)
    screen = PuzzleScreen(puzzle)
    app = _BattleHarness(screen)
    async with app.run_test() as pilot:
        await pilot.pause()
        await pilot.press("q")
        await pilot.pause()

        assert isinstance(app.screen, PuzzleScreen)
        assert screen.session.phase == PuzzlePhase.ABORTED


@pytest.mark.asyncio
async def test_puzzle_result_retry_creates_fresh_puzzle_screen():
    puzzle = next(p for p in PUZZLES if p["mate_in"] == 2)
    screen = PuzzleScreen(puzzle)
    app = _BattleHarness(screen)
    async with app.run_test() as pilot:
        await pilot.pause()
        await pilot.press("q")  # abandon -> result
        await pilot.pause()
        await pilot.press("h")  # リトライ
        await pilot.pause()

        assert isinstance(app.screen, PuzzleScreen)
        assert app.screen.session.phase == PuzzlePhase.CHOOSING
        assert app.screen.puzzle["id"] == puzzle["id"]


@pytest.mark.asyncio
async def test_puzzle_result_another_returns_to_puzzle_select_screen():
    app = MoveSenseApp()
    async with app.run_test() as pilot:
        await pilot.press("k")  # Menu -> PuzzleSelect
        await pilot.pause()
        await pilot.press("j")  # PuzzleSelect -> PuzzleScreen(random)
        await pilot.pause()
        await pilot.press("q")  # abandon -> Result
        await pilot.pause()
        await pilot.press("j")  # 別の問題
        await pilot.pause()

        assert isinstance(app.screen, PuzzleSelectScreen)


@pytest.mark.asyncio
async def test_puzzle_result_to_menu_returns_to_menu_screen():
    app = MoveSenseApp()
    async with app.run_test() as pilot:
        await pilot.press("k")
        await pilot.pause()
        await pilot.press("j")
        await pilot.pause()
        await pilot.press("q")  # abandon -> result
        await pilot.pause()
        await pilot.press("k")  # メニューへ戻る
        await pilot.pause()

        assert isinstance(app.screen, MenuScreen)


@pytest.mark.asyncio
async def test_puzzle_result_quit_exits_app():
    app = MoveSenseApp()
    async with app.run_test() as pilot:
        await pilot.press("k")
        await pilot.pause()
        await pilot.press("j")
        await pilot.pause()
        await pilot.press("q")  # abandon -> result
        await pilot.pause()
        await pilot.press("q")  # 終了
        await pilot.pause()

        assert app.is_running is False


@pytest.mark.asyncio
async def test_puzzle_screen_shows_player_color_in_status_bar():
    puzzle = next(p for p in PUZZLES if p["mate_in"] == 2)
    screen = PuzzleScreen(puzzle)
    app = _BattleHarness(screen)
    async with app.run_test() as pilot:
        await pilot.pause()
        expected = "白番" if screen.player_color == chess.WHITE else "黒番"
        body = str(app.screen.query_one("#status-bar").render())
        assert expected in body


def test_choice_line_key_badge_uses_board_identity_color():
    board = chess.Board()
    for idx, uci in ((0, "g1f3"), (1, "b1c3"), (2, "a2a3")):
        item = (chess.Move.from_uci(uci), 0, "green")
        text = _choice_line(idx, board, item, focused=False)
        # 表示テキストは従来どおり(既存テスト互換)
        assert f"{KEYS[idx]})" in text.plain
        # キー記号 j)/k)/l) に盤面と同じ識別色の背景スタイルが付く
        key_spans = [s for s in text.spans if text.plain[s.start:s.end] == f"{KEYS[idx]})"]
        assert key_spans, f"no styled span for {KEYS[idx]})"
        assert theme.IDENTITY_BG[idx] in str(key_spans[0].style)


def test_puzzle_choice_line_key_badge_uses_board_identity_color():
    puzzle = next(p for p in PUZZLES if p["mate_in"] == 2)
    board = chess.Board(puzzle["fen"])
    correct = chess.Move.from_uci(puzzle["solution"][0])
    item = (correct, 0, "green")
    text = _puzzle_choice_line(1, board, item, focused=False)
    key_spans = [s for s in text.spans if text.plain[s.start:s.end] == f"{KEYS[1]})"]
    assert key_spans
    assert theme.IDENTITY_BG[1] in str(key_spans[0].style)
