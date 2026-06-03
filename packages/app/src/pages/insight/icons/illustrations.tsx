import type { JSX } from "solid-js"
import insightEmptyUrl from "./IllustrationInsightEmpty.svg?url"
import resultEmptyUrl from "./IllustrationResultEmpty.svg?url"
import iconSendBlueUrl from "./IconSend.svg?url"
import iconStopBlueUrl from "./IconStopBlue.svg?url"
import iconFileDocUrl from "./IconFileDoc.svg?url"
import iconFilePptUrl from "./IconFilePpt.svg?url"
import iconFilePdfUrl from "./IconFilePdf.svg?url"
import iconFileExcelUrl from "./IconFileExcel.svg?url"
import iconFileHtmlUrl from "./IconFileHtml.svg?url"
import iconFileMarkdownUrl from "./IconFileMarkdown.svg?url"
import iconFileMindmapUrl from "./IconFileMindmap.svg?url"
import iconFileVideoUrl from "./IconFileVideo.svg?url"
import iconFileImageUrl from "./IconFileImage.svg?url"
import iconFileCodeUrl from "./IconFileCode.svg?url"
import iconFileOtherUrl from "./IconFileOther.svg?url"

/** 按 fileName 扩展名 / mimeType 选文件类型图标 URL（用于 FileFallback 大图标）。*/
export function fileTypeIconUrl(fileName?: string, mimeType?: string): string {
  const ext = fileName?.split(".").pop()?.toLowerCase() ?? ""
  const mime = mimeType?.toLowerCase() ?? ""
  if (ext === "doc" || ext === "docx" || mime.includes("wordprocessingml") || mime.includes("msword")) return iconFileDocUrl
  if (ext === "xls" || ext === "xlsx" || mime.includes("spreadsheetml") || mime.includes("ms-excel")) return iconFileExcelUrl
  if (ext === "ppt" || ext === "pptx" || mime.includes("presentationml") || mime.includes("ms-powerpoint")) return iconFilePptUrl
  if (ext === "pdf" || mime === "application/pdf") return iconFilePdfUrl
  if (ext === "html" || ext === "htm" || mime.includes("html")) return iconFileHtmlUrl
  if (ext === "md" || ext === "markdown" || mime.includes("markdown")) return iconFileMarkdownUrl
  if (ext === "json" && mime.includes("mindmap")) return iconFileMindmapUrl
  if (["mp4","mov","avi","mkv","webm","flv"].includes(ext) || mime.startsWith("video/")) return iconFileVideoUrl
  if (["jpg","jpeg","png","gif","webp","svg","bmp"].includes(ext) || mime.startsWith("image/")) return iconFileImageUrl
  if (["js","ts","jsx","tsx","py","java","go","rs","c","cpp","cs","rb","php","sh"].includes(ext) || mime.includes("javascript") || mime.includes("typescript")) return iconFileCodeUrl
  return iconFileOtherUrl
}

type IllustrationProps = { width?: number; height?: number; class?: string }

/** 发送按钮成品 SVG(含蓝色圆 + 内嵌纸飞机 + 外发光);自带视觉, button 容器只负责 onClick/disabled。*/
export function IconSendBlue(props: IllustrationProps): JSX.Element {
  return (
    <img
      src={iconSendBlueUrl}
      width={props.width ?? 40}
      height={props.height ?? 40}
      alt=""
      aria-hidden="true"
      class={props.class}
    />
  )
}

/** 停止按钮图标：蓝色渐变圆 + 白色方块（设计稿成品 SVG）。*/
export function IconStopBlue(props: IllustrationProps): JSX.Element {
  return (
    <img
      src={iconStopBlueUrl}
      width={props.width ?? 40}
      height={props.height ?? 40}
      alt=""
      aria-hidden="true"
      class={props.class}
    />
  )
}

export function IllustrationInsightEmpty(props: IllustrationProps): JSX.Element {
  return (
    <img
      src={insightEmptyUrl}
      width={props.width ?? 120}
      height={props.height ?? 120}
      alt=""
      aria-hidden="true"
      class={props.class}
    />
  )
}

export function IllustrationResultEmpty(props: IllustrationProps): JSX.Element {
  return (
    <img
      src={resultEmptyUrl}
      width={props.width ?? 80}
      height={props.height ?? 80}
      alt=""
      aria-hidden="true"
      class={props.class}
    />
  )
}
