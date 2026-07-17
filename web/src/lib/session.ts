// thrie_raed_chess/session.py の移植。
//
// UI 非依存のゲーム進行の状態機械。BattleSession / PuzzleSession は盤面・選択肢・
// フェーズだけを保持し、描画やキー入力は一切行わない。BattleSession のみ
// エンジン(UciClient)を必要とする。

import { Chess } from "chess.js";
import {
  parseUci,
  pickPuzzleThree,
  puzzleBoard,
  type Puzzle,
  type PuzzleChoice,
} from "./puzzles";
import {
  evaluateAllMoves,
  formatPositionEvalFromPov,
  moveFacts,
  pickThree,
  whiteCp,
  type EvaluatedMove,
  type MoveColor,
} from "./evaluation";
import { BattleStats } from "./stats";
import type { UciClient } from "../engine/uci-client";
import { CPU_LEVELS } from "../config";
import { defaultRng, type Rng } from "./rng";

// ── 対戦モード ────────────────────────────────────────────────────────────

export enum BattlePhase {
  HUMAN_CHOOSING = "HUMAN_CHOOSING", // 3択を提示中
  REVEALED = "REVEALED", // 指した後、色/差/事実を開示中
  CPU_THINKING = "CPU_THINKING", // CPU 手番を起動済み(思考中。再入防止)
  GAME_OVER = "GAME_OVER",
}

export type Color = "w" | "b";

// apply_choice が返す全候補の開示情報。
export interface RevealedChoice {
  uci: string;
  san: string;
  loss: number;
  color: MoveColor;
  facts: string[];
  isChosen: boolean;
}

// 終局理由を1行の日本語メッセージにする(announce_result 相当)。
export function outcomeMessage(
  board: Chess,
  humanColor: Color = "w",
): string {
  if (board.isCheckmate()) {
    const loserIsHuman = board.turn() === humanColor;
    const winner = loserIsHuman ? "CPU" : "あなた";
    return `チェックメイト! 勝者: ${winner}`;
  }
  if (board.isStalemate()) return "ステイルメイト(引き分け)";
  if (board.isInsufficientMaterial()) return "駒不足で引き分け";
  if (board.isDraw()) return "引き分け(反復/50手ルール)";
  return "終了";
}

// board.result(claim_draw=True) 相当の結果文字列。
function resultString(board: Chess): string {
  if (board.isCheckmate()) return board.turn() === "w" ? "0-1" : "1-0";
  if (board.isStalemate() || board.isInsufficientMaterial() || board.isDraw()) {
    return "1/2-1/2";
  }
  return "*";
}

export interface BattleOptions {
  board?: Chess;
  stats?: BattleStats;
  humanColor?: Color;
  cpuSkill?: number;
  cpuDepth?: number;
  rng?: Rng;
}

export class BattleSession {
  board: Chess;
  stats: BattleStats;
  humanColor: Color;
  cpuSkill: number; // 相手 CPU の強さ 0(最弱)〜20(最強)
  cpuDepth: number; // 相手 CPU の読みの深さ
  phase: BattlePhase = BattlePhase.HUMAN_CHOOSING;
  choices: EvaluatedMove[] = [];
  positionEval = "互角";
  positionEvalCp = 0; // 評価バー用: 白 POV のセンチポーン(mate は ±10000 スケール)
  focusedIdx: number | null = null;
  chosenIdx: number | null = null;
  result = "*";
  termination = "Unfinished";
  private rng: Rng;

  constructor(opts: BattleOptions = {}) {
    this.board = opts.board ?? new Chess();
    this.stats = opts.stats ?? new BattleStats();
    this.humanColor = opts.humanColor ?? "w";
    // 既定は CPU_LEVELS の初級相当。
    this.cpuSkill = opts.cpuSkill ?? CPU_LEVELS[1].skill;
    this.cpuDepth = opts.cpuDepth ?? CPU_LEVELS[1].depth;
    this.rng = opts.rng ?? defaultRng;
  }

  // 人間の手番の開始。3択と局面評価を用意する。
  async prepareChoices(
    client: UciClient,
    onProgress?: (depth: number) => void,
  ): Promise<EvaluatedMove[]> {
    const evaluated = await evaluateAllMoves(client, this.board, onProgress);
    this.choices = pickThree(evaluated, this.rng);
    // 追加解析はせず best 手(手番側 POV)のスコアを白 POV に変換して表示。
    if (evaluated.length > 0) {
      const turn = this.board.turn();
      this.positionEval = formatPositionEvalFromPov(evaluated[0].scorePov, turn);
      this.positionEvalCp = whiteCp(evaluated[0].scorePov, turn);
    } else {
      this.positionEval = "互角";
      this.positionEvalCp = 0;
    }
    this.phase = BattlePhase.HUMAN_CHOOSING;
    this.focusedIdx = null;
    this.chosenIdx = null;
    return this.choices;
  }

  // 3択のうち1手をプレビュー強調する。
  focus(idx: number): void {
    if (
      this.phase === BattlePhase.HUMAN_CHOOSING &&
      idx >= 0 &&
      idx < this.choices.length
    ) {
      this.focusedIdx = idx;
    }
  }

  // idx の手を確定。全候補の開示情報(RevealedChoice のリスト)を返す。
  applyChoice(idx: number): RevealedChoice[] {
    const revealed: RevealedChoice[] = this.choices.map((c, i) => ({
      uci: c.uci,
      san: c.san,
      loss: c.loss,
      color: c.color,
      facts: moveFacts(this.board, c.uci),
      isChosen: i === idx,
    }));
    const chosen = this.choices[idx];
    this.board.move(parseUci(chosen.uci));
    this.stats.record(chosen.color, chosen.loss);
    this.chosenIdx = idx;
    if (this.board.isGameOver()) {
      this.phase = BattlePhase.GAME_OVER;
      this.result = resultString(this.board);
      this.termination = "Game over";
    } else {
      this.phase = BattlePhase.REVEALED;
    }
    return revealed;
  }

  // CPU 手番の開始宣言。ワーカー起動前に呼び、再入を防ぐ。
  beginCpuTurn(): void {
    this.phase = BattlePhase.CPU_THINKING;
  }

  // CPU の手番。指した手(UCI)を返す。終局なら GAME_OVER へ。
  async applyCpuMove(client: UciClient): Promise<string> {
    const uci = await client.bestMove(this.board.fen(), {
      depth: this.cpuDepth,
      skillLevel: this.cpuSkill,
    });
    this.board.move(parseUci(uci));
    if (this.board.isGameOver()) {
      this.phase = BattlePhase.GAME_OVER;
      this.result = resultString(this.board);
      this.termination = "Game over";
    } else {
      this.phase = BattlePhase.HUMAN_CHOOSING;
    }
    return uci;
  }

  resign(): void {
    this.phase = BattlePhase.GAME_OVER;
    if (this.humanColor === "w") {
      this.result = "0-1";
      this.termination = "White resigned";
    } else {
      this.result = "1-0";
      this.termination = "Black resigned";
    }
  }

  abandon(): void {
    this.phase = BattlePhase.GAME_OVER;
    this.result = "*";
    this.termination = "Abandoned";
  }

  isGameOver(): boolean {
    return this.phase === BattlePhase.GAME_OVER;
  }

  // 終局理由の日本語メッセージ。
  outcomeMessage(): string {
    return outcomeMessage(this.board, this.humanColor);
  }
}

// ── 詰めチェスモード ────────────────────────────────────────────────────────

export enum PuzzlePhase {
  CHOOSING = "CHOOSING",
  SUCCESS = "SUCCESS",
  MISS = "MISS",
  FAIL = "FAIL",
  ABORTED = "ABORTED",
}

// apply_choice の返り値。Python 版と同じ 'correct' | 'miss' | 'fail'。
export type ApplyResult = "correct" | "miss" | "fail";

export class PuzzleSession {
  readonly puzzle: Puzzle;
  board: Chess;
  readonly solution: string[];
  idx = 0;
  phase: PuzzlePhase = PuzzlePhase.CHOOSING;
  choices: PuzzleChoice[] = [];
  focusedIdx: number | null = null;
  finalChoiceIdx: number | null = null;
  private rng: Rng;

  constructor(puzzle: Puzzle, rng: Rng = defaultRng) {
    this.puzzle = puzzle;
    this.board = puzzleBoard(puzzle);
    this.solution = puzzle.solution;
    this.rng = rng;
    this.prepareChoices();
  }

  private prepareChoices(): void {
    const correct = this.solution[this.idx];
    this.choices = pickPuzzleThree(this.board, correct, this.rng);
    this.focusedIdx = null;
  }

  focus(idx: number): void {
    if (
      this.phase === PuzzlePhase.CHOOSING &&
      idx >= 0 &&
      idx < this.choices.length
    ) {
      this.focusedIdx = idx;
    }
  }

  abandon(): void {
    this.phase = PuzzlePhase.ABORTED;
  }

  // idx の手を確定。'correct' | 'miss' | 'fail' を返す。
  applyChoice(idx: number): ApplyResult {
    const move = this.choices[idx].uci;
    const correct = this.solution[this.idx];

    if (move !== correct) {
      this.board.move(parseUci(move));
      this.finalChoiceIdx = idx;
      this.phase = PuzzlePhase.MISS;
      return "miss";
    }

    this.board.move(parseUci(move));
    this.finalChoiceIdx = idx;
    this.idx += 1;
    if (this.board.isCheckmate()) {
      this.phase = PuzzlePhase.SUCCESS;
      return "correct";
    }
    if (this.idx >= this.solution.length) {
      this.phase = PuzzlePhase.FAIL;
      return "fail";
    }
    const reply = this.solution[this.idx];
    const legal = this.board
      .moves({ verbose: true })
      .some((m) => m.lan === reply);
    if (!legal) {
      this.phase = PuzzlePhase.FAIL;
      return "fail";
    }
    this.board.move(parseUci(reply));
    this.idx += 1;
    this.prepareChoices();
    return "correct";
  }

  // 現在の手順番号(1 始まり)。TUI の step_no と同じ。
  get step(): number {
    return Math.floor(this.idx / 2) + 1;
  }

  isFinished(): boolean {
    return this.phase !== PuzzlePhase.CHOOSING;
  }
}
