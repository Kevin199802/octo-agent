import { afterAll, beforeAll, describe, expect, test } from "bun:test"
import * as fs from "node:fs"
import * as os from "node:os"
import * as path from "node:path"
import { fileURLToPath } from "node:url"

import { buildRuntimeConfig, deepMerge } from "./config-core"

const __filename = fileURLToPath(import.meta.url)
const __dirname = path.dirname(__filename)

// 指向真实源文件（dev 路径）
const DEFAULT_CONFIG = path.resolve(__dirname, "../../resources/default-config.json")
const devPromptPath = (name: string) =>
  path.resolve(__dirname, "../../../../packages/agent", name, "agents", `${name}.md`)

let tmpDir: string

beforeAll(() => {
  tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "octo-config-test-"))
})

afterAll(() => {
  fs.rmSync(tmpDir, { recursive: true, force: true })
})

// --- deepMerge ---

describe("deepMerge", () => {
  test("source 叶子值覆盖 target", () => {
    const result = deepMerge({ a: 1, b: 2 }, { b: 99 })
    expect(result).toEqual({ a: 1, b: 99 })
  })

  test("object 递归合并，不整体覆盖", () => {
    const result = deepMerge(
      { mcp: { tool: { url: "http://a", timeout: 30000 } } },
      { mcp: { tool: { headers: { Authorization: "Bearer sk" } } } },
    )
    expect((result.mcp as any).tool).toEqual({
      url: "http://a",
      timeout: 30000,
      headers: { Authorization: "Bearer sk" },
    })
  })

  test("array 直接覆盖，不合并元素", () => {
    const result = deepMerge({ tags: [1, 2] }, { tags: [3] })
    expect(result.tags).toEqual([3])
  })
})

// --- buildRuntimeConfig ---

describe("buildRuntimeConfig — 读真实源文件", () => {
  test("V-01 全新机器：runtime 含 insight prompt，用户 stub 自动创建", () => {
    const dir = path.join(tmpDir, "fresh")
    const userConfigPath = path.join(dir, "octo.config.json")
    const runtimePath = path.join(dir, ".octo-runtime.json")

    buildRuntimeConfig(DEFAULT_CONFIG, devPromptPath, userConfigPath, runtimePath)

    // stub 被写入
    expect(fs.existsSync(userConfigPath)).toBe(true)
    const stub = JSON.parse(fs.readFileSync(userConfigPath, "utf8"))
    expect(stub.provider?.deepseek?.options?.apiKey).toBe("REPLACE_ME")

    // runtime 含 insight prompt（来自真实 insight.md）
    const runtime = JSON.parse(fs.readFileSync(runtimePath, "utf8"))
    const prompt: string = runtime?.agent?.insight?.prompt ?? ""
    expect(prompt.length).toBeGreaterThan(0)

    // runtime 也含 insight.md 里的关键词
    const insightSrc = fs.readFileSync(devPromptPath("insight"), "utf8")
    expect(prompt).toContain(insightSrc.slice(0, 50).trim())

    // MCP url 来自 default-config.json
    expect(runtime.mcp?.["uxr-tool"]?.url).toBeDefined()

    // MCP headers 来自 stub（deepMerge 后两者都在）
    expect(runtime.mcp?.["uxr-tool"]?.headers?.Authorization).toBe("Bearer REPLACE_ME")
  })

  test("V-02 升级路径：改 prompt 源文件后重跑，runtime 立即更新", () => {
    const dir = path.join(tmpDir, "upgrade")
    const userConfigPath = path.join(dir, "octo.config.json")
    const runtimePath = path.join(dir, ".octo-runtime.json")

    // 第一次运行（使用真实 insight.md）
    buildRuntimeConfig(DEFAULT_CONFIG, devPromptPath, userConfigPath, runtimePath)
    const runtime1 = JSON.parse(fs.readFileSync(runtimePath, "utf8"))

    // 模拟"改了 insight.md"：用一个修改版本的 getPromptPath
    const altDir = path.join(tmpDir, "alt-agents")
    fs.mkdirSync(altDir, { recursive: true })
    fs.writeFileSync(path.join(altDir, "insight.md"), "# UPDATED PROMPT v2")
    const altPromptPath = (name: string) => path.join(altDir, `${name}.md`)

    buildRuntimeConfig(DEFAULT_CONFIG, altPromptPath, userConfigPath, runtimePath)
    const runtime2 = JSON.parse(fs.readFileSync(runtimePath, "utf8"))

    expect(runtime2.agent?.insight?.prompt).toBe("# UPDATED PROMPT v2")
    // 用户文件不变
    const stub = JSON.parse(fs.readFileSync(userConfigPath, "utf8"))
    expect(stub.provider?.deepseek?.options?.apiKey).toBe("REPLACE_ME")
    // A 类字段来自 default-config.json 仍在
    expect(runtime2.default_agent).toBe(runtime1.default_agent)
  })

  test("V-04 用户 override A 类：用户改 prompt，runtime 以用户值为准", () => {
    const dir = path.join(tmpDir, "override")
    const userConfigPath = path.join(dir, "octo.config.json")
    const runtimePath = path.join(dir, ".octo-runtime.json")
    fs.mkdirSync(dir, { recursive: true })

    // 用户手动改了 prompt
    fs.writeFileSync(
      userConfigPath,
      JSON.stringify({ agent: { insight: { prompt: "我的自定义 prompt" } } }, null, 2),
    )

    buildRuntimeConfig(DEFAULT_CONFIG, devPromptPath, userConfigPath, runtimePath)
    const runtime = JSON.parse(fs.readFileSync(runtimePath, "utf8"))

    expect(runtime.agent?.insight?.prompt).toBe("我的自定义 prompt")
    // 其余 A 类字段仍然存在
    expect(runtime.default_agent).toBeDefined()
  })

  test("用户 model 优先：用户设置的模型不被 bundle 覆盖", () => {
    const dir = path.join(tmpDir, "model-override")
    const userConfigPath = path.join(dir, "octo.config.json")
    const runtimePath = path.join(dir, ".octo-runtime.json")
    fs.mkdirSync(dir, { recursive: true })

    fs.writeFileSync(
      userConfigPath,
      JSON.stringify({ model: "custom/my-model", provider: { deepseek: { options: { apiKey: "sk-real" } } } }),
    )

    buildRuntimeConfig(DEFAULT_CONFIG, devPromptPath, userConfigPath, runtimePath)
    const runtime = JSON.parse(fs.readFileSync(runtimePath, "utf8"))

    expect(runtime.model).toBe("custom/my-model")
    expect((runtime as any).provider?.deepseek?.options?.apiKey).toBe("sk-real")
  })
})
