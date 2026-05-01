import { defineConfig } from "electron-vite"
import desktopPlugin from "@opencode-ai/app/vite"
import { resolve } from "node:path"
import * as fs from "node:fs/promises"

const channel = (() => {
  const raw = process.env.OPENCODE_CHANNEL
  if (raw === "dev" || raw === "beta" || raw === "prod") return raw
  return "dev"
})()

const OPENCODE_SERVER_DIST = "../opencode/dist/node"

const nodePtyPkg = `@lydell/node-pty-${process.platform}-${process.arch}`

export default defineConfig({
  main: {
    define: {
      "import.meta.env.OPENCODE_CHANNEL": JSON.stringify(channel),
    },
    build: {
      rollupOptions: {
        input: { index: "src/main/index.ts" },
      },
      externalizeDeps: { include: [nodePtyPkg] },
    },
    plugins: [
      {
        name: "opencode:node-pty-narrower",
        enforce: "pre",
        resolveId(s) {
          if (s === "@lydell/node-pty") return nodePtyPkg
        },
      },
      {
        name: "opencode:virtual-server-module",
        enforce: "pre",
        resolveId(id) {
          if (id === "virtual:opencode-server") return this.resolve(`${OPENCODE_SERVER_DIST}/node.js`)
        },
      },
      {
        name: "opencode:copy-server-assets",
        async writeBundle() {
          for (const l of await fs.readdir(OPENCODE_SERVER_DIST)) {
            if (!l.endsWith(".wasm")) continue
            await fs.writeFile(`./out/main/chunks/${l}`, await fs.readFile(`${OPENCODE_SERVER_DIST}/${l}`))
          }
        },
      },
    ],
  },
  preload: {
    build: {
      rollupOptions: {
        input: { index: "src/preload/index.ts" },
      },
    },
  },
  renderer: {
    // electron-vite 不读 octo-app/vite.config.ts,renderer 配置必须在这里给。
    // 复用 @opencode-ai/app/vite 导出的 plugin 组:
    //   - `@` alias → packages/app/src(消费 @opencode-ai/app 的 transitive 导入)
    //   - oc-theme-preload.js 内联到 HTML
    //   - tailwindcss + vite-plugin-solid
    plugins: desktopPlugin as never,
    root: resolve("../octo-app"),
    define: {
      "import.meta.env.VITE_OPENCODE_CHANNEL": JSON.stringify(channel),
    },
    server: {
      port: 5175,
      strictPort: true,
    },
    build: {
      rollupOptions: {
        input: {
          main: resolve("../octo-app/index.html"),
        },
      },
    },
  },
})
