# Thrie Raed Chess — スマホWebアプリ移植計画

## Context

TUI版「3択で覚えるチェス」（Textual + python-chess + Stockfish）をスマホで遊べるようにする。ユーザー決定事項:

- **スマホ最適UX**（タップ前提の新規UI設計、TUI移植ではない）
- **全機能**: 対戦モード（難易度5段階・コーチコメント・3択候補手・緑黄赤評価・評価バー・統計）＋パズルモード（2/3/4手詰め）＋レビュー出力
- **完全クライアントサイド**: stockfish WASM（Web Worker）、GitHub Pages配信、PWA/オフライン対応
- **スタック**: Vite + React + TypeScript、同一リポの `web/` に配置

既存コードは `tui/` 以外（evaluation/session/coach/puzzles/stats/boardmodel）が純ロジックでTSへ素直に移植可能。puzzles.json（905KB・3000問）はそのまま流用。

## 構成

```
web/
├── vite.config.ts            # base=リポ名（env切替）、vite-plugin-pwa
├── public/engine/            # stockfish lite single-thread build (vendor)
├── public/pieces/            # SVG駒セット（cburnett等、ライセンス記載）
├── src/
│   ├── App.tsx               # useStateベースの画面遷移（router不要）
│   ├── config.ts             # ANALYSIS_DEPTH=12, GREEN_MAX=30, YELLOW_MAX=150, CPU_LEVELS, ANALYSIS_MOVETIME_MS
│   ├── lib/                  # UI非依存の移植ロジック
│   │   ├── evaluation.ts     # classify / evaluateAllMoves / pickThree / moveFacts
│   │   ├── session.ts        # BattleSession / PuzzleSession（Python同名フェーズ）
│   │   ├── coach.ts          # 日本語フレーズ表を逐語コピー、deque(4)重複防止
│   │   ├── puzzles.ts        # dynamic importで遅延ロード
│   │   ├── stats.ts / boardmodel.ts / review.ts / rng.ts（seedable mulberry32）
│   ├── engine/
│   │   ├── uci-client.ts     # Promise型UCIクライアント（analyse/bestMove/queue直列化）
│   │   └── engine.worker.ts
│   ├── screens/              # Menu, BattleSetup, Battle, PuzzleSelect, Puzzle, Review
│   ├── components/           # Board, ChoiceButtons, CoachBubble, EvalBar, StatsPanel
│   └── data/puzzles.json     # prebuildスクリプトで ../thrie_raed_chess/data/ からコピー（gitignore）
└── tests/                    # vitest
```

## 主要技術判断

- **チェスライブラリ**: chess.js v1（python-chess Boardと1:1対応、PGN出力あり。`attackers()` で `move_facts` のhangs判定を移植）
- **Stockfish**: nmrugg `stockfish` npm の **single-thread lite build**（~7MB）。GH PagesはCOOP/COEP不可→SharedArrayBuffer使えないためシングルスレッド固定。coi-serviceworkerは後日の選択肢としてのみ記録
- **モバイル性能対策**（depth12 MultiPV≈30は単スレでは重い）:
  1. `go depth 12 movetime 4000` キャップ（完了した最深depthを採用）
  2. onProgressで途中depth結果から先に3択表示、確定時にloss/色のみ更新（ボタン順は固定）
  3. 評価バーはMultiPV line1のスコア流用で追加探索なし
- **UCIスコア**: cp/mateはside-to-move POV（Pythonの `pov(turn)` と同じ）、mate→±10000スケール変換
- **CPU手**: MultiPV=1 + `Skill Level` + depth（config.ts の CPU_LEVELS: 入門(0,4)〜最強(20,12)）

## UI（縦持ち ~390px 基準）

- 画面遷移: Menu →（難易度+先後選択）→ Battle / Menu → PuzzleSelect → Puzzle / 終局 → Reviewシート
- Board: CSS grid 8×8、SVG駒、boardmodel.tsのロール→CSSクラス。後手時は盤反転。タップ移動なし（3択ボタンのみ）
- Battle縦積み: 評価バー（横・細）→ 盤 → コーチ吹き出し（固定高）→ 3択ボタン（全幅・≥48px、1タップ目=盤上プレビュー、2タップ目=確定）→ 公開後は緑黄赤+loss表示 → 「次へ」でCPU手番（スピナー）。統計はボトムシート
- safe-area対応、`touch-action: manipulation`、ダークテーマ基調
- review.ts: `navigator.share` → clipboard → textarea の順でフォールバック

## テスト（vitest）

- `evaluation.test.ts`: classify境界(30/31, 150/151)、pickThree不変条件（seeded rng）、moveFactsの日本語文字列がPython定数と完全一致
- `session.test.ts`: フェイクエンジンでフェーズ遷移・reveal・終局・resign/abandon・パズルのMISS/SUCCESS/FAIL
- `coach.test.ts`: tierOf境界(0/30/80/150/300)、重複防止、連続好手
- `uci-client.test.ts`: info行パース、mate変換のpython-chess互換

## マイルストーン

1. **M1**: scaffold + Pages CI + PWA + Boardコンポーネント（FEN表示）— デプロイ導通確認
2. **M2**: パズルモード（エンジン不要）— **最初の遊べるリリース**
3. **M3**: エンジン統合 + 実機で性能計測 → movetimeキャップ決定
4. **M4**: 対戦モード（evaluation/session/UI一式）
5. **M5**: コーチ + レビュー出力
6. **M6**: 磨き込み（オフライン監査、ライセンス表記: Stockfish GPL・駒セット・Lichess CC0、README）

## リスク

- モバイルでの解析レイテンシが最大のUXリスク → M3で実測してからM4着手
- iOS SafariのWASMメモリ → liteビルド使用、エンジンWorkerは1個を再利用
- RNGのPython/JS完全一致は非目標（injectable rngでテストのみ決定的に）

## 検証方法

- 各lib移植後にvitest実行
- M2以降は各マイルストーンでGH Pagesデプロイ→実機スマホ（iPhone Safari）で動作確認
- M3で解析時間を実測しconfig調整
- 最終的にPython版と同一FEN数局面で分類（緑黄赤）のバケット一致を目視確認

## 実装時の参照ファイル

- thrie_raed_chess/session.py（状態機械）
- thrie_raed_chess/evaluation.py（コアループ）
- thrie_raed_chess/coach.py（フレーズ表を逐語コピー）
- thrie_raed_chess/boardmodel.py（ハイライト意味論）
- thrie_raed_chess/data/puzzles.json（ビルド時コピー元）

実装は CLAUDE.md の方針どおり @agent-implementer / @agent-fast-implementer に委譲する。
