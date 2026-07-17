import { describe, it, expect } from "vitest";
import {
  parseInfoLine,
  pvScore,
  AnalyseAccumulator,
  type PvLine,
} from "../src/engine/uci-parser";

describe("parseInfoLine", () => {
  it("cp スコアの info 行をパースする", () => {
    const line =
      "info depth 12 seldepth 18 multipv 1 score cp 34 nodes 75633 nps 1543530 hashfull 29 time 49 pv e2e4 e7e5";
    const p = parseInfoLine(line);
    expect(p).not.toBeNull();
    expect(p!.depth).toBe(12);
    expect(p!.multipv).toBe(1);
    expect(p!.cpPov).toBe(34);
    expect(p!.matePov).toBeNull();
    expect(p!.bound).toBeNull();
    expect(p!.pv).toEqual(["e2e4", "e7e5"]);
  });

  it("負の cp とマルチ pv を扱う", () => {
    const p = parseInfoLine(
      "info depth 12 seldepth 17 multipv 3 score cp -21 nodes 1 nps 1 time 1 pv g1f3 d7d5 d2d4",
    );
    expect(p!.multipv).toBe(3);
    expect(p!.cpPov).toBe(-21);
    expect(p!.pv).toEqual(["g1f3", "d7d5", "d2d4"]);
  });

  it("score mate 3 をパースする", () => {
    const p = parseInfoLine(
      "info depth 20 seldepth 22 multipv 1 score mate 3 nodes 12345 time 10 pv d1h5 g6h5 f3f7",
    );
    expect(p!.matePov).toBe(3);
    expect(p!.cpPov).toBeNull();
  });

  it("score mate -2 をパースする", () => {
    const p = parseInfoLine(
      "info depth 15 multipv 1 score mate -2 nodes 1 time 1 pv a1a2 b1b2",
    );
    expect(p!.matePov).toBe(-2);
    expect(p!.cpPov).toBeNull();
  });

  it("multipv 省略時は 1 とみなす", () => {
    const p = parseInfoLine(
      "info depth 8 score cp 12 nodes 1 time 1 pv e2e4",
    );
    expect(p!.multipv).toBe(1);
  });

  it("lowerbound / upperbound を bound として記録する", () => {
    const lower = parseInfoLine(
      "info depth 10 multipv 1 score cp 50 lowerbound nodes 1 time 1 pv e2e4",
    );
    expect(lower!.bound).toBe("lower");
    const upper = parseInfoLine(
      "info depth 10 multipv 1 score cp 10 upperbound nodes 1 time 1 pv e2e4",
    );
    expect(upper!.bound).toBe("upper");
  });

  it("score や pv を欠く info 行、info 以外の行は null", () => {
    expect(parseInfoLine("info string NNUE evaluation using ...")).toBeNull();
    expect(
      parseInfoLine("info depth 1 currmove e2e4 currmovenumber 1"),
    ).toBeNull();
    expect(parseInfoLine("bestmove e2e4 ponder e7e5")).toBeNull();
    expect(parseInfoLine("readyok")).toBeNull();
    // depth はあるが score が無い
    expect(parseInfoLine("info depth 5 nodes 1 time 1 pv e2e4")).toBeNull();
  });
});

describe("pvScore (python-chess score(mate_score=10000) 互換)", () => {
  const mk = (cp: number | null, mate: number | null): PvLine => ({
    multipv: 1,
    depth: 1,
    cpPov: cp,
    matePov: mate,
    pv: [],
  });

  it("cp はそのまま返す", () => {
    expect(pvScore(mk(34, null))).toBe(34);
    expect(pvScore(mk(-250, null))).toBe(-250);
  });

  it("mate m>0 は 10000 - m", () => {
    expect(pvScore(mk(null, 3))).toBe(9997);
    expect(pvScore(mk(null, 1))).toBe(9999);
  });

  it("mate m<0 は -10000 - m (= -(10000 - |m|))", () => {
    expect(pvScore(mk(null, -2))).toBe(-9998);
    expect(pvScore(mk(null, -1))).toBe(-9999);
  });
});

describe("AnalyseAccumulator", () => {
  // multipv 本のラインを持つ depth の info 行を生成する。
  const depthLines = (depth: number, mpvScores: number[]): string[] =>
    mpvScores.map(
      (cp, i) =>
        `info depth ${depth} seldepth ${depth + 4} multipv ${i + 1} score cp ${cp} nodes 1 nps 1 time 1 pv e2e4 e7e5`,
    );

  it("完成 depth ごとに progress が発火し、最終 depth の全 multipv を返す", () => {
    const acc = new AnalyseAccumulator();
    const progress: number[] = [];
    const feed = (line: string) => {
      const done = acc.ingest(line);
      if (done) progress.push(done.depth);
    };

    for (const l of depthLines(1, [10, 5, 0])) feed(l);
    for (const l of depthLines(2, [12, 6, 1])) feed(l);
    for (const l of depthLines(3, [20, 8, 3])) feed(l);
    feed("bestmove e2e4 ponder e7e5");

    // depth 1,2,3 それぞれ完成時に発火。
    expect(progress).toEqual([1, 2, 3]);
    const best = acc.best();
    expect(acc.bestDepth()).toBe(3);
    expect(best.map((l) => l.multipv)).toEqual([1, 2, 3]);
    expect(best.map((l) => l.cpPov)).toEqual([20, 8, 3]);
  });

  it("最深 depth が途中打ち切りなら『最後に全 multipv が揃った depth』を返す", () => {
    const acc = new AnalyseAccumulator();
    for (const l of depthLines(10, [30, 20, 10])) acc.ingest(l);
    for (const l of depthLines(11, [33, 21, 11])) acc.ingest(l);
    // depth 12 は multipv 1 のみで movetime 打ち切り(残り 2 本が未計算)。
    acc.ingest(depthLines(12, [40])[0]);
    acc.ingest("bestmove e2e4");

    // 全 3 本揃った最後の depth = 11 を採用。
    expect(acc.bestDepth()).toBe(11);
    expect(acc.best().map((l) => l.multipv)).toEqual([1, 2, 3]);
    expect(acc.best().map((l) => l.cpPov)).toEqual([33, 21, 11]);
  });

  it("lowerbound/upperbound 行は集約に含めない", () => {
    const acc = new AnalyseAccumulator();
    acc.ingest(
      "info depth 5 multipv 1 score cp 50 lowerbound nodes 1 time 1 pv e2e4",
    );
    // 上の暫定行は無視され、確定行で上書きされる。
    acc.ingest("info depth 5 multipv 1 score cp 34 nodes 1 time 1 pv e2e4");
    acc.ingest("bestmove e2e4");
    expect(acc.best()).toHaveLength(1);
    expect(acc.best()[0].cpPov).toBe(34);
  });

  it("mate ラインも保持し pvScore で比較できる", () => {
    const acc = new AnalyseAccumulator();
    acc.ingest(
      "info depth 20 multipv 1 score mate 3 nodes 1 time 1 pv d1h5 g6h5 f3f7",
    );
    acc.ingest("bestmove d1h5");
    const best = acc.best();
    expect(best[0].matePov).toBe(3);
    expect(pvScore(best[0])).toBe(9997);
  });
});
