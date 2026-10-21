/**
 * 工程的识别、列举与定位(SPEC-DES-008 §3.2 / §3.4 / §3.5)。
 *
 * 「这是不是我们的工程」只有两条判据,都是对确定文件的存在性判断:
 *   1. 工程根有标记 `.octo-fastui.json`(带 `schema` 字段)
 *   2. 旧布局:目录形如 `<会话目录>/outputs/<产物名>`、含 `packages/portal`,且会话目录下有旧状态文件
 * 两条都不满足的目录一律不碰 —— 工作区是设计师随手选的目录,同名的普通文件夹很常见。
 */
import { existsSync, readdirSync, renameSync, statSync, writeFileSync } from "node:fs"
import path from "node:path"
import { MARKER_FILE, readJson, within } from "./paths.mjs"

export const MARKER_SCHEMA = 1

/** 工程标记;不存在或不是标记(旧会话级状态文件没有 `schema`)返回 null */
export function readMarker(projectDir) {
  const m = readJson(path.join(projectDir, MARKER_FILE))
  return m && typeof m === "object" && m.schema ? m : null
}

/** 先写临时名再改名:宿主与别的脚本只会读到完整的文件 */
export function writeMarker(projectDir, marker) {
  const p = path.join(projectDir, MARKER_FILE)
  const tmp = `${p}.${process.pid}.tmp`
  writeFileSync(tmp, JSON.stringify(marker, null, 2))
  renameSync(tmp, p)
}

const hasPortal = (dir) => existsSync(path.join(dir, "packages", "portal"))

/**
 * 旧布局(SPEC-DES-008 之前):`<W>/.octo/<sid>/outputs/<产物名>/`,状态文件在会话目录。
 * 会话目录名就是会话 id,所以「属于哪个对话」也是确定的。
 * @returns {{sessionDir: string, sessionId: string, state: Record<string, any>} | null}
 */
export function legacyOf(projectDir) {
  const outputs = path.dirname(path.resolve(projectDir))
  if (path.basename(outputs) !== "outputs") return null
  const sessionDir = path.dirname(outputs)
  const state = readJson(path.join(sessionDir, MARKER_FILE))
  if (!state || typeof state !== "object" || state.schema || !hasPortal(projectDir)) return null
  return { sessionDir, sessionId: path.basename(sessionDir), state }
}

/**
 * @returns {{kind: "marker", marker: Record<string, any>} | {kind: "legacy", legacy: ReturnType<typeof legacyOf>} | null}
 */
export function identify(projectDir) {
  const marker = readMarker(projectDir)
  if (marker) return { kind: "marker", marker }
  const legacy = legacyOf(projectDir)
  if (legacy) return { kind: "legacy", legacy }
  return null
}

/** 起服务要用的环境信息(envDir / depsDir / nodeBin / skillDir):标记里有就用,旧布局读会话级状态 */
export function envInfoOf(id) {
  return id.kind === "marker" ? id.marker : id.legacy.state
}

function sessionsOf(id) {
  return id.kind === "marker" ? (Array.isArray(id.marker.sessions) ? id.marker.sessions : []) : [id.legacy.sessionId]
}

function updatedAtOf(dir, id) {
  const t = id.kind === "marker" ? Date.parse(id.marker.updatedAt ?? "") : NaN
  if (Number.isFinite(t)) return t
  try {
    return statSync(dir).mtimeMs
  } catch {
    return 0
  }
}

/**
 * `<artifactDir>` 下的工程(只看直接子目录)。
 *
 * 传了 `skillName` 就只列这个 skill 的:fastui 与 chart 的模板不同,不能互相接着改。
 * 旧布局不记 skill,只会出现在本会话目录内,照样列出。
 */
export function listProjects(artifactDir, { skillName, sessionId } = {}) {
  let entries = []
  try {
    entries = readdirSync(artifactDir, { withFileTypes: true })
  } catch {
    return []
  }
  const out = []
  for (const e of entries) {
    if (!e.isDirectory() || e.name.startsWith(".")) continue
    const dir = path.join(artifactDir, e.name)
    const id = identify(dir)
    if (!id) continue
    if (skillName && id.kind === "marker" && id.marker.skill && id.marker.skill !== skillName) continue
    out.push({
      name: e.name,
      dir,
      title: (id.kind === "marker" && id.marker.title) || e.name,
      updatedAt: updatedAtOf(dir, id),
      thisSession: sessionId ? sessionsOf(id).includes(sessionId) : null,
      legacy: id.kind === "legacy",
    })
  }
  return out.sort((a, b) => b.updatedAt - a.updatedAt)
}

const pad = (n) => String(n).padStart(2, "0")
const fmtTime = (ms) => {
  const d = new Date(ms)
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())} ${pad(d.getHours())}:${pad(d.getMinutes())}`
}

/** `PROJECTS_BEGIN…END` 块的正文,一行一个工程 */
export function formatProjects(list) {
  if (list.length === 0) return "(无)"
  return list
    .map((p) => {
      const mine = p.thisSession === null ? "unknown" : p.thisSession ? "yes" : "no"
      return `${p.name} | ${p.title} | updated ${fmtTime(p.updatedAt)} | this-session: ${mine}`
    })
    .join("\n")
}

/**
 * verify / export-zip 定位工程(SPEC-DES-008 §3.5),命中就停:
 *   1. `--project-dir`(主参数)
 *   2. `--session-dir`(旧参数:老对话历史里有这种命令,模型会照着跑):先读会话级状态,
 *      再到它的 outputs 里找恰好一个工程,还没有就按 3 的规则;用到旧参数时带一条 `warn`
 *   3. 都没传:本会话**恰好一个**工程才用它,零个或多个就报错列出候选 —— 不猜
 *
 * @returns {{ok: true, projectDir: string, id: NonNullable<ReturnType<typeof identify>>, warn?: string}
 *   | {ok: false, usage?: true, code?: string, reason: string, hint?: string, blocks?: Array<{name: string, text: string}>}}
 */
export function locateProject({ projectDir, sessionDir }, { sessionId, workspaceDir, skillName }) {
  // 有工作区上下文时,定位出来的工程必须在工作区内(内网 2026-10-21:旧版脚本在工作区**上一级**
  // 留下过会话级状态文件,`--session-dir` 指过去就可能把 verify 引到别的工程上)
  const inWorkspace = (dir) => !workspaceDir || within(dir, workspaceDir)
  if (projectDir && projectDir !== true) {
    const dir = path.resolve(String(projectDir))
    const id = identify(dir)
    if (id && !inWorkspace(dir)) {
      return {
        ok: false,
        code: "OUTSIDE_WORKSPACE",
        reason: `--project-dir 不在当前工作区内: ${dir}`,
        hint: `工作区是 ${workspaceDir}。--project-dir 取 new-session 返回的 PROJECT_DIR 原值`,
      }
    }
    if (id) return { ok: true, projectDir: dir, id }
    return {
      ok: false,
      code: "NO_PROJECT",
      reason: `不是 fastui 工程(没有 ${MARKER_FILE}): ${dir}`,
      hint: "--project-dir 取 new-session 返回的 PROJECT_DIR 原值;还没建过工程就先跑 new-session.mjs",
    }
  }
  const fromSession = sessionId && workspaceDir ? () => locateInSession({ sessionId, workspaceDir, skillName }) : null
  if (sessionDir && sessionDir !== true) {
    const sd = path.resolve(String(sessionDir))
    // 旧布局:会话级状态文件记着工程目录
    const state = readJson(path.join(sd, MARKER_FILE))
    const dir = state?.projectDir ? path.resolve(String(state.projectDir)) : null
    const id = dir ? identify(dir) : null
    if (dir && id && inWorkspace(dir)) return { ok: true, projectDir: dir, id }
    // 新版在普通工作区建的工程不写会话级状态,只在工程根有标记 —— 模型照旧习惯传了
    // 「[Artifact Folder] 的上一级」时,到它的 outputs 里找,恰好一个才用(内网 2026-10-21 实撞)
    const inOutputs = listProjects(path.join(sd, "outputs"), { skillName }).filter((p) => inWorkspace(p.dir))
    if (inOutputs.length === 1) {
      return { ok: true, projectDir: inOutputs[0].dir, id: identify(inOutputs[0].dir), warn: SESSION_DIR_WARN }
    }
    // 传错的 --session-dir(比如代码工作区下自己拼的 .octo 路径):按本会话恰好一个工程定位
    const viaSession = inOutputs.length === 0 && fromSession ? fromSession() : null
    if (viaSession?.ok) return { ...viaSession, warn: SESSION_DIR_WARN }
    return {
      ok: false,
      code: inOutputs.length ? "NO_PROJECT" : "NO_SESSION",
      reason: inOutputs.length ? `${sd} 下有 ${inOutputs.length} 个工程,无法确定是哪一个` : `${sd} 下找不到 fastui 工程`,
      hint: "改用 --project-dir=<new-session 返回的 PROJECT_DIR>",
      blocks: inOutputs.length ? [{ name: "PROJECTS", text: formatProjects(inOutputs) }] : viaSession?.blocks,
    }
  }
  if (fromSession) return fromSession()
  return { ok: false, usage: true, reason: "缺少 --project-dir=<new-session 返回的 PROJECT_DIR>" }
}

const SESSION_DIR_WARN = "--session-dir 是旧参数,下次 verify / export-zip 直接传 --project-dir=<new-session 返回的 PROJECT_DIR>"

/** 本会话恰好一个工程就用它,零个或多个就报错列出候选 —— 不猜 */
function locateInSession({ sessionId, workspaceDir, skillName }) {
  const scopes = [workspaceDir, path.join(workspaceDir, ".octo", sessionId, "outputs")]
  const mine = scopes.flatMap((s) => listProjects(s, { skillName, sessionId })).filter((p) => p.thisSession)
  if (mine.length === 1) return { ok: true, projectDir: mine[0].dir, id: identify(mine[0].dir) }
  return {
    ok: false,
    code: "NO_PROJECT",
    reason: mine.length ? `本对话有 ${mine.length} 个工程,无法确定是哪一个` : "本对话还没有工程",
    hint: "传 --project-dir=<new-session 返回的 PROJECT_DIR>;还没建过工程就先跑 new-session.mjs",
    blocks: mine.length ? [{ name: "PROJECTS", text: formatProjects(mine) }] : undefined,
  }
}

/**
 * 删除前的护栏(SPEC-DES-008 §3.4,替换 v14 的「路径必须含 .octo 段」—— 代码工作区下没有那一段)。
 *
 * `rmSync(recursive, force)` 不可逆、不进回收站,而目标路径是由外部参数推出来的。
 * 2026-09-07 内网出过 agent 误删用户目录的事故(SPEC-DES-001 §5.1.2),我们自己的代码里
 * 不能留同样的形状。以下全部满足才放行,任何一条不满足就拒绝 —— 宁可留个半成品让人看:
 *   - 目标是 `<artifactDir>` 的**直接子目录**
 *   - 有工作区上下文时,在工作区之内
 *   - 是我们的工程(带标记或旧布局),或者是本脚本建的临时目录(`tempPrefix` 开头)
 */
export function safeToRemove(target, { artifactDir, workspaceDir, tempPrefix }) {
  const abs = path.resolve(target)
  if (path.relative(path.resolve(artifactDir), path.dirname(abs)) !== "") return false
  if (workspaceDir && !within(abs, workspaceDir)) return false
  if (abs.split(path.sep).filter(Boolean).length < 3) return false
  if (tempPrefix && path.basename(abs).startsWith(tempPrefix)) return true
  return identify(abs) !== null
}
