import { describe, it, expect } from "vitest";
import { Chess } from "chess.js";
import {
  classify,
  evaluateAllMoves,
  moveFacts,
  pickThree,
  formatPositionEval,
  type EvaluatedMove,
  type MoveColor,
} from "../src/lib/evaluation";
import { mulberry32 } from "../src/lib/rng";
import type { PvLine } from "../src/engine/uci-client";
import type { UciClient } from "../src/engine/uci-client";

// ── classify 境界 ─────────────────────────────────────────────
describe("classify", () => {
  it("GREEN_MAX 境界: 30=green, 31=yellow", () => {
    expect(classify(0)).toBe("green");
    expect(classify(30)).toBe("green");
    expect(classify(31)).toBe("yellow");
  });
  it("YELLOW_MAX 境界: 150=yellow, 151=red", () => {
    expect(classify(150)).toBe("yellow");
    expect(classify(151)).toBe("red");
  });
});

// ── pickThree 不変条件 ─────────────────────────────────────────
function ev(uci: string, loss: number, color: MoveColor): EvaluatedMove {
  return { uci, san: uci, scorePov: -loss, loss, color };
}

describe("pickThree", () => {
  it("空なら空", () => {
    expect(pickThree([], mulberry32(1))).toEqual([]);
  });

  it("best(先頭)を必ず含み、黄・赤を優先、長さ3", () => {
    const evaluated = [
      ev("best", 0, "green"),
      ev("g2", 10, "green"),
      ev("y1", 100, "yellow"),
      ev("y2", 120, "yellow"),
      ev("r1", 300, "red"),
      ev("r2", 400, "red"),
    ];
    for (let seed = 1; seed <= 20; seed++) {
      const res = pickThree(evaluated, mulberry32(seed));
      expect(res).toHaveLength(3);
      expect(res).toContain(evaluated[0]); // best 必須
      expect(res.some((m) => m.color === "yellow")).toBe(true);
      expect(res.some((m) => m.color === "red")).toBe(true);
    }
  });

  it("黄しか無い場合は best+黄、残りをバックフィル", () => {
    const evaluated = [
      ev("best", 0, "green"),
      ev("g2", 5, "green"),
      ev("y1", 90, "yellow"),
    ];
    const res = pickThree(evaluated, mulberry32(2));
    expect(res).toHaveLength(3);
    expect(res).toContain(evaluated[0]);
    expect(res).toContain(evaluated[2]); // 唯一の yellow
    // 残り1枠は green からバックフィル
    expect(res).toContain(evaluated[1]);
  });

  it("2手しか無い局面は2手だけ返す", () => {
    const evaluated = [ev("best", 0, "green"), ev("r1", 200, "red")];
    const res = pickThree(evaluated, mulberry32(3));
    expect(res).toHaveLength(2);
    expect(res).toContain(evaluated[0]);
    expect(res).toContain(evaluated[1]);
  });

  it("3手ちょうどは全部返す", () => {
    const evaluated = [
      ev("best", 0, "green"),
      ev("y1", 100, "yellow"),
      ev("r1", 200, "red"),
    ];
    const res = pickThree(evaluated, mulberry32(4));
    expect(res).toHaveLength(3);
    expect(new Set(res)).toEqual(new Set(evaluated));
  });
});

// ── evaluateAllMoves(フェイククライアント) ───────────────────────
function pvLine(multipv: number, cp: number, firstUci: string): PvLine {
  return { multipv, depth: 12, cpPov: cp, matePov: null, pv: [firstUci] };
}

// analyse だけ差し替えたフェイク。
function fakeClient(lines: PvLine[]): UciClient {
  return {
    analyse: async () => lines,
  } as unknown as UciClient;
}

describe("evaluateAllMoves", () => {
  it("loss=best-score, 昇順ソート, 色分け", async () => {
    const chess = new Chess("4k3/8/8/8/8/8/8/4K2R w K - 0 1");
    // 実際の合法手のうち3つに canned スコアを付与。
    const legal = chess.moves({ verbose: true }).map((m) => m.lan);
    const [a, b, c] = legal;
    const lines = [
      pvLine(1, 50, a), // best
      pvLine(2, 20, b), // loss 30 -> green
      pvLine(3, -110, c), // loss 160 -> red
    ];
    const res = await evaluateAllMoves(fakeClient(lines), chess);
    // 先頭は best(loss 0)
    expect(res[0].uci).toBe(a);
    expect(res[0].loss).toBe(0);
    expect(res[0].color).toBe("green");
    const byUci = new Map(res.map((r) => [r.uci, r]));
    expect(byUci.get(b)!.loss).toBe(30);
    expect(byUci.get(b)!.color).toBe("green");
    expect(byUci.get(c)!.loss).toBe(160);
    expect(byUci.get(c)!.color).toBe("red");
    // 昇順
    for (let i = 1; i < res.length; i++) {
      expect(res[i].loss).toBeGreaterThanOrEqual(res[i - 1].loss);
    }
  });

  it("PvLine に現れない合法手は red(最悪損失扱い)", async () => {
    const chess = new Chess("4k3/8/8/8/8/8/8/4K2R w K - 0 1");
    const legal = chess.moves({ verbose: true }).map((m) => m.lan);
    // 1手だけスコアを返す。残りは打ち切りで欠落したとみなす。
    const lines = [pvLine(1, 40, legal[0])];
    const res = await evaluateAllMoves(fakeClient(lines), chess);
    const missing = res.filter((r) => r.uci !== legal[0]);
    expect(missing.length).toBe(legal.length - 1);
    for (const m of missing) expect(m.color).toBe("red");
    // best 手は先頭で green。
    expect(res[0].uci).toBe(legal[0]);
    expect(res[0].color).toBe("green");
  });
});

// ── moveFacts 日本語文字列 ─────────────────────────────────────
describe("moveFacts", () => {
  it("駒を取る", () => {
    const c = new Chess("4k3/8/8/8/8/8/3p4/3QK3 w - - 0 1");
    expect(moveFacts(c, "d1d2")).toEqual(["駒を取る"]);
  });
  it("成る", () => {
    const c = new Chess("8/P7/8/8/7k/8/8/4K3 w - - 0 1");
    expect(moveFacts(c, "a7a8q")).toEqual(["成る"]);
  });
  it("キャスリング", () => {
    const c = new Chess("r3k2r/8/8/8/8/8/8/R3K2R w KQkq - 0 1");
    expect(moveFacts(c, "e1g1")).toEqual(["キャスリング"]);
  });
  it("王手(守られていて捨てでない)", () => {
    const c = new Chess("4k3/8/8/3Q4/8/8/8/3R1K2 w - - 0 1");
    expect(moveFacts(c, "d5d7")).toEqual(["王手"]);
  });
  it("取られる位置(守りなし)", () => {
    const c = new Chess("4k3/8/8/2p5/8/8/8/3RK3 w - - 0 1");
    expect(moveFacts(c, "d1d4")).toEqual(["取られる位置(守りなし)"]);
  });
});

// ── formatPositionEval ─────────────────────────────────────────
describe("formatPositionEval", () => {
  it("互角(|cp|<=20)", () => {
    expect(formatPositionEval(0)).toBe("互角");
    expect(formatPositionEval(20)).toBe("互角");
    expect(formatPositionEval(null)).toBe("互角");
  });
  it("cp を White/Black +x.x で表示", () => {
    expect(formatPositionEval(150)).toBe("White +1.5");
    expect(formatPositionEval(-230)).toBe("Black +2.3");
  });
  it("mate 表示", () => {
    expect(formatPositionEval(null, 3)).toBe("White mate in 3");
    expect(formatPositionEval(null, -2)).toBe("Black mate in 2");
  });
});
