// Stockfish UCI 出力の純関数パーサと解析状態機械。
// Web Worker やブラウザ API に一切依存しないため、単体テスト可能。

export interface PvLine {
  multipv: number;
  depth: number;
  cpPov: number | null; // side-to-move POV のセンチポーン(mate 行なら null)
  matePov: number | null; // side-to-move POV の mate 手数(cp 行なら null)
  pv: string[]; // 読み筋(UCI表記)。先頭が着手候補。
}

// info 行のパース結果。score が cp/mate どちらでもなく、または
// lowerbound/upperbound 付き、あるいは info 行でない場合は null を返す。
export interface ParsedInfo {
  multipv: number;
  depth: number;
  cpPov: number | null;
  matePov: number | null;
  bound: "lower" | "upper" | null;
  pv: string[];
}

/**
 * 1行の UCI 出力をパースする。
 * - "info depth ... multipv M score cp|mate V ... pv ..." のみ ParsedInfo を返す。
 * - depth / pv / score を欠く info 行(例: "info string ...", currmove のみ)や
 *   info 以外の行は null。
 * - lowerbound/upperbound は bound フィールドに記録して返す(除外判断は呼び出し側)。
 */
export function parseInfoLine(line: string): ParsedInfo | null {
  const t = line.trim();
  if (!t.startsWith("info ")) return null;

  const tok = t.split(/\s+/);
  let depth: number | null = null;
  let multipv = 1; // multipv 省略時(MultiPV=1)は 1 とみなす
  let cpPov: number | null = null;
  let matePov: number | null = null;
  let bound: "lower" | "upper" | null = null;
  let pv: string[] | null = null;

  for (let i = 1; i < tok.length; i++) {
    const k = tok[i];
    switch (k) {
      case "depth":
        depth = parseInt(tok[++i], 10);
        break;
      case "multipv":
        multipv = parseInt(tok[++i], 10);
        break;
      case "score": {
        const kind = tok[++i];
        const val = parseInt(tok[++i], 10);
        if (kind === "cp") cpPov = val;
        else if (kind === "mate") matePov = val;
        // 直後に lowerbound/upperbound が続くことがある
        if (tok[i + 1] === "lowerbound") {
          bound = "lower";
          i++;
        } else if (tok[i + 1] === "upperbound") {
          bound = "upper";
          i++;
        }
        break;
      }
      case "pv":
        // pv は行末まで全部が読み筋。
        pv = tok.slice(i + 1);
        i = tok.length;
        break;
      default:
        break;
    }
  }

  // depth と pv と score のいずれかを欠く info 行は解析対象外。
  if (depth === null || pv === null || pv.length === 0) return null;
  if (cpPov === null && matePov === null) return null;

  return { multipv, depth, cpPov, matePov, bound, pv };
}

/**
 * mate/cp を単一スケールのスコアに変換する(python-chess の
 * Score.score(mate_score=10000) と同一規約)。UCI スコアは手番側 POV なので
 * 変換後も手番側 POV のまま。
 *   cp        -> そのまま
 *   mate m>0  -> 10000 - m
 *   mate m<0  -> -10000 - m   (= -(10000 - |m|))
 */
export function pvScore(line: PvLine, mateScore = 10000): number {
  if (line.cpPov !== null) return line.cpPov;
  const m = line.matePov as number;
  return m > 0 ? mateScore - m : -mateScore - m;
}

/**
 * 単一の analyse ジョブ中の info 行を集約する状態機械。
 *
 * Stockfish は各 depth ごとに multipv=1..N の info 行を順に出力し、
 * 次の depth に進む。movetime 打ち切り時は最深 depth が全 multipv 揃わない
 * ことがあるため、「全 multipv が揃った最後の depth」を最終結果とする。
 *
 * 実装方針:
 * - depth が変わる / bestmove が来た時点で、直前の depth を確定(finalize)する。
 * - これまでに確定した depth の最大ライン数を「期待ライン数」とみなし、
 *   期待ライン数に達した depth だけを「完成 depth」として記録・通知する。
 *   これにより MultiPV が合法手数より多い場合(揃うライン数が少ない場合)でも、
 *   途中打ち切りの中途半端な最深 depth を除外して最後の完全な depth を返せる。
 */
export class AnalyseAccumulator {
  private pendingDepth: number | null = null;
  private pendingLines: PvLine[] = [];
  private expectedCount = 0;
  // 完成した depth の最新スナップショット(depth 昇順で上書きされる)。
  private completed: PvLine[] | null = null;
  private completedDepth = 0;

  /**
   * 1行を投入する。「完成 depth」が確定したら {depth, lines} を返す
   * (呼び出し側は onProgress を発火する)。それ以外は null。
   */
  ingest(line: string): { depth: number; lines: PvLine[] } | null {
    if (line.trim().startsWith("bestmove")) {
      return this.finalizePending();
    }

    const parsed = parseInfoLine(line);
    if (!parsed) return null;
    // lowerbound/upperbound の暫定スコアは確定値でないため無視する。
    if (parsed.bound !== null) return null;

    let completed: { depth: number; lines: PvLine[] } | null = null;

    // depth が変わったら直前の depth を確定する。
    if (this.pendingDepth !== null && parsed.depth !== this.pendingDepth) {
      completed = this.finalizePending();
    }

    if (this.pendingDepth === null) {
      this.pendingDepth = parsed.depth;
      this.pendingLines = [];
    }

    const pvLine: PvLine = {
      multipv: parsed.multipv,
      depth: parsed.depth,
      cpPov: parsed.cpPov,
      matePov: parsed.matePov,
      pv: parsed.pv,
    };
    // 同一 multipv の重複(暫定→確定の上書き)は後着を採用。
    const idx = this.pendingLines.findIndex((l) => l.multipv === pvLine.multipv);
    if (idx >= 0) this.pendingLines[idx] = pvLine;
    else this.pendingLines.push(pvLine);

    return completed;
  }

  /** 現在確定している最良(最深の完成)depth のライン群。未確定なら空配列。 */
  best(): PvLine[] {
    return this.completed ? this.completed.slice() : [];
  }

  /** 完成した最深 depth。未確定なら 0。 */
  bestDepth(): number {
    return this.completedDepth;
  }

  private finalizePending(): { depth: number; lines: PvLine[] } | null {
    if (this.pendingDepth === null || this.pendingLines.length === 0) {
      this.pendingDepth = null;
      this.pendingLines = [];
      return null;
    }
    const depth = this.pendingDepth;
    const lines = this.pendingLines
      .slice()
      .sort((a, b) => a.multipv - b.multipv);
    this.pendingDepth = null;
    this.pendingLines = [];

    // 期待ライン数(過去最大)に達していれば「完成 depth」として採用。
    if (lines.length >= this.expectedCount) {
      this.expectedCount = lines.length;
      this.completed = lines;
      this.completedDepth = depth;
      return { depth, lines };
    }
    return null;
  }
}
