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

const SIDE_LABELS: Record<SideChoice, string> = {
  w: "先手(白)",
  b: "後手(黒)",
  random: "ランダム",
};

const SIDE_DESCS: Record<SideChoice, string> = {
  w: "先手(白)を担当",
  b: "後手(黒)を担当",
  random: "開始時にランダムで決定",
};

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

  const lv = CPU_LEVELS[level];
  const lvDesc = `${lv.name} — Skill ${lv.skill} / 深さ ${lv.depth}`;

  const stratDesc =
    strategyId === null
      ? "おまかせ — エンジンの最善手で選ぶ"
      : (() => {
          const s = STRATEGIES.find((st) => st.id === strategyId)!;
          return `${s.shortName} — ${s.tagline}`;
        })();

  return (
    <div className="app">
      <header className="app__header">
        <h1 className="app__title">対戦</h1>
        <p className="app__subtitle">難易度と手番を選ぶ</p>
      </header>

      <section className="bsetup__section">
        <div className="bsetup__section-head">
          <h2 className="bsetup__label">CPU の強さ</h2>
          <span className="bsetup__desc">{lvDesc}</span>
        </div>
        <div className="bsetup__levels-grid">
          {CPU_LEVELS.map((l, i) => (
            <button
              key={l.name}
              type="button"
              className={
                "bsetup__level" + (i === level ? " bsetup__level--on" : "")
              }
              onClick={() => setLevel(i)}
              aria-pressed={i === level}
            >
              {l.name}
            </button>
          ))}
        </div>
      </section>

      <section className="bsetup__section">
        <div className="bsetup__section-head">
          <h2 className="bsetup__label">あなたの手番</h2>
          <span className="bsetup__desc">{SIDE_DESCS[side]}</span>
        </div>
        <div className="bsetup__sides">
          {(["w", "b", "random"] as SideChoice[]).map((val) => (
            <button
              key={val}
              type="button"
              className={
                "bsetup__side" + (side === val ? " bsetup__side--on" : "")
              }
              onClick={() => setSide(val)}
              aria-pressed={side === val}
            >
              {SIDE_LABELS[val]}
            </button>
          ))}
        </div>
      </section>

      <section className="bsetup__section">
        <div className="bsetup__section-head">
          <h2 className="bsetup__label">序盤の戦略</h2>
          <span className="bsetup__desc">{stratDesc}</span>
        </div>
        <div className="bsetup__strat-grid">
          <button
            type="button"
            className={
              "bsetup__level" +
              (strategyId === null ? " bsetup__level--on" : "")
            }
            onClick={() => setStrategyId(null)}
            aria-pressed={strategyId === null}
          >
            おまかせ
          </button>
          {STRATEGIES.map((s) => (
            <button
              key={s.id}
              type="button"
              className={
                "bsetup__level" +
                (strategyId === s.id ? " bsetup__level--on" : "")
              }
              onClick={() => setStrategyId(s.id)}
              aria-pressed={strategyId === s.id}
            >
              {s.shortName}
            </button>
          ))}
        </div>
      </section>

      <div className="bsetup__actions">
        <button className="bsetup__start" type="button" onClick={start}>
          対戦開始
        </button>
        <button className="bsetup__back" type="button" onClick={onBack}>
          メニューへ戻る
        </button>
      </div>
    </div>
  );
}
