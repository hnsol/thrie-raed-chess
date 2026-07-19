// thrie_raed_chess/config.py からの移植。
// UI 非依存の定数群。エンジン解析・色分けしきい値・CPU 難易度プリセット。

export const APP_NAME = "Thrie Raed Chess";

// 3択を選ぶための読みの深さ。大きいほど正確・遅い。
export const ANALYSIS_DEPTH = 12;

// 評価バー用の局面評価の読みの深さ。
export const POSITION_EVAL_DEPTH = 8;

// 色分けのしきい値(センチポーン=歩1枚≒100)。best手からの損失で判定。
export const GREEN_MAX = 30; // 損失これ以下 → 緑(ほぼ最善)
export const YELLOW_MAX = 150; // ここまで → 黄、超えたら → 赤

// 序盤定跡手の採用しきい値。best からの損失がこれ以下なら定跡手を green 候補に採用。
export const BOOK_MAX_LOSS = GREEN_MAX; // =30



// 単スレ WASM 対策: 解析にかける movetime の上限(ms)。
export const ANALYSIS_MOVETIME_MS = 4000;

export interface CpuLevel {
  name: string; // 表示名
  skill: number; // Stockfish Skill Level (0-20)
  depth: number; // 読みの深さ
}

// 対戦CPUの難易度プリセット。
export const CPU_LEVELS: CpuLevel[] = [
  { name: "入門", skill: 0, depth: 4 },
  { name: "初級", skill: 3, depth: 6 },
  { name: "中級", skill: 8, depth: 8 },
  { name: "上級", skill: 13, depth: 10 },
  { name: "最強", skill: 20, depth: 12 },
];

// 初級（従来のデフォルト相当）。
export const DEFAULT_CPU_LEVEL = 1;
