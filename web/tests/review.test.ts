import { describe, it, expect } from "vitest";
import { Chess } from "chess.js";
import { gamePgn, gameReviewText } from "../src/lib/review";

// review.py の移植の検証。数手の短い対局を組み立て、PGN ヘッダとレビュー文面を
// スナップショット的に確認する(Date は chess.js 既定の "????.??.??" で決定的)。

function shortGame(): Chess {
  const board = new Chess();
  board.move("e4");
  board.move("e5");
  board.move("Nf3");
  return board;
}

describe("gamePgn", () => {
  it("人間=白のヘッダと棋譜(Python 版 game_pgn 準拠)", () => {
    const pgn = gamePgn(shortGame(), {
      result: "*",
      termination: "Unfinished",
      humanColor: "w",
    });
    expect(pgn).toBe(
      '[Event "Thrie Raed Chess"]\n' +
        '[Site "?"]\n' +
        '[Date "????.??.??"]\n' +
        '[Round "?"]\n' +
        '[White "Human"]\n' +
        '[Black "CPU"]\n' +
        '[Result "*"]\n' +
        '[Termination "Unfinished"]\n' +
        "\n" +
        "1. e4 e5 2. Nf3 *",
    );
  });

  it("人間=黒なら White/Black が入れ替わる", () => {
    const pgn = gamePgn(shortGame(), {
      result: "0-1",
      termination: "Checkmate",
      humanColor: "b",
    });
    expect(pgn).toContain('[White "CPU"]');
    expect(pgn).toContain('[Black "Human"]');
    expect(pgn).toContain('[Result "0-1"]');
    expect(pgn).toContain('[Termination "Checkmate"]');
  });

  it("元の board のヘッダを汚さない", () => {
    const board = shortGame();
    gamePgn(board, { humanColor: "w" });
    // 既定のまま(Event が上書きされていない)。
    expect(board.pgn()).toContain('[Event "?"]');
  });
});

describe("gameReviewText", () => {
  it("Python 版と同じ日本語プロンプト文面 + PGN", () => {
    const text = gameReviewText(shortGame(), {
      result: "*",
      termination: "Unfinished",
      humanColor: "w",
    });
    const pgn = gamePgn(shortGame(), {
      result: "*",
      termination: "Unfinished",
      humanColor: "w",
    });
    expect(text).toBe(
      "この棋譜を見て、初心者向けに改善点を教えてください。\n" +
        "特に、悪手・見落とし・駒の動かし方の理解不足がありそうな場面を、" +
        "短く具体的に指摘してください。\n\n" +
        pgn,
    );
  });
});
