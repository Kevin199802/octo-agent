import type { JSX } from "solid-js"

type IllustrationProps = { width?: number; height?: number; class?: string }

export function IllustrationInsightEmpty(props: IllustrationProps): JSX.Element {
  return (
    <img
      src="/assets/insight/IllustrationInsightEmpty.svg"
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
      src="/assets/insight/IllustrationResultEmpty.svg"
      width={props.width ?? 80}
      height={props.height ?? 80}
      alt=""
      aria-hidden="true"
      class={props.class}
    />
  )
}
