import shutil
import subprocess

import chess.pgn

from .config import APP_NAME


def game_pgn(board, result="*", termination="Unfinished", human_color=None):
    game = chess.pgn.Game.from_board(board)
    game.headers["Event"] = APP_NAME
    if human_color == chess.BLACK:
        game.headers["White"] = "CPU"
        game.headers["Black"] = "Human"
    else:
        game.headers["White"] = "Human"
        game.headers["Black"] = "CPU"
    game.headers["Result"] = result
    game.headers["Termination"] = termination
    return str(game)


def game_review_text(board, result="*", termination="Unfinished", human_color=None):
    pgn = game_pgn(board, result=result, termination=termination, human_color=human_color)
    return (
        "この棋譜を見て、初心者向けに改善点を教えてください。\n"
        "特に、悪手・見落とし・駒の動かし方の理解不足がありそうな場面を、"
        "短く具体的に指摘してください。\n\n"
        f"{pgn}"
    )


def copy_to_clipboard(text):
    if not shutil.which("pbcopy"):
        return False
    try:
        subprocess.run(["pbcopy"], input=text, text=True, check=True)
    except (OSError, subprocess.CalledProcessError):
        return False
    return True
