// thrie_raed_chess/boardmodel.py の移植。
//
// 升目の意味づけ(色付き表示の対象)を、実際の色の描画から切り離すモデル。
// square('e4' 等) -> Cell の Map を返す純関数群。Cell.role が
// 「なぜこの升が強調されているか」を表す。実際の色決定は描画側(Board)が行う。
//
// Python 版は python-chess の整数 square を使うが、ここでは chess.js の
// 代数表記文字列('e4' 等)に置き換えている。

export type Square = string;

export interface Piece {
  type: string; // 'p' | 'n' | 'b' | 'r' | 'q' | 'k'
  color: string; // 'w' | 'b'
}

// board.piece_at 相当。chess.js の Chess インスタンスや、get() を持つ
// 任意のオブジェクトを受け付ける(テストのためのモック互換)。
export interface PieceLookup {
  get(square: Square): Piece | false | null | undefined;
}

export interface Move {
  from: Square;
  to: Square;
}

// choices の各要素。Python では (move, score, extra) のタプルだが、
// M1 で必要なのは move のみ。
export interface Choice {
  move: Move;
}

export enum CellRole {
  LASTMOVE = "LASTMOVE", // 直前の相手の手(from/to)
  CHOICE = "CHOICE", // 3択の候補(常時表示)
  CHOICE_FOCUSED = "CHOICE_FOCUSED", // 3択のうち現在フォーカス中の1手
  CHOICE_DIMMED = "CHOICE_DIMMED", // 3択のうちフォーカスされていない残り
  RESULT_CHOSEN = "RESULT_CHOSEN", // 指した後: 選んだ手
  RESULT_OTHER = "RESULT_OTHER", // 指した後: 選ばなかった候補
}

export interface Cell {
  role: CellRole;
  choiceIndex: number | null; // 識別色配列の何番目を使うか
  piece: Piece | null;
  showPiece: boolean; // false なら升は空き表示(出発点など)
}

export type CellMap = Map<Square, Cell>;

function makeCell(
  role: CellRole,
  choiceIndex: number | null = null,
  piece: Piece | null = null,
  showPiece = true,
): Cell {
  return { role, choiceIndex, piece, showPiece };
}

function pieceAt(board: PieceLookup, square: Square): Piece | null {
  const p = board.get(square);
  return p ? (p as Piece) : null;
}

// 直前の1手。出発点=空き、着地点=動いた駒。
export function lastmoveModel(board: PieceLookup, move: Move): CellMap {
  const model: CellMap = new Map();
  model.set(move.from, makeCell(CellRole.LASTMOVE, null, null, false));
  model.set(
    move.to,
    makeCell(CellRole.LASTMOVE, null, pieceAt(board, move.to)),
  );
  return model;
}

// 3択を常時表示するモデル。
// focusedIndex が指定されていれば、その手だけ CHOICE_FOCUSED、残りは
// CHOICE_DIMMED になる。未指定(null)なら全て CHOICE(通常表示)。
export function choiceModel(
  board: PieceLookup,
  choices: Choice[],
  focusedIndex: number | null = null,
): CellMap {
  const model: CellMap = new Map();
  choices.forEach((choice, i) => {
    let role: CellRole;
    if (focusedIndex === null) {
      role = CellRole.CHOICE;
    } else if (i === focusedIndex) {
      role = CellRole.CHOICE_FOCUSED;
    } else {
      role = CellRole.CHOICE_DIMMED;
    }
    for (const sq of [choice.move.from, choice.move.to]) {
      const existing = model.get(sq);
      if (
        existing &&
        existing.role === CellRole.CHOICE_FOCUSED &&
        role !== CellRole.CHOICE_FOCUSED
      ) {
        continue;
      }
      model.set(sq, makeCell(role, i, pieceAt(board, sq)));
    }
  });
  return model;
}

// 指した後の盤(board は sel の手を適用済み)。
// 選んだ手はその識別色で単色表示(出発点=空き)、選ばなかった候補も
// 色付きで併記する。
export function resultModel(
  board: PieceLookup,
  choices: Choice[],
  sel: number,
): CellMap {
  const model: CellMap = new Map();
  choices.forEach((choice, i) => {
    if (i === sel) return;
    model.set(
      choice.move.from,
      makeCell(CellRole.RESULT_OTHER, i, pieceAt(board, choice.move.from)),
    );
    model.set(
      choice.move.to,
      makeCell(CellRole.RESULT_OTHER, i, pieceAt(board, choice.move.to)),
    );
  });
  const mv = choices[sel].move;
  model.set(mv.from, makeCell(CellRole.RESULT_CHOSEN, sel, null, false));
  model.set(
    mv.to,
    makeCell(CellRole.RESULT_CHOSEN, sel, pieceAt(board, mv.to)),
  );
  return model;
}

// 詰めチェス結果画面: 最終手を識別色で(出発点=空き、着地点=駒)。
export function puzzleResultModel(
  board: PieceLookup,
  move: Move,
  choiceIndex: number,
): CellMap {
  const model: CellMap = new Map();
  model.set(
    move.from,
    makeCell(CellRole.RESULT_CHOSEN, choiceIndex, null, false),
  );
  model.set(
    move.to,
    makeCell(CellRole.RESULT_CHOSEN, choiceIndex, pieceAt(board, move.to)),
  );
  return model;
}

// 白黒の区別が付くよう、全駒に「塗りつぶし記号」を使い色で分ける。
// (SVG 取得失敗時のフォールバック描画に使う)
const SOLID_GLYPHS: Record<string, string> = {
  P: "♟",
  N: "♞",
  B: "♝",
  R: "♜",
  Q: "♛",
  K: "♚",
};

export function pieceGlyph(piece: Piece | null): string {
  if (piece === null) return "";
  return SOLID_GLYPHS[piece.type.toUpperCase()] ?? "";
}
