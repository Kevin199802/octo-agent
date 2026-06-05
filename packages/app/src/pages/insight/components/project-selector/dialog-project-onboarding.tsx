import { Splash } from "@opencode-ai/ui/logo"
import octoAgentWordmarkUrl from "../../icons/octo-agent.png?url"
import { usePlatform } from "@/context/platform"
import { useGlobalSync } from "@/context/global-sync"
import { useLanguage } from "@/context/language"
import { ProjectInfoDialogContent } from "./project-info-dialog-content"
import { createStore } from "solid-js/store"
import { createMemo, createSignal, Show } from "solid-js"
import { projectSelection, saveProjectSelection, type ProjectSelection } from "../../store/project-selection"

/**
 * insight 项目&版本 onboarding 弹窗 —— 复刻 UXAI make-tab DialogProjectOnboarding。
 *
 * Octo 定制（见 plan）：
 * - 去掉 useServer / useGlobalSDK / useLayout 依赖（server.tsx 在「不动」区，不能加 saveSelection/lastSelection）。
 *   选择初值读本地 store projectSelection()，确定时写 saveProjectSelection()。
 * - 纯 UI：handleConfirm 只持久化 + 关闭，不切换 app 项目（不 layout.projects.open / createClient / navigate）。
 * - octo-agent 无 @/utils/path-valid → 内联极简校验。
 * - 顶部 wordmark octo-agent.png 缺失 → 仅渲染 Splash + 文字兜底（见 design-assets-needed.md）。
 */

interface DialogProjectOnboardingProps {
  onSelect: (data: ProjectSelection) => void
}

const isValidUserPath = (p?: string): p is string => !!p && p.trim().length > 0

export function DialogProjectOnboarding(props: DialogProjectOnboardingProps) {
  const platform = usePlatform()
  const globalSync = useGlobalSync()
  const language = useLanguage()

  const lastSelection = projectSelection()

  const [selections, setSelections] = createStore({
    domain: lastSelection?.domain,
    productLine: lastSelection?.productLine,
    product: lastSelection?.product,
    version: lastSelection?.version,
  })

  const [directory, setDirectory] = createSignal<string>(lastSelection?.directory ?? "")
  const [selecting, setSelecting] = createSignal(false)

  const displayPath = createMemo(() => {
    const dir = directory()
    if (!dir) return ""
    const home = globalSync.data.path.home
    if (home && dir.startsWith(home)) {
      return "~" + dir.slice(home.length)
    }
    return dir
  })

  async function handlePickDirectory() {
    if (selecting()) return
    setSelecting(true)
    try {
      const result = await platform.openDirectoryPickerDialog?.({
        title: language.t("command.project.open"),
        multiple: false,
      })
      const picked = Array.isArray(result) ? result[0] : result
      if (typeof picked === "string" && picked) {
        setDirectory(picked)
      }
    } finally {
      setSelecting(false)
    }
  }

  function handleConfirm() {
    const dir = directory()
    if (!dir) return
    const data: ProjectSelection = {
      directory: dir,
      domain: selections.domain,
      productLine: selections.productLine,
      product: selections.product,
      version: selections.version,
    }
    saveProjectSelection(data)
    props.onSelect(data)
  }

  const hasDirectory = createMemo(() => isValidUserPath(directory()))

  return (
    <div
      class="fixed inset-0 z-50 flex items-center justify-center"
      style={{ background: "rgba(0, 0, 0, 0.5)" }}
    >
      <div
        class="flex flex-col items-center"
        style={{
          width: "400px",
          background: "white",
          "border-radius": "8px",
          padding: "40px 32px 32px 32px",
          "box-shadow": "0 4px 24px rgba(0, 0, 0, 0.15)",
          overflow: "visible",
        }}
      >
        <Splash class="w-[80px] h-[80px]" />
        <img src={octoAgentWordmarkUrl} alt="Octo Agent" style={{ width: "212px", height: "42px", "margin-top": "20px" }} />
        <div style={{ "font-weight": 500, "font-size": "16px", "line-height": "24px", "letter-spacing": "2px", "text-align": "center", color: "rgba(110, 115, 122, 1)", "margin-top": "4px" }}>您的全能设计与调研专家</div>
        <div style={{ "font-weight": 500, "font-size": "16px", "line-height": "19px", "text-align": "left", "margin-top": "40px", width: "100%", color: "#191919" }}>选择项目&版本</div>
        <div style={{ width: "100%", height: "40px", "margin-top": "4px" }}>
          <ProjectInfoDialogContent
            domain={selections.domain}
            productLine={selections.productLine}
            product={selections.product}
            version={selections.version}
            onSelectionChange={(data) => {
              setSelections("domain", data.domain)
              setSelections("productLine", data.productLine)
              setSelections("product", data.product)
              setSelections("version", data.version)
            }}
          />
        </div>
        <div style={{ "font-weight": 500, "font-size": "16px", "line-height": "19px", "text-align": "left", "margin-top": "16px", width: "100%", color: "#191919" }}>关联本地文件夹</div>

        <button
          type="button"
          onClick={handlePickDirectory}
          disabled={selecting()}
          class="w-full mb-5 flex items-center gap-2 px-3"
          style={{
            height: "40px",
            "margin-top": "4px",
            border: "1px solid var(--octo-border-input, #D1D5DB)",
            "border-radius": "6px",
            background: selecting() ? "var(--octo-surface-disabled, #F3F4F6)" : "transparent",
            cursor: selecting() ? "not-allowed" : "pointer",
            overflow: "hidden",
          }}
        >
          <Show when={displayPath()} fallback={<span class="text-text-weak text-[14px]">选择文件夹</span>}>
            <span
              class="text-[14px] font-mono text-text-base overflow-hidden truncate"
              style={{
                color: "#191919"
              }}
            >
              {displayPath()}
            </span>
          </Show>
        </button>

        <button
          type="button"
          onClick={handleConfirm}
          disabled={!hasDirectory()}
          class="w-full h-[40px] rounded-md text-[14px] font-medium text-white"
          style={{
            background: hasDirectory() ? "#0a59f7" : "var(--octo-surface-disabled, #D1D5DB)",
            cursor: hasDirectory() ? "pointer" : "not-allowed",
            color: "#fff",
          }}
        >
          确定
        </button>
      </div>
    </div>
  )
}
