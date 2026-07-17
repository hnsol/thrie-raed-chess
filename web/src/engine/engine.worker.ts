// Stockfish エンジンを載せる Web Worker への薄いブリッジ。
//
// nmrugg 版 stockfish のグルー(stockfish-*-lite-single.js)は、それ自体が
// self.onmessage / postMessage で UCI 文字列を双方向にやり取りする完結した
// クラシック Worker スクリプトである。対応する .wasm の場所は、Worker URL の
// ハッシュ(#<encoded wasm url>)で与える仕様になっている
// (グルー内: `self.location.hash.substr(1).split(",")` の先頭要素を wasm URL とする)。
//
// そのためここでは独自 Worker を作って importScripts で中継するのではなく、
// グルーを直接クラシック Worker として起動する。この関数は BASE_URL(vite base)
// を考慮したパス解決と、UCI 文字列の送受信 API 提供だけを担う薄い層。
//
// 参考: GitHub Pages は COOP/COEP 不可のため SharedArrayBuffer が使えず、
// マルチスレッド版は動かない。ここで使うのはシングルスレッド lite 版。

const ENGINE_JS = "engine/stockfish-18-lite-single.js";
const ENGINE_WASM = "engine/stockfish-18-lite-single.wasm";

export interface EngineBridge {
  /** UCI コマンド文字列を 1 行送る。 */
  post(cmd: string): void;
  /** エンジンからの 1 行出力を購読する。戻り値で購読解除。 */
  subscribe(cb: (line: string) => void): () => void;
  /** Worker を終了して解放する。 */
  terminate(): void;
}

// vite の base(例: "/" や "/thrie-raed-chess/")。末尾は必ず "/"。
function baseUrl(): string {
  // import.meta.env はブラウザ/ビルド時に vite が注入する。
  const base = (import.meta as { env?: { BASE_URL?: string } }).env?.BASE_URL ?? "/";
  return base.endsWith("/") ? base : base + "/";
}

/**
 * Stockfish グルーをクラシック Worker として起動し、ブリッジを返す。
 * ブラウザ(メインスレッド)からのみ呼ぶこと。
 */
export function createEngineBridge(): EngineBridge {
  const origin = self.location.origin;
  const base = baseUrl();
  const jsUrl = new URL(base + ENGINE_JS, origin);
  const wasmUrl = new URL(base + ENGINE_WASM, origin);
  // wasm の場所をハッシュで渡す(グルーの仕様)。
  jsUrl.hash = encodeURIComponent(wasmUrl.toString());

  const worker = new Worker(jsUrl.toString(), { type: "classic" });

  const listeners = new Set<(line: string) => void>();
  worker.onmessage = (e: MessageEvent) => {
    const data = e.data;
    if (typeof data !== "string") return; // 進捗ポート等の非文字列は無視
    for (const cb of listeners) cb(data);
  };

  return {
    post(cmd: string) {
      worker.postMessage(cmd);
    },
    subscribe(cb: (line: string) => void) {
      listeners.add(cb);
      return () => listeners.delete(cb);
    },
    terminate() {
      listeners.clear();
      worker.terminate();
    },
  };
}
