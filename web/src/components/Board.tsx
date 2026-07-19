import { useState } from "react";
import { Cell, CellMap, Piece, pieceGlyph, arrowLine } from "../lib/boardmodel";
import "./Board.css";

const FILES = ["a", "b", "c", "d", "e", "f", "g", "h"];
const RANKS = ["8", "7", "6", "5", "4", "3", "2", "1"];

// FEN の駒配置フィールドを解析し、square('e4') -> Piece の Map を返す。
// chess.js に依存せず Board 単体で完結させるための軽量パーサ。
function parseFenPieces(fen: string): Map<string, Piece> {
  const map = new Map<string, Piece>();
  const placement = fen.trim().split(/\s+/)[0] ?? "";
  const rows = placement.split("/");
  rows.forEach((row, rankIdx) => {
    const rank = 8 - rankIdx; // 先頭行が rank8
    let fileIdx = 0;
    for (const ch of row) {
      if (/\d/.test(ch)) {
        fileIdx += Number(ch);
        continue;
      }
      const square = FILES[fileIdx] + rank;
      const color = ch === ch.toUpperCase() ? "w" : "b";
      map.set(square, { type: ch.toLowerCase(), color });
      fileIdx += 1;
    }
  });
  return map;
}

// CellRole / choiceIndex を CSS クラス名へ写像する。
function roleClasses(cell: Cell): string {
  const classes = ["cell--" + cell.role.toLowerCase().replace(/_/g, "-")];
  if (cell.choiceIndex !== null) {
    classes.push("cell--choice-" + (cell.choiceIndex % 3));
  }
  // 開示後、選んだ手はその評価色(緑/黄/赤)で強調(識別色より優先)。
  if (cell.evalColor) {
    classes.push("cell--eval-" + cell.evalColor);
  }
  return classes.join(" ");
}

function pieceCode(piece: Piece): string {
  return piece.color + piece.type.toUpperCase();
}

function PieceView({ piece }: { piece: Piece }) {
  const [failed, setFailed] = useState(false);
  const code = pieceCode(piece);
  if (failed) {
    return (
      <span className={"piece piece--glyph piece--" + piece.color}>
        {pieceGlyph(piece)}
      </span>
    );
  }
  const src = `${import.meta.env.BASE_URL}pieces/${code}.svg`;
  return (
    <img
      className="piece piece--svg"
      src={src}
      alt={code}
      draggable={false}
      onError={() => setFailed(true)}
    />
  );
}

export interface BoardProps {
  fen: string;
  roles?: CellMap;
  flip?: boolean; // 後手視点
  // 着手のフラッシュ演出。flashSquare の升を点滅させ、flashKey が変わると再トリガー。
  flashSquare?: string | null;
  flashKey?: string | number;
  // 相手(CPU)の直前の手を盤上に矢印で示す。null なら描画しない。
  arrow?: { from: string; to: string } | null;
}

export function Board({
  fen,
  roles,
  flip = false,
  flashSquare = null,
  flashKey = 0,
  arrow = null,
}: BoardProps) {
  const pieces = parseFenPieces(fen);

  const files = flip ? [...FILES].reverse() : FILES;
  const ranks = flip ? [...RANKS].reverse() : RANKS;

  const cells = [];
  for (let r = 0; r < 8; r++) {
    for (let f = 0; f < 8; f++) {
      const square = files[f] + ranks[r];
      const rankNum = Number(ranks[r]);
      const fileIdx = FILES.indexOf(files[f]);
      const dark = (rankNum + fileIdx) % 2 === 1; // a1 が暗色
      const cellRole = roles?.get(square);
      // ロールが駒非表示(出発点など)を指示していればそれに従う。
      const showPiece = cellRole ? cellRole.showPiece : true;
      const piece = showPiece ? pieces.get(square) : undefined;

      const classNames = [
        "cell",
        dark ? "cell--dark" : "cell--light",
      ];
      if (cellRole) classNames.push(roleClasses(cellRole));

      const flashing = flashSquare !== null && square === flashSquare;

      cells.push(
        <div key={square} className={classNames.join(" ")} data-square={square}>
          {flashing && (
            <span
              key={"flash-" + flashKey}
              className="cell__flash"
              aria-hidden="true"
            />
          )}
          {f === 0 && <span className="coord coord--rank">{ranks[r]}</span>}
          {r === 7 && <span className="coord coord--file">{files[f]}</span>}
          {piece && <PieceView piece={piece} />}
        </div>,
      );
    }
  }

  const arrowLn = arrow ? arrowLine(arrow.from, arrow.to, flip) : null;

  return (
    <div className="board">
      {cells}
      {arrowLn && (
        <svg
          className="board__arrow"
          viewBox="0 0 8 8"
          preserveAspectRatio="none"
          aria-hidden="true"
        >
          <defs>
            <marker
              id="board-arrowhead"
              markerUnits="userSpaceOnUse"
              markerWidth="0.5"
              markerHeight="0.5"
              refX="0.42"
              refY="0.25"
              orient="auto"
            >
              <polygon points="0,0 0.5,0.25 0,0.5" fill="var(--lastmove)" />
            </marker>
          </defs>
          <line
            x1={arrowLn.x1}
            y1={arrowLn.y1}
            x2={arrowLn.x2}
            y2={arrowLn.y2}
            stroke="var(--lastmove)"
            strokeWidth={0.22}
            strokeLinecap="round"
            markerEnd="url(#board-arrowhead)"
          />
        </svg>
      )}
    </div>
  );
}

export default Board;
