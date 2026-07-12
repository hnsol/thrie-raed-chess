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

# 対戦CPUの難易度プリセット (表示名, Skill Level 0-20, 読みの深さ)
CPU_LEVELS = [
    ("入門", 0, 4),
    ("初級", 3, 6),
    ("中級", 8, 8),
    ("上級", 13, 10),
    ("最強", 20, 12),
]
DEFAULT_CPU_LEVEL = 1  # 初級（従来のデフォルト相当）

# 色分けのしきい値(センチポーン=歩1枚≒100)。best手からの損失で判定
GREEN_MAX  = 30          # 損失これ以下 → 緑(ほぼ最善)
YELLOW_MAX = 150         # ここまで → 黄、超えたら → 赤

# 画面の3択(左・中・右)に対応するキー
KEYS = ["j", "k", "l"]
MENU_KEYS = {"j", "k", "l", "q"}
RESULT_KEYS = {"h", "j", "k", "q"}
