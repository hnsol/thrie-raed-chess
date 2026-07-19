import { useRef, useState } from "react";
import PuzzleSelect from "./screens/PuzzleSelect";
import Puzzle from "./screens/Puzzle";
import EngineDebug from "./screens/EngineDebug";
import BattleSetup from "./screens/BattleSetup";
import Battle from "./screens/Battle";
import { getPuzzlesByDifficulty, type Puzzle as PuzzleData } from "./lib/puzzles";
import { defaultRng } from "./lib/rng";
import type { Color } from "./lib/session";
import type { StrategyId } from "./lib/openings";
import { UciClient } from "./engine/uci-client";
import "./App.css";

type Screen =
  | "menu"
  | "battle-setup"
  | "battle"
  | "puzzle-select"
  | "puzzle"
  | "engine-debug";

function Menu({
  onBattle,
  onPuzzle,
  onEngineDebug,
}: {
  onBattle: () => void;
  onPuzzle: () => void;
  onEngineDebug: () => void;
}) {
  return (
    <div className="app">
      <header className="app__header">
        <img className="app__title-logo" src={import.meta.env.BASE_URL + "title-logo.svg"} alt="" />
        <h1 className="app__title">Thrie Raed Chess</h1>
        <p className="app__subtitle">3択で覚えるチェス</p>
      </header>

      <nav className="menu">
        <button className="menu__btn" type="button" onClick={onBattle}>
          対戦
        </button>
        <button className="menu__btn" type="button" onClick={onPuzzle}>
          詰めチェス
        </button>
      </nav>

      <footer className="app__footer">
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
  const [battleCfg, setBattleCfg] = useState<{
    level: number;
    humanColor: Color;
    strategyId: StrategyId | null;
    key: number;
  } | null>(null);

  // エンジンは画面間で 1 個の Worker を再利用する(スペック準拠)。
  const clientRef = useRef<UciClient | null>(null);
  function getClient(): UciClient {
    if (!clientRef.current) clientRef.current = new UciClient();
    return clientRef.current;
  }

  function start(p: PuzzleData) {
    setPuzzle(p);
    setScreen("puzzle");
  }

  function startBattle(
    level: number,
    humanColor: Color,
    strategyId: StrategyId | null,
  ) {
    setBattleCfg((prev) => ({
      level,
      humanColor,
      strategyId,
      key: (prev?.key ?? 0) + 1,
    }));
    setScreen("battle");
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

  if (screen === "battle-setup") {
    return (
      <BattleSetup
        onStart={startBattle}
        onBack={() => setScreen("menu")}
      />
    );
  }

  if (screen === "battle" && battleCfg) {
    return (
      <div className="app app--battle">
        <Battle
          key={battleCfg.key}
          client={getClient()}
          cpuLevelIndex={battleCfg.level}
          humanColor={battleCfg.humanColor}
          strategyId={battleCfg.strategyId}
          onExit={() => setScreen("menu")}
        />
      </div>
    );
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
      onBattle={() => setScreen("battle-setup")}
      onPuzzle={() => setScreen("puzzle-select")}
      onEngineDebug={() => setScreen("engine-debug")}
    />
  );
}
