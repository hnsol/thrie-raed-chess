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

import sys
import random
import termios
import tty
import chess
import chess.engine

from movesense.config import (
    APP_NAME,
    ANALYSIS_DEPTH,
    CPU_SKILL,
    CPU_DEPTH,
    GREEN_MAX,
    YELLOW_MAX,
    KEYS,
    MENU_KEYS,
    RESULT_KEYS,
    find_stockfish,
)
from movesense.evaluation import (
    classify,
    evaluate_all_moves,
    evaluate_position,
    format_position_eval,
    move_facts,
    pick_three,
)
from movesense.puzzles import (
    PUZZLES,
    find_puzzle_by_id,
    get_puzzles_by_difficulty,
    mate_label,
    pick_puzzle_three,
    puzzle_board,
)
from movesense.stats import BattleStats, movement_help_lines
from movesense.review import copy_to_clipboard, game_pgn, game_review_text
from movesense.boardmodel import (
    CellRole,
    choice_model,
    lastmove_model,
    puzzle_result_model,
    result_model,
)

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


def show_title(mode="menu"):
    mode_name = {"menu": "Menu", "battle": "Battle", "puzzle": "Puzzle"}[mode]
    print(f"=== {APP_NAME} ===")
    print(f"{DIM}Mode: {mode_name}{RESET}")
    if mode == "battle":
        print(f"{DIM}j / k / l で選ぶ。選んだ後に評価を開示。{RESET}")
    elif mode == "puzzle":
        print(f"{DIM}j / k / l で詰ませる手を選ぶ。評価は開示しません。{RESET}")
    print()


def read_menu_choice(valid):
    while True:
        key = read_key()
        if key in valid:
            return key

# ---- 表示設定 ------------------------------------------------------------
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
    ("\033[48;5;214m", HL_FG),     # l: オレンジ
]

BOARD_TEXT_W = 2 + 8 * SQUARE_W


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


def render_board_lines(board, overrides, panel_lines=None):
    """overrides: square -> (bg, content, cw, fg)。無い升はチェッカー+駒。"""
    lines = []
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
        lines.append(row)
    lines.append("  " + "".join(_pad(c, 1) for c in "abcdefgh"))

    help_lines = movement_help_lines() if panel_lines is None else panel_lines
    merged = []
    for i, line in enumerate(lines):
        help_text = help_lines[i] if i < len(help_lines) else ""
        if help_text:
            merged.append(f"{line:<{BOARD_TEXT_W}}  {DIM}{help_text}{RESET}")
        else:
            merged.append(line)
    return merged


def _render_board(board, overrides, panel_lines=None):
    print()
    for line in render_board_lines(board, overrides, panel_lines=panel_lines):
        print(line)


def _cell_ansi(cell):
    """boardmodel.Cell -> (bg, content, cw, fg) の ANSI 表示タプル。"""
    if cell.role == CellRole.LASTMOVE:
        bg = LASTMOVE
    else:
        bg, _ = IDENTITY[cell.choice_index]
    if cell.show_piece and cell.piece is not None:
        content, cw, fg = _piece_content(cell.piece)
    else:
        content, cw, fg = "", 0, ""
    return bg, content, cw, fg


def _overrides_from_model(model):
    return {sq: _cell_ansi(cell) for sq, cell in model.items()}


def _lastmove_overrides(board, move):
    """直前の1手を淡黄で。出発点=空き、着地点=動いた駒。"""
    return _overrides_from_model(lastmove_model(board, move))


def _choice_overrides(board, choices):
    return _overrides_from_model(choice_model(board, choices))


def show_board(board, panel_lines=None):
    _render_board(board, {}, panel_lines=panel_lines)
    turn = "White(あなた)" if board.turn == chess.WHITE else "Black(CPU)"
    print(f"  手番: {turn}")
    print()


def last_move_san(board):
    if not board.move_stack:
        return None
    tmp = board.copy()
    move = tmp.pop()
    return tmp.san(move)


def render_annotated_board(board, choices, panel_lines=None):
    """選択肢(識別色)＋直前の相手の手(淡黄)を同じ盤に。競合は選択肢優先。"""
    last = board.peek() if board.move_stack else None
    ov = _lastmove_overrides(board, last) if last else {}
    ov.update(_choice_overrides(board, choices))  # 選択肢が上書き=優先
    _render_board(board, ov, panel_lines=panel_lines)
    if last:
        san = last_move_san(board)
        print(f"  {DIM}直近CPU手: {san} / 淡黄=出発点と到着点{RESET}")
    print()


def render_puzzle_choices_board(board, choices):
    last = board.peek() if board.move_stack else None
    ov = _lastmove_overrides(board, last) if last else {}
    ov.update(_choice_overrides(board, choices))
    _render_board(board, ov)
    if last:
        san = last_move_san(board)
        print(f"  {DIM}直近応手: {san} / 淡黄=出発点と到着点{RESET}")
    print()


def show_board_move(board, move, who="手"):
    """直前に指された1手を強調(board は push 済み前提)。相手の手に使う。"""
    _render_board(board, _lastmove_overrides(board, move))
    print(f"  {DIM}淡黄={who}{RESET}")
    print()


def show_result_board(board, choices, sel, panel_lines=None):
    """指した後の盤(board は push 済み)。
    選んだ手はその識別色で単色表示、選ばなかった候補も色付きで併記。
    相手の手(淡黄)とは別表現にする。"""
    ov = _overrides_from_model(result_model(board, choices, sel))
    _render_board(board, ov, panel_lines=panel_lines)
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


def side_to_move_label(board):
    return "White" if board.turn == chess.WHITE else "Black"


def render_puzzle_choice(idx, board, item):
    move, _, _ = item
    san = board.san(move)
    bg, fg = IDENTITY[idx]
    keytag = f"{bg}{fg} {KEYS[idx]} {RESET}"
    src = chess.square_name(move.from_square)
    dst = chess.square_name(move.to_square)
    return f"  {keytag} {side_to_move_label(board)}: {san:6} {src}->{dst}"


def show_game_export(board, result="*", termination="Unfinished"):
    text = game_review_text(board, result=result, termination=termination)
    copied = copy_to_clipboard(text)
    print("\n==============================")
    print("  棋譜と依頼文")
    print("==============================")
    print(text)
    print("==============================")
    if copied:
        print("  クリップボードにコピーしました。")
    else:
        print("  クリップボードコピーはできませんでした。")


# ---- メインループ ------------------------------------------------------
def battle_panel_lines(stats, position_eval):
    return movement_help_lines(stats=stats, position_eval=position_eval, panel_mode=stats.panel_mode)


def draw_human_choice_screen(board, choices, stats, position_eval):
    panel_lines = battle_panel_lines(stats, position_eval) if stats is not None else None

    clear_screen()
    if sys.stdin.isatty():
        show_title("battle")
    render_annotated_board(board, choices, panel_lines=panel_lines)
    print("  どれを指す？（色付き升=候補の駒と行き先）")
    for i, item in enumerate(choices):
        print(render_choice(i, board, item, reveal=False))

    present = {c for _, _, c in choices}
    missing = [LABELS[c][1].strip() for c in ("green", "yellow", "red")
               if c not in present]
    if missing:
        print(f"  {DIM}(この局面では {' / '.join(missing)} は出せませんでした){RESET}")

    valid = KEYS[:len(choices)]
    print(f"  {DIM}{' / '.join(valid)} で選択、x で表示切替、r で投了、q で終了{RESET}")
    return valid


def human_turn(engine, board, stats=None):
    evaluated = evaluate_all_moves(engine, board)
    choices = pick_three(evaluated)
    position_eval = evaluate_position(engine, board)
    valid = draw_human_choice_screen(board, choices, stats, position_eval)
    sel = None
    while sel is None:
        key = read_key()
        if key == "q":
            return "quit"
        if key == "r":
            return "resign"
        if key == "x" and stats is not None:
            stats.panel_mode = "help" if stats.panel_mode == "stats" else "stats"
            valid = draw_human_choice_screen(board, choices, stats, position_eval)
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
    if stats is not None:
        stats.record(color, loss)
    panel_lines = battle_panel_lines(stats, evaluate_position(engine, board)) if stats is not None else None

    clear_screen()
    if sys.stdin.isatty():
        show_title("battle")
    show_result_board(board, choices, sel, panel_lines=panel_lines)
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


def show_main_menu():
    clear_screen()
    show_title()
    print("  モード選択")
    print("  j  対戦モード")
    print("  k  詰めチェス")
    print("  q  終了")
    print(f"  {DIM}j / k / q で選択{RESET}")
    return read_menu_choice({"j", "k", "q"})


def choose_puzzle_by_number():
    clear_screen()
    show_title("puzzle")
    print("  問題番号")
    counts = {n: len(get_puzzles_by_difficulty(n)) for n in (2, 3, 4)}
    print(f"  mate in 2: {counts[2]}問 / mate in 3: {counts[3]}問 / mate in 4: {counts[4]}問")
    print(f"  例: {PUZZLES[0]['id']}")
    print()
    puzzle_id = input("  番号を入力: ").strip()
    return find_puzzle_by_id(puzzle_id)


def choose_puzzle_by_difficulty():
    clear_screen()
    show_title("puzzle")
    print("  難易度")
    print("  j  mate in 2")
    print("  k  mate in 3")
    print("  l  mate in 4")
    print("  q  戻る")
    key = read_menu_choice(MENU_KEYS)
    if key == "q":
        return None
    mate_in = {"j": 2, "k": 3, "l": 4}[key]
    return random.choice([p for p in PUZZLES if p["mate_in"] == mate_in])


def choose_puzzle():
    while True:
        clear_screen()
        show_title("puzzle")
        print("  詰めチェス")
        print("  j  ランダム")
        print("  k  難易度指定")
        print("  l  問題番号指定")
        print("  q  戻る")
        key = read_menu_choice(MENU_KEYS)
        if key == "q":
            return None
        if key == "j":
            puzzle = random.choice(PUZZLES)
        elif key == "k":
            puzzle = choose_puzzle_by_difficulty()
        else:
            puzzle = choose_puzzle_by_number()
        if puzzle:
            return puzzle
        pause("  ─ 見つかりません。キーで戻る ─")


def render_puzzle_board(board, puzzle, step_no):
    _render_board(board, {})
    print(f"  問題 {puzzle['id']}: {mate_label(puzzle)}  {puzzle['title']}")
    print(f"  {DIM}手順 {step_no}/{(len(puzzle['solution']) + 1) // 2}{RESET}")
    print()


def puzzle_turn(board, puzzle, solution_index):
    correct = chess.Move.from_uci(puzzle["solution"][solution_index])
    choices = pick_puzzle_three(board, correct)
    clear_screen()
    show_title("puzzle")
    render_puzzle_choices_board(board, choices)
    print(f"  問題 {puzzle['id']}: {mate_label(puzzle)}  {puzzle['title']}")
    print(f"  手番: {side_to_move_label(board)}")
    print(f"  {DIM}手順 {solution_index // 2 + 1}/{puzzle['mate_in']}{RESET}")
    print()
    print("  詰ませる手は？（評価は開示しません）")
    for i, item in enumerate(choices):
        print(render_puzzle_choice(i, board, item))
    valid = KEYS[:len(choices)]
    print(f"  {DIM}{' / '.join(valid)} で選択、q で終了{RESET}")
    while True:
        key = read_key()
        if key == "q":
            return "quit"
        if key in valid:
            selected_idx = valid.index(key)
            selected = choices[selected_idx][0]
            if selected != correct:
                board.push(selected)
                return "miss", selected_idx
            san = board.san(selected)
            board.push(selected)
            return san, selected_idx


def run_puzzle(puzzle):
    board = puzzle_board(puzzle)
    solution = puzzle["solution"]
    idx = 0
    final_choice_idx = None
    while idx < len(solution):
        result = puzzle_turn(board, puzzle, idx)
        if result == "quit":
            return result, None
        if isinstance(result, tuple) and result[0] == "miss":
            _, choice_idx = result
            return "miss", (board, choice_idx)
        _, choice_idx = result
        final_choice_idx = choice_idx
        idx += 1
        if board.is_checkmate():
            return "success", (board, final_choice_idx)
        if idx >= len(solution):
            return "fail", None
        reply = chess.Move.from_uci(solution[idx])
        if reply not in board.legal_moves:
            return "fail", None
        board.push(reply)
        idx += 1
    return ("success", (board, final_choice_idx)) if board.is_checkmate() else ("fail", None)


def puzzle_result_menu(status, puzzle, final_result=None):
    if status in ("success", "miss") and final_result is not None:
        final_board, final_choice_idx = final_result
        clear_screen()
        show_title("puzzle")
        last = final_board.peek() if final_board.move_stack else None
        overrides = {}
        if last:
            overrides = _overrides_from_model(puzzle_result_model(final_board, last, final_choice_idx))
        _render_board(final_board, overrides)
    print()
    if status == "success":
        print("  成功。チェックメイトです。")
    elif status == "miss":
        print("  失敗。別の手を選びました。")
    elif status == "fail":
        print("  失敗。規定手数で詰みませんでした。")
    else:
        print("  中断しました。")
    print()
    print("  h  リトライ")
    print("  j  別の問題")
    print("  k  メニューへ戻る")
    print("  q  終了")
    return read_menu_choice(RESULT_KEYS)


def run_puzzle_mode():
    puzzle = choose_puzzle()
    while puzzle:
        status, final_result = run_puzzle(puzzle)
        key = puzzle_result_menu(status, puzzle, final_result=final_result)
        if key == "h":
            continue
        if key == "j":
            puzzle = choose_puzzle()
            continue
        if key == "k":
            return "menu"
        return "quit"
    return "menu"


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


def run_battle_mode():
    sf = find_stockfish()
    if not sf:
        print("Stockfish が見つかりません。")
        print("  Mac:  brew install stockfish")
        print("  その後、STOCKFISH_PATH を設定するか PATH に入れてください。")
        return

    engine = chess.engine.SimpleEngine.popen_uci(sf)
    board = chess.Board()
    stats = BattleStats()
    show_title("battle")

    try:
        result = "*"
        termination = "Unfinished"
        while not board.is_game_over():
            if board.turn == chess.WHITE:
                # 人間の手番は注釈付き盤面を human_turn 内で描く
                turn_result = human_turn(engine, board, stats=stats)
                if turn_result == "quit":
                    result = "*"
                    termination = "Abandoned"
                    print("\n中断しました。")
                    break
                if turn_result == "resign":
                    result = "0-1"
                    termination = "White resigned"
                    print("\n投了しました。")
                    break
            else:
                cpu_turn(engine, board)
        else:
            result = board.result(claim_draw=True)
            termination = "Game over"
            show_board(board, panel_lines=battle_panel_lines(stats, evaluate_position(engine, board)))
            announce_result(board)
        show_game_export(board, result=result, termination=termination)
    finally:
        engine.quit()


def main():
    while True:
        mode = show_main_menu()
        if mode == "j":
            run_battle_mode()
            pause("  ─ キーでメニューへ ─")
        elif mode == "k":
            if run_puzzle_mode() == "quit":
                break
        else:
            break


if __name__ == "__main__":
    main()
