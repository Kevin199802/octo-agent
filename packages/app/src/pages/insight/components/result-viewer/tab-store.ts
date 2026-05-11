import { createSignal } from "solid-js"
import type { OutputCard } from "../insight-turn"

export type ResultTab = {
  id: string
  title: string
  type: "table" | "mindmap" | "markdown" | "file" | "json"
  content: string
  createdAt: Date
}

export function createTabStore() {
  const [tabs, setTabs] = createSignal<ResultTab[]>([])
  const [activeId, setActiveId] = createSignal<string | null>(null)

  function openTab(card: OutputCard) {
    const existing = tabs().find((t) => t.id === card.id)
    if (existing) {
      setActiveId(card.id)
      return
    }
    const tab: ResultTab = {
      id: card.id,
      title: card.title,
      type: card.type,
      content: card.content,
      createdAt: card.createdAt,
    }
    setTabs((prev) => [...prev, tab])
    setActiveId(card.id)
  }

  function closeTab(id: string) {
    setTabs((prev) => {
      const idx = prev.findIndex((t) => t.id === id)
      if (idx === -1) return prev
      const next = prev.filter((t) => t.id !== id)
      if (activeId() === id) {
        setActiveId(next[Math.max(0, idx - 1)]?.id ?? null)
      }
      return next
    })
  }

  function activate(id: string) {
    setActiveId(id)
  }

  function reset() {
    setTabs([])
    setActiveId(null)
  }

  return { tabs, activeId, activate, openTab, closeTab, reset }
}

export type TabStore = ReturnType<typeof createTabStore>
