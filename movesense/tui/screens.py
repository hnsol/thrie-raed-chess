import chess
import chess.engine
from textual.containers import Horizontal
from textual.screen import ModalScreen, Screen
from textual.widgets import Footer, Header, Static

from movesense.boardmodel import choice_model, lastmove_model, piece_glyph, result_model
from movesense.config import APP_NAME, KEYS, find_stockfish
from movesense.review import copy_to_clipboard, game_review_text
from movesense.session import BattlePhase, BattleSession, outcome_message

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
        pass  # Step 8 で PuzzleSelectScreen に差し替え

    def action_quit(self):
        self.app.exit()


def _choice_line(idx, board, item, focused):
    move, _loss, _color = item
    san = board.san(move)
    glyph = piece_glyph(board.piece_at(move.from_square))
    frm = chess.square_name(move.from_square)
    to = chess.square_name(move.to_square)
    marker = "→" if focused else " "
    return f"{marker} {KEYS[idx]}) {glyph} {san} ({frm}→{to})"


def _revealed_line(idx, revealed_choice):
    rc = revealed_choice
    mark = "  ← 選んだ手" if rc.is_chosen else ""
    facts = "、".join(rc.facts)
    factstr = f"  ({facts})" if facts else ""
    return f"  {KEYS[idx]}) {LABELS[rc.color]} {rc.san} (差 {rc.loss}){factstr}{mark}"


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

    @staticmethod
    def _default_engine_factory():
        path = find_stockfish()
        if not path:
            return None
        return chess.engine.SimpleEngine.popen_uci(path)

    def compose(self):
        yield Header()
        with Horizontal():
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
        lines = [
            _choice_line(i, self.session.board, item, focused=(self.session.focused_idx == i))
            for i, item in enumerate(self.session.choices)
        ]
        self.query_one("#choice-list", Static).update("\n".join(lines))

    def action_pick(self, key):
        if self.session.phase == BattlePhase.REVEALED:
            self._start_cpu_turn()
            return
        if self.session.phase != BattlePhase.HUMAN_CHOOSING:
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
        chosen = revealed[idx]
        self.last_cpu_move = None
        model = result_model(self.session.board, [(r.move, r.loss, r.color) for r in revealed], idx)
        self.query_one("#board", BoardWidget).update_board(self.session.board, model)
        lines = [_revealed_line(i, rc) for i, rc in enumerate(revealed)]
        self.query_one("#choice-list", Static).update("\n".join(lines))
        self.query_one("#side", SidePanel).move_log.add_move(chosen.san, color=chosen.color)

        if self.session.phase == BattlePhase.GAME_OVER:
            self.query_one("#status-bar", Static).update(outcome_message(self.session.board))
            self._finish_game()
        else:
            self.query_one("#status-bar", Static).update(
                f"あなたの手: {chosen.san}  {LABELS[chosen.color]}(差 {chosen.loss})  "
                "─ もう一度キーでCPUの番へ ─"
            )

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
            self.query_one("#status-bar", Static).update(outcome_message(self.session.board))
            self._finish_game()
        else:
            self._flash_lastmove(move)

    def _flash_lastmove(self, move):
        self._flash_ticks_done = 0

        def tick():
            self._flash_ticks_done += 1
            visible = self._flash_ticks_done % 2 == 1
            model = lastmove_model(self.session.board, move) if visible else {}
            self.query_one("#board", BoardWidget).update_board(self.session.board, model)
            if self._flash_ticks_done >= FLASH_TICKS:
                self._flash_timer.stop()
                self._begin_human_turn()

        self._flash_timer = self.set_interval(FLASH_INTERVAL, tick)

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
