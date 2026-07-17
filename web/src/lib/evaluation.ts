// thrie_raed_chess/evaluation.py の移植。
//
// 全合法手の評価(best手からの損失=センチポーン差での色分け)、3択抽出、
// 手の事実(fact)抽出、局面評価の表示整形。python-chess の Board/Move は
// chess.js に、Stockfish 呼び出しは UciClient に置き換える。
//
// 乱数(pick_three)はテストのため注入可能な Rng を使う(rng.ts)。

import { Chess, type Square } from "chess.js";
import { pvScore, type PvLine, type UciClient } from "../engine/uci-client";
import { ANALYSIS_DEPTH, ANALYSIS_MOVETIME_MS, GREEN_MAX, YELLOW_MAX } from "../config";
import { parseUci } from "./puzzles";
import { defaultRng, shuffle, type Rng } from "./rng";

export type MoveColor = "green" | "yellow" | "red";

// 評価済みの1手。Python の (move, loss, color) タプル + 表示用の san/scorePov。
export interface EvaluatedMove {
  uci: string;
  san: string;
  scorePov: number; // 手番側 POV のスコア(mate は ±10000 スケール)
  loss: number; // best - score(センチポーン)
  color: MoveColor;
}

// classify(loss): 損失から色分け。Python 版と同一(<= 判定)。
export function classify(loss: number): MoveColor {
  if (loss <= GREEN_MAX) return "green";
  if (loss <= YELLOW_MAX) return "yellow";
  return "red";
}

// rng を使った random.choice 相当。
function choice<T>(arr: T[], rng: Rng): T {
  return arr[Math.floor(rng() * arr.length)];
}

/**
 * 全合法手を評価。best 手との損失(センチポーン)昇順で EvaluatedMove[] を返す。
 *
 * 合法手数を MultiPV に指定して一度だけ解析する。movetime 打ち切りで PvLine に
 * 現れなかった合法手は「最悪損失扱い」で red とする(スペック準拠)。
 *
 * onProgress は途中 depth の進捗通知用(3択自体は最終結果で確定する)。
 */
export async function evaluateAllMoves(
  client: UciClient,
  chess: Chess,
  onProgress?: (depth: number) => void,
): Promise<EvaluatedMove[]> {
  const legal = chess.moves({ verbose: true });
  const fen = chess.fen();
  const lines = await client.analyse(
    fen,
    {
      depth: ANALYSIS_DEPTH,
      multiPv: legal.length,
      movetimeMs: ANALYSIS_MOVETIME_MS,
    },
    onProgress ? (depth) => onProgress(depth) : undefined,
  );

  // PvLine の先頭手 -> スコア(手番側 POV)。
  const scoreByUci = new Map<string, number>();
  for (const line of lines) {
    const uci = line.pv[0];
    if (uci === undefined) continue;
    if (!scoreByUci.has(uci)) scoreByUci.set(uci, pvScore(line));
  }

  const present = [...scoreByUci.values()];
  const best = present.length ? Math.max(...present) : 0;
  const worstScore = present.length ? Math.min(...present) : 0;

  // uci -> san の対応。
  const sanByUci = new Map<string, string>();
  for (const m of legal) sanByUci.set(m.lan, m.san);

  const result: EvaluatedMove[] = legal.map((m) => {
    const uci = m.lan;
    const san = sanByUci.get(uci) ?? uci;
    if (scoreByUci.has(uci)) {
      const scorePov = scoreByUci.get(uci) as number;
      const loss = best - scorePov;
      return { uci, san, scorePov, loss, color: classify(loss) };
    }
    // PvLine に現れなかった手: 最悪損失扱いで red(movetime 打ち切り対策)。
    const scorePov = worstScore;
    const loss = Math.max(best - scorePov, YELLOW_MAX + 1);
    return { uci, san, scorePov, loss, color: "red" as MoveColor };
  });

  result.sort((a, b) => a.loss - b.loss);
  return result;
}

/**
 * 最善手を必ず含め、できるだけ 黄・赤 も1つずつ。足りない色は他から補充。
 * 3手未満の局面ならある分だけ。Python 版 pick_three と同一アルゴリズム。
 */
export function pickThree(
  evaluated: EvaluatedMove[],
  rng: Rng = defaultRng,
): EvaluatedMove[] {
  if (evaluated.length === 0) return [];

  const best = evaluated[0];
  const buckets: Record<MoveColor, EvaluatedMove[]> = {
    green: [],
    yellow: [],
    red: [],
  };
  for (const item of evaluated) {
    if (item === best) continue;
    buckets[item.color].push(item);
  }

  const chosen: EvaluatedMove[] = [best];
  for (const color of ["yellow", "red"] as const) {
    if (buckets[color].length > 0) chosen.push(choice(buckets[color], rng));
  }

  if (chosen.length < 3) {
    const rest = evaluated.filter((x) => !chosen.includes(x));
    shuffle(rest, rng);
    chosen.push(...rest.slice(0, 3 - chosen.length));
  }

  const trimmed = chosen.slice(0, 3);
  shuffle(trimmed, rng); // 色順に並ばないように
  return trimmed;
}

/**
 * 一言解説の材料になる、確認できる事実だけを拾う。Python 版 move_facts と
 * 同一の日本語文字列(coach.py のテーブルキーと一致必須)。
 *
 * chess は着手前の局面。uci はその局面での合法手 UCI。
 */
export function moveFacts(chess: Chess, uci: string): string[] {
  const tmp = new Chess(chess.fen());
  const verbose = tmp.moves({ verbose: true }).find((m) => m.lan === uci);
  if (!verbose) return [];

  const facts: string[] = [];
  // 取る(通常取り/アンパッサン): verbose.captured が入る。
  if (verbose.captured) facts.push("駒を取る");
  if (verbose.promotion) facts.push("成る");
  // キャスリング: flags に 'k'(キング側)/'q'(クイーン側)。
  if (verbose.flags.includes("k") || verbose.flags.includes("q")) {
    facts.push("キャスリング");
  }

  const mover = tmp.turn(); // 着手側の色(push 前)
  tmp.move(parseUci(uci));
  if (tmp.isCheck()) facts.push("王手");

  // 着地マスが相手に取られる位置で、味方が守っていない = ただ捨ての危険。
  const to = uci.slice(2, 4) as Square;
  const opponent = mover === "w" ? "b" : "w";
  const attacked = tmp.attackers(to, opponent).length > 0;
  const defended = tmp.attackers(to, mover).length > 0;
  if (attacked && !defended) facts.push("取られる位置(守りなし)");

  return facts;
}

// format_position_eval 移植。cp/mate は白 POV。
export function formatPositionEval(
  cp: number | null,
  mate: number | null = null,
): string {
  if (mate !== null) {
    const side = mate > 0 ? "White" : "Black";
    return `${side} mate in ${Math.abs(mate)}`;
  }
  if (cp === null || Math.abs(cp) <= 20) return "互角";
  const side = cp > 0 ? "White" : "Black";
  return `${side} +${(Math.abs(cp) / 100).toFixed(1)}`;
}

/**
 * 手番側 POV のベストスコア(pvScore 済み)を白 POV に変換して表示整形する。
 * 追加解析はせず MultiPV line1 のスコアを流用する(スペック準拠)。
 */
export function formatPositionEvalFromPov(
  bestScorePov: number,
  turn: "w" | "b",
): string {
  const white = turn === "w" ? bestScorePov : -bestScorePov;
  // mate は ±10000 スケール。|score|>9000 を mate とみなして手数へ戻す。
  if (Math.abs(white) > 9000) {
    const mate = white > 0 ? 10000 - white : -10000 - white;
    return formatPositionEval(null, mate);
  }
  return formatPositionEval(white, null);
}

// 評価バー用: 白 POV のセンチポーン(mate は ±10000 スケール)。
export function whiteCp(bestScorePov: number, turn: "w" | "b"): number {
  return turn === "w" ? bestScorePov : -bestScorePov;
}

// PvLine 群(MultiPV)から line1 の手番側 POV スコアを取り出す。空なら null。
export function bestScorePovFromLines(lines: PvLine[]): number | null {
  if (lines.length === 0) return null;
  const line1 = lines.find((l) => l.multipv === 1) ?? lines[0];
  return pvScore(line1);
}
