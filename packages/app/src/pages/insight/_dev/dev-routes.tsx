import { lazy } from "solid-js"
import { Route } from "@solidjs/router"

/**
 * /_dev、/_dev/* 样式沙箱路由 —— 集中在此模块,让 app.tsx(限改)不再硬编码 dev 路由细节。
 *
 * 与原生路由完全隔离:
 *   ① 构建隔离:devRoutes() 仅在 import.meta.env.DEV 下被调用(见 app.tsx 调用点),生产包无此段。
 *   ② shell 隔离:isDevPath() 命中 → app.tsx 的 isOctoPage() 走 OctoShell,绕开原生 AppShellProviders。
 *   ③ 路径隔离:显式 /_dev 路由优先于通配 /:dir(session 那套)。
 *
 * 新增 dev 预览页:① 在下方 PAGES 加一条;② 在 index-preview.tsx 的 DEV_PAGES 加一条。无需改 app.tsx。
 */

const DevIndexPage = lazy(() => import("./index-preview"))
const InsightCardsDevPage = lazy(() => import("./cards-preview"))
const TypographyDevPage = lazy(() => import("./typography-preview"))
const ResultTabsDevPage = lazy(() => import("./result-tabs-preview"))
const FileFallbackDevPage = lazy(() => import("./file-fallback-preview"))

const PAGES = [
  { path: "/_dev", component: DevIndexPage },
  { path: "/_dev/insight-cards", component: InsightCardsDevPage },
  { path: "/_dev/typography", component: TypographyDevPage },
  { path: "/_dev/result-tabs", component: ResultTabsDevPage },
  { path: "/_dev/file-fallback", component: FileFallbackDevPage },
] as const

/** 是否为 /_dev 沙箱路径(含索引页本身,无尾斜杠)。app.tsx 用它决定走 OctoShell。 */
export function isDevPath(pathname: string): boolean {
  return pathname === "/_dev" || pathname.startsWith("/_dev/")
}

/** 返回全部 dev 路由。调用点须加 import.meta.env.DEV 守卫。 */
export function devRoutes() {
  return PAGES.map((p) => <Route path={p.path} component={p.component} />)
}
