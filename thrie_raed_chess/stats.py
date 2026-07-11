from dataclasses import dataclass, field


@dataclass
class BattleStats:
    moves: int = 0
    counts: dict = field(default_factory=lambda: {"green": 0, "yellow": 0, "red": 0})
    total_loss: int = 0
    last_color: str | None = None
    last_loss: int | None = None
    panel_mode: str = "stats"

    def record(self, color, loss):
        self.moves += 1
        self.counts[color] += 1
        self.total_loss += loss
        self.last_color = color
        self.last_loss = loss

    def lines(self):
        avg = round(self.total_loss / self.moves) if self.moves else 0
        last = "-" if self.last_color is None else f"{self.last_color} {self.last_loss}"
        return [
            "Stats",
            f"Moves {self.moves}",
            f"G/Y/R {self.counts['green']}/{self.counts['yellow']}/{self.counts['red']}",
            f"Avg loss {avg}",
            f"Last {last}",
        ]


def movement_help_lines(stats=None, position_eval=None, panel_mode="help"):
    lines = []
    if position_eval is not None and panel_mode == "stats":
        lines += ["Battle", f"形勢 {position_eval}"]
        if stats is not None:
            lines += stats.lines()
        lines += ["", "x: 動き"]
        return lines
    lines += [
        "動き",
        "♟ Pawn   前1 初手2",
        "         取る=斜め",
        "♞ Knight L字",
        "♝ Bishop 斜め",
        "♜ Rook   縦横",
        "♛ Queen  縦横斜め",
        "♚ King   周囲1",
    ]
    return lines
