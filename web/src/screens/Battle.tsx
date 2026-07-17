// 対戦画面。BattleSession の状態機械を駆動し、縦積みレイアウトで表示する。
// 評価バー → 盤 → 3択ボタン(プレビュー→確定)→ 開示(緑黄赤+loss)→ CPU 手番 →
// 終局(勝敗+統計)。エンジンは親から渡された 1 個の UciClient を再利用する。
import { useEffect, useMemo, useRef, useState } from "react";
import { Chess } from "chess.js";
import Board from "../components/Board";
import {
  choiceModel,
  lastmoveModel,
  resultModel,
  type CellMap,
  type Choice as BmChoice,
  type Move,
} from "../lib/boardmodel";
import {
  BattleSession,
  BattlePhase,
  type Color,
  type RevealedChoice,
} from "../lib/session";
import { moveFacts } from "../lib/evaluation";
import { parseUci } from "../lib/puzzles";
import { CPU_LEVELS } from "../config";
import type { UciClient } from "../engine/uci-client";
import "./Battle.css";

export interface BattleProps {
  client: UciClient;
  cpuLevelIndex: number;
  humanColor: Color;
  onExit: () => void; // メニューへ戻る
}

// 白 POV のセンチポーンを白の優勢シェア(0..1)に変換(評価バー用)。
function whiteShare(cp: number): number {
  return 1 / (1 + Math.pow(10, -cp / 400));
}

// chess.js の履歴から直前の手(from/to)を取り出す。
function lastMoveOf(board: Chess): Move | null {
  const hist = board.history({ verbose: true });
  if (hist.length === 0) return null;
  const last = hist[hist.length - 1];
  return { from: last.from, to: last.to };
}

export default function Battle({
  client,
  cpuLevelIndex,
  humanColor,
  onExit,
}: BattleProps) {
  const level = CPU_LEVELS[cpuLevelIndex] ?? CPU_LEVELS[1];

  // セッションは1回だけ生成。
  const sessionRef = useRef<BattleSession | null>(null);
  if (sessionRef.current === null) {
    sessionRef.current = new BattleSession({
      board: new Chess(),
      humanColor,
      cpuSkill: level.skill,
      cpuDepth: level.depth,
    });
  }
  const session = sessionRef.current;

  const flip = humanColor === "b";
  const [, setTick] = useState(0);
  const rerender = () => setTick((t) => t + 1);

  const [analyzing, setAnalyzing] = useState(false);
  const [analyzeDepth, setAnalyzeDepth] = useState(0);
  const [error, setError] = useState<string | null>(null);
  const [revealed, setRevealed] = useState<RevealedChoice[] | null>(null);
  const [showStats, setShowStats] = useState(false);
  // 直前に盤を動かしたのが人間か CPU か(終局ハイライトの判定用)。
  const lastMoverRef = useRef<"human" | "cpu" | null>(null);

  const cancelledRef = useRef(false);

  // 人間の手番を開始(解析→3択提示)。
  async function startHumanTurn() {
    setAnalyzing(true);
    setAnalyzeDepth(0);
    setRevealed(null);
    try {
      await session.prepareChoices(client, (depth) => {
        if (!cancelledRef.current) setAnalyzeDepth(depth);
      });
    } catch (e) {
      if (!cancelledRef.current) setError((e as Error).message);
      return;
    }
    if (cancelledRef.current) return;
    setAnalyzing(false);
    rerender();
  }

  // CPU の手番を実行。終局なら停止、そうでなければ次の人間手番へ。
  async function runCpuTurn() {
    session.beginCpuTurn();
    rerender();
    try {
      await session.applyCpuMove(client);
    } catch (e) {
      if (!cancelledRef.current) setError((e as Error).message);
      return;
    }
    if (cancelledRef.current) return;
    lastMoverRef.current = "cpu";
    if (session.isGameOver()) {
      rerender();
      return;
    }
    await startHumanTurn();
  }

  // 初回: エンジン初期化 → 後手なら CPU 先行 → 人間手番。
  useEffect(() => {
    cancelledRef.current = false;
    (async () => {
      try {
        await client.init();
      } catch (e) {
        if (!cancelledRef.current) setError((e as Error).message);
        return;
      }
      if (cancelledRef.current) return;
      // 人間が後手(手番でない)なら CPU が先に指す。
      if (session.humanColor !== session.board.turn()) {
        await runCpuTurn();
      } else {
        await startHumanTurn();
      }
    })();
    return () => {
      cancelledRef.current = true;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const phase = session.phase;

  // 3択のタップ処理: 1回目=プレビュー、同じ手を2回目=確定。
  function handlePick(idx: number) {
    if (phase !== BattlePhase.HUMAN_CHOOSING || analyzing) return;
    if (session.focusedIdx === idx) {
      const rev = session.applyChoice(idx);
      lastMoverRef.current = "human";
      setRevealed(rev);
      rerender();
    } else {
      session.focus(idx);
      rerender();
    }
  }

  // 開示後「次へ」: CPU 手番へ。
  function handleNext() {
    if (phase !== BattlePhase.REVEALED) return;
    void runCpuTurn();
  }

  function handleResign() {
    if (session.isGameOver()) return;
    session.resign();
    rerender();
  }

  // 盤ハイライトモデル。
  const roles: CellMap = useMemo(() => {
    const board = session.board;
    const bmChoices: BmChoice[] = session.choices.map((c) => ({
      move: parseUci(c.uci),
    }));

    if (phase === BattlePhase.HUMAN_CHOOSING) {
      const model: CellMap = new Map();
      const lm = lastMoveOf(board);
      if (lm) for (const [k, v] of lastmoveModel(board, lm)) model.set(k, v);
      for (const [k, v] of choiceModel(board, bmChoices, session.focusedIdx))
        model.set(k, v);
      return model;
    }

    const humanResult =
      session.chosenIdx !== null &&
      bmChoices.length > 0 &&
      lastMoverRef.current === "human";

    if (phase === BattlePhase.REVEALED) {
      return humanResult
        ? resultModel(board, bmChoices, session.chosenIdx as number)
        : new Map();
    }

    // CPU_THINKING / GAME_OVER: 直前が人間なら結果モデル、CPU なら lastmove。
    if (humanResult) {
      return resultModel(board, bmChoices, session.chosenIdx as number);
    }
    const lm = lastMoveOf(board);
    return lm ? lastmoveModel(board, lm) : new Map();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [phase, session, session.focusedIdx, session.chosenIdx, analyzing, revealed]);

  const share = whiteShare(session.positionEvalCp);
  const summary = session.stats.summary();
  const gameOver = phase === BattlePhase.GAME_OVER;

  return (
    <div className="battle">
      <header className="battle__head">
        <button className="battle__back" type="button" onClick={onExit}>
          ← メニュー
        </button>
        <span className="battle__level">
          CPU: {level.name}（あなた: {humanColor === "w" ? "白" : "黒"}）
        </span>
      </header>

      {/* 評価バー(横・細、白 POV) */}
      <div className="battle__evalbar" aria-label={`形勢 ${session.positionEval}`}>
        <div
          className="battle__evalbar-white"
          style={{ width: `${(share * 100).toFixed(1)}%` }}
        />
        <span className="battle__evaltext">{session.positionEval}</span>
      </div>

      <Board fen={session.board.fen()} roles={roles} flip={flip} />

      {error && <p className="battle__error">エラー: {error}</p>}

      {/* 状況に応じた下部 UI */}
      {gameOver ? (
        <div className="battle__over">
          <div className="battle__over-msg">{session.outcomeMessage()}</div>
          <div className="battle__over-result">{session.result}</div>
          <dl className="battle__stats">
            <div>
              <dt>手数</dt>
              <dd>{summary.moves}</dd>
            </div>
            <div>
              <dt>緑/黄/赤</dt>
              <dd>
                {summary.green}/{summary.yellow}/{summary.red}
              </dd>
            </div>
            <div>
              <dt>平均loss</dt>
              <dd>{summary.avgLoss}</dd>
            </div>
          </dl>
          <button className="battle__primary" type="button" onClick={onExit}>
            メニューへ
          </button>
        </div>
      ) : phase === BattlePhase.CPU_THINKING ? (
        <div className="battle__thinking">
          <span className="battle__spinner" aria-hidden="true" />
          CPU が考えています…
        </div>
      ) : analyzing ? (
        <div className="battle__choices">
          {[0, 1, 2].map((i) => (
            <div key={i} className="bchoice bchoice--skeleton">
              <span className="bchoice__san">解析中…</span>
              <span className="bchoice__sub">depth {analyzeDepth || "-"}</span>
            </div>
          ))}
        </div>
      ) : phase === BattlePhase.REVEALED && revealed ? (
        <div className="battle__revealed">
          <div className="battle__choices">
            {revealed.map((r, i) => (
              <div
                key={i}
                className={
                  "bchoice bchoice--" +
                  r.color +
                  (r.isChosen ? " bchoice--chosen" : "")
                }
              >
                <span className="bchoice__san">{r.san}</span>
                <span className="bchoice__meta">
                  loss {r.loss}
                  {r.isChosen ? "（選択）" : ""}
                  {r.facts.length ? " ・ " + r.facts.join(" / ") : ""}
                </span>
              </div>
            ))}
          </div>
          <button className="battle__primary" type="button" onClick={handleNext}>
            次へ
          </button>
        </div>
      ) : (
        <div className="battle__choices">
          {session.choices.map((c, i) => {
            const focused = session.focusedIdx === i;
            const facts = moveFacts(session.board, c.uci);
            return (
              <button
                key={i}
                type="button"
                className={
                  "bchoice bchoice--" + (i % 3) + (focused ? " bchoice--focused" : "")
                }
                onClick={() => handlePick(i)}
              >
                <span className="bchoice__san">{c.san}</span>
                <span className="bchoice__sub">
                  {facts.length ? facts.join(" / ") : "　"}
                </span>
                <span className="bchoice__hint">
                  {focused ? "もう一度タップで確定" : "タップでプレビュー"}
                </span>
              </button>
            );
          })}
        </div>
      )}

      {!gameOver && (
        <div className="battle__foot">
          <button
            className="battle__stats-toggle"
            type="button"
            onClick={() => setShowStats((v) => !v)}
          >
            統計 {showStats ? "▲" : "▼"}
          </button>
          <button
            className="battle__resign"
            type="button"
            onClick={handleResign}
          >
            投了
          </button>
        </div>
      )}

      {!gameOver && showStats && (
        <dl className="battle__stats battle__stats--sheet">
          <div>
            <dt>手数</dt>
            <dd>{summary.moves}</dd>
          </div>
          <div>
            <dt>緑/黄/赤</dt>
            <dd>
              {summary.green}/{summary.yellow}/{summary.red}
            </dd>
          </div>
          <div>
            <dt>平均loss</dt>
            <dd>{summary.avgLoss}</dd>
          </div>
          <div>
            <dt>直近</dt>
            <dd>
              {summary.lastColor
                ? `${summary.lastColor} ${summary.lastLoss}`
                : "-"}
            </dd>
          </div>
        </dl>
      )}
    </div>
  );
}
