// 序盤の定跡戦略（web 独自機能）。
//
// 手順ツリーではなく SAN 優先リスト（駒組み優先）方式。局面来歴に非依存なので
// 相手が定跡を外れてもトランスポジションでも頑健。序盤の間だけ、プラン先頭から
// 「現在合法・未使用」の最初の SAN を uci で返し、候補選定に定跡手を採用する。

import { Chess } from "chess.js";
import { gamePhase } from "./coach";
import { BOOK_MAX_LOSS } from "../config";
import type { EvaluatedMove } from "./evaluation";

export type StrategyId = "italian" | "london" | "fianchetto";

export interface OpeningStrategy {
  id: StrategyId;
  name: string; // 選択肢の表示名
  shortName: string; // 短縮表示名（BattleSetupグリッド用）
  tagline: string; // 一言説明
  openingName: { w: string; b: string }; // 開示時に表示する定跡名（白/黒）
  plan: { w: string[]; b: string[] }; // SAN 優先リスト（白/黒）
}

// 戦略セット（白黒共通・セットアップ型）。
export const STRATEGIES: OpeningStrategy[] = [
  {
    id: "italian",
    name: "まっすぐ攻める（イタリアン流）",
    shortName: "イタリアン流",
    tagline: "中央に出て素早く攻める",
    openingName: { w: "イタリアンゲーム", b: "イタリアン風の受け" },
    plan: {
      w: ["e4", "Nf3", "Bc4", "O-O", "d3", "c3", "Re1", "Nbd2"],
      b: ["e5", "Nc6", "Nf6", "Bc5", "O-O", "d6", "a6"],
    },
  },
  {
    id: "london",
    name: "がっちり組む（ロンドン流）",
    shortName: "ロンドン流",
    tagline: "堅い陣形でじっくり戦う",
    openingName: { w: "ロンドンシステム", b: "堅陣ディフェンス" },
    plan: {
      w: ["d4", "Nf3", "Bf4", "e3", "Bd3", "Nbd2", "c3", "O-O"],
      b: ["d5", "Nf6", "e6", "Be7", "O-O", "c6", "Nbd7"],
    },
  },
  {
    id: "fianchetto",
    name: "じっくり構える（フィアンケット流）",
    shortName: "フィアンケット流",
    tagline: "斜めから盤面ににらみを利かせる",
    openingName: { w: "イングリッシュオープニング", b: "キングズインディアン風" },
    plan: {
      w: ["c4", "g3", "Bg2", "Nf3", "O-O", "d3", "Nc3"],
      b: ["g6", "Bg7", "Nf6", "O-O", "d6", "c5", "Nc6"],
    },
  },
];

// id から戦略を引く。none/未指定は null。
export function getStrategy(id: StrategyId | null | undefined): OpeningStrategy | null {
  if (id == null) return null;
  return STRATEGIES.find((s) => s.id === id) ?? null;
}

/**
 * 序盤の間、プラン先頭から「現在合法・未使用」の最初の SAN を uci で返す。
 *
 * - 手番が color でなければ null。
 * - gamePhase が opening でなければ null（早期クイーン交換や手数超過で即無効）。
 * - plan[color] を先頭から走査し、現在合法な SAN かつ history に未出現の最初の1手を
 *   uci（from+to+promotion）で返す。該当なしなら null。
 */
export function suggestPlanMove(
  chess: Chess,
  strategy: OpeningStrategy,
  color: "w" | "b",
): string | null {
  if (chess.turn() !== color) return null;
  if (gamePhase(chess) !== "opening") return null;

  // 現在合法な SAN -> verbose の対応。
  const verboseBySan = new Map<string, { from: string; to: string; promotion?: string }>();
  for (const m of chess.moves({ verbose: true })) {
    if (!verboseBySan.has(m.san)) verboseBySan.set(m.san, m);
  }

  // 「使用済み」判定は自分(color)の手のみ。相手の同名手(例: 相手が先に O-O)で
  // 自分のプラン手がスキップされないようにする。
  const played = new Set(
    chess
      .history({ verbose: true })
      .filter((m) => m.color === color)
      .map((m) => m.san),
  );

  for (const san of strategy.plan[color]) {
    if (played.has(san)) continue;
    const v = verboseBySan.get(san);
    if (v) return `${v.from}${v.to}${v.promotion ?? ""}`;
  }
  return null;
}

/**
 * bookUci 該当手の loss <= BOOK_MAX_LOSS なら配列先頭へ移動した新配列 + adopted:true。
 * それ以外（該当なし・null・しきい値超）は元配列 + adopted:false。元配列は破壊しない。
 */
export function applyBookPreference(
  evaluated: EvaluatedMove[],
  bookUci: string | null,
): { evaluated: EvaluatedMove[]; adopted: boolean } {
  if (bookUci === null) return { evaluated, adopted: false };
  const idx = evaluated.findIndex((m) => m.uci === bookUci);
  if (idx < 0) return { evaluated, adopted: false };
  if (evaluated[idx].loss > BOOK_MAX_LOSS) return { evaluated, adopted: false };
  const book = evaluated[idx];
  const reordered = [book, ...evaluated.slice(0, idx), ...evaluated.slice(idx + 1)];
  return { evaluated: reordered, adopted: true };
}
