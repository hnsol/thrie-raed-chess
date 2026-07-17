// thrie_raed_chess/session.py の移植(パズル部分)。
//
// UI 非依存のゲーム進行の状態機械。PuzzleSession は盤面・選択肢・フェーズだけを
// 保持し、描画やキー入力は一切行わない。
//
// BattleSession はマイルストーン M4 で実装する。ここではファイル構成のみ用意し、
// PuzzleSession を忠実移植する。エンジンは不要。

import { Chess } from "chess.js";
import {
  parseUci,
  pickPuzzleThree,
  puzzleBoard,
  type Puzzle,
  type PuzzleChoice,
} from "./puzzles";
import { defaultRng, type Rng } from "./rng";

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
