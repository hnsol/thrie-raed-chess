// thrie_raed_chess/stats.py の BattleStats 移植。
//
// 対戦中の手の色分け(green/yellow/red)集計と平均損失を保持する。UI 非依存。

import type { MoveColor } from "./evaluation";

export interface BattleSummary {
  moves: number;
  green: number;
  yellow: number;
  red: number;
  totalLoss: number;
  avgLoss: number;
  lastColor: MoveColor | null;
  lastLoss: number | null;
}

export class BattleStats {
  moves = 0;
  counts: Record<MoveColor, number> = { green: 0, yellow: 0, red: 0 };
  totalLoss = 0;
  lastColor: MoveColor | null = null;
  lastLoss: number | null = null;

  record(color: MoveColor, loss: number): void {
    this.moves += 1;
    this.counts[color] += 1;
    this.totalLoss += loss;
    this.lastColor = color;
    this.lastLoss = loss;
  }

  // 平均損失(センチポーン、四捨五入)。手数 0 なら 0。
  get avgLoss(): number {
    return this.moves ? Math.round(this.totalLoss / this.moves) : 0;
  }

  // Python 版 lines() 相当(TUI 互換の表示行)。
  lines(): string[] {
    const last =
      this.lastColor === null ? "-" : `${this.lastColor} ${this.lastLoss}`;
    return [
      "Stats",
      `Moves ${this.moves}`,
      `G/Y/R ${this.counts.green}/${this.counts.yellow}/${this.counts.red}`,
      `Avg loss ${this.avgLoss}`,
      `Last ${last}`,
    ];
  }

  // 構造化サマリ(UI 用)。
  summary(): BattleSummary {
    return {
      moves: this.moves,
      green: this.counts.green,
      yellow: this.counts.yellow,
      red: this.counts.red,
      totalLoss: this.totalLoss,
      avgLoss: this.avgLoss,
      lastColor: this.lastColor,
      lastLoss: this.lastLoss,
    };
  }
}
