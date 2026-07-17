// Stockfish WASM エンジン(single-thread lite build)を node_modules から
// web/public/engine/ へコピーする。predev/prebuild/pretest から呼ばれる。
//
// GitHub Pages は COOP/COEP ヘッダを付与できず SharedArrayBuffer が使えないため、
// マルチスレッド版ではなくシングルスレッド lite 版(*-lite-single.js / .wasm)を使う。
import { copyFileSync, mkdirSync, existsSync, readdirSync, statSync } from "node:fs";
import { dirname, resolve, join } from "node:path";
import { fileURLToPath } from "node:url";

const here = dirname(fileURLToPath(import.meta.url));
const binDir = resolve(here, "../node_modules/stockfish/bin");
const destDir = resolve(here, "../public/engine");

if (!existsSync(binDir)) {
  console.error(`[copy-engine] stockfish package not found: ${binDir}`);
  console.error(`[copy-engine] run \`npm install\` first.`);
  process.exit(1);
}

// パッケージ内の実ファイル名を検出(バージョン番号が変わっても追従できるように)。
const files = readdirSync(binDir);
const jsName = files.find((f) => /-lite-single\.js$/.test(f));
const wasmName = files.find((f) => /-lite-single\.wasm$/.test(f));

if (!jsName || !wasmName) {
  console.error(
    `[copy-engine] lite-single build not found in ${binDir}. found: ${files.join(", ")}`,
  );
  process.exit(1);
}

mkdirSync(destDir, { recursive: true });

for (const name of [jsName, wasmName]) {
  const src = join(binDir, name);
  const dest = join(destDir, name);
  copyFileSync(src, dest);
  const kb = (statSync(dest).size / 1024).toFixed(0);
  console.log(`[copy-engine] copied ${name} (${kb} KB) -> ${dest}`);
}
