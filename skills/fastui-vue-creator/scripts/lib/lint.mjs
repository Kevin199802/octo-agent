/**
 * 漏 import 检查(SPEC-DES-001 §7.2 第一层)
 *
 * 这个脚手架**没有全局注册** element-plus / lake 组件,模板里用到的每一个都得在
 * `<script setup>` 里 import。而 webpack 编不出这种错 —— 它不知道模板里 `<el-table>`
 * 指的是什么。于是失败形态极具误导性:**verify 返回 OK,页面却白屏**,
 * 浏览器 console 里才有 `[Vue warn]: Failed to resolve component: el-table`。
 *
 * 内网首次实测就踩到了(模型 import 了 ElButton,却漏了 ElTable / ElTableColumn)。
 * 大概率是因为它把 kebab-case 的 `<el-table>` 当成了"HTML 标签"而非"组件"。
 *
 * 结论是 WARN 不是 FAIL:模板里也可能出现脚手架全局注册的组件,
 * 一刀切阻断会误伤。但措辞要足够强,SKILL.md 里写明看到就必须修。
 */
import { readFileSync, readdirSync, statSync } from "node:fs"
import path from "node:path"

// Vue 内置 + 常见原生标签,不需要 import
const BUILTIN = new Set([
  "template", "component", "slot", "transition", "transition-group", "keep-alive", "teleport", "suspense",
  "Transition", "TransitionGroup", "KeepAlive", "Teleport", "Suspense", "Component",
])

const kebabToPascal = (s) => s.replace(/(^|-)([a-z])/g, (_, __, c) => c.toUpperCase())

/** 从 .vue 源码里挑出"看起来是组件"的标签 */
function usedComponents(src) {
  const tpl = src.match(/<template>([\s\S]*)<\/template>/)
  const body = tpl ? tpl[1] : src
  const found = new Set()
  // 大写开头(PascalCase)或 el- / lake- 前缀(kebab-case)
  for (const m of body.matchAll(/<([A-Z][A-Za-z0-9]*|(?:el|lake)-[a-z][a-z0-9-]*)[\s/>]/g)) {
    const raw = m[1]
    if (BUILTIN.has(raw)) continue
    found.add(raw.includes("-") ? kebabToPascal(raw) : raw)
  }
  return found
}

/** script 段里 import 进来的绑定名(具名 + 默认 + 命名空间) */
function importedNames(src) {
  const names = new Set()
  for (const m of src.matchAll(/import\s+([\s\S]*?)\s+from\s+['"][^'"]+['"]/g)) {
    const clause = m[1]
    for (const g of clause.matchAll(/\{([^}]*)\}/g)) {
      for (const part of g[1].split(",")) {
        const alias = part.split(/\s+as\s+/).pop().trim()
        if (alias) names.add(alias)
      }
    }
    const bare = clause.replace(/\{[^}]*\}/g, "").replace(/^\s*,|,\s*$/g, "").trim()
    if (bare && /^[A-Za-z_$][\w$]*$/.test(bare)) names.add(bare)
  }
  // defineComponent / 局部变量组件也算数(不精确,但宁可漏报不误报)
  for (const m of src.matchAll(/(?:const|let|var)\s+([A-Z][\w$]*)\s*=/g)) names.add(m[1])
  return names
}

/** @returns {{file: string, missing: string[]}[]} */
export function lintMissingImports(viewsDir) {
  const results = []
  const walk = (dir) => {
    let entries = []
    try {
      entries = readdirSync(dir, { withFileTypes: true })
    } catch {
      return
    }
    for (const e of entries) {
      const abs = path.join(dir, e.name)
      if (e.isDirectory()) {
        if (e.name.startsWith("_") || e.name.startsWith(".")) continue // golden example 等不检查
        walk(abs)
        continue
      }
      if (!e.name.endsWith(".vue")) continue
      let src = ""
      try {
        src = readFileSync(abs, "utf8")
      } catch {
        continue
      }
      const used = usedComponents(src)
      const imported = importedNames(src)
      const missing = [...used].filter((c) => !imported.has(c))
      if (missing.length) results.push({ file: abs, missing })
    }
  }
  walk(viewsDir)
  return results
}
