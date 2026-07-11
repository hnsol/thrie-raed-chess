"""升目の意味づけ(色付き表示の対象)を、実際の色の描画から切り離すモデル。

square -> Cell の辞書を返す純関数群。Cell.role が「なぜこの升が強調されているか」を
表し、実際の色決定は movesense/tui の Textual テーマが個別に行う。
"""

from dataclasses import dataclass
from enum import Enum, auto
from typing import Optional

import chess


class CellRole(Enum):
    LASTMOVE = auto()          # 直前の相手の手(from/to)
    CHOICE = auto()            # 3択の候補(常時表示)
    CHOICE_FOCUSED = auto()    # 3択のうち現在フォーカス中の1手
    CHOICE_DIMMED = auto()     # 3択のうちフォーカスされていない残り
    RESULT_CHOSEN = auto()     # 指した後: 選んだ手
    RESULT_OTHER = auto()      # 指した後: 選ばなかった候補


@dataclass(frozen=True)
class Cell:
    role: CellRole
    choice_index: Optional[int] = None   # IDENTITY 配列の何番目の識別色を使うか
    piece: Optional[chess.Piece] = None
    show_piece: bool = True              # False なら升は空き表示(出発点など)


def lastmove_model(board, move):
    """直前の1手。出発点=空き、着地点=動いた駒。"""
    return {
        move.from_square: Cell(CellRole.LASTMOVE, show_piece=False),
        move.to_square: Cell(CellRole.LASTMOVE, piece=board.piece_at(move.to_square)),
    }


def choice_model(board, choices, focused_index=None):
    """3択を常時表示するモデル。

    focused_index が指定されていれば、その手だけ CHOICE_FOCUSED、
    残りは CHOICE_DIMMED になる(症状②のプレビュー強調に対応)。
    未指定なら全て CHOICE(通常表示)。
    """
    model = {}
    for i, (move, _, _) in enumerate(choices):
        if focused_index is None:
            role = CellRole.CHOICE
        elif i == focused_index:
            role = CellRole.CHOICE_FOCUSED
        else:
            role = CellRole.CHOICE_DIMMED
        for sq in (move.from_square, move.to_square):
            existing = model.get(sq)
            if existing and existing.role == CellRole.CHOICE_FOCUSED and role != CellRole.CHOICE_FOCUSED:
                continue
            model[sq] = Cell(role, i, board.piece_at(sq))
    return model


def result_model(board, choices, sel):
    """指した後の盤(board は sel の手を push 済み)。

    選んだ手はその識別色で単色表示(出発点=空き)、選ばなかった候補も
    色付きで併記する。
    """
    model = {}
    for i, (mv, _, _) in enumerate(choices):
        if i == sel:
            continue
        model[mv.from_square] = Cell(CellRole.RESULT_OTHER, i, board.piece_at(mv.from_square))
        model[mv.to_square] = Cell(CellRole.RESULT_OTHER, i, board.piece_at(mv.to_square))
    mv = choices[sel][0]
    model[mv.from_square] = Cell(CellRole.RESULT_CHOSEN, sel, show_piece=False)
    model[mv.to_square] = Cell(CellRole.RESULT_CHOSEN, sel, board.piece_at(mv.to_square))
    return model


def puzzle_result_model(board, move, choice_index):
    """詰めチェス結果画面: 最終手を識別色で(出発点=空き、着地点=駒)。"""
    return {
        move.from_square: Cell(CellRole.RESULT_CHOSEN, choice_index, show_piece=False),
        move.to_square: Cell(CellRole.RESULT_CHOSEN, choice_index, board.piece_at(move.to_square)),
    }


# 白黒の区別が付くよう、全駒に「塗りつぶし記号」を使い色で分ける。
SOLID_GLYPHS = {"P": "♟", "N": "♞", "B": "♝", "R": "♜", "Q": "♛", "K": "♚"}


def piece_glyph(piece):
    if piece is None:
        return ""
    return SOLID_GLYPHS[piece.symbol().upper()]
