import { defineConfig } from "vite"
import desktopPlugin from "@opencode-ai/app/vite"

// 直接复用 @opencode-ai/app 的 vite plugin 组,自动获得:
//   - `@` alias 指向 packages/app/src(解决 @opencode-ai/app 内部 import 解析)
//   - oc-theme-preload.js 内联(解决主题闪烁 + 404)
//   - tailwindcss + vite-plugin-solid
export default defineConfig({
  plugins: [desktopPlugin],
  server: {
    port: 5174,
    strictPort: true,
    proxy: {
      "/api": {
        target: "http://127.0.0.1:4096",
        changeOrigin: true,
        ws: true,
        rewrite: (path) => path.replace(/^\/api/, ""),
      },
    },
  },
  build: {
    target: "esnext",
  },
})
