import chess
from rich.cells import cell_len
from rich.style import Style
from rich.text import Text
from textual.widgets import RichLog, Static

from movesense.boardmodel import piece_glyph
from movesense.stats import movement_help_lines

from . import theme

# 症状①: 旧CLI版の1行3桁から2行5桁へ拡大(面積約3倍)。
SQUARE_W = 5
SQUARE_H = 2

_COLOR_BADGE = {"green": "🟢", "yellow": "🟡", "red": "🔴"}


def _center(text, width):
    total = max(0, width - cell_len(text))
    left = total // 2
    return " " * left + text + " " * (total - left)


def _square_visual(board, model, sq, file_idx, rank_idx):
    """(bg色, fg style文字列, 表示グリフ) を返す。文字色は常に駒自体の色。"""
    cell = model.get(sq)
    if cell is None:
        bg = theme.checkerboard_bg(file_idx, rank_idx)
        piece = board.piece_at(sq)
        if piece is None:
            return bg, "", ""
        return bg, theme.piece_fg(piece), piece_glyph(piece)
    bg, modifier = theme.cell_background(cell)
    if cell.show_piece and cell.piece is not None:
        fg_style = f"{modifier} {theme.piece_fg(cell.piece)}".strip()
        glyph = piece_glyph(cell.piece)
    else:
        fg_style = ""
        glyph = ""
    return bg, fg_style, glyph


class BoardWidget(Static):
    """拡大盤(2行x5桁の升目)。update_board() で局面とハイライトを差し替える。"""

    def __init__(self, **kwargs):
        super().__init__(**kwargs)
        self._board = chess.Board()
        self._model = {}

    def update_board(self, board, model=None):
        self._board = board
        self._model = model or {}
        self.refresh()

    def render(self):
        board = self._board
        model = self._model
        lines = []
        for rank in range(7, -1, -1):
            row_texts = [Text() for _ in range(SQUARE_H)]
            for i, t in enumerate(row_texts):
                label = f"{rank + 1} " if i == SQUARE_H - 1 else "  "
                t.append(label)
            for file_idx in range(8):
                sq = chess.square(file_idx, rank)
                bg, fg, glyph = _square_visual(board, model, sq, file_idx, rank)
                style = Style.parse(f"{fg} on {bg}" if fg else f"on {bg}")
                for i, t in enumerate(row_texts):
                    content = _center(glyph, SQUARE_W) if i == SQUARE_H - 1 else " " * SQUARE_W
                    t.append(content, style=style)
            lines.extend(row_texts)
        file_label = Text("  " + "".join(_center(c, SQUARE_W) for c in "abcdefgh"))
        lines.append(file_label)
        result = lines[0]
        for line in lines[1:]:
            result = result + "\n" + line
        return result


class MoveLogWidget(RichLog):
    """常設のライブ棋譜パネル(症状④)。自分の手には G/Y/R バッジを付ける。"""

    def __init__(self, **kwargs):
        kwargs.setdefault("wrap", True)
        kwargs.setdefault("markup", False)
        super().__init__(**kwargs)
        self._ply = 0

    def add_move(self, san, color=None):
        self._ply += 1
        move_no = (self._ply + 1) // 2
        prefix = f"{move_no}. " if self._ply % 2 == 1 else "    "
        badge = _COLOR_BADGE.get(color, "")
        self.write(f"{prefix}{san} {badge}".rstrip())

    def reset_log(self):
        self.clear()
        self._ply = 0


class SidePanel(Static):
    """右サイドパネル。x キーで 棋譜 → 戦績 → 駒ガイド の順に切り替える。"""

    MODES = ("movelog", "stats", "guide")

    def __init__(self, **kwargs):
        super().__init__(**kwargs)
        self.mode = "movelog"

    def compose(self):
        yield MoveLogWidget(id="movelog")
        yield Static(id="stats-body")
        yield Static(id="guide-body")

    def on_mount(self):
        self._apply_visibility()
        self.update_guide()

    @property
    def move_log(self):
        return self.query_one("#movelog", MoveLogWidget)

    def cycle_mode(self):
        idx = self.MODES.index(self.mode)
        self.mode = self.MODES[(idx + 1) % len(self.MODES)]
        self._apply_visibility()

    def _apply_visibility(self):
        widget_id = {"movelog": "movelog", "stats": "stats-body", "guide": "guide-body"}
        for name, wid in widget_id.items():
            self.query_one(f"#{wid}").display = (name == self.mode)

    def update_stats(self, stats, position_eval):
        lines = movement_help_lines(stats=stats, position_eval=position_eval, panel_mode="stats")
        self.query_one("#stats-body", Static).update("\n".join(lines))

    def update_guide(self, stats=None, position_eval=None):
        lines = movement_help_lines(stats=stats, position_eval=position_eval, panel_mode="help")
        self.query_one("#guide-body", Static).update("\n".join(lines))
