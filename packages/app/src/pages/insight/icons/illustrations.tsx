import type { JSX } from "solid-js"
import insightEmptyUrl from "./IllustrationInsightEmpty.svg?url"
import resultEmptyUrl from "./IllustrationResultEmpty.svg?url"

type IllustrationProps = { width?: number; height?: number; class?: string }

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
