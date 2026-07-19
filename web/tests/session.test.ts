import { describe, it, expect } from "vitest";
import { Chess } from "chess.js";
import {
  PuzzleSession,
  PuzzlePhase,
  BattleSession,
  BattlePhase,
} from "../src/lib/session";
import { mulberry32 } from "../src/lib/rng";
import { getStrategy } from "../src/lib/openings";
import type { Puzzle } from "../src/lib/puzzles";
import type { PvLine, UciClient } from "../src/engine/uci-client";

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

  it("clearFocus: focus(1) → clearFocus() → focusedIdx === null", () => {
    const s = new PuzzleSession(MATE_IN_1, mulberry32(1));
    s.focus(1);
    expect(s.focusedIdx).toBe(1);
    s.clearFocus();
    expect(s.focusedIdx).toBeNull();
  });
});

// ── BattleSession ─────────────────────────────────────────────

function pv(multipv: number, cp: number, firstUci: string): PvLine {
  return { multipv, depth: 12, cpPov: cp, matePov: null, pv: [firstUci] };
}

// analyse / bestMove を差し替えたフェイククライアント。
function fakeClient(opts: {
  lines?: PvLine[];
  bestMove?: string;
}): UciClient {
  return {
    analyse: async () => opts.lines ?? [],
    bestMove: async () => opts.bestMove ?? "",
  } as unknown as UciClient;
}

describe("BattleSession", () => {
  it("初期状態は HUMAN_CHOOSING", () => {
    const s = new BattleSession();
    expect(s.phase).toBe(BattlePhase.HUMAN_CHOOSING);
    expect(s.result).toBe("*");
  });

  it("prepareChoices → applyChoice(非終局) → REVEALED、reveal 内容が一致", async () => {
    const fen = "4k3/8/8/8/8/8/8/4K2R w K - 0 1";
    const s = new BattleSession({ board: new Chess(fen), rng: mulberry32(7) });
    const lines = [
      pv(1, 300, "h1h8"), // best
      pv(2, 280, "e1e2"), // loss 20 -> green
      pv(3, 150, "h1h2"), // loss 150 -> yellow
      pv(4, 100, "e1f2"), // loss 200 -> red
    ];
    const choices = await s.prepareChoices(fakeClient({ lines }));
    expect(choices.length).toBeGreaterThanOrEqual(1);
    expect(choices.length).toBeLessThanOrEqual(3);
    expect(typeof s.positionEval).toBe("string");

    const revealed = s.applyChoice(0);
    expect(revealed).toHaveLength(choices.length);
    expect(revealed[0].isChosen).toBe(true);
    for (let i = 1; i < revealed.length; i++) {
      expect(revealed[i].isChosen).toBe(false);
    }
    // reveal の loss/color は choices と一致。
    revealed.forEach((r, i) => {
      expect(r.loss).toBe(choices[i].loss);
      expect(r.color).toBe(choices[i].color);
      expect(Array.isArray(r.facts)).toBe(true);
    });
    expect(s.phase).toBe(BattlePhase.REVEALED);
    expect(s.chosenIdx).toBe(0);
    expect(s.stats.moves).toBe(1);
  });

  it("applyChoice でチェックメイト → GAME_OVER, 結果 1-0", async () => {
    const fen = "6k1/5ppp/8/8/8/8/8/4R2K w - - 0 1";
    const s = new BattleSession({ board: new Chess(fen), rng: mulberry32(1) });
    // e1e8 を best(mate 相当)にする。
    const lines = [pv(1, 9995, "e1e8"), pv(2, 0, "h1g1"), pv(3, -50, "h1g2")];
    await s.prepareChoices(fakeClient({ lines }));
    const idx = s.choices.findIndex((c) => c.uci === "e1e8");
    expect(idx).toBeGreaterThanOrEqual(0); // best は必ず choices に含まれる
    s.applyChoice(idx);
    expect(s.phase).toBe(BattlePhase.GAME_OVER);
    expect(s.result).toBe("1-0");
    expect(s.outcomeMessage()).toContain("あなた");
  });

  it("beginCpuTurn → CPU_THINKING、applyCpuMove(非終局) → HUMAN_CHOOSING", async () => {
    const fen = "4k3/8/8/8/8/8/8/4K2R b K - 0 1";
    const s = new BattleSession({ board: new Chess(fen) });
    s.beginCpuTurn();
    expect(s.phase).toBe(BattlePhase.CPU_THINKING);
    const uci = await s.applyCpuMove(fakeClient({ bestMove: "e8d8" }));
    expect(uci).toBe("e8d8");
    expect(s.phase).toBe(BattlePhase.HUMAN_CHOOSING);
  });

  it("CPU の手でステイルメイト → GAME_OVER 引き分け", async () => {
    // 黒番。黒が指すと白がステイルメイト。
    const fen = "K7/8/2q5/8/8/8/8/k7 b - - 0 1";
    const s = new BattleSession({ board: new Chess(fen), humanColor: "w" });
    s.beginCpuTurn();
    await s.applyCpuMove(fakeClient({ bestMove: "c6c7" }));
    expect(s.phase).toBe(BattlePhase.GAME_OVER);
    expect(s.result).toBe("1/2-1/2");
  });

  it("resign: 白番なら 0-1", () => {
    const s = new BattleSession({ humanColor: "w" });
    s.resign();
    expect(s.phase).toBe(BattlePhase.GAME_OVER);
    expect(s.result).toBe("0-1");
    expect(s.termination).toBe("White resigned");
  });

  it("resign: 黒番なら 1-0", () => {
    const s = new BattleSession({ humanColor: "b" });
    s.resign();
    expect(s.result).toBe("1-0");
    expect(s.termination).toBe("Black resigned");
  });

  it("clearFocus: focus(1) → clearFocus() → focusedIdx === null", async () => {
    const fen = "4k3/8/8/8/8/8/8/4K2R w K - 0 1";
    const s = new BattleSession({ board: new Chess(fen), rng: mulberry32(7) });
    const lines = [pv(1, 300, "h1h8"), pv(2, 280, "e1e2"), pv(3, 150, "h1h2")];
    await s.prepareChoices(fakeClient({ lines }));
    s.focus(1);
    expect(s.focusedIdx).toBe(1);
    s.clearFocus();
    expect(s.focusedIdx).toBeNull();
  });
});

// ── 序盤の定跡戦略(web 独自機能) ──────────────────────────────────
describe("BattleSession 定跡戦略", () => {
  const italian = getStrategy("italian")!;

  // 初期局面(白番)。イタリアン流の定跡手は e2e4。
  // best は d2d4(cp50)、e2e4 は cp30(loss 20 <= 30)。
  const bookLines: PvLine[] = [
    pv(1, 50, "d2d4"), // 真の best
    pv(2, 30, "e2e4"), // 定跡手・loss 20 -> green
    pv(3, -100, "a2a3"),
  ];

  it("定跡手が僅差(loss<=30)なら choices に含まれ bookInfo が立つ", async () => {
    const s = new BattleSession({
      board: new Chess(),
      strategy: italian,
      rng: mulberry32(7),
    });
    await s.prepareChoices(fakeClient({ lines: bookLines }));
    expect(s.bookInfo).not.toBeNull();
    expect(s.bookInfo!.uci).toBe("e2e4");
    expect(s.bookInfo!.san).toBe("e4");
    expect(s.bookInfo!.openingName).toBe("イタリアンゲーム");
    expect(s.bookInfo!.strategyName).toBe(italian.name);
    expect(s.choices.some((c) => c.uci === "e2e4")).toBe(true);
  });

  it("評価バーは真の best 由来のまま(定跡差し替えの影響を受けない)", async () => {
    const s = new BattleSession({
      board: new Chess(),
      strategy: italian,
      rng: mulberry32(7),
    });
    await s.prepareChoices(fakeClient({ lines: bookLines }));
    // 真の best は d2d4(白 POV cp50)。差し替えても評価バーは 50 のまま。
    expect(s.positionEvalCp).toBe(50);
  });

  it("定跡手が loss>30 なら不採用・bookInfo null で通常 best", async () => {
    const s = new BattleSession({
      board: new Chess(),
      strategy: italian,
      rng: mulberry32(7),
    });
    // e2e4 cp -30(loss 80 > 30)。best は d2d4。
    const lines: PvLine[] = [
      pv(1, 50, "d2d4"),
      pv(2, -30, "e2e4"),
      pv(3, -100, "a2a3"),
    ];
    const choices = await s.prepareChoices(fakeClient({ lines }));
    expect(s.bookInfo).toBeNull();
    expect(choices[0].uci).toBe("d2d4"); // 通常 best
    expect(s.positionEvalCp).toBe(50);
  });

  it("戦略ありでも中盤局面(序盤外)では bookInfo null", async () => {
    // moveNumber 11 の局面 = 中盤。suggestPlanMove は phase で null を返す。
    const fen =
      "r1bqkbnr/pppp1ppp/2n5/4p3/4P3/5N2/PPPP1PPP/RNBQKB1R w KQkq - 0 11";
    const s = new BattleSession({
      board: new Chess(fen),
      strategy: italian,
      rng: mulberry32(3),
    });
    const lines: PvLine[] = [pv(1, 40, "f1c4"), pv(2, 20, "d2d4")];
    await s.prepareChoices(fakeClient({ lines }));
    expect(s.bookInfo).toBeNull();
  });

  it("戦略なしなら bookInfo null(現行動作)", async () => {
    const s = new BattleSession({ board: new Chess(), rng: mulberry32(7) });
    await s.prepareChoices(fakeClient({ lines: bookLines }));
    expect(s.bookInfo).toBeNull();
  });

  it("applyChoice で定跡手の revealed[].isBook が立つ", async () => {
    const s = new BattleSession({
      board: new Chess(),
      strategy: italian,
      rng: mulberry32(7),
    });
    await s.prepareChoices(fakeClient({ lines: bookLines }));
    const idx = s.choices.findIndex((c) => c.uci === "e2e4");
    const revealed = s.applyChoice(idx);
    expect(revealed[idx].isBook).toBe(true);
    // 定跡手以外は isBook false。
    revealed.forEach((r) => {
      if (r.uci !== "e2e4") expect(r.isBook).toBe(false);
    });
  });
});
