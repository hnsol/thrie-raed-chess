import { useMemo, useRef, useState } from "react";
import Board from "../components/Board";
import {
  choiceModel,
  lastmoveModel,
  puzzleResultModel,
  type CellMap,
  type Move,
} from "../lib/boardmodel";
import { PuzzleSession, PuzzlePhase } from "../lib/session";
import { mateLabel, type Puzzle as PuzzleData } from "../lib/puzzles";
import "./Puzzle.css";

export interface PuzzleProps {
  puzzle: PuzzleData;
  onAnother: () => void; // もう一問(同難易度からランダム)
  onBack: () => void; // 選択に戻る
}

const RESULT_MESSAGE: Record<string, string> = {
  [PuzzlePhase.SUCCESS]: "成功！チェックメイトです。",
  [PuzzlePhase.MISS]: "失敗。別の手を選びました。",
  [PuzzlePhase.FAIL]: "失敗。規定手数で詰みませんでした。",
  [PuzzlePhase.ABORTED]: "中断しました。",
};

// chess.js の履歴から直前の手(from/to)を取り出す。
function lastMove(session: PuzzleSession): Move | null {
  const hist = session.board.history({ verbose: true });
  if (hist.length === 0) return null;
  const last = hist[hist.length - 1];
  return { from: last.from, to: last.to };
}

export function Puzzle({ puzzle, onAnother, onBack }: PuzzleProps) {
  // セッションは puzzle 単位で保持。retry / puzzle 変更で作り直す。
  const sessionRef = useRef<PuzzleSession | null>(null);
  const puzzleIdRef = useRef<string | null>(null);
  if (sessionRef.current === null || puzzleIdRef.current !== puzzle.id) {
    sessionRef.current = new PuzzleSession(puzzle);
    puzzleIdRef.current = puzzle.id;
  }
  const session = sessionRef.current;

  // 手番側視点で盤を反転(解答者が黒番なら flip)。開始時の手番で固定。
  const flipRef = useRef<boolean>(session.board.turn() === "b");
  // 再描画トリガ。
  const [, setTick] = useState(0);
  const rerender = () => setTick((t) => t + 1);

  const finished = session.isFinished();
  const phase = session.phase;

  function handlePick(idx: number) {
    if (finished || phase !== PuzzlePhase.CHOOSING) return;
    if (session.focusedIdx === idx) {
      session.applyChoice(idx);
    } else {
      session.focus(idx);
    }
    rerender();
  }

  function retry() {
    sessionRef.current = new PuzzleSession(puzzle);
    flipRef.current = sessionRef.current.board.turn() === "b";
    rerender();
  }

  // 盤ハイライトモデル。
  const roles: CellMap = useMemo(() => {
    const board = session.board;
    if (finished && phase !== PuzzlePhase.ABORTED) {
      const mv = lastMove(session);
      if (mv && session.finalChoiceIdx !== null) {
        return puzzleResultModel(board, mv, session.finalChoiceIdx);
      }
      return new Map();
    }
    const model: CellMap = new Map();
    const lm = lastMove(session);
    if (lm) {
      for (const [k, v] of lastmoveModel(board, lm)) model.set(k, v);
    }
    for (const [k, v] of choiceModel(board, session.choices, session.focusedIdx))
      model.set(k, v);
    return model;
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [session, finished, phase, session.focusedIdx, session.idx]);

  const side = flipRef.current ? "黒番" : "白番";

  return (
    <div className="puzzle">
      <header className="puzzle__head">
        <button className="puzzle__back" type="button" onClick={onBack}>
          ← 選択に戻る
        </button>
        <div className="puzzle__meta">
          <span className="puzzle__mate">{mateLabel(puzzle)}</span>
          <span className="puzzle__rating">rating {puzzle.rating}</span>
        </div>
      </header>

      <p className="puzzle__prompt">
        {finished
          ? RESULT_MESSAGE[phase]
          : `手順 ${session.step}/${puzzle.mate_in}  ${side}  詰ませる手は？`}
      </p>

      <Board fen={session.board.fen()} roles={roles} flip={flipRef.current} />

      {!finished ? (
        <div className="puzzle__choices">
          {session.choices.map((c, i) => {
            const focused = session.focusedIdx === i;
            return (
              <button
                key={i}
                type="button"
                className={
                  "pchoice pchoice--" +
                  (i % 3) +
                  (focused ? " pchoice--focused" : "")
                }
                onClick={() => handlePick(i)}
              >
                <span className="pchoice__san">{c.san}</span>
                <span className="pchoice__sub">
                  {focused ? "もう一度タップで確定" : "タップでプレビュー"}
                </span>
              </button>
            );
          })}
        </div>
      ) : (
        <div className="puzzle__result">
          <div
            className={
              "puzzle__banner puzzle__banner--" + phase.toLowerCase()
            }
          >
            {RESULT_MESSAGE[phase]}
          </div>
          <div className="puzzle__actions">
            {phase === PuzzlePhase.MISS && (
              <button
                className="puzzle__act puzzle__act--primary"
                type="button"
                onClick={retry}
              >
                もう一度挑戦
              </button>
            )}
            <button
              className="puzzle__act puzzle__act--primary"
              type="button"
              onClick={onAnother}
            >
              もう一問
            </button>
            <button className="puzzle__act" type="button" onClick={onBack}>
              選択に戻る
            </button>
          </div>
        </div>
      )}
    </div>
  );
}

export default Puzzle;
