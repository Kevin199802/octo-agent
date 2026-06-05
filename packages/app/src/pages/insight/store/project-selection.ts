// insight 项目/版本选择 — 本地持久化 store
//
// Octo 定制：UXAI 把选择存进 context/server.tsx 的 lastProjectSelection（按 server origin 分键）。
// octo-agent 的 server.tsx 在「不动」区（改了跟上游 diff 会乱），故这里改用 localStorage 自包含持久化，
// 即 UXAI commit 7bc39f2 之前的老做法。整套选择器自闭环在 insight/ 内，不依赖 server store。
//
// 见 plan: 左上角「选择版本」复刻 UXAI make-tab ProjectInfo。

import { createSignal } from "solid-js"
import type { Domain, ProductLine, Product, Version } from "../components/project-selector/project-product-select-panel"

export interface ProjectSelection {
  directory?: string
  domain?: Domain
  productLine?: ProductLine
  product?: Product
  version?: Version
}

const STORAGE_KEY = "octo:insight:project-selection"

function load(): ProjectSelection | undefined {
  try {
    const raw = localStorage.getItem(STORAGE_KEY)
    if (!raw) return undefined
    return JSON.parse(raw) as ProjectSelection
  } catch {
    return undefined
  }
}

// 模块级 signal：卡片订阅它 → 弹窗保存后即时刷新。
const [projectSelection, setProjectSelection] = createSignal<ProjectSelection | undefined>(load())

export { projectSelection }

export function saveProjectSelection(data: ProjectSelection): void {
  setProjectSelection(data)
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(data))
  } catch {}
}
