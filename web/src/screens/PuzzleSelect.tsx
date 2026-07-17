import { useEffect, useState } from "react";
import {
  findPuzzleById,
  getPuzzlesByDifficulty,
  type Puzzle,
} from "../lib/puzzles";
import { defaultRng } from "../lib/rng";
import "./PuzzleSelect.css";

const MATE_TABS = [
  { mateIn: 2, label: "2手詰め" },
  { mateIn: 3, label: "3手詰め" },
  { mateIn: 4, label: "4手詰め" },
];

export interface PuzzleSelectProps {
  onStart: (puzzle: Puzzle) => void;
  onBack: () => void;
}

// TUI の PuzzleSelect/Difficulty/Number 画面をスマホ向けに1画面へ統合。
export function PuzzleSelect({ onStart, onBack }: PuzzleSelectProps) {
  const [mateIn, setMateIn] = useState(2);
  const [pool, setPool] = useState<Puzzle[] | null>(null);
  const [numInput, setNumInput] = useState("");
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let alive = true;
    setPool(null);
    setError(null);
    getPuzzlesByDifficulty(mateIn)
      .then((ps) => {
        if (alive) setPool(ps);
      })
      .catch(() => {
        if (alive) setError("問題の読み込みに失敗しました");
      });
    return () => {
      alive = false;
    };
  }, [mateIn]);

  function pickRandom() {
    if (!pool || pool.length === 0) return;
    const i = Math.floor(defaultRng() * pool.length);
    onStart(pool[i]);
  }

  async function pickByNumber() {
    const id = numInput.trim();
    if (!id) return;
    setError(null);
    // 問題番号は 1 始まりのインデックス、または puzzle id を受け付ける。
    if (pool && /^\d+$/.test(id)) {
      const n = Number(id);
      if (n >= 1 && n <= pool.length) {
        onStart(pool[n - 1]);
        return;
      }
    }
    const byId = await findPuzzleById(id);
    if (byId) {
      onStart(byId);
      return;
    }
    setError(`問題が見つかりません: ${id}`);
  }

  return (
    <div className="pselect">
      <header className="pselect__head">
        <button className="pselect__back" type="button" onClick={onBack}>
          ← 戻る
        </button>
        <h2 className="pselect__title">詰めチェス</h2>
      </header>

      <div className="pselect__tabs" role="tablist">
        {MATE_TABS.map((t) => (
          <button
            key={t.mateIn}
            type="button"
            role="tab"
            aria-selected={mateIn === t.mateIn}
            className={
              "pselect__tab" + (mateIn === t.mateIn ? " pselect__tab--on" : "")
            }
            onClick={() => setMateIn(t.mateIn)}
          >
            {t.label}
          </button>
        ))}
      </div>

      <p className="pselect__count">
        {pool === null ? "読み込み中…" : `${pool.length} 問`}
      </p>

      <button
        className="pselect__primary"
        type="button"
        onClick={pickRandom}
        disabled={!pool || pool.length === 0}
      >
        ランダムに出題
      </button>

      <div className="pselect__num">
        <label className="pselect__num-label">
          問題番号 / ID を指定（任意）
        </label>
        <div className="pselect__num-row">
          <input
            className="pselect__num-input"
            type="text"
            inputMode="text"
            value={numInput}
            placeholder={pool ? `1〜${pool.length} または ID` : "…"}
            onChange={(e) => setNumInput(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === "Enter") pickByNumber();
            }}
          />
          <button
            className="pselect__num-go"
            type="button"
            onClick={pickByNumber}
            disabled={!numInput.trim()}
          >
            出題
          </button>
        </div>
      </div>

      {error && <p className="pselect__error">{error}</p>}
    </div>
  );
}

export default PuzzleSelect;
