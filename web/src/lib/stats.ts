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

// 駒の動かし方(下部シート用)。stats.py の movement_help_lines() を日本語で移植。
// アイコンは Unicode グリフではなく盤と同じ SVG 駒(code)を使う。
// (♟ U+265F は iOS 等で絵文字として描画され、他の駒と見た目が揃わないため)
export interface PieceHelp {
  code: string; // public/pieces/<code>.svg
  name: string;
  move: string;
}

export const MOVEMENT_HELP: PieceHelp[] = [
  { code: "wP", name: "ポーン", move: "前へ1マス(初手のみ2マス)。取るときは斜め前。" },
  { code: "wN", name: "ナイト", move: "L字(2+1マス)。駒を飛び越せる。" },
  { code: "wB", name: "ビショップ", move: "斜めに何マスでも。" },
  { code: "wR", name: "ルーク", move: "縦・横に何マスでも。" },
  { code: "wQ", name: "クイーン", move: "縦・横・斜めに何マスでも。" },
  { code: "wK", name: "キング", move: "周囲1マス。" },
];
