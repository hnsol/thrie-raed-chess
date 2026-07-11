import random

import chess
import chess.engine
from rich.text import Text
from textual.containers import Horizontal
from textual.screen import ModalScreen, Screen
from textual.widgets import Footer, Header, Input, Static

from movesense.boardmodel import (
    choice_model,
    lastmove_model,
    piece_glyph,
    puzzle_result_model,
    result_model,
)
from movesense.config import APP_NAME, KEYS, find_stockfish
from movesense.puzzles import PUZZLES, find_puzzle_by_id, get_puzzles_by_difficulty, mate_label
from movesense.review import copy_to_clipboard, game_review_text
from movesense.session import (
    BattlePhase,
    BattleSession,
    PuzzlePhase,
    PuzzleSession,
    outcome_message,
)

from . import theme
from .widgets import BoardWidget, SidePanel

LABELS = {
    "green": "🟢 良い手",
    "yellow": "🟡 普通",
    "red": "🔴 悪い手",
}

FLASH_TICKS = 5           # 直前手のフラッシュ回数(症状③)
FLASH_INTERVAL = 0.15


class MenuScreen(Screen):
    BINDINGS = [
        ("j", "battle", "対戦モード"),
        ("k", "puzzle", "詰めチェス"),
        ("q", "quit", "終了"),
    ]

    def compose(self):
        yield Header()
        yield Static(
            f"=== {APP_NAME} ===\n\n"
            "モード選択\n\n"
            "j  対戦モード\n"
            "k  詰めチェス\n"
            "q  終了",
            id="menu-body",
        )
        yield Footer()

    def action_battle(self):
        self.app.push_screen(BattleScreen())

    def action_puzzle(self):
        self.app.push_screen(PuzzleSelectScreen())

    def action_quit(self):
        self.app.exit()


def _key_badge(idx, focused, dimmed=False):
    """行頭のマーカー＋識別色付きキー記号(例 "→ j)")の Text を作る。

    dimmed は「他の候補がフォーカスされている間、自分は注目されていない」ことを
    示す(盤面の CHOICE_DIMMED と同じ扱い。focused の方が優先)。
    """
    t = Text()
    t.append("→ " if focused else "  ")
    t.append(f"{KEYS[idx]})", style=theme.key_badge_style(idx, dimmed=dimmed and not focused))
    return t


def _choice_line(idx, board, item, focused, dimmed=False):
    move, _loss, _color = item
    san = board.san(move)
    glyph = piece_glyph(board.piece_at(move.from_square))
    frm = chess.square_name(move.from_square)
    to = chess.square_name(move.to_square)
    t = _key_badge(idx, focused, dimmed=dimmed)
    t.append(f" {glyph} {san} ({frm}→{to})")
    return t


def _revealed_line(idx, revealed_choice):
    rc = revealed_choice
    mark = "  ← 選んだ手" if rc.is_chosen else ""
    facts = "、".join(rc.facts)
    factstr = f"  ({facts})" if facts else ""
    t = _key_badge(idx, focused=False)
    t.append(f" {LABELS[rc.color]} {rc.san} (差 {rc.loss}){factstr}{mark}")
    return t


def _cpu_move_status(board_after_push, move):
    glyph = piece_glyph(board_after_push.piece_at(move.to_square))
    frm = chess.square_name(move.from_square)
    to = chess.square_name(move.to_square)
    return f"CPU: {glyph} {frm}→{to}"


class BattleScreen(Screen):
    """対戦モード。3択の常時表示+フォーカス強調(症状②)、直前手のフラッシュ+
    ステータス表示(症状③)、ライブ棋譜パネル(症状④)を統合する。"""

    BINDINGS = [
        ("j", "pick('j')", "選ぶ"),
        ("k", "pick('k')", "選ぶ"),
        ("l", "pick('l')", "選ぶ"),
        ("escape", "deselect", "選択解除"),
        ("x", "toggle_panel", "表示切替"),
        ("r", "resign", "投了"),
        ("q", "quit_battle", "終了"),
    ]

    def __init__(self, engine_factory=None, **kwargs):
        super().__init__(**kwargs)
        self.session = BattleSession()
        self._engine_factory = engine_factory or self._default_engine_factory
        self.engine = None
        self._engine_shut_down = False
        self.last_cpu_move = None
        self._flash_timer = None
        self._flash_ticks_done = 0
        self._flashing = False
        self._game_over_displayed = False

    @staticmethod
    def _default_engine_factory():
        path = find_stockfish()
        if not path:
            return None
        return chess.engine.SimpleEngine.popen_uci(path)

    def compose(self):
        yield Header()
        with Horizontal(id="board-row"):
            yield BoardWidget(id="board")
            yield SidePanel(id="side")
        yield Static(id="status-bar")
        yield Static(id="choice-list")
        yield Footer()

    def on_mount(self):
        self.run_worker(self._boot, thread=True, exclusive=True, group="engine")

    # ---- エンジン起動 -----------------------------------------------------
    def _boot(self):
        self.engine = self._engine_factory()
        self.app.call_from_thread(self._after_boot)

    def _after_boot(self):
        if self.engine is None:
            self.query_one("#status-bar", Static).update(
                "Stockfish が見つかりません。brew install stockfish"
            )
            return
        self._begin_human_turn()

    # ---- 人間の手番 ---------------------------------------------------------
    def _begin_human_turn(self):
        self.query_one("#status-bar", Static).update("考え中…")
        self.run_worker(self._prepare_worker, thread=True, exclusive=True, group="engine")

    def _prepare_worker(self):
        self.session.prepare_choices(self.engine)
        self.app.call_from_thread(self._show_choices)

    def _show_choices(self):
        self._render_choice_board()
        self._render_choice_list()
        side = self.query_one("#side", SidePanel)
        side.update_stats(self.session.stats, self.session.position_eval)
        side.update_guide(self.session.stats, self.session.position_eval)
        self.query_one("#status-bar", Static).update(
            f"形勢 {self.session.position_eval} / どれを指す？"
        )

    def _render_choice_board(self):
        model = {}
        if self.last_cpu_move is not None:
            model.update(lastmove_model(self.session.board, self.last_cpu_move))
        model.update(
            choice_model(self.session.board, self.session.choices, focused_index=self.session.focused_idx)
        )
        self.query_one("#board", BoardWidget).update_board(self.session.board, model)

    def _render_choice_list(self):
        focused_idx = self.session.focused_idx
        lines = [
            _choice_line(
                i, self.session.board, item,
                focused=(focused_idx == i),
                dimmed=(focused_idx is not None and focused_idx != i),
            )
            for i, item in enumerate(self.session.choices)
        ]
        self.query_one("#choice-list", Static).update(Text("\n").join(lines))

    def on_key(self, event):
        if self._flashing:
            return
        if self._game_over_displayed:
            self._game_over_displayed = False
            self._finish_game()
            return
        if self.session.phase == BattlePhase.REVEALED:
            if event.key not in ("q", "x", "r"):
                self._start_cpu_turn()

    def action_deselect(self):
        if self._flashing:
            return
        if self.session.phase == BattlePhase.HUMAN_CHOOSING and self.session.focused_idx is not None:
            self.session.focused_idx = None
            self._render_choice_board()
            self._render_choice_list()

    def action_pick(self, key):
        if self._flashing or self.session.phase != BattlePhase.HUMAN_CHOOSING:
            return
        if key not in KEYS[: len(self.session.choices)]:
            return
        idx = KEYS.index(key)
        if self.session.focused_idx == idx:
            self._commit_choice(idx)
        else:
            self.session.focus(idx)
            self._render_choice_board()
            self._render_choice_list()

    def _commit_choice(self, idx):
        revealed = self.session.apply_choice(idx)
        self._pending_revealed = revealed
        self._pending_chosen_idx = idx
        self.last_cpu_move = None
        self._flash_move(revealed[idx].move, self._after_player_flash)

    def _after_player_flash(self):
        revealed = self._pending_revealed
        idx = self._pending_chosen_idx
        chosen = revealed[idx]
        model = result_model(self.session.board, [(r.move, r.loss, r.color) for r in revealed], idx)
        self.query_one("#board", BoardWidget).update_board(self.session.board, model)
        lines = [_revealed_line(i, rc) for i, rc in enumerate(revealed)]
        self.query_one("#choice-list", Static).update(Text("\n").join(lines))
        self.query_one("#side", SidePanel).move_log.add_move(chosen.san, color=chosen.color)

        if self.session.phase == BattlePhase.GAME_OVER:
            self.query_one("#status-bar", Static).update(
                outcome_message(self.session.board) + "  ─ キーで棋譜へ ─"
            )
            self._game_over_displayed = True
        else:
            self.query_one("#status-bar", Static).update(
                f"あなたの手: {chosen.san}  {LABELS[chosen.color]}(差 {chosen.loss})  "
                "─ キーでCPUの番へ ─"
            )

    # ---- フラッシュ(共通) ---------------------------------------------------
    def _flash_move(self, move, callback):
        self._flashing = True
        self._flash_ticks_done = 0

        def tick():
            self._flash_ticks_done += 1
            visible = self._flash_ticks_done % 2 == 1
            model = lastmove_model(self.session.board, move) if visible else {}
            self.query_one("#board", BoardWidget).update_board(self.session.board, model)
            if self._flash_ticks_done >= FLASH_TICKS:
                self._flash_timer.stop()
                self._flashing = False
                callback()

        self._flash_timer = self.set_interval(FLASH_INTERVAL, tick)

    # ---- CPUの手番 -----------------------------------------------------------
    def _start_cpu_turn(self):
        self.query_one("#status-bar", Static).update("CPU考え中…")
        self.run_worker(self._cpu_worker, thread=True, exclusive=True, group="engine")

    def _cpu_worker(self):
        move = self.session.apply_cpu_move(self.engine)
        self.app.call_from_thread(self._after_cpu_move, move)

    def _after_cpu_move(self, move):
        self.last_cpu_move = move
        board = self.session.board
        self.query_one("#status-bar", Static).update(_cpu_move_status(board, move))
        self.query_one("#side", SidePanel).move_log.add_move(_cpu_san(board, move), color=None)
        if self.session.phase == BattlePhase.GAME_OVER:
            self._flash_move(move, self._show_game_over)
        else:
            self._flash_move(move, self._begin_human_turn)

    def _show_game_over(self):
        self.query_one("#status-bar", Static).update(
            outcome_message(self.session.board) + "  ─ キーで棋譜へ ─"
        )
        self._game_over_displayed = True

    # ---- パネル/終局 -----------------------------------------------------------
    def action_toggle_panel(self):
        self.query_one("#side", SidePanel).cycle_mode()

    def action_resign(self):
        self.session.resign()
        self.query_one("#status-bar", Static).update("投了しました。")
        self._finish_game()

    def action_quit_battle(self):
        if self.session.phase != BattlePhase.GAME_OVER:
            self.session.abandon()
        self.query_one("#status-bar", Static).update("中断しました。")
        self._finish_game()

    def _finish_game(self):
        if self._engine_shut_down:
            return
        self._shutdown_engine()
        text = game_review_text(
            self.session.board, result=self.session.result, termination=self.session.termination
        )
        copied = copy_to_clipboard(text)
        self.app.push_screen(ExportScreen(text, copied))

    def _shutdown_engine(self):
        if self._engine_shut_down:
            return
        self._engine_shut_down = True
        if self._flash_timer is not None:
            self._flash_timer.stop()
        self.workers.cancel_group(self, "engine")
        if self.engine is not None:
            self.engine.quit()

    def on_unmount(self):
        self._shutdown_engine()


def _cpu_san(board_after_push, move):
    tmp = board_after_push.copy()
    tmp.pop()
    return tmp.san(move)


class ExportScreen(ModalScreen):
    """棋譜+レビュー依頼文の表示。閉じるとメニューまで戻る。"""

    BINDINGS = [("q", "close", "閉じる"), ("k", "close", "メニューへ")]

    def __init__(self, text, copied, **kwargs):
        super().__init__(**kwargs)
        self.text = text
        self.copied = copied

    def compose(self):
        note = "クリップボードにコピーしました。" if self.copied else "クリップボードコピーはできませんでした。"
        yield Static(f"{self.text}\n\n{note}", id="export-body")
        yield Footer()

    def action_close(self):
        self.app.pop_screen()  # ExportScreen
        self.app.pop_screen()  # BattleScreen


class PuzzleSelectScreen(Screen):
    """詰めチェス選択メニュー。ランダム/難易度指定/番号指定。"""

    BINDINGS = [
        ("j", "random_puzzle", "ランダム"),
        ("k", "by_difficulty", "難易度指定"),
        ("l", "by_number", "問題番号指定"),
        ("q", "back", "戻る"),
    ]

    def compose(self):
        yield Header()
        yield Static(
            "詰めチェス\n\n"
            "j  ランダム\n"
            "k  難易度指定\n"
            "l  問題番号指定\n"
            "q  戻る",
            id="puzzle-select-body",
        )
        yield Footer()

    def action_random_puzzle(self):
        self.app.push_screen(PuzzleScreen(random.choice(PUZZLES)))

    def action_by_difficulty(self):
        self.app.push_screen(PuzzleDifficultyScreen())

    def action_by_number(self):
        self.app.push_screen(PuzzleNumberScreen())

    def action_back(self):
        self.app.pop_screen()


class PuzzleDifficultyScreen(Screen):
    BINDINGS = [
        ("j", "pick(2)", "mate in 2"),
        ("k", "pick(3)", "mate in 3"),
        ("l", "pick(4)", "mate in 4"),
        ("q", "back", "戻る"),
    ]

    def compose(self):
        yield Header()
        yield Static(
            "難易度\n\n"
            "j  mate in 2\n"
            "k  mate in 3\n"
            "l  mate in 4\n"
            "q  戻る",
            id="puzzle-difficulty-body",
        )
        yield Footer()

    def action_pick(self, mate_in):
        puzzle = random.choice(get_puzzles_by_difficulty(mate_in))
        self.app.pop_screen()
        self.app.push_screen(PuzzleScreen(puzzle))

    def action_back(self):
        self.app.pop_screen()


class PuzzleNumberScreen(Screen):
    BINDINGS = [("escape", "back", "戻る")]

    def compose(self):
        yield Header()
        counts = {n: len(get_puzzles_by_difficulty(n)) for n in (2, 3, 4)}
        yield Static(
            "問題番号\n\n"
            f"mate in 2: {counts[2]}問 / mate in 3: {counts[3]}問 / mate in 4: {counts[4]}問\n"
            f"例: {PUZZLES[0]['id']}",
            id="puzzle-number-info",
        )
        yield Input(placeholder="番号を入力", id="puzzle-number-input")
        yield Static(id="puzzle-number-error")
        yield Footer()

    def on_input_submitted(self, event):
        puzzle = find_puzzle_by_id(event.value.strip())
        if puzzle is None:
            self.query_one("#puzzle-number-error", Static).update("見つかりません。")
            return
        self.app.pop_screen()
        self.app.push_screen(PuzzleScreen(puzzle))

    def action_back(self):
        self.app.pop_screen()


def _puzzle_choice_line(idx, board, item, focused, dimmed=False):
    move, _loss, _color = item
    san = board.san(move)
    side = "White" if board.turn == chess.WHITE else "Black"
    frm = chess.square_name(move.from_square)
    to = chess.square_name(move.to_square)
    t = _key_badge(idx, focused, dimmed=dimmed)
    t.append(f" {side}: {san} ({frm}→{to})")
    return t


_PUZZLE_RESULT_MESSAGES = {
    PuzzlePhase.SUCCESS: "成功。チェックメイトです。",
    PuzzlePhase.MISS: "失敗。別の手を選びました。",
    PuzzlePhase.FAIL: "失敗。規定手数で詰みませんでした。",
    PuzzlePhase.ABORTED: "中断しました。",
}


class PuzzleScreen(Screen):
    """詰めチェス。結果もこの画面内にインラインで表示する。"""

    BINDINGS = [
        ("j", "pick('j')", "選ぶ"),
        ("k", "pick('k')", "選ぶ"),
        ("l", "pick('l')", "選ぶ"),
        ("escape", "deselect", "選択解除"),
        ("h", "retry", "リトライ"),
        ("q", "abandon", "中断"),
    ]

    def __init__(self, puzzle, **kwargs):
        super().__init__(**kwargs)
        self.puzzle = puzzle
        self.session = PuzzleSession(puzzle)
        self.player_color = self.session.board.turn
        self._flashing = False
        self._flash_timer = None
        self._flash_ticks_done = 0

    def compose(self):
        yield Header()
        with Horizontal(id="board-row"):
            yield BoardWidget(id="board")
            yield SidePanel(id="side", modes=("guide",))
        yield Static(id="status-bar")
        yield Static(id="choice-list")
        yield Footer()

    def on_mount(self):
        self._refresh_view()

    def _is_finished(self):
        return self.session.phase in (
            PuzzlePhase.SUCCESS, PuzzlePhase.MISS,
            PuzzlePhase.FAIL, PuzzlePhase.ABORTED,
        )

    def action_deselect(self):
        if self._flashing:
            return
        if self.session.phase == PuzzlePhase.CHOOSING and self.session.focused_idx is not None:
            self.session.focused_idx = None
            self._refresh_view()

    def _refresh_view(self):
        board = self.session.board
        model = {}
        if board.move_stack:
            model.update(lastmove_model(board, board.peek()))
        model.update(
            choice_model(board, self.session.choices, focused_index=self.session.focused_idx)
        )
        self.query_one("#board", BoardWidget).update_board(board, model)
        focused_idx = self.session.focused_idx
        lines = [
            _puzzle_choice_line(
                i, board, item,
                focused=(focused_idx == i),
                dimmed=(focused_idx is not None and focused_idx != i),
            )
            for i, item in enumerate(self.session.choices)
        ]
        self.query_one("#choice-list", Static).update(Text("\n").join(lines))
        step_no = self.session.idx // 2 + 1
        side = "白番" if self.player_color == chess.WHITE else "黒番"
        self.query_one("#status-bar", Static).update(
            f"問題 {self.puzzle['id']}: {mate_label(self.puzzle)}  {self.puzzle['title']}\n"
            f"手順 {step_no}/{self.puzzle['mate_in']}  {side}  詰ませる手は？(評価は開示しません)"
        )

    def action_pick(self, key):
        if self._flashing:
            return
        if self._is_finished():
            if key == 'j':
                self.app.pop_screen()
            elif key == 'k':
                self.app.pop_screen()
                self.app.pop_screen()
            return
        if self.session.phase != PuzzlePhase.CHOOSING:
            return
        if key not in KEYS[: len(self.session.choices)]:
            return
        idx = KEYS.index(key)
        if self.session.focused_idx == idx:
            self._commit(idx)
        else:
            self.session.focus(idx)
            self._refresh_view()

    def _commit(self, idx):
        player_move = self.session.choices[idx][0]
        result = self.session.apply_choice(idx)
        if result == "correct" and self.session.phase == PuzzlePhase.CHOOSING:
            reply = self.session.board.pop()
            self._flash_move(player_move, lambda: self._after_player_flash(reply))
        elif self._is_finished():
            self._flash_move(player_move, self._show_result)
        else:
            self._refresh_view()

    def _after_player_flash(self, reply):
        self.session.board.push(reply)
        self._flash_move(reply, self._refresh_view)

    def _flash_move(self, move, callback):
        self._flashing = True
        self._flash_ticks_done = 0

        def tick():
            self._flash_ticks_done += 1
            visible = self._flash_ticks_done % 2 == 1
            model = lastmove_model(self.session.board, move) if visible else {}
            self.query_one("#board", BoardWidget).update_board(self.session.board, model)
            if self._flash_ticks_done >= FLASH_TICKS:
                self._flash_timer.stop()
                self._flashing = False
                callback()

        self._flash_timer = self.set_interval(FLASH_INTERVAL, tick)

    def _show_result(self):
        board = self.session.board
        model = {}
        if board.move_stack and self.session.final_choice_idx is not None:
            model = puzzle_result_model(board, board.peek(), self.session.final_choice_idx)
        self.query_one("#board", BoardWidget).update_board(board, model)
        self.query_one("#status-bar", Static).update(
            _PUZZLE_RESULT_MESSAGES[self.session.phase]
        )
        self.query_one("#choice-list", Static).update(
            "h  リトライ\nj  別の問題\nk  メニューへ戻る\nq  終了"
        )

    def action_abandon(self):
        if self._flashing:
            return
        if self._is_finished():
            self.app.exit()
            return
        self.session.abandon()
        self._show_result()

    def action_retry(self):
        if self._flashing or not self._is_finished():
            return
        self.app.pop_screen()
        self.app.push_screen(PuzzleScreen(self.puzzle))
