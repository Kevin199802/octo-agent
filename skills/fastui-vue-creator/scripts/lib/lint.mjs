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
 * 撞上已有的同名绑定 → `SyntaxError: Identifier 'x' has already been declared`
 * → 编译门禁挡住 → 删掉又回到 MISSING → 两道门互卡,再也出不来。
 *
 * 所以判定拆成**两边用不同文本**,各自朝漏报方向偏:
 *
 * | 问什么 | 查哪份文本 | 为什么 |
 * |---|---|---|
 * | 这个名字**被绑定**了吗 | **未剥噪声的原文** | `stripNoise` 的块注释与模板字符串两条正则**会跨行**,一旦吞掉中间几行,被吞的正好是 `const ref = …` 而下面的 `ref(1)` 还在 → 报一个本文件声明过的名字 → 死锁 |
 * | 这个名字**被调用**了吗 | **剥过噪声的文本** | 不剥的话注释和字符串里的 `ref(` 都算数 |
 *
 * > ⚠️ 2026-09-12 的 review 逐条打穿过一版"都用剥过的文本"的实现 ——
 * > 10 个反例全中,其中 import 清单带注释、以及上面那条跨行吞代码,都会真死锁。
 * > 那些反例全部固化在 `lint.test.mjs` 里了,**改这里之前先跑它**。
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
    // clause 里的注释必须先剥。多行 import 逐项写注释是模型最常见的写法之一:
    //   import {
    //     ref,        // 响应式
    //     computed,   // 派生
    //   } from 'vue'
    // 不剥的话 `split(",")` 切出的第二段是 " // 响应式\n  computed",
    // 整段被当成一个别名收进集合,**`computed` 自己反而没收录** → 报它漏 import
    // → 模型再补一行 import → `Identifier 'computed' has already been declared`
    // → 编译门禁挡住 → 删掉又回到 MISSING → **死锁**。
    // 模块名在 clause 之外,不受影响。
    const clause = m[1].replace(/\/\*[\s\S]*?\*\//g, " ").replace(/\/\/[^\n]*/g, " ")
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

/**
 * 要查的代码正文:`.vue` 取所有 `<script>` / `<script setup>` 块,`.ts` / `.js` 取全文。
 *
 * 带上 `.ts` / `.js` 是因为模型常把逻辑抽成 `views/xxx/useTable.ts` ——
 * 那里漏 `ref` 一样是白屏,而只扫 `.vue` 的话门禁看不见。
 */
function scriptBody(src, file = "") {
  if (!file.endsWith(".vue")) return src
  const parts = []
  for (const m of src.matchAll(/<script\b[^>]*>([\s\S]*?)<\/script>/gi)) parts.push(m[1])
  return parts.join("\n")
}

/**
 * 剥掉注释与字符串字面量 —— **这是 FAIL 档误报率的主要来源**:
 * 模型爱写 `// 用 ref() 定义响应式数据` 这种中文注释,不剥就是一条假报警。
 *
 * 顺序是**块注释 → 模板字符串 → 引号字符串 → 行注释**:行注释放最后,
 * 否则 `'http://x'` 里的 `//` 会把半行真代码当注释吃掉。
 *
 * ⚠️ **块注释与模板字符串这两条会跨行**:源码里一个落单的 `/*` 或反引号
 * (写在字符串或注释里)会让它一路吃到下一个配对符号,中间几行真代码就没了。
 * 所以这个函数的输出**只能用来判断"有没有被调用"**;判断"有没有被绑定"必须
 * 回到原文(见 `boundNames`)—— 否则被吞掉的声明会变成一条误报。
 */
function stripNoise(code) {
  return code
    .replace(/\/\*[\s\S]*?\*\//g, " ")
    .replace(/`(?:\\[\s\S]|[^`\\])*`/g, "``")
    .replace(/'(?:\\[^\n]|[^'\\\n])*'/g, "''")
    .replace(/"(?:\\[^\n]|[^"\\\n])*"/g, '""')
    .replace(/\/\/[^\n]*/g, " ")
}

/** 一段文本里所有看起来像标识符的词 */
const identsIn = (s) => s.match(/[A-Za-z_$][\w$]*/g) ?? []

/**
 * 一串"逗号分隔的绑定位"(声明列表 / 形参列表)里被**绑定**的名字。
 *
 * 关键是**按逗号切开后只取 `=` 左边** —— 右边是初始化表达式,
 * `const n = ref(0)` 的 `ref` 在右边,绝不能算成"声明过 ref",否则真阳性全灭。
 * 左边则要整段取标识符,这样解构 `const { a, b } = x` 两个名字都收得到。
 */
function boundIn(list) {
  const out = []
  for (const seg of list.split(",")) out.push(...identsIn(seg.split("=")[0]))
  return out
}

/**
 * 本文件里**已经被绑定**的名字:import、声明、函数/类名、方法简写、形参。
 * 命中就不报 —— 那是模型自己的标识符,补 import 只会撞名(`SyntaxError`)。
 *
 * ⚠️ **在未剥噪声的原文上跑**(`stripNoise` 的块注释与模板字符串两条正则都会跨行,
 * 一旦吞掉中间几行,被吞的正好是 `const ref = …` 这条声明、而下面的 `ref(1)` 还在,
 * 就会报一个本文件明确声明过的名字 → 模型补 import → 撞名 → 死锁)。
 * 代价是注释里的假声明也算数 —— 那是漏报方向,安全。
 */
function boundNames(script) {
  const names = new Set(importedNames(script))
  const add = (arr) => arr.forEach((n) => names.add(n))

  // const / let / var 的声明列表(含解构、含 `let a = 1, watch = null` 这种多声明符)
  for (const m of script.matchAll(/\b(?:const|let|var)\s+([^;\n]+)/g)) add(boundIn(m[1]))
  // 函数名 / 类名
  for (const m of script.matchAll(/\b(?:function\s*\*?|class)\s+([A-Za-z_$][\w$]*)/g)) names.add(m[1])
  // 方法简写与函数声明:`provide() {` / `watch(cb) {` / `function f(a = 0, nextTick) {`
  // —— 名字和形参一起收。`[^()]*` 不吃括号,所以 `onMounted(() => {})` 这类**真调用**
  // (实参几乎总带括号)匹配不上;`ref({})` 之类括号后面也不是 `{`。
  for (const m of script.matchAll(/([A-Za-z_$][\w$]*)\s*\(([^()]*)\)\s*\{/g)) {
    names.add(m[1])
    add(boundIn(m[2]))
  }
  // 箭头函数形参:`(unref) => unref()` / `v => v`
  for (const m of script.matchAll(/\(([^()]*)\)\s*=>/g)) add(boundIn(m[1]))
  for (const m of script.matchAll(/(^|[^.$\w])([A-Za-z_$][\w$]*)\s*=>/g)) names.add(m[2])

  return names
}

/**
 * 这个名字在本文件里被当函数调用了吗。
 * - `(^|[^.$\\w])` 排除成员调用:`store.ref(`、`this.$nextTick(`、`myRef(`
 * - `(?:<[^<>()]*>)?` 兼容 TS 泛型:`ref<number>(0)`
 */
function calledAsFunction(code, name) {
  return new RegExp(`(^|[^.$\\w])${name}\\s*(?:<[^<>()]*>)?\\s*\\(`).test(code)
}

/** 遍历 views/,对每个源码文件跑 `check(src, file)`,收集非空结果 */
function walkFiles(viewsDir, check, exts) {
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
      // .d.ts 只有类型声明,没有运行时调用
      if (!exts.some((x) => e.name.endsWith(x)) || e.name.endsWith(".d.ts")) continue
      let src = ""
      try {
        src = readFileSync(abs, "utf8")
      } catch {
        continue
      }
      const missing = check(src, e.name)
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
  // 组件标签只可能出现在 .vue 的 <template> 里
  return walkFiles(viewsDir, (src) => {
    const imported = importedNames(src)
    return [...usedComponents(src)].filter((c) => !imported.has(c))
  }, [".vue"])
}

/**
 * vue API 漏 import —— **FAIL**(判据闭合,见文件头)
 * @returns {{file: string, missing: string[]}[]}
 */
export function lintMissingVueApis(viewsDir) {
  return walkFiles(viewsDir, (src, file) => {
    const script = scriptBody(src, file)
    const code = stripNoise(script)
    if (!code.trim()) return [] // 没有 script 块,纯模板组件
    // **两边用的文本不同,这是刻意的**:
    // - "被绑定了吗"查**原文**(剥噪声会跨行吞掉声明 → 误报 → 死锁)
    // - "被调用了吗"查**剥过的**(不剥的话注释和字符串里的 `ref(` 都算 → 误报)
    // 两边都朝漏报方向偏。
    const bound = boundNames(script)
    const missing = []
    for (const name of VUE_APIS) {
      if (MACROS.has(name)) continue // 兜底:白名单里不该有编译宏
      if (bound.has(name)) continue
      if (calledAsFunction(code, name)) missing.push(name)
    }
    return missing.sort()
  }, [".vue", ".ts", ".js"])
}
