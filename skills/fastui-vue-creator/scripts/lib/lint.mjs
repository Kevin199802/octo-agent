/**
 * 漏 import 检查(SPEC-DES-001 §7.3 第二层的静态补充)
 *
 * webpack 编不出这两类错 —— 编译通过、页面白屏,失败形态极具误导性:
 * **verify 返回 OK,浏览器 console 里才有真相**。这是 verify 唯一能在"返回 OK"之前
 * 替模型兜住的一类运行时错误,不查白不查。
 *
 * 查两类,**严重性不同**:
 *
 * | 查什么 | 运行时表现 | 严重性 |
 * |---|---|---|
 * | 组件标签(`<el-table>` / PascalCase) | `Failed to resolve component` → 白屏 | WARN |
 * | 从 'vue' 导入的 API(`ref` / `computed` / `onMounted`…) | `ReferenceError` → 白屏 | **FAIL** |
 *
 * **两档的依据不是后果严重性 —— 两类都是 100% 白屏 —— 而是「判据在不在本文件内闭合」:
 * 这个检查会不会冤枉一个正确的写法。**
 *
 * - 组件**有**一条本检查看不见的合法豁免路径:脚手架可以在 `main.ts` 里 `app.component()`
 *   全局注册,而那个文件在 WRITE_DIR 之外、lint 走不到。判据不闭合 → 只能 WARN,
 *   一刀切阻断会误伤。
 * - vue API **没有**:它们是模块导出,不存在"全局注册"。唯一的豁免是 `unplugin-auto-import`
 *   这类编译期插件,而那是**脚手架的固定属性**(验明一次即为常量),不是逐文件的未知数。
 *   判据闭合 → FAIL。
 *
 * ⚠️ **别把两者统一成 WARN**(也别统一成 FAIL)。统一成 WARN 会让一个 100% 可判定的
 * 致命错误变成一行模型有理由忽略的提示 —— SKILL.md 里 `WARN` 的既定语义就是"不阻塞、不用管";
 * 统一成 FAIL 则会在全局注册的组件上把模型锁死在一道它无法满足的门禁前。
 *
 * 内网实测两类都踩到过(模型 import 了 ElButton 却漏了 ElTable / ElTableColumn;
 * 在父组件里 import 了 `ref`、子组件里直接用)。大概率是因为它把 kebab-case 的
 * `<el-table>` 当成了"HTML 标签",把 `ref` 当成了"到处都有的全局函数"。
 *
 * **FAIL 这一档的前提是误报率为零** —— 误报会把模型锁死:照提示补 import,
 * 撞上已有的同名局部声明 → 编译错误 → 两道门互卡,再也出不来。所以这里一律
 * **宁可漏报不误报**:剥注释与字符串、只扫 script 块、排除成员调用与编译宏、
 * 本地声明过就不报。
 */
import { readFileSync, readdirSync } from "node:fs"
import path from "node:path"

// Vue 内置 + 常见原生标签,不需要 import
const BUILTIN = new Set([
  "template", "component", "slot", "transition", "transition-group", "keep-alive", "teleport", "suspense",
  "Transition", "TransitionGroup", "KeepAlive", "Teleport", "Suspense", "Component",
])

/**
 * 必须从 'vue' import 才能用的 API。**闭集合,只加确定的**。
 *
 * 收录判据:① 是 `vue` 的具名导出;② 以函数形式调用(本检查只看 `name(`);
 * ③ 名字够独特,不至于和模型自己写的局部函数重名。
 *
 * 刻意**不收 `h`** —— 单字母,和局部变量撞名的概率远高于它在 SFC 里出现的概率,
 * 而 FAIL 这一档赔不起一次误报。
 */
const VUE_APIS = new Set([
  // 响应式
  "ref", "shallowRef", "customRef", "triggerRef", "isRef", "unref",
  "reactive", "shallowReactive", "readonly", "shallowReadonly", "isReactive", "isReadonly", "isProxy",
  "toRef", "toRefs", "toRaw", "toValue", "markRaw", "computed",
  // 侦听
  "watch", "watchEffect", "watchPostEffect", "watchSyncEffect", "nextTick",
  // 生命周期
  "onMounted", "onBeforeMount", "onBeforeUpdate", "onUpdated", "onBeforeUnmount", "onUnmounted",
  "onActivated", "onDeactivated", "onErrorCaptured", "onRenderTracked", "onRenderTriggered", "onServerPrefetch",
  // 依赖注入与实例
  "provide", "inject", "hasInjectionContext", "getCurrentInstance",
  // 组合式工具
  "useSlots", "useAttrs", "useCssModule", "useCssVars", "useId", "useTemplateRef",
  // 组件定义
  "defineComponent", "defineAsyncComponent", "createApp", "resolveComponent", "resolveDirective",
])

/**
 * 编译宏 —— `<script setup>` 里由编译器处理,**不需要也不应该 import**。
 * 不排除的话它们会被当成"漏 import"报出来,而模型按提示去 import 反而会引入告警。
 * 它们不在 VUE_APIS 里,这个集合只是把意图写明,防止后来人往白名单里加。
 */
const MACROS = new Set([
  "defineProps", "defineEmits", "defineExpose", "defineOptions", "defineSlots", "defineModel", "withDefaults",
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

/** 所有 `<script>` / `<script setup>` 块的内容拼一起(两种写法都要查) */
function scriptBody(src) {
  const parts = []
  for (const m of src.matchAll(/<script\b[^>]*>([\s\S]*?)<\/script>/gi)) parts.push(m[1])
  return parts.join("\n")
}

/**
 * 剥掉注释与字符串字面量 —— **这是 FAIL 档误报率的主要来源**:
 * 模型爱写 `// 用 ref() 定义响应式数据` 这种中文注释,不剥就是一条假报警。
 *
 * 顺序是**块注释 → 字符串 → 行注释**:行注释放最后,否则 `'http://x'` 里的 `//`
 * 会把半行真代码当注释吃掉。三条正则都不跨行吃(字符串类不匹配 `\n`),
 * 最坏情况只影响本行、且只会造成漏报。
 */
function stripNoise(code) {
  return code
    .replace(/\/\*[\s\S]*?\*\//g, " ")
    .replace(/`(?:\\[\s\S]|[^`\\])*`/g, "``")
    .replace(/'(?:\\[^\n]|[^'\\\n])*'/g, "''")
    .replace(/"(?:\\[^\n]|[^"\\\n])*"/g, '""')
    .replace(/\/\/[^\n]*/g, " ")
}

/**
 * 这个名字在本文件里被声明过吗(`const` / `let` / `var` / `function` / `class`,含解构)。
 * 声明过就不报 —— 那是模型自己的局部标识符,补 import 反而会撞名。
 * 判据故意放宽(只要声明头里出现过这个词就算),宁可漏报不误报。
 */
function declaredLocally(code, name) {
  return new RegExp(`\\b(?:const|let|var|function|class)\\b[^=;\\n]*\\b${name}\\b`).test(code)
}

/**
 * 这个名字在本文件里被当函数调用了吗。
 * - `(^|[^.$\\w])` 排除成员调用:`store.ref(`、`this.$nextTick(`、`myRef(`
 * - `(?:<[^<>()]*>)?` 兼容 TS 泛型:`ref<number>(0)`
 */
function calledAsFunction(code, name) {
  return new RegExp(`(^|[^.$\\w])${name}\\s*(?:<[^<>()]*>)?\\s*\\(`).test(code)
}

/** 遍历 views/ 下的 .vue,对每个文件跑 `check(src)`,收集非空结果 */
function walkVue(viewsDir, check) {
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
      const missing = check(src)
      if (missing.length) results.push({ file: abs, missing })
    }
  }
  walk(viewsDir)
  return results
}

/**
 * 组件漏 import —— **WARN**(判据不闭合,见文件头)
 * @returns {{file: string, missing: string[]}[]}
 */
export function lintMissingImports(viewsDir) {
  return walkVue(viewsDir, (src) => {
    const imported = importedNames(src)
    return [...usedComponents(src)].filter((c) => !imported.has(c))
  })
}

/**
 * vue API 漏 import —— **FAIL**(判据闭合,见文件头)
 * @returns {{file: string, missing: string[]}[]}
 */
export function lintMissingVueApis(viewsDir) {
  return walkVue(viewsDir, (src) => {
    const script = scriptBody(src)
    const code = stripNoise(script)
    if (!code.trim()) return [] // 没有 script 块,纯模板组件
    // import 扫**未剥过**的原文 —— stripNoise 会把 `from 'vue'` 的模块名剥成空串,
    // 在剥过的文本上认不出任何 import(那会让每个文件都误报一遍)。
    // 代价是注释掉的 import 也算数,方向安全(漏报)。
    const imported = importedNames(script)
    const missing = []
    for (const name of VUE_APIS) {
      if (MACROS.has(name)) continue // 兜底:白名单里不该有编译宏
      if (imported.has(name) || declaredLocally(code, name)) continue
      if (calledAsFunction(code, name)) missing.push(name)
    }
    return missing.sort()
  })
}
