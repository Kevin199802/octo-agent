import { useServer } from "@/context/server"
import { useGlobalSync } from "@/context/global-sync"
import { useParams } from "@solidjs/router"
import { decode64 } from "@/utils/base64"
import { isValidUserPath } from "@/utils/path-valid"

const SESSIONS_DIR_NAME = "sessions"

/**
 * 把 path.config(如 `~/.config/opencode`) 重写到 `~/.config/octo/sessions`,
 * 给"按目录选择项目"模式用作配置态的固定 sessions 落地点。
 */
export function octoSessionsDir(config: string): string {
  const octoConfig = config.replace(/opencode[/\\]?$/, "octo")
  const sep = octoConfig.includes("\\") ? "\\" : "/"
  const base = octoConfig.endsWith(sep) ? octoConfig.slice(0, -1) : octoConfig
  return base + sep + SESSIONS_DIR_NAME
}

/**
 * 统一项目目录抽象 —— 业务侧统一用这个 hook 拿"当前工作目录字符串",
 * 不再各页直接读 globalSync.data.path.home / server.projects.last(),
 * 避免目录来源不一致导致的"session.list 查的目录 ≠ session.create 落的目录"飘移 bug。
 *
 * 解析优先级:
 *   1. URL 路径 base64 段 `:dir`(directory-layout 路由用,详 directory-layout.tsx)
 *   2. `server.projects.last()`(用户最近通过 onboarding / 目录选择器选过的)
 *   3. `globalSync.data.path.home` 兜底(用户没显式选过,落 OS home)
 *
 * mode="config":固定走 `<config>/octo/sessions`,给 chat / studio 等"agent 级配置态"用。
 */
export function useProjectDir(opts?: { mode?: "project" | "config" }) {
  const server = useServer()
  const globalSync = useGlobalSync()
  const params = useParams<{ dir?: string }>()
  const mode = opts?.mode ?? "project"

  return () => {
    if (mode === "config") {
      const config = globalSync.data.path.config
      return config ? octoSessionsDir(config) : ""
    }
    if (params.dir) {
      const decoded = decode64(params.dir)
      if (decoded && isValidUserPath(decoded)) return decoded
    }
    const last = server.projects.last()
    if (last && isValidUserPath(last)) return last

    const home = globalSync.data.path.home
    if (home && isValidUserPath(home)) return home

    return ""
  }
}
