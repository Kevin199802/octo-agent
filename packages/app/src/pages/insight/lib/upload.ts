// 上传服务客户端：spec 见 docs/specs/infra/file-upload.md
//
// 设计要点：
// - form 里只发 file 一个字段，不组 S3 路径（路径策略是服务端的事）
// - 端点从环境变量 VITE_OCTO_UPLOAD_ENDPOINT 读取，内网同学改 .env.local 即可，
//   不需要改源码（详见 spec §端点）
// - 全链路 console 日志统一前缀 [octo:upload]，便于内外网隔空调试

// 上传服务端地址。配置方式：packages/app/.env.local 里写 VITE_OCTO_UPLOAD_ENDPOINT=...
const UPLOAD_ENDPOINT = import.meta.env.VITE_OCTO_UPLOAD_ENDPOINT ?? ""

const LOG = "[octo:upload]"

export const MAX_UPLOAD_SIZE = 100 * 1024 * 1024 // Insight 当前 100MB；其他 agent 可自定
export const ALLOWED_EXT = ["txt", "md", "docx", "xlsx", "pdf"] as const

export type UploadResult = {
  url: string
  fileId: string
  fileName: string
  size: number
  mime: string
}

// 服务端响应统一封装（内网约定，spec §接口合同）
type ApiResponse<T> = {
  content: T | null
  success: boolean
  errorCode: number
  errorMessage: string | null
}

export type UploadErrorCode =
  | "FILE_TOO_LARGE"
  | "EXT_NOT_ALLOWED"
  | "FILE_INVALID"
  | "RATE_LIMITED"
  | "ENDPOINT_NOT_CONFIGURED"
  | "NETWORK"
  | "INTERNAL"

export class UploadError extends Error {
  constructor(public code: UploadErrorCode, message?: string) {
    super(message ?? code)
    this.name = "UploadError"
  }
}

function getExt(filename: string): string {
  const dot = filename.lastIndexOf(".")
  if (dot < 0 || dot === filename.length - 1) return ""
  return filename.slice(dot + 1).toLowerCase()
}

export function validateFile(file: File): UploadError | null {
  if (file.size === 0) return new UploadError("FILE_INVALID", "文件为空")
  if (file.size > MAX_UPLOAD_SIZE) {
    return new UploadError(
      "FILE_TOO_LARGE",
      `文件超过 ${Math.round(MAX_UPLOAD_SIZE / 1024 / 1024)}MB 上限`,
    )
  }
  const ext = getExt(file.name)
  if (!ALLOWED_EXT.includes(ext as (typeof ALLOWED_EXT)[number])) {
    return new UploadError("EXT_NOT_ALLOWED", `不支持的格式 .${ext || "(无扩展名)"}`)
  }
  return null
}

// 业务错误码 → 客户端语义。spec §业务错误码
function mapErrorCode(code: number, message: string | null): UploadError {
  const msg = message ?? ""
  if (code === 305) return new UploadError("FILE_INVALID", msg || "文件无效")
  if (code === 413) return new UploadError("FILE_TOO_LARGE", msg || "超过服务端大小上限")
  if (code === 415) return new UploadError("EXT_NOT_ALLOWED", msg || "服务端不支持的格式")
  if (code === 429) return new UploadError("RATE_LIMITED", msg || "上传繁忙，请稍后重试")
  if (code >= 500) return new UploadError("INTERNAL", msg || `服务端错误 (errorCode=${code})`)
  return new UploadError("INTERNAL", msg || `上传失败 (errorCode=${code})`)
}

// HTTP 层失败兜底（被代理直接拒、或服务端没按封装协议返回时走这里）
function mapHttpStatus(status: number): UploadError {
  if (status === 413) return new UploadError("FILE_TOO_LARGE", "超过服务端大小上限")
  if (status === 415) return new UploadError("EXT_NOT_ALLOWED", "服务端不支持的格式")
  if (status === 429) return new UploadError("RATE_LIMITED", "上传繁忙，请稍后重试")
  if (status >= 500) return new UploadError("INTERNAL", `服务端错误 (HTTP ${status})`)
  return new UploadError("INTERNAL", `上传失败 (HTTP ${status})`)
}

export async function uploadFile(file: File): Promise<UploadResult> {
  const meta = { filename: file.name, size: file.size, mime: file.type }
  console.log(`${LOG} 1/5 start`, meta)

  const validationErr = validateFile(file)
  if (validationErr) {
    console.warn(`${LOG} validate failed (client-side)`, {
      ...meta,
      code: validationErr.code,
      message: validationErr.message,
    })
    throw validationErr
  }

  if (!UPLOAD_ENDPOINT) {
    // 用户可见文案友好简洁;开发期排查提示(改 .env.local)只走 console,不糊给用户
    const err = new UploadError("ENDPOINT_NOT_CONFIGURED", "上传服务暂时不可用，请稍后重试")
    console.error(`${LOG} endpoint not configured`, {
      hint: "在 packages/app/.env.local 设置 VITE_OCTO_UPLOAD_ENDPOINT=<内网地址>,然后重启 dev",
    })
    throw err
  }

  console.log(`${LOG} 2/5 request`, { endpoint: UPLOAD_ENDPOINT, ...meta })

  const form = new FormData()
  form.append("file", file)

  let res: Response
  try {
    res = await fetch(UPLOAD_ENDPOINT, { method: "POST", body: form })
  } catch (e) {
    // fetch 抛出的原生 Error.message 是英文（如 "Failed to fetch"），固定用中文文案
    const err = new UploadError("NETWORK", "网络异常，请检查连接后重试")
    console.error(`${LOG} network failed`, { ...meta, nativeError: e instanceof Error ? e.message : String(e) })
    throw err
  }

  // 优先按业务封装解析；HTTP 层异常作兜底
  let body: ApiResponse<UploadResult> | null = null
  let rawText = ""
  try {
    rawText = await res.text()
    body = JSON.parse(rawText) as ApiResponse<UploadResult>
  } catch {
    // 服务端未返回 JSON 或解析失败，body 保持 null，rawText 留作排查用
  }

  console.log(`${LOG} 3/5 response`, {
    ...meta,
    httpStatus: res.status,
    httpOk: res.ok,
    body: body ?? { rawText: rawText.slice(0, 500) },
  })

  if (!body || typeof body !== "object" || typeof body.success !== "boolean") {
    // 非约定格式：用 HTTP 状态码兜底
    if (!res.ok) {
      const err = mapHttpStatus(res.status)
      console.error(`${LOG} http failed`, { ...meta, httpStatus: res.status, mappedCode: err.code })
      throw err
    }
    const err = new UploadError(
      "INTERNAL",
      "服务端响应格式不符合约定（缺少 success/errorCode 字段）",
    )
    console.error(`${LOG} bad response format`, { ...meta, body, rawText: rawText.slice(0, 500) })
    throw err
  }

  if (!body.success) {
    const err = mapErrorCode(body.errorCode, body.errorMessage)
    console.error(`${LOG} 4/5 business error`, {
      ...meta,
      errorCode: body.errorCode,
      errorMessage: body.errorMessage,
      mappedCode: err.code,
    })
    throw err
  }
  if (!body.content) {
    const err = new UploadError("INTERNAL", "服务端返回 success=true 但 content 为空")
    console.error(`${LOG} empty content`, { ...meta, body })
    throw err
  }

  console.log(`${LOG} 5/5 success`, {
    ...meta,
    url: body.content.url,
    fileId: body.content.fileId,
  })
  return body.content
}

// 按 spec §注入格式：拼成 [已上传文件] 段落。
//
// 该段落作为**独立的 synthetic text part** 发送(不再拼进用户可见文本):
//   - server 的 toModelMessages 对 user 消息只过滤 ignored,synthetic 照样喂给模型 → LLM 拿得到 URL
//   - 上游 UserMessageDisplay 只渲染非 synthetic text part → 气泡不暴露 S3 长地址
// 文件卡片由 InsightTurn 解析本段落渲染(parseUploadedFiles),optimistic / server 回传后都稳定存在。
export function formatUploadsForPrompt(uploads: Array<{ filename: string; url: string }>): string {
  if (uploads.length === 0) return ""
  const lines = uploads.map((u) => `- ${u.filename}: ${u.url}`)
  return `[已上传文件]\n${lines.join("\n")}`
}

// formatUploadsForPrompt 的逆操作:从 synthetic text part 解析出 { filename, url } 列表,
// 供 InsightTurn 渲染输入文件卡片。两者共用同一格式,是单一事实源。
export function parseUploadedFiles(block: string): Array<{ filename: string; url: string }> {
  const out: Array<{ filename: string; url: string }> = []
  for (const line of block.split("\n")) {
    const trimmed = line.trim()
    if (!trimmed.startsWith("- ")) continue
    // 按第一个 ": " 切分,不要用正则的 \S+ 匹配 URL:内网上传服务会把未编码的
    // 原始文件名拼进 URL,文件名带空格 → URL 含空格 → \S+ 截断 → 整行丢弃(实测 10 个文件
    // 发送后只剩不含空格的几个)。这里 filename / url 任一含空格都能完整还原。
    const body = trimmed.slice(2)
    const sep = body.indexOf(": ")
    if (sep < 0) continue
    const filename = body.slice(0, sep).trim()
    const url = body.slice(sep + 2).trim()
    if (filename && url) out.push({ filename, url })
  }
  return out
}
