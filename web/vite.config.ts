/// <reference types="vitest" />
import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
import { VitePWA } from "vite-plugin-pwa";

// base はデプロイ先に応じて環境変数 VITE_BASE で切り替える。
// GitHub Actions では VITE_BASE=/thrie-raed-chess/ を渡す。未設定時はルート。
const base = process.env.VITE_BASE ?? "/";

export default defineConfig({
  base,
  plugins: [
    react(),
    VitePWA({
      registerType: "autoUpdate",
      manifest: {
        name: "Thrie Raed Chess",
        short_name: "ThrieRaed",
        lang: "ja",
        theme_color: "#1b1b1f",
        background_color: "#1b1b1f",
        display: "standalone",
      },
      workbox: {
        // Stockfish WASM 等の大きめアセットをキャッシュ対象にするため上限を引き上げる。
        maximumFileSizeToCacheInBytes: 15 * 1024 * 1024,
      },
    }),
  ],
  test: {
    globals: true,
    environment: "node",
    include: ["tests/**/*.test.ts"],
  },
});
