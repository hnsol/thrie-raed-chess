import { describe, it, expect } from "vitest";
import { PuzzleSession, PuzzlePhase } from "../src/lib/session";
import { mulberry32 } from "../src/lib/rng";
import type { Puzzle } from "../src/lib/puzzles";

// 手作りの詰み局面(実データ非依存)。
const MATE_IN_1: Puzzle = {
  id: "test-m1",
  mate_in: 1,
  title: "back-rank mate",
  fen: "6k1/5ppp/8/8/8/8/8/4R2K w - - 0 1",
  solution: ["e1e8"],
  rating: 1000,
  source: "test",
};

// 2手詰め(ラダーメイト): 自分→相手応手→自分で詰み。
const MATE_IN_2: Puzzle = {
  id: "test-m2",
  mate_in: 2,
  title: "ladder mate",
  fen: "8/6k1/R7/8/8/8/8/1R5K w - - 0 1",
  solution: ["b1b7", "g7g8", "a6a8"],
  rating: 1200,
  source: "test",
};

function correctIdx(session: PuzzleSession): number {
  return session.choices.findIndex((c) => c.correct);
}

describe("PuzzleSession", () => {
  it("mate-in-1: 正解で SUCCESS", () => {
    const s = new PuzzleSession(MATE_IN_1, mulberry32(1));
    expect(s.phase).toBe(PuzzlePhase.CHOOSING);
    expect(s.choices).toHaveLength(3);

    const res = s.applyChoice(correctIdx(s));
    expect(res).toBe("correct");
    expect(s.phase).toBe(PuzzlePhase.SUCCESS);
    expect(s.isFinished()).toBe(true);
  });

  it("不正解で MISS、再挑戦(新規セッション)で CHOOSING に戻る", () => {
    const s = new PuzzleSession(MATE_IN_1, mulberry32(1));
    const wrong = s.choices.findIndex((c) => !c.correct);
    const res = s.applyChoice(wrong);
    expect(res).toBe("miss");
    expect(s.phase).toBe(PuzzlePhase.MISS);
    expect(s.finalChoiceIdx).toBe(wrong);

    // TUI の retry 相当: 同じ問題で新規セッションを作れば同一局面から再挑戦。
    const retry = new PuzzleSession(MATE_IN_1, mulberry32(1));
    expect(retry.phase).toBe(PuzzlePhase.CHOOSING);
    expect(retry.board.fen()).toBe(MATE_IN_1.fen);
    expect(retry.applyChoice(correctIdx(retry))).toBe("correct");
    expect(retry.phase).toBe(PuzzlePhase.SUCCESS);
  });

  it("mate-in-2: 正解で相手の応手が自動適用され、次の3択に進む→SUCCESS", () => {
    const s = new PuzzleSession(MATE_IN_2, mulberry32(3));

    // 1手目: 正解 → 相手応手を自動適用して CHOOSING 継続
    const res1 = s.applyChoice(correctIdx(s));
    expect(res1).toBe("correct");
    expect(s.phase).toBe(PuzzlePhase.CHOOSING);
    expect(s.idx).toBe(2); // 自分の手 + 相手の応手で 2 進む
    expect(s.choices).toHaveLength(3);

    // 2手目: 正解 → チェックメイトで SUCCESS
    const res2 = s.applyChoice(correctIdx(s));
    expect(res2).toBe("correct");
    expect(s.phase).toBe(PuzzlePhase.SUCCESS);
  });

  it("解答手順を消化しても詰まなければ FAIL", () => {
    // solution が1手だが詰みではない → 消化して FAIL。
    const noMate: Puzzle = {
      ...MATE_IN_1,
      id: "test-fail",
      solution: ["e1e2"], // 合法だが非詰み
    };
    const s = new PuzzleSession(noMate, mulberry32(1));
    const res = s.applyChoice(correctIdx(s));
    expect(res).toBe("fail");
    expect(s.phase).toBe(PuzzlePhase.FAIL);
  });

  it("abandon で ABORTED", () => {
    const s = new PuzzleSession(MATE_IN_1, mulberry32(1));
    s.abandon();
    expect(s.phase).toBe(PuzzlePhase.ABORTED);
  });
});
