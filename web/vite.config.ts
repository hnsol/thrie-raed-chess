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
      // アイコンは public/icons/ に置いた実ファイルを使うため自動生成しない。
      includeAssets: ["icons/apple-touch-icon.png"],
      manifest: {
        name: "Thrie Raed Chess",
        short_name: "ThrieRaed",
        description: "3択で覚えるチェス — インストール不要・オフライン対応のPWA",
        lang: "ja",
        theme_color: "#1b1b1f",
        background_color: "#1b1b1f",
        display: "standalone",
        orientation: "portrait",
        // src はマニフェスト位置からの相対パス。base 付きでも正しく解決される。
        icons: [
          {
            src: "icons/pwa-192x192.png",
            sizes: "192x192",
            type: "image/png",
          },
          {
            src: "icons/pwa-512x512.png",
            sizes: "512x512",
            type: "image/png",
          },
          {
            src: "icons/maskable-512x512.png",
            sizes: "512x512",
            type: "image/png",
            purpose: "maskable",
          },
        ],
      },
      workbox: {
        // wasm / svg 駒 / puzzles(json) / エンジン js を含めてプリキャッシュする。
        globPatterns: [
          "**/*.{js,css,html,wasm,svg,png,ico,json,webmanifest}",
        ],
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
