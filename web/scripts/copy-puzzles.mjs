// ../thrie_raed_chess/data/puzzles.json を web/src/data/puzzles.json へコピーする。
// コピー先は gitignore 済み。predev/prebuild/pretest から呼ばれる。
import { copyFileSync, mkdirSync, existsSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const here = dirname(fileURLToPath(import.meta.url));
const src = resolve(here, "../../thrie_raed_chess/data/puzzles.json");
const dest = resolve(here, "../src/data/puzzles.json");

if (!existsSync(src)) {
  console.error(`[copy-puzzles] source not found: ${src}`);
  process.exit(1);
}

mkdirSync(dirname(dest), { recursive: true });
copyFileSync(src, dest);
console.log(`[copy-puzzles] copied puzzles.json -> ${dest}`);
