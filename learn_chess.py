#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""
learn_chess.py — 3択で覚えるチェス
--------------------------------------------------
遊び方の思想:
  自分の手番では「無印の3択」が出る。色はまだ見えない。
  自分で「これが良さそう」と選ぶ → 選んだ後に3手すべての
  green / yellow / red と best手との差が開く。
  「良さそうに見えた手が実は赤だった」という瞬間で覚える。

必要なもの:
  pip install python-chess
  Stockfish 本体(engine)。Macなら: brew install stockfish
"""

import os
import sys
import random
import shutil
import termios
import tty
import chess
import chess.engine

# ---- 単キー入力 --------------------------------------------------------
# ターミナルを一時的に cbreak モードにして、Enterなしで1キーを拾う。
# cbreak なので Ctrl-C(SIGINT) は通常どおり効く。
def read_key():
    # 端末でない(パイプ等)場合は1行読んで先頭文字を使う
    if not sys.stdin.isatty():
        line = sys.stdin.readline()
        return line.strip().lower()[:1] if line.strip() else "q"
    fd = sys.stdin.fileno()
    old = termios.tcgetattr(fd)
    try:
        tty.setcbreak(fd)
        ch = sys.stdin.read(1)
    finally:
        termios.tcsetattr(fd, termios.TCSADRAIN, old)
    return ch.lower()

# 画面の3択(左・中・右)に対応するキー
KEYS = ["j", "k", "l"]

def pause(msg="  ─ キーで次へ ─"):
    """1ビートごとに立ち止まる。パイプ等の非対話時は止まらない。"""
    if not sys.stdin.isatty():
        return
    print(f"{DIM}{msg}{RESET}")
    read_key()


def clear_screen():
    """対話端末だけ固定画面風に再描画する。"""
    if sys.stdin.isatty():
        print("\033[2J\033[H", end="")


def show_title():
    print("=== 3択チェス ===  あなた=White(明るい駒)")
    print(f"{DIM}j / k / l で選ぶ。色の意味は選んだ後に開示。{RESET}")
    print()

# ---- 設定 --------------------------------------------------------------
# Stockfish の場所を自動探索(PATH → よくある場所)。見つからなければ手動指定。
def find_stockfish():
    p = shutil.which("stockfish")
    if p:
        return p
    for cand in ("/usr/games/stockfish", "/opt/homebrew/bin/stockfish",
                 "/usr/local/bin/stockfish"):
        if os.path.exists(cand):
            return cand
    return None

ANALYSIS_DEPTH = 12      # 3択を選ぶための読みの深さ。大きいほど正確・遅い
CPU_SKILL      = 3       # 相手CPUの強さ 0(最弱)〜20(最強)。初心者は3前後
CPU_DEPTH      = 6       # 相手CPUの読みの深さ

# 色分けのしきい値(センチポーン=歩1枚≒100)。best手からの損失で判定
GREEN_MAX  = 30          # 損失これ以下 → 緑(ほぼ最善)
YELLOW_MAX = 150         # ここまで → 黄、超えたら → 赤

LABELS = {
    "green":  ("\033[92m", "🟢 良い手"),
    "yellow": ("\033[93m", "🟡 普通  "),
    "red":    ("\033[91m", "🔴 悪い手"),
}
RESET = "\033[0m"
DIM   = "\033[2m"

# 盤の升目(チェッカーボード)と駒の色。升に背景色を敷き、
# 各升を固定幅にすることで曖昧幅の影響を受けず整列させる。
LIGHT_SQ = "\033[48;5;180m"        # 明るい升
DARK_SQ  = "\033[48;5;101m"        # 暗い升
W_PIECE  = "\033[1;38;5;231m"      # 白番の駒(明るい白・太字)
B_PIECE  = "\033[1;38;5;16m"       # 黒番の駒(黒)
LASTMOVE = "\033[48;5;228m"        # 直前の相手の手(淡黄背景)
HL_FG    = "\033[1;38;5;16m"       # ハイライト升の文字色(黒・太字)

# 駒の見た目。記号(♟♞…)を使うか、ASCII(K/Q/R/B/N/P)にするか。
#   USE_UNICODE_PIECES=False にすれば、どの端末でも確実に整列(ASCII)。
#   記号を使う場合、多くの日本語環境では全角(2セル)で描かれるので
#   UNICODE_GLYPH_WIDTH=2。半角で描かれる端末なら 1 にする。
USE_UNICODE_PIECES  = True
UNICODE_GLYPH_WIDTH = 1
# 白黒の区別が付くよう、全駒に「塗りつぶし記号」を使い色で分ける。
_SOLID = {"P": "♟", "N": "♞", "B": "♝", "R": "♜", "Q": "♛", "K": "♚"}

PIECE_W  = UNICODE_GLYPH_WIDTH if USE_UNICODE_PIECES else 1
SQUARE_W = PIECE_W + 2             # 升の表示幅(駒の左右に余白1ずつ)

# 選択肢の識別色(升の背景, 文字色)。品質の緑/黄/赤とは別系統。
IDENTITY = [
    ("\033[48;5;45m",  HL_FG),     # j: シアン
    ("\033[48;5;213m", HL_FG),     # k: マゼンタ
    ("\033[48;5;75m",  HL_FG),     # l: 青
]


# ---- 評価まわり --------------------------------------------------------
def classify(loss):
    if loss <= GREEN_MAX:
        return "green"
    if loss <= YELLOW_MAX:
        return "yellow"
    return "red"


def evaluate_all_moves(engine, board):
    """
    全合法手を評価。best手との損失(センチポーン)昇順で
    [(move, loss, color)] を返す。
    """
    legal = list(board.legal_moves)
    infos = engine.analyse(
        board,
        chess.engine.Limit(depth=ANALYSIS_DEPTH),
        multipv=len(legal),
    )
    scored = []
    for info in infos:
        move = info["pv"][0]
        score = info["score"].pov(board.turn).score(mate_score=10000)
        scored.append((move, score))
    best = max(s for _, s in scored)
    result = [(m, best - s, classify(best - s)) for m, s in scored]
    result.sort(key=lambda x: x[1])
    return result


def pick_three(evaluated):
    """
    最善手を必ず含め、できるだけ 黄・赤 も1つずつ。
    足りない色は他から補充。3手未満の局面ならある分だけ。
    """
    if not evaluated:
        return []

    best = evaluated[0]
    buckets = {"green": [], "yellow": [], "red": []}
    for item in evaluated:
        if item == best:
            continue
        buckets[item[2]].append(item)

    chosen = [best]
    for color in ("yellow", "red"):
        if buckets[color]:
            chosen.append(random.choice(buckets[color]))

    if len(chosen) < 3:
        rest = [x for x in evaluated if x not in chosen]
        random.shuffle(rest)
        chosen += rest[: 3 - len(chosen)]

    chosen = chosen[:3]
    random.shuffle(chosen)   # 色順に並ばないように
    return chosen


def move_facts(board, move):
    """一言解説の材料になる、確認できる事実だけを拾う。"""
    facts = []
    if board.is_capture(move):
        facts.append("駒を取る")
    if move.promotion:
        facts.append("成る")
    if board.is_castling(move):
        facts.append("キャスリング")
    board.push(move)
    if board.is_check():
        facts.append("王手")
    board.pop()
    # 動かした駒が相手に取られる位置で、味方が守っていない = ただ捨ての危険
    to_sq = move.to_square
    tmp = board.copy()
    tmp.push(move)
    attacked = tmp.is_attacked_by(not board.turn, to_sq)
    defended = tmp.is_attacked_by(board.turn, to_sq)
    if attacked and not defended:
        facts.append("取られる位置(守りなし)")
    return facts


# ---- 表示 --------------------------------------------------------------
# 各升は固定幅 SQUARE_W の色付きブロック。中身(駒記号/キー/空白)を
# その表示幅に応じて中央寄せするので、全角記号でも整列が崩れない。

def _piece_content(piece):
    """駒 → (表示文字, 表示幅, 前景色)。空マスは ("", 0, "")。"""
    if piece is None:
        return "", 0, ""
    fg = W_PIECE if piece.color == chess.WHITE else B_PIECE
    if USE_UNICODE_PIECES:
        return _SOLID[piece.symbol().upper()], UNICODE_GLYPH_WIDTH, fg
    return piece.symbol(), 1, fg


def _pad(content, cw, width=None):
    width = SQUARE_W if width is None else width
    total = max(0, width - cw)
    left = total // 2
    return " " * left + content + " " * (total - left)


def _cell(bg, content, cw, fg):
    return f"{bg}{fg}{_pad(content, cw)}{RESET}"


def _render_board(board, overrides):
    """overrides: square -> (bg, content, cw, fg)。無い升はチェッカー+駒。"""
    print()
    for rank in range(7, -1, -1):
        row = f"{rank+1} "
        for file in range(8):
            sq = chess.square(file, rank)
            if sq in overrides:
                bg, content, cw, fg = overrides[sq]
            else:
                is_light = (file + rank) % 2 == 1
                bg = LIGHT_SQ if is_light else DARK_SQ
                content, cw, fg = _piece_content(board.piece_at(sq))
            row += _cell(bg, content, cw, fg)
        print(row)
    print("  " + "".join(_pad(c, 1) for c in "abcdefgh"))


def _lastmove_overrides(board, move):
    """直前の1手を淡黄で。出発点=空き、着地点=動いた駒。"""
    content, cw, fg = _piece_content(board.piece_at(move.to_square))
    return {
        move.from_square: (LASTMOVE, "", 0, ""),
        move.to_square:   (LASTMOVE, content, cw, fg),
    }


def show_board(board):
    _render_board(board, {})
    turn = "White(あなた)" if board.turn == chess.WHITE else "Black(CPU)"
    print(f"  手番: {turn}")
    print()


def last_move_san(board):
    if not board.move_stack:
        return None
    tmp = board.copy()
    move = tmp.pop()
    return tmp.san(move)


def render_annotated_board(board, choices):
    """選択肢(識別色)＋直前の相手の手(淡黄)を同じ盤に。競合は選択肢優先。"""
    last = board.peek() if board.move_stack else None
    ov = _lastmove_overrides(board, last) if last else {}
    for i, (move, _, _) in enumerate(choices):     # 選択肢が上書き=優先
        bg, _keyfg = IDENTITY[i]
        content, cw, _ = _piece_content(board.piece_at(move.from_square))
        ov[move.from_square] = (bg, content, cw, W_PIECE)   # 出発点=自分の駒
        ov[move.to_square] = (bg, KEYS[i], 1, HL_FG)        # 行き先=キー
    _render_board(board, ov)
    if last:
        san = last_move_san(board)
        print(f"  {DIM}直近CPU手: {san} / 淡黄=出発点と到着点{RESET}")
    print()


def show_board_move(board, move, who="手"):
    """直前に指された1手を強調(board は push 済み前提)。相手の手に使う。"""
    _render_board(board, _lastmove_overrides(board, move))
    print(f"  {DIM}淡黄={who}{RESET}")
    print()


def show_result_board(board, choices, sel):
    """指した後の盤(board は push 済み)。
    選んだ手はその識別色で単色表示、選ばなかった候補も色付きで併記。
    相手の手(淡黄)とは別表現にする。"""
    ov = {}
    # 選ばなかった候補: 出発点の駒 + 行き先キー(識別色)
    for i, (mv, _, _) in enumerate(choices):
        if i == sel:
            continue
        bg, _ = IDENTITY[i]
        content, cw, _ = _piece_content(board.piece_at(mv.from_square))
        ov[mv.from_square] = (bg, content, cw, W_PIECE)
        ov[mv.to_square] = (bg, KEYS[i], 1, HL_FG)
    # 選んだ手: 識別色で単色(出発点=空き / 着地点=動いた駒)。上書き優先。
    mv = choices[sel][0]
    bg, _ = IDENTITY[sel]
    content, cw, fg = _piece_content(board.piece_at(mv.to_square))
    ov[mv.from_square] = (bg, "", 0, "")
    ov[mv.to_square] = (bg, content, cw, fg)

    _render_board(board, ov)
    others = "・".join(KEYS[i] for i in range(len(choices)) if i != sel)
    print(f"  {DIM}{KEYS[sel]}の色=あなたの手 / {others}=選ばなかった候補{RESET}")
    print()


def render_choice(idx, board, item, reveal, chosen_idx=None):
    move, loss, color = item
    san = board.san(move)
    bg, fg = IDENTITY[idx]
    keytag = f"{bg}{fg} {KEYS[idx]} {RESET}"   # 盤面と同じ識別色のキー
    if not reveal:
        return f"  {keytag} {san}"
    col, label = LABELS[color]
    facts = "、".join(move_facts(board, move))
    mark = "  ← 選んだ手" if idx == chosen_idx else ""
    tail = f"{DIM}(差 {loss}){RESET}"
    factstr = f"  {DIM}{facts}{RESET}" if facts else ""
    return f"  {keytag} {col}{label}{RESET} {san:6} {tail}{factstr}{mark}"


# ---- メインループ ------------------------------------------------------
def human_turn(engine, board):
    evaluated = evaluate_all_moves(engine, board)
    choices = pick_three(evaluated)

    clear_screen()
    if sys.stdin.isatty():
        show_title()
    render_annotated_board(board, choices)
    print("  どれを指す？（色付き升=候補の駒と行き先）")
    for i, item in enumerate(choices):
        print(render_choice(i, board, item, reveal=False))

    # 存在する色を数えて、欠けている色があれば伝える
    present = {c for _, _, c in choices}
    missing = [LABELS[c][1].strip() for c in ("green", "yellow", "red")
               if c not in present]
    if missing:
        print(f"  {DIM}(この局面では {' / '.join(missing)} は出せませんでした){RESET}")

    valid = KEYS[:len(choices)]
    print(f"  {DIM}{' / '.join(valid)} で選択、q で終了{RESET}")
    sel = None
    while sel is None:
        key = read_key()
        if key == "q":
            return "quit"
        if key in valid:
            sel = valid.index(key)

    chosen = choices[sel]
    move, loss, color = chosen
    san = board.san(move)
    _, label = LABELS[color]
    revealed = [
        render_choice(i, board, item, reveal=True, chosen_idx=sel)
        for i, item in enumerate(choices)
    ]
    board.push(move)

    clear_screen()
    if sys.stdin.isatty():
        show_title()
    show_result_board(board, choices, sel)
    print(f"  あなたの手: {san}  {label.strip()}(差 {loss})")
    print()
    print("  --- 評価 ---")
    for line in revealed:
        print(line)
    print()
    pause("  ─ 確認したらキーでCPUの番へ ─")

    return "ok"


def cpu_turn(engine, board):
    result = engine.play(
        board,
        chess.engine.Limit(depth=CPU_DEPTH),
        options={"Skill Level": CPU_SKILL},
    )
    move = result.move
    board.push(move)


def announce_result(board):
    print("\n==============================")
    if board.is_checkmate():
        winner = "CPU(Black)" if board.turn == chess.WHITE else "あなた(White)"
        print(f"  チェックメイト! 勝者: {winner}")
    elif board.is_stalemate():
        print("  ステイルメイト(引き分け)")
    elif board.is_insufficient_material():
        print("  駒不足で引き分け")
    elif board.can_claim_draw():
        print("  引き分け(反復/50手ルール)")
    else:
        print("  終了")
    print("==============================")


def main():
    sf = find_stockfish()
    if not sf:
        print("Stockfish が見つかりません。")
        print("  Mac:  brew install stockfish")
        print("  その後、STOCKFISH_PATH を設定するか PATH に入れてください。")
        sys.exit(1)

    engine = chess.engine.SimpleEngine.popen_uci(sf)
    board = chess.Board()
    show_title()

    try:
        while not board.is_game_over():
            if board.turn == chess.WHITE:
                # 人間の手番は注釈付き盤面を human_turn 内で描く
                if human_turn(engine, board) == "quit":
                    print("\n中断しました。")
                    break
            else:
                cpu_turn(engine, board)
        else:
            show_board(board)
            announce_result(board)
    finally:
        engine.quit()


if __name__ == "__main__":
    main()
