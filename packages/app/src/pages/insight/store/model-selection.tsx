/**
 * Insight 专属模型选择 store
 *
 * 设计目标:
 * - 不引入 octoapp 子目录(上游路径对齐),不改 src/context/local.tsx 公共代码
 * - 仅复用 ModelSelectorPopover(通过 `model` prop 注入,绕过其内部 useLocal 调用,见
 *   src/components/dialog-select-model.tsx:27 `const model = props.model ?? useLocal().model`)
 * - 模型清单 / 可见性 / recent 等"全局"概念直接代理到 @/context/models
 *   (这些本就是 user-level/workspace-level 共享,无需 agent 隔离)
 * - 仅 "当前选中模型" 是 insight 专属,workspace 级持久化,
 *   key "insight-model-selection" 跟 useLocal 的 "model-selection" 隔离
 *
 * 不实现:
 * - session 级隔离(UXAI octoapp/context/local.tsx 做了 per-session 模型记忆,我们暂不需要)
 * - variant 切换(无 UI 入口,variant.* 字段返回 noop 仅为 ModelState 类型兼容)
 */
import { batch, createMemo } from "solid-js"
import { createStore } from "solid-js/store"
import { createSimpleContext } from "@opencode-ai/ui/context"
import { useSDK } from "@/context/sdk"
import { useModels } from "@/context/models"
import { Persist, persisted } from "@/utils/persist"

export type ModelKey = { providerID: string; modelID: string }

type Saved = {
  // 除 id 外额外存一份 name:首次进入时 providers 尚未连接、find() 还解析不出模型对象,
  // 用持久化的 name 立即显示已选项,消除"已有选中却显示未选"的首屏闪烁(模型标签 bug)。
  model?: ModelKey & { name?: string }
}

export const { use: useInsightModelSelection, provider: InsightModelSelectionProvider } =
  createSimpleContext({
    name: "InsightModelSelection",
    init: () => {
      const sdk = useSDK()
      const models = useModels()

      const [saved, setSaved, , savedReady] = persisted(
        Persist.workspace(sdk.directory, "insight-model-selection", ["insight-model-selection.v1"]),
        createStore<Saved>({}),
      )

      const current = () => {
        if (!savedReady()) return undefined
        const key = saved.model
        if (!key) return undefined
        return models.find(key)
      }

      // 标签文案:优先用解析出的真实模型对象(权威,能反映改名),
      // providers 未连接时回退到持久化的 name,保证有选中项就不会显示"未选"。
      const label = () => current()?.name ?? (savedReady() ? saved.model?.name : undefined)

      const recent = createMemo(() => models.recent.list().map(models.find).filter(Boolean))

      const set = (item: ModelKey | undefined, options?: { recent?: boolean }) => {
        batch(() => {
          if (!item) {
            setSaved("model", undefined)
            return
          }
          // 选择发生在 providers 已连接时,此刻 find() 能解析出 name,顺手存下供下次首屏显示。
          setSaved("model", {
            providerID: item.providerID,
            modelID: item.modelID,
            name: models.find(item)?.name,
          })
          models.setVisibility(item, true)
          if (options?.recent) models.recent.push(item)
        })
      }

      const cycle = (direction: 1 | -1) => {
        const items = recent()
        const item = current()
        if (!item) return
        const index = items.findIndex((e) => e?.provider.id === item.provider.id && e?.id === item.id)
        if (index === -1) return
        let next = index + direction
        if (next < 0) next = items.length - 1
        if (next >= items.length) next = 0
        const entry = items[next]
        if (!entry) return
        set({ providerID: entry.provider.id, modelID: entry.id })
      }

      const model = {
        // 直接代理 models.ready(它是 Accessor & { promise } 类型,包一层就丢了 .promise)。
        // savedReady() 守卫已经在 current() 内做,异步未就绪时返回 undefined,不会泄漏错误模型。
        ready: models.ready,
        current,
        label,
        recent,
        list: models.list,
        cycle,
        set,
        visible: models.visible,
        setVisibility: models.setVisibility,
        variant: {
          configured: () => undefined as string | undefined,
          selected: () => undefined as string | null | undefined,
          current: () => undefined as string | undefined,
          list: () => [] as string[],
          set: (_value: string | undefined) => {},
          cycle: () => {},
        },
      }

      return { model }
    },
  })
