import { describe, it, expect } from "vitest";
import { Chess } from "chess.js";
import {
  STRATEGIES,
  getStrategy,
  suggestPlanMove,
  applyBookPreference,
  type StrategyId,
} from "../src/lib/openings";
import type { EvaluatedMove } from "../src/lib/evaluation";

// 想定メインライン（全手 SAN・両者分）。各戦略×各色のプランがこの手順上で
// 順に全て合法であることをデータ健全性として確認する。
const MAINLINES: Record<StrategyId, { w: string[]; b: string[] }> = {
  italian: {
    // 白プラン検証: 白 e4,Nf3,Bc4,O-O,d3,c3,Re1,Nbd2
    w: ["e4", "e5", "Nf3", "Nc6", "Bc4", "Bc5", "O-O", "Nf6",
      "d3", "d6", "c3", "O-O", "Re1", "a6", "Nbd2", "b5"],
    // 黒プラン検証: 黒 e5,Nc6,Nf6,Bc5,O-O,d6,a6
    b: ["e4", "e5", "Nf3", "Nc6", "Bc4", "Nf6", "d3", "Bc5",
      "O-O", "O-O", "Re1", "d6", "h3", "a6"],
  },
  london: {
    // 白プラン検証: 白 d4,Nf3,Bf4,e3,Bd3,Nbd2,c3,O-O
    w: ["d4", "d5", "Nf3", "Nf6", "Bf4", "e6", "e3", "Be7",
      "Bd3", "O-O", "Nbd2", "c5", "c3", "Nc6", "O-O", "h6"],
    // 黒プラン検証: 黒 d5,Nf6,e6,Be7,O-O,c6,Nbd7
    b: ["d4", "d5", "Nf3", "Nf6", "Bf4", "e6", "e3", "Be7",
      "Bd3", "O-O", "O-O", "c6", "Nbd2", "Nbd7"],
  },
  fianchetto: {
    // 白プラン検証: 白 c4,g3,Bg2,Nf3,O-O,d3,Nc3
    w: ["c4", "e5", "g3", "Nf6", "Bg2", "d5", "Nf3", "Nc6",
      "O-O", "Be7", "d3", "O-O", "Nc3", "h6"],
    // 黒プラン検証: 黒 g6,Bg7,Nf6,O-O,d6,c5,Nc6
    b: ["d4", "g6", "c4", "Bg7", "Nc3", "Nf6", "e4", "O-O",
      "Nf3", "d6", "Be2", "c5", "O-O", "Nc6"],
  },
};

// ── データ健全性 ────────────────────────────────────────────────
describe("STRATEGIES データ健全性", () => {
  for (const strat of STRATEGIES) {
    for (const color of ["w", "b"] as const) {
      it(`${strat.id} の ${color} プランがメインライン上で全て合法`, () => {
        const chess = new Chess();
        const line = MAINLINES[strat.id][color];
        // メインラインを順に指し、全手が合法（chess.move が例外を投げない）。
        for (const san of line) {
          expect(() => chess.move(san)).not.toThrow();
        }
        // プランの各 SAN がメインライン（該当色の手）に含まれていること。
        const played = new Set(line);
        for (const san of strat.plan[color]) {
          expect(played.has(san)).toBe(true);
        }
      });
    }
  }
});

// ── getStrategy ────────────────────────────────────────────────
describe("getStrategy", () => {
  it("id で戦略を引ける", () => {
    expect(getStrategy("italian")?.id).toBe("italian");
    expect(getStrategy("london")?.id).toBe("london");
    expect(getStrategy("fianchetto")?.id).toBe("fianchetto");
  });
  it("null/undefined は null", () => {
    expect(getStrategy(null)).toBeNull();
    expect(getStrategy(undefined)).toBeNull();
  });
});

// ── suggestPlanMove ────────────────────────────────────────────
describe("suggestPlanMove", () => {
  const italian = getStrategy("italian")!;

  it("初期局面・白 italian は e2e4", () => {
    const chess = new Chess();
    expect(suggestPlanMove(chess, italian, "w")).toBe("e2e4");
  });

  it("初期局面で color=b は手番違いで null", () => {
    const chess = new Chess();
    expect(suggestPlanMove(chess, italian, "b")).toBeNull();
  });

  it("相手が 1.a4 でも黒 italian プラン先頭 e5 → e7e5", () => {
    const chess = new Chess();
    chess.move("a4");
    expect(suggestPlanMove(chess, italian, "b")).toBe("e7e5");
  });

  it("使用済み SAN をスキップ（e4 の後の白 italian は Nf3=g1f3）", () => {
    const chess = new Chess();
    chess.move("e4");
    chess.move("e5");
    expect(suggestPlanMove(chess, italian, "w")).toBe("g1f3");
  });

  it("相手初手 e4/d4/c4/Nf3 に対し各黒戦略が1手目から非null", () => {
    for (const first of ["e4", "d4", "c4", "Nf3"]) {
      for (const strat of STRATEGIES) {
        const chess = new Chess();
        chess.move(first);
        expect(suggestPlanMove(chess, strat, "b")).not.toBeNull();
      }
    }
  });

  it("phase 境界: 手数超過（moveNumber>10）は null", () => {
    const chess = new Chess(
      "rnbqkbnr/pppppppp/8/8/8/8/PPPPPPPP/RNBQKBNR w KQkq - 0 11",
    );
    expect(suggestPlanMove(chess, italian, "w")).toBeNull();
  });

  it("phase 境界: クイーン消失は null", () => {
    const chess = new Chess(
      "rnb1kbnr/pppppppp/8/8/8/8/PPPPPPPP/RNB1KBNR w KQkq - 0 3",
    );
    expect(suggestPlanMove(chess, italian, "w")).toBeNull();
  });
});

// ── applyBookPreference ────────────────────────────────────────
function mv(uci: string, loss: number): EvaluatedMove {
  return { uci, san: uci, scorePov: 0, loss, color: "green" };
}

describe("applyBookPreference", () => {
  it("loss 30 は採用され先頭へ移動", () => {
    const arr = [mv("a", 0), mv("b", 30), mv("c", 50)];
    const { evaluated, adopted } = applyBookPreference(arr, "b");
    expect(adopted).toBe(true);
    expect(evaluated[0].uci).toBe("b");
    expect(evaluated.map((m) => m.uci)).toEqual(["b", "a", "c"]);
  });

  it("loss 31 は非採用", () => {
    const arr = [mv("a", 0), mv("b", 31)];
    const { evaluated, adopted } = applyBookPreference(arr, "b");
    expect(adopted).toBe(false);
    expect(evaluated).toBe(arr);
  });

  it("bookUci 不在は非採用", () => {
    const arr = [mv("a", 0)];
    const { adopted } = applyBookPreference(arr, "zz");
    expect(adopted).toBe(false);
  });

  it("bookUci null は非採用", () => {
    const arr = [mv("a", 0)];
    const { adopted } = applyBookPreference(arr, null);
    expect(adopted).toBe(false);
  });

  it("元配列を破壊しない", () => {
    const arr = [mv("a", 0), mv("b", 10)];
    const before = arr.map((m) => m.uci);
    applyBookPreference(arr, "b");
    expect(arr.map((m) => m.uci)).toEqual(before);
  });
});

// 相手が先に同名手(O-O)を指していても自分のプラン手はスキップされない。
describe("suggestPlanMove: 相手の同名手と衝突しない", () => {
  it("相手が先にO-O済みでも自分のO-Oが提案される", () => {
    // イタリアン進行で白が先にキャスリングした局面(黒番、黒はまだO-Oしていない)。
    const chess = new Chess();
    for (const san of ["e4", "e5", "Nf3", "Nc6", "Bc4", "Bc5", "O-O", "Nf6"]) {
      chess.move(san);
    }
    chess.move("d3"); // 白: d3 → 黒番
    const italian = STRATEGIES.find((s) => s.id === "italian")!;
    // 黒プランの未使用先頭は O-O(e5,Nc6,Nf6,Bc5は使用済み)。
    expect(suggestPlanMove(chess, italian, "b")).toBe("e8g8");
  });
});
