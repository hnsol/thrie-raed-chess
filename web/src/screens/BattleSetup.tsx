// 対戦の設定画面。CPU 難易度(5段階)と手番(先手/後手/ランダム)を選んで開始。
import { useState } from "react";
import { CPU_LEVELS, DEFAULT_CPU_LEVEL } from "../config";
import type { Color } from "../lib/session";
import { STRATEGIES, type StrategyId } from "../lib/openings";
import "./BattleSetup.css";

// UI 上の手番選択。ランダムは開始時に確定する。
type SideChoice = "w" | "b" | "random";

export interface BattleSetupProps {
  onStart: (
    cpuLevelIndex: number,
    humanColor: Color,
    strategyId: StrategyId | null,
  ) => void;
  onBack: () => void;
}

export default function BattleSetup({ onStart, onBack }: BattleSetupProps) {
  const [level, setLevel] = useState(DEFAULT_CPU_LEVEL);
  const [side, setSide] = useState<SideChoice>("random");
  // 序盤の戦略。null は「おまかせ」(現行動作、デフォルト)。
  const [strategyId, setStrategyId] = useState<StrategyId | null>(null);

  function start() {
    const humanColor: Color =
      side === "random" ? (Math.random() < 0.5 ? "w" : "b") : side;
    onStart(level, humanColor, strategyId);
  }

  return (
    <div className="app">
      <header className="app__header">
        <h1 className="app__title">対戦</h1>
        <p className="app__subtitle">難易度と手番を選ぶ</p>
      </header>

      <section className="bsetup__section">
        <h2 className="bsetup__label">CPU の強さ</h2>
        <div className="bsetup__levels">
          {CPU_LEVELS.map((lv, i) => (
            <button
              key={lv.name}
              type="button"
              className={
                "bsetup__level" + (i === level ? " bsetup__level--on" : "")
              }
              onClick={() => setLevel(i)}
              aria-pressed={i === level}
            >
              <span className="bsetup__level-name">{lv.name}</span>
              <span className="bsetup__level-sub">
                Skill {lv.skill} / 深さ {lv.depth}
              </span>
            </button>
          ))}
        </div>
      </section>

      <section className="bsetup__section">
        <h2 className="bsetup__label">あなたの手番</h2>
        <div className="bsetup__sides">
          {(
            [
              ["w", "先手(白)"],
              ["b", "後手(黒)"],
              ["random", "ランダム"],
            ] as [SideChoice, string][]
          ).map(([val, label]) => (
            <button
              key={val}
              type="button"
              className={
                "bsetup__side" + (side === val ? " bsetup__side--on" : "")
              }
              onClick={() => setSide(val)}
              aria-pressed={side === val}
            >
              {label}
            </button>
          ))}
        </div>
      </section>

      <section className="bsetup__section">
        <h2 className="bsetup__label">序盤の戦略</h2>
        <div className="bsetup__levels">
          <button
            type="button"
            className={
              "bsetup__level bsetup__strat" +
              (strategyId === null ? " bsetup__level--on" : "")
            }
            onClick={() => setStrategyId(null)}
            aria-pressed={strategyId === null}
          >
            <span className="bsetup__level-name">おまかせ</span>
            <span className="bsetup__level-sub">エンジンの最善手で選ぶ</span>
          </button>
          {STRATEGIES.map((s) => (
            <button
              key={s.id}
              type="button"
              className={
                "bsetup__level bsetup__strat" +
                (strategyId === s.id ? " bsetup__level--on" : "")
              }
              onClick={() => setStrategyId(s.id)}
              aria-pressed={strategyId === s.id}
            >
              <span className="bsetup__level-name">{s.name}</span>
              <span className="bsetup__level-sub">{s.tagline}</span>
            </button>
          ))}
        </div>
      </section>

      <div className="bsetup__actions">
        <button
          className="bsetup__start"
          type="button"
          onClick={start}
        >
          対戦開始
        </button>
        <button className="bsetup__back" type="button" onClick={onBack}>
          メニューへ戻る
        </button>
      </div>
    </div>
  );
}
