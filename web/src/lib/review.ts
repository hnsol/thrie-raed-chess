// thrie_raed_chess/review.py の移植。
//
// 対局の棋譜(PGN)と、LLM に渡すレビュー依頼文を組み立てる。クリップボード
// コピーは Web 用に share → clipboard → textarea の順でフォールバックする。

import { Chess } from "chess.js";
import { APP_NAME } from "../config";
import type { Color } from "./session";

export interface ReviewOptions {
  result?: string;
  termination?: string;
  humanColor?: Color; // "w" | "b"
}

// board(指了局面) から PGN 文字列を作る。ヘッダは Python 版 game_pgn 準拠。
// 元の board を汚さないよう、履歴を複製した盤で PGN を生成する。
export function gamePgn(board: Chess, opts: ReviewOptions = {}): string {
  const result = opts.result ?? "*";
  const termination = opts.termination ?? "Unfinished";
  const humanColor = opts.humanColor;

  // 履歴を複製(元 board のヘッダを変更しないため)。
  const game = new Chess();
  for (const m of board.history({ verbose: true })) {
    game.move({ from: m.from, to: m.to, promotion: m.promotion });
  }

  const white = humanColor === "b" ? "CPU" : "Human";
  const black = humanColor === "b" ? "Human" : "CPU";
  game.header(
    "Event", APP_NAME,
    "White", white,
    "Black", black,
    "Result", result,
    "Termination", termination,
  );
  return game.pgn();
}

// レビュー依頼文(Python 版 game_review_text と同一文面)。
export function gameReviewText(board: Chess, opts: ReviewOptions = {}): string {
  const pgn = gamePgn(board, opts);
  return (
    "この棋譜を見て、初心者向けに改善点を教えてください。\n" +
    "特に、悪手・見落とし・駒の動かし方の理解不足がありそうな場面を、" +
    "短く具体的に指摘してください。\n\n" +
    pgn
  );
}

// 共有/コピーの結果。UI のフィードバック表示に使う。
export type ShareOutcome = "shared" | "copied" | "manual";

// テキストを共有またはコピーする。
// navigator.share → navigator.clipboard.writeText → 選択済み textarea の順に
// フォールバックする。'manual' は自動コピーできず手動選択に委ねた場合。
export async function shareOrCopy(text: string): Promise<ShareOutcome> {
  // 1) Web Share API(主にモバイル)。
  if (typeof navigator !== "undefined" && typeof navigator.share === "function") {
    try {
      await navigator.share({ text });
      return "shared";
    } catch {
      // キャンセル/失敗時は次のフォールバックへ。
    }
  }

  // 2) Clipboard API。
  if (
    typeof navigator !== "undefined" &&
    navigator.clipboard &&
    typeof navigator.clipboard.writeText === "function"
  ) {
    try {
      await navigator.clipboard.writeText(text);
      return "copied";
    } catch {
      // 権限拒否等は手動フォールバックへ。
    }
  }

  // 3) 選択済み textarea を表示し、手動コピーに委ねる(execCommand 併用)。
  if (typeof document !== "undefined") {
    return copyViaTextarea(text) ? "copied" : "manual";
  }
  return "manual";
}

// 一時 textarea を使った execCommand("copy") フォールバック。
function copyViaTextarea(text: string): boolean {
  const ta = document.createElement("textarea");
  ta.value = text;
  ta.setAttribute("readonly", "");
  ta.style.position = "fixed";
  ta.style.top = "0";
  ta.style.left = "0";
  ta.style.opacity = "0";
  document.body.appendChild(ta);
  ta.focus();
  ta.select();
  let ok = false;
  try {
    ok = document.execCommand("copy");
  } catch {
    ok = false;
  }
  document.body.removeChild(ta);
  return ok;
}
