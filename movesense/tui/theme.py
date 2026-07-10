"""色の一元管理。boardmodel.Cell -> Rich style文字列 のマッピングを持つ。

旧CLI版の256色パレットを踏襲しつつ、フォーカス/ダイム表現
(症状②のプレビュー強調)を追加する。
"""

from movesense.boardmodel import CellRole

LIGHT_SQUARE_BG = "color(180)"
DARK_SQUARE_BG = "color(101)"
WHITE_PIECE_FG = "bold color(231)"
BLACK_PIECE_FG = "bold color(16)"
LASTMOVE_BG = "color(228)"
HIGHLIGHT_FG = "bold color(16)"

# 選択肢の識別色。旧CLI版の IDENTITY と同じ配色(j: シアン / k: マゼンタ / l: オレンジ)。
IDENTITY_BG = ["color(45)", "color(213)", "color(214)"]


def key_badge_style(idx):
    """選択肢リストの j/k/l キー記号に付ける、盤面と同じ識別色の背景スタイル。"""
    return f"{HIGHLIGHT_FG} on {IDENTITY_BG[idx]}"


def checkerboard_bg(file_idx, rank_idx):
    is_light = (file_idx + rank_idx) % 2 == 1
    return LIGHT_SQUARE_BG if is_light else DARK_SQUARE_BG


def piece_fg(piece):
    return WHITE_PIECE_FG if piece.color else BLACK_PIECE_FG


def cell_background(cell):
    """boardmodel.Cell -> (bg色, 修飾子)。

    升の文字色は常に駒自体の色(piece_fg)で決まる(旧CLI版と同じ)。HIGHLIGHT_FG は
    盤面の升には使わず、選択肢キーのバッジ表示(将来のChoicePanel)専用。
    "dim"/"bold" は色名ではなく別枠の修飾子なので分けて返す(Rich の Style 構文は
    "on <色>" の後に色名以外を置けない)。
    """
    if cell.role == CellRole.LASTMOVE:
        return LASTMOVE_BG, ""
    bg = IDENTITY_BG[cell.choice_index]
    if cell.role == CellRole.CHOICE_DIMMED:
        return bg, "dim"
    if cell.role == CellRole.CHOICE_FOCUSED:
        return bg, "bold"
    return bg, ""
