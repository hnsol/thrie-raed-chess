import random

import chess
import chess.engine

from .config import ANALYSIS_DEPTH, GREEN_MAX, YELLOW_MAX


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


def evaluate_position(engine, board, depth=8):
    if engine is None:
        return "互角"
    info = engine.analyse(board, chess.engine.Limit(depth=depth))
    score = info["score"].pov(chess.WHITE)
    return format_position_eval(score.score(mate_score=10000), mate=score.mate())


def format_position_eval(cp, mate=None):
    if mate is not None:
        side = "White" if mate > 0 else "Black"
        return f"{side} mate in {abs(mate)}"
    if cp is None or abs(cp) <= 20:
        return "互角"
    side = "White" if cp > 0 else "Black"
    return f"{side} +{abs(cp) / 100:.1f}"


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
