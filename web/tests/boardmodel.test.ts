import { describe, it, expect } from "vitest";
import {
  CellRole,
  choiceModel,
  lastmoveModel,
  pieceGlyph,
  puzzleResultModel,
  resultModel,
  squareToXY,
  arrowLine,
  type Choice,
  type Piece,
  type PieceLookup,
} from "../src/lib/boardmodel";

// board.piece_at 相当のモック。square -> Piece の固定表を引く。
function lookup(table: Record<string, Piece>): PieceLookup {
  return { get: (sq) => table[sq] ?? null };
}

describe("lastmoveModel", () => {
  it("出発点は駒非表示、着地点は動いた駒", () => {
    const board = lookup({ e4: { type: "p", color: "w" } });
    const model = lastmoveModel(board, { from: "e2", to: "e4" });

    expect(model.size).toBe(2);
    const from = model.get("e2")!;
    expect(from.role).toBe(CellRole.LASTMOVE);
    expect(from.showPiece).toBe(false);
    expect(from.piece).toBeNull();

    const to = model.get("e4")!;
    expect(to.role).toBe(CellRole.LASTMOVE);
    expect(to.showPiece).toBe(true);
    expect(to.piece).toEqual({ type: "p", color: "w" });
  });
});

describe("choiceModel", () => {
  const choices: Choice[] = [
    { move: { from: "e2", to: "e4" } },
    { move: { from: "g1", to: "f3" } },
    { move: { from: "d2", to: "d4" } },
  ];

  it("focused 未指定なら全て CHOICE で choiceIndex を持つ", () => {
    const model = choiceModel(lookup({}), choices);
    // 6 升 (重複なし)
    expect(model.size).toBe(6);
    for (const cell of model.values()) {
      expect(cell.role).toBe(CellRole.CHOICE);
    }
    expect(model.get("e2")!.choiceIndex).toBe(0);
    expect(model.get("f3")!.choiceIndex).toBe(1);
    expect(model.get("d4")!.choiceIndex).toBe(2);
  });

  it("focusedIndex 指定で当該手は FOCUSED、残りは DIMMED", () => {
    const model = choiceModel(lookup({}), choices, 1);
    expect(model.get("g1")!.role).toBe(CellRole.CHOICE_FOCUSED);
    expect(model.get("f3")!.role).toBe(CellRole.CHOICE_FOCUSED);
    expect(model.get("e2")!.role).toBe(CellRole.CHOICE_DIMMED);
    expect(model.get("d4")!.role).toBe(CellRole.CHOICE_DIMMED);
  });

  it("FOCUSED の升は後続の非FOCUSED手で上書きされない", () => {
    // 2手が同じ升(e4)を共有し、後の手が非フォーカスの場合。
    const shared: Choice[] = [
      { move: { from: "d2", to: "e4" } }, // index0 focused
      { move: { from: "g2", to: "e4" } }, // index1 dimmed, e4 を共有
    ];
    const model = choiceModel(lookup({}), shared, 0);
    // e4 は index0(focused) を保持し、index1 に奪われない
    expect(model.get("e4")!.role).toBe(CellRole.CHOICE_FOCUSED);
    expect(model.get("e4")!.choiceIndex).toBe(0);
  });
});

describe("resultModel", () => {
  const choices: Choice[] = [
    { move: { from: "e2", to: "e4" } },
    { move: { from: "g1", to: "f3" } },
    { move: { from: "d2", to: "d4" } },
  ];

  it("選んだ手は RESULT_CHOSEN(出発点空き)、他は RESULT_OTHER", () => {
    const board = lookup({ e4: { type: "p", color: "w" } });
    const model = resultModel(board, choices, 0);

    const from = model.get("e2")!;
    expect(from.role).toBe(CellRole.RESULT_CHOSEN);
    expect(from.showPiece).toBe(false);
    expect(from.choiceIndex).toBe(0);

    const to = model.get("e4")!;
    expect(to.role).toBe(CellRole.RESULT_CHOSEN);
    expect(to.piece).toEqual({ type: "p", color: "w" });

    // 選ばれなかった候補は RESULT_OTHER
    expect(model.get("g1")!.role).toBe(CellRole.RESULT_OTHER);
    expect(model.get("f3")!.role).toBe(CellRole.RESULT_OTHER);
    expect(model.get("f3")!.choiceIndex).toBe(1);
    expect(model.get("d2")!.role).toBe(CellRole.RESULT_OTHER);
    expect(model.get("d4")!.choiceIndex).toBe(2);
  });
});

describe("puzzleResultModel", () => {
  it("最終手を識別色で表示", () => {
    const board = lookup({ h7: { type: "q", color: "w" } });
    const model = puzzleResultModel(board, { from: "h5", to: "h7" }, 2);
    expect(model.size).toBe(2);
    expect(model.get("h5")!.role).toBe(CellRole.RESULT_CHOSEN);
    expect(model.get("h5")!.showPiece).toBe(false);
    expect(model.get("h5")!.choiceIndex).toBe(2);
    expect(model.get("h7")!.piece).toEqual({ type: "q", color: "w" });
  });
});

describe("pieceGlyph", () => {
  it("塗りつぶし記号を返す(色は問わない)", () => {
    expect(pieceGlyph({ type: "k", color: "w" })).toBe("♚");
    expect(pieceGlyph({ type: "q", color: "b" })).toBe("♛");
    expect(pieceGlyph({ type: "p", color: "w" })).toBe("♟");
    expect(pieceGlyph({ type: "n", color: "b" })).toBe("♞");
    expect(pieceGlyph(null)).toBe("");
  });
});

describe("squareToXY", () => {
  it("非 flip: a8 が左上、h1 が右下(セル中心 idx+0.5)", () => {
    expect(squareToXY("a8", false)).toEqual({ x: 0.5, y: 0.5 });
    expect(squareToXY("h1", false)).toEqual({ x: 7.5, y: 7.5 });
    expect(squareToXY("e4", false)).toEqual({ x: 4.5, y: 4.5 });
  });

  it("flip: 列・行とも反転(a8→右下、h1→左上)", () => {
    expect(squareToXY("a8", true)).toEqual({ x: 7.5, y: 7.5 });
    expect(squareToXY("h1", true)).toEqual({ x: 0.5, y: 0.5 });
    expect(squareToXY("e4", true)).toEqual({ x: 3.5, y: 3.5 });
  });
});

describe("arrowLine", () => {
  it("from は升中心、to は中心より手前で止まる(垂直手)", () => {
    const ln = arrowLine("e2", "e4", false);
    // e2=(4.5,6.5) e4=(4.5,4.5): 上向き、始点は中心、終点は 0.32 手前。
    expect(ln.x1).toBeCloseTo(4.5);
    expect(ln.y1).toBeCloseTo(6.5);
    expect(ln.x2).toBeCloseTo(4.5);
    expect(ln.y2).toBeCloseTo(4.5 + 0.32);
  });

  it("flip で座標が反転する", () => {
    const ln = arrowLine("e2", "e4", true);
    // e2=(3.5,1.5) e4=(3.5,3.5): 下向き、終点は 0.32 手前。
    expect(ln.x1).toBeCloseTo(3.5);
    expect(ln.y1).toBeCloseTo(1.5);
    expect(ln.x2).toBeCloseTo(3.5);
    expect(ln.y2).toBeCloseTo(3.5 - 0.32);
  });
});
