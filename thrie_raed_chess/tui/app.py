from pathlib import Path

from textual.app import App

from ..config import DEFAULT_CPU_LEVEL
from .screens import MenuScreen


class ThrieRaedChessApp(App):
    CSS_PATH = Path(__file__).with_name("thrie_raed_chess.tcss")
    TITLE = "Thrie Raed Chess"

    cpu_level_idx = DEFAULT_CPU_LEVEL  # 対戦の難易度(起動中のみ記憶。ファイル保存なし)

    def on_mount(self):
        self.push_screen(MenuScreen())


def run():
    ThrieRaedChessApp().run()


if __name__ == "__main__":
    run()
