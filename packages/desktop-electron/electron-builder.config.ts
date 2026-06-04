import { execFile } from "node:child_process"
import path from "node:path"
import { fileURLToPath } from "node:url"
import { promisify } from "node:util"

import type { Configuration } from "electron-builder"

const execFileAsync = promisify(execFile)
const rootDir = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../..")
const signScript = path.join(rootDir, "script", "sign-windows.ps1")

async function signWindows(configuration: { path: string }) {
  if (process.platform !== "win32") return
  if (process.env.GITHUB_ACTIONS !== "true") return

  await execFileAsync(
    "pwsh",
    ["-NoLogo", "-NoProfile", "-ExecutionPolicy", "Bypass", "-File", signScript, configuration.path],
    { cwd: rootDir },
  )
}

const channel = (() => {
  const raw = process.env.OPENCODE_CHANNEL
  if (raw === "dev" || raw === "beta" || raw === "prod") return raw
  return "dev"
})()

const isCi = process.env.GITHUB_ACTIONS === "true"

const getBase = (): Configuration => ({
  artifactName: "Octo Agent-${version}-${arch}.${ext}",
  directories: {
    output: "dist",
    buildResources: "resources",
  },
  files: ["out/**/*", "resources/**/*"],
  extraResources: [
    {
      from: "../../packages/agent/octo_insight/agents/octo_insight.md",
      to: "agents/octo_insight.md",
    },
  ],
  mac: {
    category: "public.app-category.developer-tools",
    icon: `resources/icons/icon.icns`,
    // 签名 & 公证只在 CI 环境开启；本地内网分发直接跳过
    identity: isCi ? undefined : null,
    hardenedRuntime: isCi,
    gatekeeperAssess: false,
    notarize: isCi,
    target: ["dmg"],
  },
  protocols: {
    name: "Octo Agent",
    schemes: ["octo-agent"],
  },
  win: {
    icon: `resources/icons/icon.ico`,
    signtoolOptions: {
      sign: signWindows,
    },
    target: ["nsis"],
  },
  nsis: {
    oneClick: false,
    allowToChangeInstallationDirectory: true,
    installerIcon: `resources/icons/icon.ico`,
    installerHeaderIcon: `resources/icons/icon.ico`,
  },
  linux: {
    icon: `resources/icons`,
    category: "Development",
    target: ["AppImage", "deb", "rpm"],
  },
})

function getConfig() {
  const base = getBase()

  switch (channel) {
    case "dev": {
      return {
        ...base,
        appId: "ai.octoagent.desktop.dev",
        productName: "Octo AI",
        protocols: { name: "Octo AI", schemes: ["octo-agent-dev"] },
        rpm: { packageName: "octo-dev" },
      }
    }
    case "beta": {
      return {
        ...base,
        appId: "ai.octoagent.desktop.beta",
        productName: "Octo Beta",
        protocols: { name: "Octo Beta", schemes: ["octo-agent"] },
        rpm: { packageName: "octo-beta" },
      }
    }
    case "prod": {
      return {
        ...base,
        appId: "ai.octoagent.desktop",
        productName: "Octo Agent",
        protocols: { name: "Octo Agent", schemes: ["octo-agent"] },
        rpm: { packageName: "octo-agent" },
      }
    }
  }
}

export default getConfig()
