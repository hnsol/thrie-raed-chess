import os
import shutil

APP_NAME = "Thrie Raed Chess"


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

# 画面の3択(左・中・右)に対応するキー
KEYS = ["j", "k", "l"]
MENU_KEYS = {"j", "k", "l", "q"}
RESULT_KEYS = {"h", "j", "k", "q"}
