import { describe, it, expect } from "vitest";
import { Chess } from "chess.js";
import { CoachCommenter, gamePhase, tierOf } from "../src/lib/coach";
import { mulberry32 } from "../src/lib/rng";

// tests/test_coach.py の移植。RNG は Python の random.Random ではなく
// mulberry32(seed) を注入して決定的にする(値の一致は非目標)。

// ── tierOf 境界 ────────────────────────────────────────────────
describe("tierOf", () => {
  it("損失境界を尊重する(0/30/80/150/300 近傍)", () => {
    expect(tierOf(0)).toBe("BRILLIANT");
    expect(tierOf(1)).toBe("EXCELLENT");
    expect(tierOf(30)).toBe("EXCELLENT");
    expect(tierOf(31)).toBe("GOOD");
    expect(tierOf(80)).toBe("GOOD");
    expect(tierOf(81)).toBe("SOSO");
    expect(tierOf(150)).toBe("SOSO");
    expect(tierOf(151)).toBe("ROUGH");
    expect(tierOf(300)).toBe("ROUGH");
    expect(tierOf(301)).toBe("BLUNDER");
  });
});

// ── gamePhase ─────────────────────────────────────────────────
describe("gamePhase", () => {
  it("局面を序盤/中盤/終盤に分類する", () => {
    expect(gamePhase(new Chess())).toBe("opening");
    // 少駒(キング+ポーンのみ) = 終盤
    expect(gamePhase(new Chess("4k3/4p3/8/8/8/8/4P3/4K3 w - - 0 30"))).toBe(
      "endgame",
    );
    // 11手目以降で駒は多い = 中盤
    expect(
      gamePhase(
        new Chess(
          "r1bqkbnr/pppp1ppp/2n5/4p3/4P3/5N2/PPPP1PPP/RNBQKB1R w KQkq - 0 11",
        ),
      ),
    ).toBe("middlegame");
  });
});

// ── コメント生成 ───────────────────────────────────────────────
describe("CoachCommenter.comment", () => {
  it("全 tier で非空文字列を返す", () => {
    const coach = new CoachCommenter(mulberry32(0));
    const board = new Chess();
    const cases: [number, "green" | "yellow" | "red"][] = [
      [0, "green"], [20, "green"], [60, "yellow"],
      [120, "yellow"], [250, "red"], [500, "red"],
    ];
    for (const [loss, color] of cases) {
      const text = coach.comment(loss, color, [], board);
      expect(typeof text).toBe("string");
      expect(text.length).toBeGreaterThan(0);
    }
  });

  it("同一コメントが連続して繰り返されない(直近4件回避)", () => {
    const coach = new CoachCommenter(mulberry32(42));
    const board = new Chess();
    let prev: string | null = null;
    for (let i = 0; i < 30; i++) {
      const text = coach.comment(60, "yellow", [], board);
      expect(text).not.toBe(prev);
      prev = text;
    }
  });

  it("ストリーク文言が出現し、非緑でリセットされる", () => {
    const board = new Chess();
    let seenStreak = false;
    for (let seed = 0; seed < 50; seed++) {
      const coach = new CoachCommenter(mulberry32(seed));
      coach.comment(0, "green", [], board);
      coach.comment(0, "green", [], board);
      expect(coach.greenStreak).toBe(2);
      const text = coach.comment(0, "green", [], board);
      expect(coach.greenStreak).toBe(3);
      if (
        text.includes("連続") || text.includes("止まらない") ||
        text.includes("絶好調") || text.includes("波に乗ってる") ||
        text.includes("勢い") || text.includes("ノリノリ") ||
        text.includes("手が付けられない")
      ) {
        seenStreak = true;
      }
    }
    expect(seenStreak).toBe(true);

    // 非緑でリセット
    const coach = new CoachCommenter(mulberry32(1));
    coach.comment(0, "green", [], board);
    coach.comment(0, "green", [], board);
    coach.comment(0, "green", [], board);
    expect(coach.greenStreak).toBe(3);
    coach.comment(200, "red", [], board);
    expect(coach.greenStreak).toBe(0);
  });

  it("好手時に駒取りの fact 言及が現れうる", () => {
    const board = new Chess();
    let seen = false;
    for (let seed = 0; seed < 50; seed++) {
      const coach = new CoachCommenter(mulberry32(seed));
      const text = coach.comment(10, "green", ["駒を取る"], board);
      if (text.includes("駒得") || text.includes("得した")) {
        seen = true;
        break;
      }
    }
    expect(seen).toBe(true);
  });

  it("悪手時にタダ取られ警告 fact が現れうる", () => {
    const board = new Chess();
    let seen = false;
    for (let seed = 0; seed < 50; seed++) {
      const coach = new CoachCommenter(mulberry32(seed));
      const text = coach.comment(
        250,
        "red",
        ["取られる位置(守りなし)"],
        board,
      );
      if (
        text.includes("タダ取られ") ||
        text.includes("守りなし") ||
        text.includes("危ない")
      ) {
        seen = true;
        break;
      }
    }
    expect(seen).toBe(true);
  });
});
