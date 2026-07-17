// エンジン確認用のデバッグ画面。スマホ実機での解析性能を実測する。
// FEN を入力して「解析」すると init 時間・depth 進捗・最終 depth・所要時間・
// 上位 5 PvLine を表示する。
import { useRef, useState } from "react";
import { Chess } from "chess.js";
import { UciClient, pvScore, type PvLine } from "../engine/uci-client";
import { ANALYSIS_DEPTH, ANALYSIS_MOVETIME_MS } from "../config";
import "./EngineDebug.css";

const START_FEN = "rnbqkbnr/pppppppp/8/8/8/8/PPPPPPPP/RNBQKBNR w KQkq - 0 1";

function legalMoveCount(fen: string): number {
  try {
    return new Chess(fen).moves().length;
  } catch {
    return 0;
  }
}

function scoreLabel(l: PvLine): string {
  if (l.matePov !== null) return `mate ${l.matePov}`;
  return `cp ${l.cpPov} (${pvScore(l)})`;
}

export default function EngineDebug({ onBack }: { onBack: () => void }) {
  const [fen, setFen] = useState(START_FEN);
  const [status, setStatus] = useState("待機中");
  const [initMs, setInitMs] = useState<number | null>(null);
  const [progress, setProgress] = useState<number[]>([]);
  const [finalDepth, setFinalDepth] = useState<number | null>(null);
  const [analyseMs, setAnalyseMs] = useState<number | null>(null);
  const [lines, setLines] = useState<PvLine[]>([]);
  const [busy, setBusy] = useState(false);
  const clientRef = useRef<UciClient | null>(null);

  async function run() {
    if (busy) return;
    setBusy(true);
    setProgress([]);
    setFinalDepth(null);
    setAnalyseMs(null);
    setLines([]);

    const multiPv = Math.max(1, legalMoveCount(fen));

    try {
      if (!clientRef.current) {
        clientRef.current = new UciClient();
        setStatus("エンジン初期化中…");
        const t0 = performance.now();
        await clientRef.current.init();
        setInitMs(Math.round(performance.now() - t0));
      }
      const client = clientRef.current;

      setStatus(`解析中… (MultiPV=${multiPv}, depth=${ANALYSIS_DEPTH})`);
      const seen: number[] = [];
      const t0 = performance.now();
      const result = await client.analyse(
        fen,
        {
          depth: ANALYSIS_DEPTH,
          multiPv,
          movetimeMs: ANALYSIS_MOVETIME_MS,
        },
        (depth, cur) => {
          seen.push(depth);
          setProgress([...seen]);
          setFinalDepth(depth);
          setLines(cur.slice(0, 5));
        },
      );
      const dt = Math.round(performance.now() - t0);
      setAnalyseMs(dt);
      setFinalDepth(result[0]?.depth ?? null);
      setLines(result.slice(0, 5));
      setStatus("完了");
    } catch (e) {
      setStatus(`エラー: ${(e as Error).message}`);
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="app">
      <header className="app__header">
        <h1 className="app__title">エンジン確認</h1>
        <p className="app__subtitle">Stockfish WASM 動作/性能チェック</p>
      </header>

      <div className="edbg">
        <label className="edbg__label" htmlFor="fen">
          FEN
        </label>
        <textarea
          id="fen"
          className="edbg__fen"
          value={fen}
          onChange={(e) => setFen(e.target.value)}
          rows={2}
          spellCheck={false}
        />
        <div className="edbg__row">
          <button
            className="edbg__btn"
            type="button"
            onClick={run}
            disabled={busy}
          >
            {busy ? "解析中…" : "解析"}
          </button>
          <button
            className="edbg__btn edbg__btn--ghost"
            type="button"
            onClick={() => setFen(START_FEN)}
            disabled={busy}
          >
            初期局面
          </button>
        </div>

        <dl className="edbg__stats">
          <dt>状態</dt>
          <dd>{status}</dd>
          <dt>init 時間</dt>
          <dd>{initMs === null ? "-" : `${initMs} ms`}</dd>
          <dt>合法手数(MultiPV)</dt>
          <dd>{legalMoveCount(fen)}</dd>
          <dt>depth 進捗</dt>
          <dd>{progress.length ? progress.join(" ") : "-"}</dd>
          <dt>最終 depth</dt>
          <dd>{finalDepth ?? "-"}</dd>
          <dt>解析時間</dt>
          <dd>{analyseMs === null ? "-" : `${analyseMs} ms`}</dd>
        </dl>

        <div className="edbg__lines">
          <div className="edbg__lines-title">上位 {lines.length} PvLine</div>
          {lines.map((l) => (
            <div key={l.multipv} className="edbg__line">
              <span className="edbg__mpv">#{l.multipv}</span>
              <span className="edbg__depth">d{l.depth}</span>
              <span className="edbg__score">{scoreLabel(l)}</span>
              <span className="edbg__pv">{l.pv.slice(0, 6).join(" ")}</span>
            </div>
          ))}
        </div>
      </div>

      <nav className="menu">
        <button className="menu__btn" type="button" onClick={onBack}>
          戻る
        </button>
      </nav>
    </div>
  );
}
