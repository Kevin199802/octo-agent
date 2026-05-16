/**
 * 纯逻辑层：无 Electron 依赖，可直接 bun test。
 */
import * as fs from "node:fs"
import * as path from "node:path"

export const STUB_USER_CONFIG = {
  $schema: "https://opencode.ai/config.json",
  provider: {
    deepseek: {
      npm: "@ai-sdk/openai-compatible",
      options: {
        baseURL: "https://api.deepseek.com/v1",
        apiKey: "REPLACE_ME",
      },
      models: {
        "deepseek-chat": { name: "DeepSeek V3" },
        "deepseek-reasoner": { name: "DeepSeek R1 (思维链)" },
      },
    },
  },
  model: "deepseek/deepseek-reasoner",
  mcp: {
    "uxr-tool": {
      headers: { Authorization: "Bearer REPLACE_ME" },
    },
  },
}

export function deepMerge(
  target: Record<string, unknown>,
  source: Record<string, unknown>,
): Record<string, unknown> {
  const result: Record<string, unknown> = { ...target }
  for (const key of Object.keys(source)) {
    const srcVal = source[key]
    const tgtVal = result[key]
    if (
      srcVal !== null &&
      typeof srcVal === "object" &&
      !Array.isArray(srcVal) &&
      tgtVal !== null &&
      typeof tgtVal === "object" &&
      !Array.isArray(tgtVal)
    ) {
      result[key] = deepMerge(tgtVal as Record<string, unknown>, srcVal as Record<string, unknown>)
    } else {
      result[key] = srcVal
    }
  }
  return result
}

/**
 * 读文件、合并、写 runtime。无 Electron 依赖，可直接单测。
 *
 * @param defaultConfigPath  default-config.json 路径
 * @param getPromptPath      agentName → prompt markdown 路径
 * @param userConfigPath     用户 octo.json 路径
 * @param runtimePath        运行时合并产物路径
 */
export function buildRuntimeConfig(
  defaultConfigPath: string,
  getPromptPath: (agentName: string) => string,
  userConfigPath: string,
  runtimePath: string,
): string {
  if (!fs.existsSync(defaultConfigPath)) {
    throw new Error(`default-config.json missing: ${defaultConfigPath}`)
  }
  const defaults = JSON.parse(fs.readFileSync(defaultConfigPath, "utf8")) as Record<string, unknown>

  const agents = (defaults.agent ?? {}) as Record<string, Record<string, unknown>>
  for (const agentName of Object.keys(agents)) {
    const promptPath = getPromptPath(agentName)
    if (fs.existsSync(promptPath)) {
      agents[agentName].prompt = fs.readFileSync(promptPath, "utf8")
    } else {
      console.warn(`[octo-config] agent prompt not found: ${promptPath}`)
    }
  }

  let userConfig: Record<string, unknown>
  if (fs.existsSync(userConfigPath)) {
    userConfig = JSON.parse(fs.readFileSync(userConfigPath, "utf8")) as Record<string, unknown>
  } else {
    userConfig = STUB_USER_CONFIG as unknown as Record<string, unknown>
    fs.mkdirSync(path.dirname(userConfigPath), { recursive: true })
    fs.writeFileSync(userConfigPath, JSON.stringify(STUB_USER_CONFIG, null, 2), "utf8")
  }

  const merged = deepMerge(defaults, userConfig)

  fs.mkdirSync(path.dirname(runtimePath), { recursive: true })
  fs.writeFileSync(runtimePath, JSON.stringify(merged, null, 2), "utf8")

  return runtimePath
}
