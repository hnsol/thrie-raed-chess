# Web版とTUI版の対応表

Web版（`web/`）はTUI版（`thrie_raed_chess/`）の移植。方針は「**基本的にすべてTUI版と同じ**」。
ロジックはTUI版のPythonを正とし、Web版はそれに追従する。差分は意図的なもののみをこの文書に記録する。

設計スペック: [superpowers/specs/2026-07-18-mobile-web-port-design.md](superpowers/specs/2026-07-18-mobile-web-port-design.md)

## 同じ点（忠実移植）

| 項目 | 移植元 → 移植先 |
|---|---|
| 3択選定（best+黄1+赤1、バックフィル、シャッフル） | evaluation.py → lib/evaluation.ts |
| 評価分類の閾値（緑≤30cp / 黄≤150cp / 赤） | config.py → config.ts |
| 解析depth=12、MultiPV=全合法手、mate=±10000スケール | evaluation.py → evaluation.ts + engine/uci-parser.ts |
| 対戦/パズルの状態機械（フェーズ・終局判定） | session.py → lib/session.ts |
| CPU難易度5段階（Skill Level/depth の組） | config.py CPU_LEVELS → config.ts |
| コーチのフレーズ表（**逐語一致**）・tier閾値・重複回避deque(4)・streak | coach.py → lib/coach.ts |
| move_factsの日本語fact文字列（コーチのテーブルキーと一致） | evaluation.py → evaluation.ts |
| 盤ハイライトの意味論（LASTMOVE/CHOICE/FOCUSED/RESULT…） | boardmodel.py → lib/boardmodel.ts |
| 盤の向き（自分の手番側が下。黒番なら反転） | tui/screens.py → Battle.tsx / Puzzle.tsx |
| 直近の相手の手＝薄黄ハイライト、着手マスの点滅 | tui/theme.py, screens.py → Board.css |
| パズルデータ（3000問、2/3/4手詰め各1000） | data/puzzles.json をビルド時コピーで共有 |
| パズルの3択（正解+ランダム合法手2、MISS後は同一局面で再挑戦） | puzzles.py / session.py → puzzles.ts / session.ts |
| レビュー用プロンプト文面・PGNヘッダ | review.py → lib/review.ts |
| 統計（緑黄赤カウント・平均loss）・駒の動かし方ヘルプ | stats.py → lib/stats.ts |

## 意図的に変えた点

| 項目 | TUI版 | Web版 | 理由 |
|---|---|---|---|
| 操作 | キーボード（j/k/l等） | タップ（1回=プレビュー、2回目=確定） | スマホ最適UX |
| エンジン | ネイティブStockfish | stockfish WASM lite（シングルスレッド） | GitHub PagesはCOOP/COEP不可でSharedArrayBuffer不可 |
| 解析時間 | 無制限（depth12完走） | `movetime 4000ms` キャップ、打ち切り時は最深完了depthを採用 | スマホ性能対策。PvLine欠落手は最悪損失=赤扱い |
| 評価バーの局面評価 | 別途depth8で解析 | MultiPV line1のスコアを流用（追加解析なし） | 1手番あたりの解析を1回に節約 |
| 選択肢の識別色 | シアン/マゼンタ/オレンジ（256色） | シアン/マゼンタ/青紫 | オレンジが評価色の黄と紛れるため青紫に変更 |
| 開示後の盤表示 | 識別色ベース | 評価色（緑/黄/赤）ベース | 良い/悪いの即時認識を優先 |
| 選択前のfacts表示 | 表示あり | **非表示**（開示後のみ） | 選択前に見えるとネタバレで学習にならない |
| 右パネル（統計/駒の動かし方/棋譜） | 常時表示 | 下部シート（3タブ、開閉式） | 縦画面の面積制約 |
| レビューのコピー | pbcopy | navigator.share → clipboard → 手動textarea | Web API事情 |
| 乱数 | Python random | 注入可能Rng（テストはmulberry32で決定的） | 言語間の乱数列一致は非目標 |
| 難易度の既定 | セッション限り | 同左（永続化なし） | TUIと同じ挙動を踏襲 |
| 追加機能 | — | PWA（ホーム画面追加・オフライン動作）、振動フィードバック | スマホ配布形態 |

## 運用メモ

- ロジックの仕様変更はまずTUI版（Python）に入れ、Web版を追従させる
- コーチのフレーズ表を変更したら、coach.ts へ逐語コピーし直す（AST比較で検証済みの手法は web/tests/coach.test.ts 参照）
- puzzles.json の正は `thrie_raed_chess/data/`。web側はコピー（gitignore）
