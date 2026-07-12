"""対戦モードのコーチコメント生成(UI非依存)。

手ごとの損失(センチポーン差)に応じ、感嘆句×本文プールを合成して
褒め/励ましコメントを作る。テンプレ合成＋履歴回避で多彩な表現にする。
"""

import random
from collections import deque

import chess

from .config import GREEN_MAX, YELLOW_MAX

# ポーン以外の駒価値(キング除く)。終盤判定に使う。
_PIECE_VALUE = {chess.KNIGHT: 3, chess.BISHOP: 3, chess.ROOK: 5, chess.QUEEN: 9}


def tier_of(loss):
    """損失値から段階を判定する。"""
    if loss <= 0:
        return "BRILLIANT"
    if loss <= GREEN_MAX:        # 1-30
        return "EXCELLENT"
    if loss <= 80:
        return "GOOD"
    if loss <= YELLOW_MAX:       # 81-150
        return "SOSO"
    if loss <= 300:
        return "ROUGH"
    return "BLUNDER"


def game_phase(board):
    """局面を序盤/中盤/終盤に分ける。"""
    white_q = bool(board.pieces(chess.QUEEN, chess.WHITE))
    black_q = bool(board.pieces(chess.QUEEN, chess.BLACK))
    if board.fullmove_number <= 10 and white_q and black_q:
        return "opening"
    total = 0
    for ptype, val in _PIECE_VALUE.items():
        total += val * len(board.pieces(ptype, chess.WHITE))
        total += val * len(board.pieces(ptype, chess.BLACK))
    if total <= 13:
        return "endgame"
    return "middlegame"


# 段階ごとの感嘆句
_EXCLAIM = {
    "BRILLIANT": ["お見事！", "完璧！", "最高！", "神の一手！", "文句なし！",
                  "ブラボー！", "圧巻！", "素晴らしい！", "見事すぎ！", "パーフェクト！"],
    "EXCELLENT": ["ナイス！", "いいね！", "上手い！", "冴えてる！", "good！",
                  "やるね！", "鋭い！", "その調子！", "見事！", "さすが！"],
    "GOOD": ["悪くない！", "いい判断！", "OK！", "堅実！", "まずまず良い！",
             "しっかり！", "手堅い！", "いい感じ！", "順調！", "落ち着いてる！"],
    "SOSO": ["まずまず！", "ぼちぼち！", "悪くはない！", "ここから！", "耐えてる！",
             "粘ろう！", "焦らず！", "大丈夫！", "五分五分！", "続けよう！"],
    "ROUGH": ["ドンマイ！", "気にしない！", "切り替え！", "まだいける！", "落ち着こう！",
              "次だ次！", "顔上げて！", "取り返そう！", "諦めない！", "巻き返そう！"],
    "BLUNDER": ["ドンマイ！", "大丈夫、次！", "誰でもある！", "気を取り直そう！", "元気出して！",
                "ここからだ！", "まだ終わらない！", "顔を上げて！", "深呼吸！", "立て直そう！"],
}

# 段階ごとの本文(汎用)
_BODY = {
    "BRILLIANT": ["理想の一手だ！", "これぞ最善！", "非の打ち所なし！", "完璧な選択！",
                  "読み切ってる！", "一切の緩みなし！", "会心の手！", "見事な決断！",
                  "エンジンも唸る！", "文句なしの手！", "光る一手！", "冴え渡ってる！"],
    "EXCELLENT": ["ほぼ最善だ！", "とても良い手！", "筋がいい！", "好判断だね！",
                  "着実に良い！", "感覚が鋭い！", "いい流れ！", "上達してる！",
                  "自信持って！", "正着に近い！", "手応えあり！", "冴えてるね！"],
    "GOOD": ["前向きな手だ！", "悪くない選択！", "十分戦える！", "方向性は良い！",
             "堅実な一手！", "問題ない手！", "戦いは続く！", "崩れてない！",
             "落ち着いていこう！", "地に足ついてる！", "悪くない流れ！", "これで良し！"],
    "SOSO": ["まずまずの手！", "ここは我慢！", "五分の勝負！", "焦らず行こう！",
             "立て直せる！", "耐える場面だ！", "粘り強く！", "挽回できる！",
             "気持ちを保とう！", "まだ大丈夫！", "冷静にいこう！", "続けていこう！"],
    "ROUGH": ["少し痛いが次！", "取り返せる！", "気持ち切り替え！", "まだ勝負だ！",
              "諦めるのは早い！", "落ち着いて挽回！", "一手ずつ丁寧に！", "顔を上げよう！",
              "巻き返しは可能！", "集中を保とう！", "深呼吸して次！", "ここから粘ろう！"],
    "BLUNDER": ["次で取り返そう！", "誰にでもある！", "気を取り直そう！", "まだ諦めない！",
                "学びに変えよう！", "落ち着いて指そう！", "一手ずつ立て直し！", "顔を上げて次！",
                "勝負はこれから！", "気持ちを新たに！", "深呼吸して集中！", "前を向こう！"],
}

# フェーズ固有の本文(該当フェーズのみ候補に合流)
_PHASE_BODY = {
    "opening": ["展開が早い！", "センター意識いいね！", "駒組みが自然！", "出だし好調！"],
    "middlegame": ["攻めの形が見えてる！", "中盤の構想が良い！", "駒がよく働いてる！",
                   "主導権を握れそう！"],
    "endgame": ["キングの活用が光る！", "寄せの感覚ある！", "終盤の底力！",
                "ポーンの押し上げ good！"],
}

# facts 言及句(好手時)。fact 文字列 -> 言及句リスト
_FACT_GOOD = {
    "駒を取る": ["駒得もバッチリ！", "しっかり駒得！", "得したね！"],
    "王手": ["王手で圧をかけた！", "王手が刺さる！", "攻めの王手！"],
    "成る": ["昇格が決まった！", "成りで一気に有利！", "クイーン誕生！"],
    "キャスリング": ["王様の安全確保！", "キャスリング good！", "囲いが完成！"],
}

# facts 言及句(悪手時)
_FACT_BAD = {
    "取られる位置(守りなし)": ["タダ取られに注意、次いこう！", "守りなしはヒヤリ、次だ！",
                       "そこは危ない、切り替え！"],
}

# ストリーク時のエスカレート句
_STREAK_BODY = ["止まらない！", "波に乗ってる！", "絶好調！", "この勢いだ！",
                "手が付けられない！", "ノリノリだね！"]


class CoachCommenter:
    """手ごとに褒め/励ましコメントを生成する。"""

    def __init__(self, rng: random.Random | None = None):
        self.rng = rng if rng is not None else random.Random()
        # 直近使用の感嘆句・本文を別々に記録して連続重複を避ける
        self._recent_exclaim = deque(maxlen=4)
        self._recent_body = deque(maxlen=4)
        self._green_streak = 0

    def _pick(self, pool, history):
        """history に無い候補を優先して1つ選ぶ。無ければ全体から選ぶ。"""
        fresh = [x for x in pool if x not in history]
        chosen = self.rng.choice(fresh if fresh else pool)
        history.append(chosen)
        return chosen

    def comment(self, loss, color, facts, board) -> str:
        """損失・色・事実・局面からコメント文字列を合成する。"""
        tier = tier_of(loss)
        is_green = loss <= GREEN_MAX
        # ストリーク更新
        if is_green:
            self._green_streak += 1
        else:
            self._green_streak = 0

        body = None

        # 悪手時: タダ取られ等の警告を優先(50%)
        if color == "red":
            for f in facts:
                if f in _FACT_BAD and self.rng.random() < 0.5:
                    body = self.rng.choice(_FACT_BAD[f])
                    break

        # 好手時: facts 言及句を確率的に採用(50%)
        if body is None and is_green:
            good = [f for f in facts if f in _FACT_GOOD]
            if good and self.rng.random() < 0.5:
                f = self.rng.choice(good)
                body = self.rng.choice(_FACT_GOOD[f])

        # ストリーク3連続以上でエスカレート句(50%)
        if body is None and self._green_streak >= 3 and self.rng.random() < 0.5:
            pool = _STREAK_BODY + [f"{self._green_streak}連続の好手！"]
            body = self._pick(pool, self._recent_body)

        # 通常本文(フェーズ固有句を合流)
        if body is None:
            pool = list(_BODY[tier])
            if is_green:
                pool += _PHASE_BODY.get(game_phase(board), [])
            body = self._pick(pool, self._recent_body)

        exclaim = self._pick(_EXCLAIM[tier], self._recent_exclaim)
        return f"{exclaim}{body}"
