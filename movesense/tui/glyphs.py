"""チェス駒のブロックアート(複数行グリフ)。

盤面のマスに応じて駒を大きく描くための、ブロック文字によるアート。
"compact" サイズ(3行×5幅)の各駒アートは chess-tui
(https://github.com/thomas-mauran/chess-tui, MIT License, Copyright (c)
2023 Thomas Mauran) の src/pieces/*.rs を参考にしつつ、本プロジェクトで
再デザインした。共通ベース ▟█▙ で統一感を出し、頭部の形で駒種を見分け
やすくしている。参考元のライセンス全文はプロジェクト直下の
THIRD_PARTY_LICENSES を参照。

白/黒は形を共通にし、描画側(theme.piece_fg)が色で区別する。
"""

import chess

from movesense.boardmodel import piece_glyph

# 駒種(大文字1文字) -> compact アート(3行)。各行は幅5セルを想定。
# ブロック要素はすべて半角(1セル)。実際の幅ズレは描画側で中央寄せ正規化する。
#
# 縦の密着対策: 土台(3行目)は上寄せブロック(▝ ▀ ▘)でマス下端に隙間を作り、
# 真下のランクの駒とくっつかないようにする。頭部(1行目)は P/N/B/R では
# 下寄せブロック(▄ ▖ ▗)にしてマス上端にも隙間を残す。K/Q だけは頭(十字/
# 王冠)がマス上端まで届く全高のままにし、「王族だけ背が高い」ヒエラルキーで
# 見分けやすさと風格を両立する。幅・高さは従来どおり(3行×5幅)。
_COMPACT = {
    "P": [
        "  ▄  ",
        " ▝█▘ ",
        " ▝▀▘ ",
    ],
    "N": [
        " ▄▄▖ ",
        " ▜██ ",
        "▝▀▀▀▘",
    ],
    "B": [
        " ▗▄▖ ",
        " ▐█▌ ",
        "▝▀▀▀▘",
    ],
    "R": [
        " ▄ ▄ ",
        " ███ ",
        "▝▀▀▀▘",
    ],
    "Q": [
        " ▙▄▟ ",
        " ▐█▌ ",
        "▝▀▀▀▘",
    ],
    "K": [
        " ▗╋▖ ",
        " ▐█▌ ",
        "▝▀▀▀▘",
    ],
}

# 各サイズの行数。small は 1行(単一グリフ)、compact は 3行。
SIZE_HEIGHTS = {"small": 1, "compact": 3}


def piece_art(piece, size):
    """駒 -> そのサイズのアート行リスト。空マスは空行 × 行数。"""
    height = SIZE_HEIGHTS[size]
    if piece is None:
        return [""] * height
    if size == "small":
        return [piece_glyph(piece)]
    return list(_COMPACT[piece.symbol().upper()])
