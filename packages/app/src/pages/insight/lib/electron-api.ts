// Insight 内部用的桌面端 API 类型(Electron preload 暴露的 window.api 子集)。
// 不做全局 Window.api 接口增强 — 上游 app.tsx 已声明 Window.api,
// 接口合并会因 setTitlebar 之外字段不一致而 TS2717 报错。
// 走 helper 强转的方式取 api,类型安全在 helper 内闭环。
// 真实实现见 packages/desktop-electron/src/preload/index.ts。

export type DesktopApi = {
  setTitlebar?: (theme: { mode: "light" | "dark" }) => Promise<void>
  openPath?: (path: string, app?: string) => Promise<unknown>
  showItemInFolder?: (path: string) => void
  saveFilePicker?: (opts?: { title?: string; defaultPath?: string }) => Promise<string | null>
  downloadResource?: (url: string, destPath: string) => Promise<void>
  downloadResourceToTemp?: (url: string, namespace: string, filename: string) => Promise<string>
}

export function getDesktopApi(): DesktopApi | undefined {
  return (window as unknown as { api?: DesktopApi }).api
}
