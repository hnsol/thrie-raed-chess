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
import { parseUci } from "../lib/puzzles";
import { getStrategy, type StrategyId } from "../lib/openings";
import { MOVEMENT_HELP } from "../lib/stats";
import { CoachCommenter } from "../lib/coach";
import { gameReviewText, shareOrCopy } from "../lib/review";
import CoachBubble from "../components/CoachBubble";
import { CPU_LEVELS } from "../config";
import type { UciClient } from "../engine/uci-client";
import "./Battle.css";

export interface BattleProps {
  client: UciClient;
  cpuLevelIndex: number;
  humanColor: Color;
  strategyId: StrategyId | null; // 序盤の定跡戦略(null=おまかせ)
  onExit: () => void; // メニューへ戻る
}

// 戦略名 "まっすぐ攻める（イタリアン流）" から括弧内の短い名前 "イタリアン流" を取り出す。
function strategyShortName(name: string): string {
  const m = name.match(/（(.+?)）/);
  return m ? m[1] : name;
}

// 白 POV のセンチポーンを白の優勢シェア(0..1)に変換(評価バー用)。
function whiteShare(cp: number): number {
  return 1 / (1 + Math.pow(10, -cp / 400));
}

// chess.js の履歴から末尾から n 番目(0=直前)の手(from/to)を取り出す。
function nthLastMove(board: Chess, n = 0): Move | null {
  const hist = board.history({ verbose: true });
  const mv = hist[hist.length - 1 - n];
  return mv ? { from: mv.from, to: mv.to } : null;
}

// chess.js の履歴から直前の手(from/to)を取り出す。
function lastMoveOf(board: Chess): Move | null {
  return nthLastMove(board, 0);
}

export default function Battle({
  client,
  cpuLevelIndex,
  humanColor,
  strategyId,
  onExit,
}: BattleProps) {
  const level = CPU_LEVELS[cpuLevelIndex] ?? CPU_LEVELS[1];
  const strategy = getStrategy(strategyId);

  // セッションは1回だけ生成。
  const sessionRef = useRef<BattleSession | null>(null);
  if (sessionRef.current === null) {
    sessionRef.current = new BattleSession({
      board: new Chess(),
      humanColor,
      cpuSkill: level.skill,
      cpuDepth: level.depth,
      strategy,
    });
  }
  const session = sessionRef.current;

  // コーチも1回だけ生成(履歴回避 deque を保持するため使い回す)。
  const coachRef = useRef<CoachCommenter | null>(null);
  if (coachRef.current === null) coachRef.current = new CoachCommenter();
  const coach = coachRef.current;

  const flip = humanColor === "b";
  const [, setTick] = useState(0);
  const rerender = () => setTick((t) => t + 1);

  const [analyzing, setAnalyzing] = useState(false);
  const [analyzeDepth, setAnalyzeDepth] = useState(0);
  // エンジン(WASM)起動中フラグ。init 完了までローディングを出す。
  const [initializing, setInitializing] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [revealed, setRevealed] = useState<RevealedChoice[] | null>(null);
  const [coachComment, setCoachComment] = useState<string | null>(null);
  const [reviewFeedback, setReviewFeedback] = useState<string | null>(null);
  const [manualReviewText, setManualReviewText] = useState<string | null>(null);
  const [showStats, setShowStats] = useState(false);
  // 下部シートのタブ(統計 / 駒の動かし方 / 棋譜)。
  const [sheetTab, setSheetTab] = useState<"stats" | "help" | "moves">("stats");
  // 直前に盤を動かしたのが人間か CPU か(終局ハイライトの判定用)。
  const lastMoverRef = useRef<"human" | "cpu" | null>(null);

  // 着手フラッシュ。手が盤に反映されるたび(人間/CPU 問わず)到達マスを1回点滅。
  // seq は手ごとにインクリメントし、Board 側の key を変えてアニメを再トリガーする。
  // 解析中〜3択表示中の再描画では seq が変わらないため点滅は再発火しない(1回分)。
  const [flash, setFlash] = useState<{ sq: string; seq: number } | null>(null);
  const flashSeqRef = useRef(0);
  const prevPlyRef = useRef(0);

  const cancelledRef = useRef(false);
  // StrictMode(dev) は effect を2回実行する。共有セッションへの二重の CPU 着手
  // (Invalid move) を防ぐため、起動シーケンスは1回だけ走らせる。
  const bootedRef = useRef(false);

  // 人間の手番を開始(解析→3択提示)。
  async function startHumanTurn() {
    setAnalyzing(true);
    setAnalyzeDepth(0);
    setRevealed(null);
    setCoachComment(null);
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
    if (bootedRef.current) return;
    bootedRef.current = true;
    cancelledRef.current = false;
    (async () => {
      try {
        await client.init();
      } catch (e) {
        if (!cancelledRef.current) {
          setError((e as Error).message);
          setInitializing(false);
        }
        return;
      }
      if (cancelledRef.current) return;
      setInitializing(false);
      // 人間が後手(手番でない)なら CPU が先に指す。
      if (session.humanColor !== session.board.turn()) {
        await runCpuTurn();
      } else {
        await startHumanTurn();
      }
    })();
    return () => {
      cancelledRef.current = true;
      // StrictMode の疑似アンマウント後の再実行で起動し直せるように戻す。
      // (中断された旧ランは cancelledRef のチェックポイントで抜ける)
      bootedRef.current = false;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const phase = session.phase;

  // 盤に新しい手が反映されたら着手フラッシュを発火する。verbose 履歴の手数が
  // 増えた時だけ seq を進め、それ以外の再描画では点滅を再発火させない。
  useEffect(() => {
    const hist = session.board.history({ verbose: true });
    if (hist.length !== prevPlyRef.current) {
      prevPlyRef.current = hist.length;
      const last = hist[hist.length - 1];
      if (last) {
        flashSeqRef.current += 1;
        setFlash({ sq: last.to, seq: flashSeqRef.current });
      }
    }
  });

  // 3択のタップ処理: 1回目=プレビュー、同じ手を2回目=確定。
  function handlePick(idx: number) {
    if (phase !== BattlePhase.HUMAN_CHOOSING || analyzing) return;
    if (session.focusedIdx === idx) {
      const rev = session.applyChoice(idx);
      // 開示のフィードバックとして短く振動(未対応/iOS では自動的に no-op)。
      navigator.vibrate?.(15);
      lastMoverRef.current = "human";
      setRevealed(rev);
      // 終局でなければ、指した手にコーチコメントを付ける(TUI と同じタイミング)。
      if (session.phase === BattlePhase.REVEALED) {
        const chosen = rev[idx];
        // 序盤で定跡手が候補に採用された手番のみ、定跡言及用の opening を渡す。
        // bookInfo が null(戦略なし/序盤外/非採用)の手番は従来どおり第5引数なし。
        const opening = session.bookInfo
          ? {
              strategyName: session.bookInfo.strategyName,
              openingName: session.bookInfo.openingName,
              followedBook: chosen.isBook,
            }
          : undefined;
        setCoachComment(
          coach.comment(
            chosen.loss,
            chosen.color,
            chosen.facts,
            session.board,
            opening,
          ),
        );
      } else {
        setCoachComment(null);
      }
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

  // レビュー用プロンプトを共有/コピー(share → clipboard → textarea)。
  async function handleShareReview() {
    const text = gameReviewText(session.board, {
      result: session.result,
      termination: session.termination,
      humanColor,
    });
    const outcome = await shareOrCopy(text);
    setReviewFeedback(
      outcome === "shared"
        ? "共有しました"
        : outcome === "copied"
          ? "コピーしました"
          : "自動コピーできませんでした。表示されたテキストを手動でコピーしてください。",
    );
    setManualReviewText(outcome === "manual" ? text : null);
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

    const colors = session.choices.map((c) => c.color);

    if (phase === BattlePhase.REVEALED) {
      const model: CellMap = new Map();
      // 直近の相手(CPU)の手=人間手の1つ前。result(選んだ手/他候補)より下に
      // 敷いて、重ならないマスの薄黄を維持する。
      const cpuMv = nthLastMove(board, 1);
      if (cpuMv) for (const [k, v] of lastmoveModel(board, cpuMv)) model.set(k, v);
      if (humanResult) {
        for (const [k, v] of resultModel(
          board,
          bmChoices,
          session.chosenIdx as number,
          colors,
        ))
          model.set(k, v);
      }
      return model;
    }

    // CPU_THINKING / GAME_OVER: 直前が人間なら結果モデル、CPU なら lastmove。
    if (humanResult) {
      return resultModel(board, bmChoices, session.chosenIdx as number, colors);
    }
    const lm = lastMoveOf(board);
    return lm ? lastmoveModel(board, lm) : new Map();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [phase, session, session.focusedIdx, session.chosenIdx, analyzing, revealed]);

  const share = whiteShare(session.positionEvalCp);
  const summary = session.stats.summary();
  const gameOver = phase === BattlePhase.GAME_OVER;

  const history = session.board.history();

  // 棋譜: SAN を手番号付きで整形(1. e4 e5 2. Nf3 ...)。
  const movePairs: { no: number; white: string; black: string }[] = [];
  for (let i = 0; i < history.length; i += 2) {
    movePairs.push({
      no: i / 2 + 1,
      white: history[i],
      black: history[i + 1] ?? "",
    });
  }

  return (
    <div className="battle">
      <header className="battle__head">
        <button className="battle__back" type="button" onClick={onExit}>
          ← メニュー
        </button>
        <span className="battle__level">
          CPU: {level.name}（あなた: {humanColor === "w" ? "白" : "黒"}
          {strategy ? "・" + strategyShortName(strategy.name) : ""}）
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

      <div
        style={{ display: "contents" }}
        onClick={() => {
          if (phase === BattlePhase.HUMAN_CHOOSING && !analyzing && session.focusedIdx !== null) {
            session.clearFocus();
            rerender();
          }
        }}
      >
        <Board
          fen={session.board.fen()}
          roles={roles}
          flip={flip}
          flashSquare={flash?.sq ?? null}
          flashKey={flash?.seq ?? 0}
        />
      </div>

      {!gameOver && !error && <CoachBubble comment={coachComment} />}

      {/* 状況に応じた下部 UI。盤より上は非スクロール領域とし、ここだけが
          スクロール可能。内容が増減しても盤の位置は物理的に動かない。 */}
      <div className="battle__lower">
      {error ? (
        <div className="battle__error" role="alert">
          <div className="battle__error-title">
            エンジンを起動できませんでした
          </div>
          <p className="battle__error-detail">{error}</p>
          <p className="battle__error-hint">
            通信環境を確認して再度お試しください。
            <br />
            パズルモードはエンジン不要で遊べます。
          </p>
          <button className="battle__back" type="button" onClick={onExit}>
            メニューへ
          </button>
        </div>
      ) : initializing ? (
        <div className="battle__thinking">
          <span className="battle__spinner" aria-hidden="true" />
          エンジンを起動しています…
        </div>
      ) : gameOver ? (
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
          <button
            className="battle__primary"
            type="button"
            onClick={handleShareReview}
          >
            レビュー用プロンプトを共有/コピー
          </button>
          {reviewFeedback && (
            <div className="battle__review-feedback" role="status">
              {reviewFeedback}
            </div>
          )}
          {manualReviewText !== null && (
            <textarea
              className="battle__review-text"
              readOnly
              value={manualReviewText}
              rows={8}
              onFocus={(e) => e.currentTarget.select()}
            />
          )}
          <button className="battle__back" type="button" onClick={onExit}>
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
                  {/* 定跡バッジは行を増やさず meta 行に同居させる(次へボタンが
                      画面外へ押し出されるのを防ぐ) */}
                  {r.isBook && session.bookInfo && (
                    <span className="bchoice__book">
                      {" ・ 📖 " + session.bookInfo.openingName}
                    </span>
                  )}
                </span>
              </div>
            ))}
          </div>
        </div>
      ) : (
        <div className="battle__choices">
          {session.choices.map((c, i) => {
            const focused = session.focusedIdx === i;
            // 選択前は facts(ヒント)を出さない。SAN と操作案内のみ。
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
                <span className="bchoice__hint">
                  {focused ? "もう一度タップで確定" : "タップでプレビュー"}
                </span>
              </button>
            );
          })}
        </div>
      )}

      {!gameOver && !error && !initializing && (
        <div className="battle__foot">
          {phase === BattlePhase.REVEALED ? (
            // REVEALED 中は全幅「次へ」に差し替え(統計・投了は次の手番で復帰)。
            <button
              className="battle__primary"
              type="button"
              onClick={handleNext}
            >
              次へ
            </button>
          ) : (
            <>
              <button
                className="battle__stats-toggle"
                type="button"
                onClick={() => setShowStats((v) => !v)}
              >
                統計・情報 {showStats ? "▲" : "▼"}
              </button>
              <button
                className="battle__resign"
                type="button"
                onClick={handleResign}
              >
                投了
              </button>
            </>
          )}
        </div>
      )}
      </div>

      {!gameOver && showStats && (
        <>
          <button
            className="battle__sheet-backdrop"
            type="button"
            aria-label="閉じる"
            onClick={() => setShowStats(false)}
          />
          <div className="battle__sheet" role="dialog" aria-label="統計・情報">
            <div className="battle__sheet-tabs" role="tablist">
              <button
                type="button"
                role="tab"
                aria-selected={sheetTab === "stats"}
                className={
                  "battle__tab" + (sheetTab === "stats" ? " battle__tab--active" : "")
                }
                onClick={() => setSheetTab("stats")}
              >
                統計
              </button>
              <button
                type="button"
                role="tab"
                aria-selected={sheetTab === "help"}
                className={
                  "battle__tab" + (sheetTab === "help" ? " battle__tab--active" : "")
                }
                onClick={() => setSheetTab("help")}
              >
                駒の動かし方
              </button>
              <button
                type="button"
                role="tab"
                aria-selected={sheetTab === "moves"}
                className={
                  "battle__tab" + (sheetTab === "moves" ? " battle__tab--active" : "")
                }
                onClick={() => setSheetTab("moves")}
              >
                棋譜
              </button>
              <button
                type="button"
                className="battle__sheet-close"
                aria-label="閉じる"
                onClick={() => setShowStats(false)}
              >
                ✕
              </button>
            </div>

            <div className="battle__sheet-body">
              {sheetTab === "stats" && (
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

              {sheetTab === "help" && (
                <ul className="battle__help">
                  {MOVEMENT_HELP.map((p) => (
                    <li key={p.name} className="battle__help-item">
                      <img
                        className="battle__help-glyph"
                        src={`${import.meta.env.BASE_URL}pieces/${p.code}.svg`}
                        alt=""
                        aria-hidden="true"
                      />
                      <span className="battle__help-name">{p.name}</span>
                      <span className="battle__help-move">{p.move}</span>
                    </li>
                  ))}
                </ul>
              )}

              {sheetTab === "moves" && (
                <ol className="battle__moves">
                  {movePairs.length === 0 ? (
                    <li className="battle__moves-empty">まだ手がありません</li>
                  ) : (
                    movePairs.map((m) => (
                      <li key={m.no} className="battle__moves-row">
                        <span className="battle__moves-no">{m.no}.</span>
                        <span className="battle__moves-san">{m.white}</span>
                        <span className="battle__moves-san">{m.black}</span>
                      </li>
                    ))
                  )}
                </ol>
              )}
            </div>
          </div>
        </>
      )}
    </div>
  );
}
