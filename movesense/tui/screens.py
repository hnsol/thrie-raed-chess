from textual.screen import Screen
from textual.widgets import Footer, Header, Static

from movesense.config import APP_NAME


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
        pass  # Step 7 で BattleScreen に差し替え

    def action_puzzle(self):
        pass  # Step 8 で PuzzleSelectScreen に差し替え

    def action_quit(self):
        self.app.exit()
