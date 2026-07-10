import chess
import pytest
from textual.app import App, ComposeResult

from movesense.boardmodel import choice_model, lastmove_model
from movesense.stats import BattleStats
from movesense.tui.app import MoveSenseApp
from movesense.tui.widgets import BoardWidget, SidePanel, _square_visual


class _BoardHarness(App):
    def compose(self) -> ComposeResult:
        yield BoardWidget(id="board")


class _SidePanelHarness(App):
    def compose(self) -> ComposeResult:
        yield SidePanel(id="side")


@pytest.mark.asyncio
async def test_board_widget_renders_two_lines_per_rank_plus_file_labels():
    app = _BoardHarness()
    async with app.run_test():
        widget = app.query_one("#board", BoardWidget)
        widget.update_board(chess.Board())

        text = str(widget.render())

        lines = text.split("\n")
        assert len(lines) == 8 * 2 + 1  # 8ランク x 2行 + ファイルラベル行
        assert "8 " in lines[1]  # 駒とラベルは各段の2行目(下段)にある
        assert lines[-1].strip() == "a    b    c    d    e    f    g    h"
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

        bg0, fg0, glyph0 = _square_visual(board, model, chess.G1, 6, 0)
        bg1, fg1, glyph1 = _square_visual(board, model, chess.B1, 1, 0)
        bg2, fg2, glyph2 = _square_visual(board, model, chess.A2, 0, 1)

        assert glyph0 == glyph1 == "♞"
        assert glyph2 == "♟"
        # 3択それぞれ異なる識別色の背景
        assert len({bg0, bg1, bg2}) == 3
        # フォーカス中(b1)は bold、他はdimで区別されるが、文字色自体は白駒色で共通
        assert "bold" in fg1
        assert "dim" in fg0
        assert fg0.endswith(fg1.split()[-1])  # 同じ駒色コードを使っている


@pytest.mark.asyncio
async def test_board_widget_lastmove_clears_from_square_and_shows_piece_on_to_square():
    app = _BoardHarness()
    async with app.run_test():
        board = chess.Board()
        board.push_san("e4")
        model = lastmove_model(board, board.peek())
        widget = app.query_one("#board", BoardWidget)
        widget.update_board(board, model)

        from_bg, from_fg, from_glyph = _square_visual(board, model, chess.E2, 4, 1)
        to_bg, to_fg, to_glyph = _square_visual(board, model, chess.E4, 4, 3)

        assert from_glyph == ""  # 出発点は空き表示
        assert to_glyph == "♟"
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
