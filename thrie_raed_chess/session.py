"""UI非依存のゲーム進行の状態機械。

BattleSession / PuzzleSession は盤面・選択肢・フェーズだけを保持し、
描画やキー入力は一切行わない。
両方から同じ進行ロジックを呼び出せるようにするための層。
"""

from dataclasses import dataclass, field
from enum import Enum, auto

import chess
import chess.engine

from .config import CPU_DEPTH, CPU_SKILL
from .evaluation import evaluate_all_moves, evaluate_position, move_facts, pick_three
from .puzzles import pick_puzzle_three, puzzle_board
from .stats import BattleStats


class BattlePhase(Enum):
    HUMAN_CHOOSING = auto()   # 3択を提示中(focused_idx でプレビュー強調も可)
    REVEALED = auto()         # 指した後、色/差/事実を開示中
    GAME_OVER = auto()


@dataclass
class RevealedChoice:
    move: chess.Move
    san: str
    loss: int
    color: str
    facts: list
    is_chosen: bool


def outcome_message(board, human_color=chess.WHITE):
    """終局理由を1行の日本語メッセージにする(announce_result相当)。"""
    if board.is_checkmate():
        loser_is_human = board.turn == human_color
        winner = "CPU" if loser_is_human else "あなた"
        return f"チェックメイト! 勝者: {winner}"
    if board.is_stalemate():
        return "ステイルメイト(引き分け)"
    if board.is_insufficient_material():
        return "駒不足で引き分け"
    if board.can_claim_draw():
        return "引き分け(反復/50手ルール)"
    return "終了"


class BattleSession:
    def __init__(self, board=None, stats=None, human_color=chess.WHITE):
        self.board = board if board is not None else chess.Board()
        self.stats = stats if stats is not None else BattleStats()
        self.human_color = human_color
        self.phase = BattlePhase.HUMAN_CHOOSING
        self.choices = []          # [(move, loss, color)]
        self.position_eval = "互角"
        self.focused_idx = None
        self.chosen_idx = None
        self.result = "*"
        self.termination = "Unfinished"

    def prepare_choices(self, engine):
        """人間の手番の開始。3択と局面評価を用意する。"""
        evaluated = evaluate_all_moves(engine, self.board)
        self.choices = pick_three(evaluated)
        self.position_eval = evaluate_position(engine, self.board)
        self.phase = BattlePhase.HUMAN_CHOOSING
        self.focused_idx = None
        self.chosen_idx = None
        return self.choices

    def focus(self, idx):
        """症状②: 3択のうち1手をプレビュー強調する。"""
        if self.phase == BattlePhase.HUMAN_CHOOSING and 0 <= idx < len(self.choices):
            self.focused_idx = idx

    def apply_choice(self, idx):
        """idx の手を確定。全候補の開示情報(RevealedChoice のリスト)を返す。"""
        revealed = [
            RevealedChoice(
                move=mv,
                san=self.board.san(mv),
                loss=loss,
                color=color,
                facts=move_facts(self.board, mv),
                is_chosen=(i == idx),
            )
            for i, (mv, loss, color) in enumerate(self.choices)
        ]
        move, loss, color = self.choices[idx]
        self.board.push(move)
        self.stats.record(color, loss)
        self.chosen_idx = idx
        if self.board.is_game_over():
            self.phase = BattlePhase.GAME_OVER
            self.result = self.board.result(claim_draw=True)
            self.termination = "Game over"
        else:
            self.phase = BattlePhase.REVEALED
        return revealed

    def apply_cpu_move(self, engine):
        """CPUの手番。指した手を返す。終局ならGAME_OVERへ。"""
        result = engine.play(
            self.board,
            chess.engine.Limit(depth=CPU_DEPTH),
            options={"Skill Level": CPU_SKILL},
        )
        move = result.move
        self.board.push(move)
        if self.board.is_game_over():
            self.phase = BattlePhase.GAME_OVER
            self.result = self.board.result(claim_draw=True)
            self.termination = "Game over"
        else:
            self.phase = BattlePhase.HUMAN_CHOOSING
        return move

    def resign(self):
        self.phase = BattlePhase.GAME_OVER
        if self.human_color == chess.WHITE:
            self.result = "0-1"
            self.termination = "White resigned"
        else:
            self.result = "1-0"
            self.termination = "Black resigned"

    def abandon(self):
        self.phase = BattlePhase.GAME_OVER
        self.result = "*"
        self.termination = "Abandoned"


class PuzzlePhase(Enum):
    CHOOSING = auto()
    SUCCESS = auto()
    MISS = auto()
    FAIL = auto()
    ABORTED = auto()


class PuzzleSession:
    def __init__(self, puzzle):
        self.puzzle = puzzle
        self.board = puzzle_board(puzzle)
        self.solution = puzzle["solution"]
        self.idx = 0
        self.phase = PuzzlePhase.CHOOSING
        self.choices = []
        self.focused_idx = None
        self.final_choice_idx = None
        self._prepare_choices()

    def _prepare_choices(self):
        correct = chess.Move.from_uci(self.solution[self.idx])
        self.choices = pick_puzzle_three(self.board, correct)
        self.focused_idx = None

    def focus(self, idx):
        if self.phase == PuzzlePhase.CHOOSING and 0 <= idx < len(self.choices):
            self.focused_idx = idx

    def abandon(self):
        self.phase = PuzzlePhase.ABORTED

    def apply_choice(self, idx):
        """idx の手を確定。'correct' | 'miss' | 'fail' を返す。"""
        move, _, _ = self.choices[idx]
        correct = chess.Move.from_uci(self.solution[self.idx])
        if move != correct:
            self.board.push(move)
            self.final_choice_idx = idx
            self.phase = PuzzlePhase.MISS
            return "miss"

        self.board.push(move)
        self.final_choice_idx = idx
        self.idx += 1
        if self.board.is_checkmate():
            self.phase = PuzzlePhase.SUCCESS
            return "correct"
        if self.idx >= len(self.solution):
            self.phase = PuzzlePhase.FAIL
            return "fail"
        reply = chess.Move.from_uci(self.solution[self.idx])
        if reply not in self.board.legal_moves:
            self.phase = PuzzlePhase.FAIL
            return "fail"
        self.board.push(reply)
        self.idx += 1
        self._prepare_choices()
        return "correct"
