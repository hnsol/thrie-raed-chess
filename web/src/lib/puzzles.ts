// thrie_raed_chess/puzzles.py の移植。
//
// puzzles.json(Lichess 由来の詰めチェス集)を遅延ロードし、難易度別取得や
// 3択生成を提供する。python-chess の Board/Move は chess.js に置き換える。

import { Chess } from "chess.js";
import type { Choice, Move } from "./boardmodel";
import { defaultRng, shuffle, type Rng } from "./rng";

export interface Puzzle {
  id: string;
  mate_in: number;
  title: string;
  fen: string;
  solution: string[]; // UCI 文字列の列(自分の手→相手の応手→…)
  rating: number;
  source: string;
}

// 3択の1つ。boardmodel の Choice 互換(move: {from,to}) に加え、
// UCI・SAN・正解フラグを持つ。
export interface PuzzleChoice extends Choice {
  move: Move & { promotion?: string };
  uci: string;
  san: string;
  color: string; // "green"(正解) | "yellow"(不正解) 相当
  correct: boolean;
}

let cache: Puzzle[] | null = null;

// puzzles.json を dynamic import で遅延ロードし、キャッシュする。
export async function loadPuzzles(): Promise<Puzzle[]> {
  if (cache === null) {
    const mod = await import("../data/puzzles.json");
    cache = (mod.default ?? mod) as unknown as Puzzle[];
  }
  return cache;
}

// テスト用: ロード済みキャッシュを直接差し替える/クリアする。
export function setPuzzlesCache(puzzles: Puzzle[] | null): void {
  cache = puzzles;
}

export function puzzleBoard(puzzle: Puzzle): Chess {
  return new Chess(puzzle.fen);
}

export function mateLabel(puzzle: Puzzle): string {
  return `mate in ${puzzle.mate_in}`;
}

export async function getPuzzlesByDifficulty(mateIn: number): Promise<Puzzle[]> {
  const puzzles = await loadPuzzles();
  return puzzles.filter((p) => p.mate_in === mateIn);
}

export async function findPuzzleById(puzzleId: string): Promise<Puzzle | null> {
  const puzzles = await loadPuzzles();
  return puzzles.find((p) => p.id === puzzleId) ?? null;
}

// UCI 文字列を {from,to,promotion} に分解する。
export function parseUci(uci: string): Move & { promotion?: string } {
  const from = uci.slice(0, 2);
  const to = uci.slice(2, 4);
  const promotion = uci.length > 4 ? uci[4] : undefined;
  return promotion ? { from, to, promotion } : { from, to };
}

// board(chess.js インスタンス)から PuzzleChoice を1件作る。
function toChoice(chess: Chess, uci: string, correct: boolean): PuzzleChoice {
  const verbose = chess.moves({ verbose: true }).find((m) => m.lan === uci);
  const parsed = parseUci(uci);
  return {
    move: parsed,
    uci,
    san: verbose ? verbose.san : uci,
    color: correct ? "green" : "yellow",
    correct,
  };
}

// puzzles.py の pick_puzzle_three 移植。
// 正解 + ランダムに選んだ他の合法手2つ、計3件をシャッフルして返す。
// Python 版の構成(正解1 + rest から先頭2件)・シャッフル手順に忠実。
export function pickPuzzleThree(
  chess: Chess,
  correctUci: string,
  rng: Rng = defaultRng,
): PuzzleChoice[] {
  const restUci = chess
    .moves({ verbose: true })
    .map((m) => m.lan)
    .filter((lan) => lan !== correctUci);
  shuffle(restUci, rng);

  const choices: PuzzleChoice[] = [toChoice(chess, correctUci, true)];
  for (const uci of restUci.slice(0, 2)) {
    choices.push(toChoice(chess, uci, false));
  }
  shuffle(choices, rng);
  return choices;
}
