from pathlib import Path

from textual.app import App

from .screens import MenuScreen


class ThrieRaedChessApp(App):
    CSS_PATH = Path(__file__).with_name("thrie_raed_chess.tcss")
    TITLE = "Thrie Raed Chess"

    def on_mount(self):
        self.push_screen(MenuScreen())


def run():
    ThrieRaedChessApp().run()


if __name__ == "__main__":
    run()
