"""色の一元管理。boardmodel.Cell -> Rich style文字列 のマッピングを持つ。

旧CLI版の256色パレットを踏襲しつつ、フォーカス/ダイム表現
(症状②のプレビュー強調)を追加する。
"""

from rich.color import Color

from movesense.boardmodel import CellRole

LIGHT_SQUARE_BG = "color(180)"
DARK_SQUARE_BG = "color(101)"
WHITE_PIECE_FG = "bold color(231)"
BLACK_PIECE_FG = "bold color(16)"
LASTMOVE_BG = "color(228)"
HIGHLIGHT_FG = "bold color(16)"

# 選択肢の識別色。旧CLI版の IDENTITY と同じ配色(j: シアン / k: マゼンタ / l: オレンジ)。
IDENTITY_BG = ["color(45)", "color(213)", "color(214)"]

_DARK_BLEND_TARGET = "color(235)"  # ほぼ黒に近いダーク背景


def _dim_color(color_str, factor=0.35):
    """識別色を暗い背景寄りにブレンドした「沈んだ」版を作る(駒の彩度は変えない)。"""
    base = Color.parse(color_str).get_truecolor()
    dark = Color.parse(_DARK_BLEND_TARGET).get_truecolor()
    r = round(base.red * factor + dark.red * (1 - factor))
    g = round(base.green * factor + dark.green * (1 - factor))
    b = round(base.blue * factor + dark.blue * (1 - factor))
    return f"rgb({r},{g},{b})"


# 非フォーカス時の「沈んだ」識別色背景。駒の前景色(白/黒)は一切変えず、
# 背景だけを暗くすることでフォーカス外の3択を視覚的に後退させる。
IDENTITY_BG_DIM = [_dim_color(c) for c in IDENTITY_BG]


def key_badge_style(idx, dimmed=False):
    """選択肢リストの j/k/l キー記号に付ける、盤面と同じ識別色の背景スタイル。"""
    bg = IDENTITY_BG_DIM[idx] if dimmed else IDENTITY_BG[idx]
    return f"{HIGHLIGHT_FG} on {bg}"


def checkerboard_bg(file_idx, rank_idx):
    is_light = (file_idx + rank_idx) % 2 == 1
    return LIGHT_SQUARE_BG if is_light else DARK_SQUARE_BG


def piece_fg(piece):
    return WHITE_PIECE_FG if piece.color else BLACK_PIECE_FG


def cell_background(cell):
    """boardmodel.Cell -> (bg色, 修飾子)。

    升の文字色は常に駒自体の色(piece_fg)で決まる(旧CLI版と同じ)。HIGHLIGHT_FG は
    盤面の升には使わず、選択肢キーのバッジ表示専用。非フォーカス(CHOICE_DIMMED)は
    駒の彩度を落とすのではなく、背景を沈んだ色に差し替える(駒自体は目立たせたまま
    「注目していない」ことを示す)。
    """
    if cell.role == CellRole.LASTMOVE:
        return LASTMOVE_BG, ""
    if cell.role == CellRole.CHOICE_DIMMED:
        return IDENTITY_BG_DIM[cell.choice_index], ""
    bg = IDENTITY_BG[cell.choice_index]
    if cell.role == CellRole.CHOICE_FOCUSED:
        return bg, "bold"
    return bg, ""
