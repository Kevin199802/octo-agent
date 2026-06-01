import type { JSX } from "solid-js"
import insightEmptyUrl from "./IllustrationInsightEmpty.svg?url"
import resultEmptyUrl from "./IllustrationResultEmpty.svg?url"
import iconSendBlueUrl from "./IconSend.svg?url"
import iconStopBlueUrl from "./IconStopBlue.svg?url"

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
