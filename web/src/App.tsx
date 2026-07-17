import { useState } from "react";
import PuzzleSelect from "./screens/PuzzleSelect";
import Puzzle from "./screens/Puzzle";
import EngineDebug from "./screens/EngineDebug";
import { getPuzzlesByDifficulty, type Puzzle as PuzzleData } from "./lib/puzzles";
import { defaultRng } from "./lib/rng";
import { APP_NAME } from "./config";
import "./App.css";

type Screen = "menu" | "puzzle-select" | "puzzle" | "engine-debug";

function Menu({
  onPuzzle,
  onEngineDebug,
}: {
  onPuzzle: () => void;
  onEngineDebug: () => void;
}) {
  return (
    <div className="app">
      <header className="app__header">
        <h1 className="app__title">{APP_NAME}</h1>
        <p className="app__subtitle">3択で覚えるチェス</p>
      </header>

      <nav className="menu">
        <button className="menu__btn" type="button" disabled>
          対戦
          <span className="menu__badge">未実装</span>
        </button>
        <button className="menu__btn" type="button" onClick={onPuzzle}>
          詰めチェス
        </button>
      </nav>

      <footer className="app__footer">
        M2: パズルモード
        <br />
        <button
          type="button"
          className="app__debug-link"
          onClick={onEngineDebug}
        >
          エンジン確認
        </button>
      </footer>
    </div>
  );
}

export default function App() {
  const [screen, setScreen] = useState<Screen>("menu");
  const [puzzle, setPuzzle] = useState<PuzzleData | null>(null);

  function start(p: PuzzleData) {
    setPuzzle(p);
    setScreen("puzzle");
  }

  // もう一問: 現在の問題と同じ難易度からランダムに次を出題。
  async function another() {
    if (!puzzle) return;
    const pool = await getPuzzlesByDifficulty(puzzle.mate_in);
    if (pool.length === 0) return;
    const next = pool[Math.floor(defaultRng() * pool.length)];
    setPuzzle(next);
    setScreen("puzzle");
  }

  if (screen === "puzzle" && puzzle) {
    return (
      <div className="app">
        <Puzzle
          puzzle={puzzle}
          onAnother={another}
          onBack={() => setScreen("puzzle-select")}
        />
      </div>
    );
  }

  if (screen === "puzzle-select") {
    return (
      <div className="app">
        <PuzzleSelect onStart={start} onBack={() => setScreen("menu")} />
      </div>
    );
  }

  if (screen === "engine-debug") {
    return <EngineDebug onBack={() => setScreen("menu")} />;
  }

  return (
    <Menu
      onPuzzle={() => setScreen("puzzle-select")}
      onEngineDebug={() => setScreen("engine-debug")}
    />
  );
}
