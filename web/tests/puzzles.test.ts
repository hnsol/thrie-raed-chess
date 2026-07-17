import { describe, it, expect } from "vitest";
import { Chess } from "chess.js";
import { pickPuzzleThree, parseUci } from "../src/lib/puzzles";
import { mulberry32 } from "../src/lib/rng";

// 手作りの合法手が十分ある局面(バックランクメイト題材)。
const FEN = "6k1/5ppp/8/8/8/8/8/4R2K w - - 0 1";
const CORRECT = "e1e8";

describe("pickPuzzleThree", () => {
  it("正解を必ず含み、3件・重複なし", () => {
    const chess = new Chess(FEN);
    const choices = pickPuzzleThree(chess, CORRECT, mulberry32(1));

    expect(choices).toHaveLength(3);
    // 正解フラグは1件だけで、その uci が正解
    const corrects = choices.filter((c) => c.correct);
    expect(corrects).toHaveLength(1);
    expect(corrects[0].uci).toBe(CORRECT);
    // uci に重複がない
    const ucis = choices.map((c) => c.uci);
    expect(new Set(ucis).size).toBe(3);
  });

  it("すべて合法手で SAN と move({from,to}) を持つ", () => {
    const chess = new Chess(FEN);
    const legal = new Set(
      chess.moves({ verbose: true }).map((m) => m.lan),
    );
    const choices = pickPuzzleThree(chess, CORRECT, mulberry32(7));
    for (const c of choices) {
      expect(legal.has(c.uci)).toBe(true);
      expect(c.san.length).toBeGreaterThan(0);
      expect(c.move.from).toBe(parseUci(c.uci).from);
      expect(c.move.to).toBe(parseUci(c.uci).to);
    }
  });

  it("seeded rng で決定的(同一 seed は同一結果)", () => {
    const a = pickPuzzleThree(new Chess(FEN), CORRECT, mulberry32(42)).map(
      (c) => c.uci,
    );
    const b = pickPuzzleThree(new Chess(FEN), CORRECT, mulberry32(42)).map(
      (c) => c.uci,
    );
    expect(a).toEqual(b);
  });

  it("異なる seed では並びが変わりうる(正解は常に含む)", () => {
    const seeds = [1, 2, 3, 4, 5];
    for (const s of seeds) {
      const choices = pickPuzzleThree(new Chess(FEN), CORRECT, mulberry32(s));
      expect(choices.some((c) => c.uci === CORRECT)).toBe(true);
    }
  });
});
