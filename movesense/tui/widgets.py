import chess
from rich.cells import cell_len
from rich.style import Style
from rich.text import Text
from textual.widgets import RichLog, Static

from movesense.stats import movement_help_lines

from . import glyphs, theme

# 症状①: 駒をブロックアートで大きく描く(chess-tui 方式)。マス幅は5固定。
# 縦スペースが足りない端末では small(1文字) にフォールバックする。
SQUARE_W = 5
# compact 盤(8ランク×3行 + ファイルラベル1行 = 25行)＋周辺 UI がおよそ収まる
# ターミナル高さの下限。これ未満なら small に落とす。
COMPACT_MIN_TERMINAL_HEIGHT = 30

_COLOR_BADGE = {"green": "🟢", "yellow": "🟡", "red": "🔴"}


def _center(text, width):
    total = max(0, width - cell_len(text))
    left = total // 2
    return " " * left + text + " " * (total - left)


def _square_visual(board, model, sq, file_idx, rank_idx, size):
    """(bg色, fg style文字列, アート行リスト) を返す。文字色は常に駒自体の色。"""
    cell = model.get(sq)
    if cell is None:
        bg = theme.checkerboard_bg(file_idx, rank_idx)
        piece = board.piece_at(sq)
        fg = theme.piece_fg(piece) if piece is not None else ""
        return bg, fg, glyphs.piece_art(piece, size)
    bg, modifier = theme.cell_background(cell)
    if cell.show_piece and cell.piece is not None:
        fg = f"{modifier} {theme.piece_fg(cell.piece)}".strip()
        art = glyphs.piece_art(cell.piece, size)
    else:
        fg = ""
        art = glyphs.piece_art(None, size)
    return bg, fg, art


class BoardWidget(Static):
    """拡大盤。update_board() で局面とハイライトを差し替える。
    ターミナルの高さに応じて駒を compact(3行) / small(1文字) で描く。"""

    def __init__(self, **kwargs):
        super().__init__(**kwargs)
        self._board = chess.Board()
        self._model = {}

    def update_board(self, board, model=None):
        self._board = board
        self._model = model or {}
        self.refresh()

    def _size_name(self):
        # 駒サイズは自分の高さではなくターミナル全体の高さで決める(自分の高さは
        # 駒サイズに依存して変わるため、それで判定すると循環する)。
        try:
            height = self.app.size.height
        except Exception:
            height = 24
        return "compact" if height >= COMPACT_MIN_TERMINAL_HEIGHT else "small"

    def render(self):
        board = self._board
        model = self._model
        size = self._size_name()
        square_h = glyphs.SIZE_HEIGHTS[size]
        lines = []
        for rank in range(7, -1, -1):
            row_texts = [Text() for _ in range(square_h)]
            for i, t in enumerate(row_texts):
                label = f"{rank + 1} " if i == square_h - 1 else "  "
                t.append(label)
            for file_idx in range(8):
                sq = chess.square(file_idx, rank)
                bg, fg, art = _square_visual(board, model, sq, file_idx, rank, size)
                style = Style.parse(f"{fg} on {bg}" if fg else f"on {bg}")
                for i, t in enumerate(row_texts):
                    t.append(_center(art[i], SQUARE_W), style=style)
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
