// 上传服务客户端：spec 见 docs/specs/infra/file-upload.md
//
// 设计要点：
// - form 里只发 file 一个字段，不组 S3 路径（路径策略是服务端的事）
// - 端点是部署期常量，不进 octo.json 用户配置
// - 项目暂无 .env 配置约定，要换地址直接改这里（沿用上游 VITE_OPENCODE_SERVER_HOST 等
//   "硬编码 + 待覆盖" 的风格，参考 packages/app/src/entry.tsx）

// 上传服务端地址。TODO: 内网开发对接后由打包版本注入实际值
const UPLOAD_ENDPOINT = ""

export const MAX_UPLOAD_SIZE = 100 * 1024 * 1024 // Insight 当前 100MB；其他 agent 可自定
export const ALLOWED_EXT = ["txt", "md", "docx", "xlsx", "pdf"] as const

export type UploadResult = {
  url: string
  file_id: string
  filename: string
  size: number
  mime: string
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

async function mapHttpError(res: Response): Promise<UploadError> {
  let serverCode = ""
  let serverMessage = ""
  try {
    const data = (await res.json()) as { error?: { code?: string; message?: string } }
    serverCode = data.error?.code ?? ""
    serverMessage = data.error?.message ?? ""
  } catch {
    // 服务端可能没返回 JSON，按状态码兜底
  }
  if (res.status === 413) return new UploadError("FILE_TOO_LARGE", serverMessage || "超过服务端大小上限")
  if (res.status === 415) return new UploadError("EXT_NOT_ALLOWED", serverMessage || "服务端不支持的格式")
  if (res.status === 429) return new UploadError("RATE_LIMITED", serverMessage || "上传繁忙，请稍后重试")
  if (res.status >= 500) return new UploadError("INTERNAL", serverMessage || `服务端错误 (${res.status})`)
  return new UploadError("INTERNAL", serverMessage || serverCode || `上传失败 (${res.status})`)
}

export async function uploadFile(file: File): Promise<UploadResult> {
  const err = validateFile(file)
  if (err) throw err

  if (!UPLOAD_ENDPOINT) {
    throw new UploadError(
      "ENDPOINT_NOT_CONFIGURED",
      "上传端点未配置：lib/upload.ts 顶部的 UPLOAD_ENDPOINT 还是空字符串",
    )
  }

  const form = new FormData()
  form.append("file", file)

  let res: Response
  try {
    res = await fetch(UPLOAD_ENDPOINT, { method: "POST", body: form })
  } catch (e) {
    throw new UploadError("NETWORK", e instanceof Error ? e.message : "网络异常")
  }
  if (!res.ok) throw await mapHttpError(res)

  const data = (await res.json()) as UploadResult
  return data
}

// 按 spec §注入格式：拼成 [已上传文件] 段落，附加到 prompt 文本末尾
export function formatUploadsForPrompt(uploads: Array<{ filename: string; url: string }>): string {
  if (uploads.length === 0) return ""
  const lines = uploads.map((u) => `- ${u.filename}: ${u.url}`)
  return `\n\n[已上传文件]\n${lines.join("\n")}`
}
