// 乱数源の抽象化。[0, 1) を返す関数。
// テストでは seedable な mulberry32 を注入して決定的にする。
// 既定は Math.random。
//
// 設計スペックの通り、Python/JS の完全一致は非目標。injectable rng で
// テストのみ決定的にするのが目的。

export type Rng = () => number;

// 既定の乱数源。
export const defaultRng: Rng = Math.random;

// seed から決定的な乱数源を作る(mulberry32)。
export function mulberry32(seed: number): Rng {
  let a = seed >>> 0;
  return () => {
    a |= 0;
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

// rng を使った Fisher-Yates シャッフル(破壊的)。Python の random.shuffle 相当。
export function shuffle<T>(arr: T[], rng: Rng): T[] {
  for (let i = arr.length - 1; i > 0; i--) {
    const j = Math.floor(rng() * (i + 1));
    [arr[i], arr[j]] = [arr[j], arr[i]];
  }
  return arr;
}
