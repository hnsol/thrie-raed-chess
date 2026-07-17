import { useMemo } from "react";
import { Chess } from "chess.js";
import Board from "./components/Board";
import { choiceModel, Choice } from "./lib/boardmodel";
import { APP_NAME } from "./config";
import "./App.css";

// 開発確認用のデモ: 初期局面に3択候補のハイライトを重ねる。
function BoardDemo() {
  const { fen, roles } = useMemo(() => {
    const chess = new Chess(); // 初期局面
    const choices: Choice[] = [
      { move: { from: "e2", to: "e4" } },
      { move: { from: "g1", to: "f3" } },
      { move: { from: "d2", to: "d4" } },
    ];
    return { fen: chess.fen(), roles: choiceModel(chess, choices) };
  }, []);

  return (
    <section className="demo">
      <h2 className="demo__title">Board デモ（3択ハイライト）</h2>
      <Board fen={fen} roles={roles} />
    </section>
  );
}

export default function App() {
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
        <button className="menu__btn" type="button" disabled>
          詰めチェス
          <span className="menu__badge">未実装</span>
        </button>
      </nav>

      <BoardDemo />

      <footer className="app__footer">M1: 基盤スキャフォールド</footer>
    </div>
  );
}
