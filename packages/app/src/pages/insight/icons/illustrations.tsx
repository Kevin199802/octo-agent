import type { JSX } from "solid-js"
import insightEmptyUrl from "./IllustrationInsightEmpty.svg?url"
import resultEmptyUrl from "./IllustrationResultEmpty.svg?url"
import iconSendBlueUrl from "./IconSend.svg?url"

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

/**
 * 停止按钮图标：蓝色圆 + 白色圆角方块（⏹）。
 * 圆直径 25 / 画布 40 ≈ 62.5%，与 IconSendBlue（圆 32 / 画布 51.5）留白比例一致。
 */
export function IconStopBlue(props: IllustrationProps): JSX.Element {
  return (
    <svg
      width={props.width ?? 40}
      height={props.height ?? 40}
      viewBox="0 0 40 40"
      fill="none"
      xmlns="http://www.w3.org/2000/svg"
      aria-hidden="true"
      class={props.class}
    >
      <circle cx="20" cy="16" r="12.5" fill="#0067D1" />
      <rect x="15.5" y="11.5" width="9" height="9" rx="1.5" fill="white" />
    </svg>
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
