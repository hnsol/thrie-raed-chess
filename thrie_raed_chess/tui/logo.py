"""スタート画面のタイトルロゴ。

APP_NAME を大きなブロック文字アートで描き、左上から右下へ火炎グラデーション
(明るい黄 → オレンジ → 深紅)を掛け、Claude Code 風の罫線ドロップシャドウ
(右辺に ║、下辺に ═、角に ╗╚╝)を添えた Rich Text を返す。figlet 等の外部
依存を避けるため、5行高のブロックフォントを手描きでハードコードしている
(glyphs.py の駒アートと同じ「文字列定数」方針)。
"""

from rich.text import Text

# 5行高のブロックフォント。ロゴに必要な文字のみ収録。
_FONT = {
    "T": ["█████", "  █  ", "  █  ", "  █  ", "  █  "],
    "H": ["█   █", "█   █", "█████", "█   █", "█   █"],
    "R": ["████ ", "█   █", "████ ", "█  █ ", "█   █"],
    "I": ["█████", "  █  ", "  █  ", "  █  ", "█████"],
    "E": ["█████", "█    ", "████ ", "█    ", "█████"],
    "A": [" ███ ", "█   █", "█████", "█   █", "█   █"],
    "D": ["████ ", "█   █", "█   █", "█   █", "████ "],
    "C": [" ████", "█    ", "█    ", "█    ", " ████"],
    "S": [" ████", "█    ", " ███ ", "    █", "████ "],
    " ": ["  ", "  ", "  ", "  ", "  "],
}
_GLYPH_H = 5

# 火炎グラデーションの区分線形アンカー(明→暗)。斜め方向に適用する。
_GRADIENT_STOPS = [(0xFF, 0xC8, 0x37), (0xFF, 0x80, 0x08), (0xFF, 0x41, 0x6C)]
_SHADOW_DIM = 0.4


def _render_word(word):
    rows = [""] * _GLYPH_H
    for i, ch in enumerate(word):
        glyph = _FONT[ch]
        sep = " " if i else ""
        rows = [rows[r] + sep + glyph[r] for r in range(_GLYPH_H)]
    return rows


def _base_lines():
    top = _render_word("THRIE RAED")
    bottom = _render_word("CHESS")
    width = max(len(line) for line in top + bottom)
    pad = lambda line: line.center(width)
    return [pad(line) for line in top] + [" " * width] + [pad(line) for line in bottom]


def _is_glyph(lines, r, c):
    return 0 <= r < len(lines) and 0 <= c < len(lines[0]) and lines[r][c] == "█"


def _line_shadow(lines):
    """各文字ブロックの右辺・下辺に罫線を敷いた1行1列大きいグリッドを返す。"""
    height, width = len(lines), len(lines[0])
    grid = []
    for r in range(height + 1):
        row = []
        for c in range(width + 1):
            if _is_glyph(lines, r, c):
                row.append("█")
                continue
            left = _is_glyph(lines, r, c - 1)
            up = _is_glyph(lines, r - 1, c)
            up_left = _is_glyph(lines, r - 1, c - 1)
            if left and up:
                row.append("╝")
            elif left:
                row.append("║" if up_left else "╗")
            elif up:
                row.append("═" if up_left else "╚")
            elif up_left:
                row.append("╝")
            else:
                row.append(" ")
        grid.append("".join(row))
    return grid


def _lerp(a, b, t):
    return tuple(round(a[k] + (b[k] - a[k]) * t) for k in range(3))


def _gradient_rgb(t):
    if t < 0.5:
        return _lerp(_GRADIENT_STOPS[0], _GRADIENT_STOPS[1], t * 2)
    return _lerp(_GRADIENT_STOPS[1], _GRADIENT_STOPS[2], (t - 0.5) * 2)


def _hex(rgb):
    return f"#{rgb[0]:02X}{rgb[1]:02X}{rgb[2]:02X}"


def _dim(rgb, factor):
    return tuple(round(c * factor) for c in rgb)


def logo_text():
    """タイトルロゴを火炎斜めグラデーション+罫線シャドウ付きの rich.text.Text で返す。"""
    grid = _line_shadow(_base_lines())
    height, width = len(grid), len(grid[0])
    last_row, last_col = height - 1, max(width - 1, 1)

    text = Text()
    for r, row in enumerate(grid):
        if r:
            text.append("\n")
        run_style, run_chars = None, []

        def flush():
            if run_chars:
                text.append("".join(run_chars), style=run_style)

        for c, ch in enumerate(row):
            if ch == " ":
                style = None
            else:
                t = (c / last_col + r / last_row) / 2 if last_row else c / last_col
                rgb = _gradient_rgb(t)
                style = _hex(rgb) if ch == "█" else _hex(_dim(rgb, _SHADOW_DIM))
            if style != run_style:
                flush()
                run_style, run_chars = style, []
            run_chars.append(ch)
        flush()
    return text
