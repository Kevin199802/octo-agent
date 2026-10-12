#!/usr/bin/env node
/**
 * lint.mjs 的自检(SPEC-DES-001 §9.1 V0-j)—— 零依赖,`node lint.test.mjs` 直接跑。
 *
 * **为什么这个模块单独配了用例,别的脚本没有**:`lintMissingVueApis` 是这套流程里
 * 唯一一道**纯静态、且会 FAIL** 的门禁。它误报一次,模型就照提示补 import、
 * 撞上已有的同名局部声明 → 编译错误 → 两道门互卡,再也出不来。
 * 所以用例的重心不在"能不能查出漏的",而在**下面那一串"不该报的"**:
 * 注释、字符串、成员调用、编译宏、局部同名声明、import 别名。
 *
 * 往 VUE_APIS 白名单里加名字之前,先在这里补一条"不该报"的用例。
 */
import { mkdtempSync, mkdirSync, writeFileSync, rmSync } from "node:fs"
import { tmpdir } from "node:os"
import path from "node:path"
import { lintMissingImports, lintMissingVueApis } from "./lint.mjs"

const ROOT = path.join(mkdtempSync(path.join(tmpdir(), "octo-lint-")), "views")
const BT = String.fromCharCode(96) // 反引号 —— 用例本身写在模板字符串里,不能直接打

/** @type {[string, string, string[]][]} 名字 / 文件内容 / 期望报出的 vue API */
const CASES = [
  ["漏 ref —— 必须报", `<template><div>{{ n }}</div></template>
<script setup lang="ts">
const n = ref(0)
</script>`, ["ref"]],

  ["正确 import —— 不报", `<script setup>
import { ref, computed } from 'vue'
const n = ref(0)
const d = computed(() => n.value * 2)
</script>`, []],

  ["注释里的 ref() —— 不报(最大误报源)", `<script setup>
import { reactive } from 'vue'
// 这里本来想用 ref() 定义,后来改成 reactive 了
/* watch() 也考虑过 */
const s = reactive({})
</script>`, []],

  ["字符串字面量里的 ref( —— 不报", `<script setup>
const tip = '写法是 ref(0)'
const t2 = "computed(() => 1)"
const t3 = \`onMounted(() => {})\`
</script>`, []],

  ["成员调用 store.ref( / $nextTick( —— 不报", `<script setup>
import { getCurrentInstance } from 'vue'
const i = getCurrentInstance()
i.proxy.$nextTick(() => {})
const store = {}
store.ref(1)
</script>`, []],

  ["局部同名声明 —— 不报(误报会锁死模型)", `<script setup>
const ref = (v) => ({ value: v })
const n = ref(0)
function watch() {}
watch()
const { inject } = window
inject()
</script>`, []],

  ["编译宏 —— 不报(它们不需要 import)", `<script setup lang="ts">
const props = withDefaults(defineProps<{ a?: string }>(), { a: '' })
const emit = defineEmits(['x'])
defineExpose({})
defineOptions({ name: 'X' })
const m = defineModel()
</script>`, []],

  ["TS 泛型 ref<number>(0) 漏 import —— 必须报", `<script setup lang="ts">
const n = ref<number>(0)
const l = shallowRef<string[]>([])
</script>`, ["ref", "shallowRef"]],

  ["多个 API 同时漏 —— 全报", `<script setup>
import { ref } from 'vue'
const n = ref(0)
const d = computed(() => n.value)
onMounted(() => { nextTick(() => {}) })
watch(n, () => {})
</script>`, ["computed", "nextTick", "onMounted", "watch"]],

  ["import as 别名 —— 不报", `<script setup>
import { ref as vueRef } from 'vue'
const n = vueRef(0)
</script>`, []],

  ["纯模板无 script —— 不报", `<template><div>hi</div></template>`, []],

  ["URL 字符串在前、ref() 在后 —— 仍要报(剥离顺序)", `<script setup>
const api = 'http://127.0.0.1:8081/x'
const n = ref(0)
</script>`, ["ref"]],

  ["Options API setup() 里漏 —— 必须报", `<script>
export default {
  setup() {
    const n = ref(0)
    onMounted(() => {})
    return { n }
  }
}
</script>`, ["onMounted", "ref"]],

  ["普通 script 与 script setup 并存 —— 合并查", `<script>
export default { name: 'X' }
</script>
<script setup>
import { ref } from 'vue'
const n = ref(0)
const c = computed(() => 1)
</script>`, ["computed"]],

  ["provide / toRefs 漏 —— 报", `<script setup>
provide('k', 1)
const { a } = toRefs(props)
</script>`, ["provide", "toRefs"]],

  ["名字含 ref 但不是调用 —— 不报", `<script setup>
import { reactive } from 'vue'
const inputRef = null
const myref = reactive({})
const x = { ref: 1 }
</script>`, []],

  // ── 以下 10 条来自 2026-09-12 的 review,**当时全部误报**,其中前两组会真死锁 ──
  // (模型照提示补 import → 与已有绑定撞名 → SyntaxError → 编译门禁挡住 → 删掉又回到
  //  MISSING → 出不来。已用 `node --check` 确认撞名确实是 SyntaxError。)

  ["import 清单里带行内注释 —— 不报(死锁级)", `<script lang="ts" setup>
import {
  ref,        // 响应式
  computed,   // 派生
} from 'vue'
const rows = ref([])
const total = computed(() => rows.value.length)
</script>`, []],

  ["import 清单里带块注释 —— 不报(死锁级)", `<script setup>
import { ref /* 响应式 */, watch } from 'vue'
const n = ref(0)
watch(n, () => {})
</script>`, []],

  ["行注释里的落单反引号吞掉后面几行 —— 不报(死锁级)", `<script setup>
// 用 ${BT}ref 代替
const ref = (v) => ({ value: v })
const msg = ${BT}hello${BT}
const n = ref(1)
</script>`, []],

  ["字符串里的反引号吞掉后面几行 —— 不报(死锁级)", `<script setup>
const tick = "${BT}"
const ref = (v) => ({ value: v })
const msg = ${BT}hi${BT}
const n = ref(1)
</script>`, []],

  ["字符串里的 /* 吞掉后面几行 —— 不报(死锁级)", `<script setup>
const OPEN = "/*"
const ref = (v) => ({ value: v })
/* 普通注释 */
const n = ref(1)
</script>`, []],

  ["Options API 的 provide() 方法简写 —— 不报", `<script>
export default {
  data() { return { msg: 'hi' } },
  provide() { return { theme: 'dark' } },
}
</script>`, []],

  ["对象方法简写 watch(cb){} —— 不报", `<script>
export default {
  methods: { watch(cb) { return cb } },
}
</script>`, []],

  ["多声明符 let a = 1, watch = null —— 不报", `<script setup>
let a = 1, watch = null
watch = () => {}
watch()
</script>`, []],

  ["默认值之后的形参 —— 不报", `<script setup>
function f(a = 0, nextTick) { return nextTick() }
f()
</script>`, []],

  ["箭头形参 (unref) => unref() —— 不报", `<script setup>
const go = (unref) => unref()
go(() => 1)
</script>`, []],

  // 真阳性不能因为上面这些放宽而丢
  ["多行 import 写干净、另漏 watch —— 仍要报", `<script setup>
import {
  ref,
  computed,
} from 'vue'
const n = ref(0)
const d = computed(() => n.value)
watch(n, () => {})
</script>`, ["watch"]],
]

let pass = 0
let failed = 0
const report = (okCase, name, extra = "") => {
  console.log(`${okCase ? "PASS" : "FAIL"} ${name}${extra}`)
  okCase ? pass++ : failed++
}

const writeOne = (dir, src) => {
  rmSync(ROOT, { recursive: true, force: true })
  mkdirSync(path.join(ROOT, dir), { recursive: true })
  writeFileSync(path.join(ROOT, dir, "index.vue"), src)
}

const t0 = Date.now()
for (const [name, src, expect] of CASES) {
  writeOne("page", src)
  const got = lintMissingVueApis(ROOT).flatMap((r) => r.missing)
  const okCase = JSON.stringify(got) === JSON.stringify(expect)
  report(okCase, name, okCase ? "" : `\n     期望 ${JSON.stringify(expect)} / 实际 ${JSON.stringify(got)}`)
}

// golden example 等下划线目录不检查
writeOne("_example", `<script setup>\nconst n = ref(0)\n</script>`)
report(lintMissingVueApis(ROOT).length === 0, "_ 开头的目录跳过")

// 抽出去的 .ts 也要查(模型常把逻辑放进 useXxx.ts,那里漏 ref 一样白屏)
writeOne("page", `<template><div/></template>`)
writeFileSync(path.join(ROOT, "page", "useTable.ts"), `export function useTable() {\n  const rows = ref([])\n  return { rows }\n}`)
report(
  JSON.stringify(lintMissingVueApis(ROOT).flatMap((r) => r.missing)) === JSON.stringify(["ref"]),
  ".ts 里漏 ref —— 必须报",
)

// .d.ts 只有类型声明,没有运行时调用
writeOne("page", `<template><div/></template>`)
writeFileSync(path.join(ROOT, "page", "types.d.ts"), `export declare function ref(v: unknown): void`)
report(lintMissingVueApis(ROOT).length === 0, ".d.ts 跳过")

// 组件检查(WARN 档)的回归
writeOne("page", `<template><el-table /><ElTag /></template>
<script setup>
import { ElButton } from 'element-plus'
</script>`)
const comps = lintMissingImports(ROOT).flatMap((r) => r.missing).sort()
report(JSON.stringify(comps) === JSON.stringify(["ElTable", "ElTag"]), `组件检查回归 —— ${JSON.stringify(comps)}`)

rmSync(path.dirname(ROOT), { recursive: true, force: true })
console.log(`\n${pass} / ${pass + failed} 通过,耗时 ${Date.now() - t0}ms`)
process.exit(failed ? 1 : 0)
