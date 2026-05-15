/**
 * 打包后验证：检查 .app bundle 内的 agent prompt 与源文件一致。
 *
 * 用法：
 *   bun run check-bundle                     # 自动找 dist/ 下第一个 .app
 *   bun run check-bundle path/to/Octo.app   # 指定 bundle 路径
 *
 * 退出码：0 = 全部通过，1 = 有差异或文件缺失
 */

import * as fs from "node:fs"
import * as path from "node:path"
import { fileURLToPath } from "node:url"

const __filename = fileURLToPath(import.meta.url)
const __dirname = path.dirname(__filename)
const ROOT = path.resolve(__dirname, "../../..")

// 要对比的文件列表：[bundle 内相对 Resources/ 的路径, 仓库内源文件路径]
const CHECKS: [string, string][] = [
  ["agents/insight.md", "packages/agent/insight/agents/insight.md"],
  ["default-config.json", "packages/desktop-electron/resources/default-config.json"],
]

function findAppBundle(): string | null {
  const distDir = path.join(__dirname, "../dist")
  if (!fs.existsSync(distDir)) return null
  for (const entry of fs.readdirSync(distDir)) {
    if (entry.endsWith(".app")) return path.join(distDir, entry)
    const sub = path.join(distDir, entry)
    if (fs.statSync(sub).isDirectory()) {
      for (const nested of fs.readdirSync(sub)) {
        if (nested.endsWith(".app")) return path.join(sub, nested)
      }
    }
  }
  return null
}

function check(bundlePath: string): boolean {
  const resourcesDir = path.join(bundlePath, "Contents", "Resources")
  let allOk = true

  console.log(`\nBundle: ${bundlePath}`)
  console.log(`Resources: ${resourcesDir}\n`)

  for (const [bundleRel, srcRel] of CHECKS) {
    const bundleFile = path.join(resourcesDir, bundleRel)
    const srcFile = path.join(ROOT, srcRel)

    process.stdout.write(`  ${bundleRel} ... `)

    if (!fs.existsSync(bundleFile)) {
      console.log(`\x1b[31mFAIL\x1b[0m — bundle 内缺失: ${bundleFile}`)
      allOk = false
      continue
    }

    if (!fs.existsSync(srcFile)) {
      console.log(`\x1b[31mFAIL\x1b[0m — 源文件缺失: ${srcFile}`)
      allOk = false
      continue
    }

    const bundleContent = fs.readFileSync(bundleFile, "utf8")
    const srcContent = fs.readFileSync(srcFile, "utf8")

    if (bundleContent === srcContent) {
      console.log("\x1b[32mOK\x1b[0m")
    } else {
      console.log(`\x1b[31mFAIL\x1b[0m — 内容与源不一致`)
      // 显示前 200 字符 diff 提示
      console.log(`    源文件前200字: ${srcContent.slice(0, 200).replace(/\n/g, "↵")}`)
      console.log(`    Bundle 前200字: ${bundleContent.slice(0, 200).replace(/\n/g, "↵")}`)
      allOk = false
    }
  }

  console.log()
  return allOk
}

const appPath = process.argv[2] ?? findAppBundle()

if (!appPath) {
  console.error("找不到 .app bundle。请先运行 bun run package:mac，或手动指定路径：")
  console.error("  bun run check-bundle path/to/Octo.app")
  process.exit(1)
}

if (!fs.existsSync(appPath)) {
  console.error(`指定路径不存在：${appPath}`)
  process.exit(1)
}

const ok = check(appPath)
process.exit(ok ? 0 : 1)
