from pathlib import Path

from textual.app import App

from .screens import MenuScreen


class MoveSenseApp(App):
    CSS_PATH = Path(__file__).with_name("movesense.tcss")
    TITLE = "MoveSense Chess"

    def on_mount(self):
        self.push_screen(MenuScreen())


def run():
    MoveSenseApp().run()


if __name__ == "__main__":
    run()
