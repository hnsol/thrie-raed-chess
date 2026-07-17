// メインスレッド側の Promise 型 UCI クライアント。
// Web Worker 上の Stockfish と UCI で対話し、analyse / bestMove を提供する。
// リクエストは内部キューで直列化(同時に 1 ジョブのみ)。
//
// 純粋なパース・状態機械部分は uci-parser.ts に分離してある(単体テスト用)。

import { createEngineBridge, type EngineBridge } from "./engine.worker";
import { AnalyseAccumulator, type PvLine } from "./uci-parser";

export type { PvLine } from "./uci-parser";
export { pvScore } from "./uci-parser";

export interface AnalyseOptions {
  depth: number;
  multiPv: number;
  movetimeMs?: number;
}

export type ProgressCb = (depth: number, lines: PvLine[]) => void;

export interface BestMoveOptions {
  depth: number;
  skillLevel: number;
}

export class UciClient {
  private bridge: EngineBridge | null = null;
  private initialized = false;
  // 直列化キュー: 直前ジョブの完了を待ってから次を実行する。
  private queue: Promise<unknown> = Promise.resolve();

  /** エンジンを起動し uci→uciok / isready→readyok を確認する。冪等。 */
  async init(): Promise<void> {
    if (this.initialized) return;
    this.bridge = createEngineBridge();
    await this.waitFor("uci", (l) => l === "uciok");
    await this.waitFor("isready", (l) => l === "readyok");
    this.initialized = true;
  }

  setOption(name: string, value: string | number): void {
    this.ensureBridge().post(`setoption name ${name} value ${value}`);
  }

  /**
   * FEN 局面を解析し、depth ごとに揃った multipv セットを保持する。
   * onProgress は完成 depth ごとに発火。bestmove で最新の完成セットを resolve。
   */
  analyse(
    fen: string,
    opts: AnalyseOptions,
    onProgress?: ProgressCb,
  ): Promise<PvLine[]> {
    return this.enqueue(() => this.runAnalyse(fen, opts, onProgress));
  }

  /**
   * MultiPV=1 + Skill Level を設定して着手を求め、bestmove の UCI 表記を返す。
   */
  bestMove(fen: string, opts: BestMoveOptions): Promise<string> {
    return this.enqueue(() => this.runBestMove(fen, opts));
  }

  /** 進行中の探索を止める(bestmove を即座に出させる)。 */
  stop(): void {
    this.bridge?.post("stop");
  }

  /** Worker を終了して解放する。 */
  dispose(): void {
    this.bridge?.post("quit");
    this.bridge?.terminate();
    this.bridge = null;
    this.initialized = false;
  }

  // --- 内部実装 -----------------------------------------------------------

  private ensureBridge(): EngineBridge {
    if (!this.bridge) throw new Error("UciClient: init() を先に呼んでください");
    return this.bridge;
  }

  // ジョブをキュー末尾に積み、前ジョブ完了後に実行する。
  private enqueue<T>(job: () => Promise<T>): Promise<T> {
    const run = this.queue.then(job, job);
    // キューは失敗しても次に進めるよう握りつぶした鎖を保持。
    this.queue = run.then(
      () => undefined,
      () => undefined,
    );
    return run;
  }

  // 1 コマンド送って特定の完了行を待つ小ヘルパ(init 用)。
  private waitFor(cmd: string, done: (line: string) => boolean): Promise<void> {
    const bridge = this.ensureBridge();
    return new Promise<void>((resolve) => {
      const unsub = bridge.subscribe((line) => {
        if (done(line)) {
          unsub();
          resolve();
        }
      });
      bridge.post(cmd);
    });
  }

  private runAnalyse(
    fen: string,
    opts: AnalyseOptions,
    onProgress?: ProgressCb,
  ): Promise<PvLine[]> {
    const bridge = this.ensureBridge();
    const acc = new AnalyseAccumulator();

    return new Promise<PvLine[]>((resolve) => {
      const unsub = bridge.subscribe((line) => {
        const done = acc.ingest(line);
        if (done && onProgress) onProgress(done.depth, done.lines);
        if (line.trim().startsWith("bestmove")) {
          unsub();
          resolve(acc.best());
        }
      });

      bridge.post(`setoption name MultiPV value ${opts.multiPv}`);
      bridge.post(`position fen ${fen}`);
      const movetime = opts.movetimeMs
        ? ` movetime ${opts.movetimeMs}`
        : "";
      bridge.post(`go depth ${opts.depth}${movetime}`);
    });
  }

  private runBestMove(fen: string, opts: BestMoveOptions): Promise<string> {
    const bridge = this.ensureBridge();
    return new Promise<string>((resolve) => {
      const unsub = bridge.subscribe((line) => {
        const t = line.trim();
        if (t.startsWith("bestmove")) {
          unsub();
          resolve(t.split(/\s+/)[1] ?? "");
        }
      });
      bridge.post("setoption name MultiPV value 1");
      bridge.post(`setoption name Skill Level value ${opts.skillLevel}`);
      bridge.post(`position fen ${fen}`);
      bridge.post(`go depth ${opts.depth}`);
    });
  }
}
