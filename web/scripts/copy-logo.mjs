// ../docs/images/title-logo.png を web/public/title-logo.png へコピー。
// sips で 800px 幅に縮小を試みる（失敗時はそのままコピー）。
// predev/prebuild/pretest から呼ばれる。
import { copyFileSync, existsSync, mkdirSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { execSync } from "node:child_process";

const here = dirname(fileURLToPath(import.meta.url));
const src = resolve(here, "../../docs/images/title-logo.png");
const dest = resolve(here, "../public/title-logo.png");

if (!existsSync(src)) {
  console.error(`[copy-logo] source not found: ${src}`);
  process.exit(1);
}

mkdirSync(dirname(dest), { recursive: true });

try {
  execSync(`sips --resampleWidth 800 "${src}" --out "${dest}"`, { stdio: "pipe" });
  console.log(`[copy-logo] resized (800px) -> ${dest}`);
} catch {
  copyFileSync(src, dest);
  console.log(`[copy-logo] copied (no resize) -> ${dest}`);
}
