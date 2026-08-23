import { defineConfig } from "vitest/config";
import { loadEnv } from "vite";
import react from "@vitejs/plugin-react";
import { VitePWA } from "vite-plugin-pwa";

export default defineConfig(({ mode }) => {
  const env = loadEnv(mode, process.cwd(), "");
  const base = env.VITE_BASE_PATH || (mode === "production" ? "/D/" : "/");
  return {
    base,
    plugins: [
      react(),
      VitePWA({
        registerType: "autoUpdate",
        includeAssets: ["icon-192.svg", "icon-512.svg"],
        manifest: {
          name: "大富豪",
          short_name: "大富豪",
          description: "3〜6人で遊ぶ3Dオンライン大富豪",
          theme_color: "#081715",
          background_color: "#06100f",
          display: "standalone",
          orientation: "any",
          lang: "ja",
          icons: [
            { src: `${base}icon-192.svg`, sizes: "192x192", type: "image/svg+xml" },
            { src: `${base}icon-512.svg`, sizes: "512x512", type: "image/svg+xml" },
          ],
        },
        workbox: {
          navigateFallback: `${base}index.html`,
          globPatterns: ["**/*.{js,css,html,svg,woff2}"],
          runtimeCaching: [
            {
              urlPattern: /^https:\/\/.*\.(?:glb|ktx2)$/,
              handler: "CacheFirst",
              options: {
                cacheName: "avatar-assets",
                expiration: { maxEntries: 64, maxAgeSeconds: 604800 },
              },
            },
          ],
        },
      }),
    ],
    build: {
      target: "es2022",
      sourcemap: true,
      chunkSizeWarningLimit: 750,
      rollupOptions: {
        output: {
          manualChunks(id) {
            const path = id.replaceAll("\\", "/");
            if (path.includes("/node_modules/@react-three/drei/")) return "r3f-drei";
            if (path.includes("/node_modules/@react-three/fiber/")) return "r3f-core";
            if (path.includes("/node_modules/three/")) return "three";
            if (
              path.includes("/node_modules/firebase/") ||
              path.includes("/node_modules/@firebase/")
            )
              return "firebase";
            if (
              path.includes("/node_modules/react/") ||
              path.includes("/node_modules/react-dom/") ||
              path.includes("/node_modules/scheduler/")
            )
              return "react";
            return undefined;
          },
        },
      },
    },
    test: {
      environment: "jsdom",
      setupFiles: "./src/test/setup.ts",
      include: ["src/**/*.test.{ts,tsx}"],
    },
  };
});
