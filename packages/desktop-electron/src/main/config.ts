/**
 * Electron 入口：路径解析 + 错误弹窗。纯逻辑见 config-core.ts。
 */
import * as fs from "node:fs"
import * as os from "node:os"
import * as path from "node:path"
import { app, dialog } from "electron"

import { buildRuntimeConfig } from "./config-core"

function getDefaultConfigPath(): string {
  // dev:  packages/desktop-electron/resources/default-config.json
  // prod: app.asar/resources/default-config.json（Electron 的 asar 补丁自动拦截）
  return path.resolve(__dirname, "../../resources/default-config.json")
}

function getAgentPromptPath(agentName: string): string {
  if (app.isPackaged) {
    return path.join(process.resourcesPath, "agents", `${agentName}.md`)
  }
  return path.resolve(__dirname, "../../../../packages/agent", agentName, "agents", `${agentName}.md`)
}

export function initOctoConfig(): string {
  const userConfigDir = path.join(os.homedir(), ".config", "octo")
  const userConfigPath = path.join(userConfigDir, "octo.config.json")
  const runtimePath = path.join(userConfigDir, ".octo-runtime.json")

  fs.mkdirSync(userConfigDir, { recursive: true })

  // 提前校验用户文件 JSON，损坏时弹窗并中止
  if (fs.existsSync(userConfigPath)) {
    try {
      JSON.parse(fs.readFileSync(userConfigPath, "utf8"))
    } catch (err) {
      dialog.showErrorBox(
        "配置文件解析失败",
        `${userConfigPath}\n\n${String(err)}\n\n请修复 JSON 格式后重新启动。`,
      )
      app.exit(1)
      throw err
    }
  }

  try {
    return buildRuntimeConfig(getDefaultConfigPath(), getAgentPromptPath, userConfigPath, runtimePath)
  } catch (err) {
    if (String(err).includes("default-config.json missing")) {
      dialog.showErrorBox("安装包损坏", `找不到核心配置文件：${getDefaultConfigPath()}\n请重新安装 Octo AI。`)
      app.exit(1)
    }
    throw err
  }
}
