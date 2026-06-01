import type { JSX } from "solid-js"
import completedUrl from "../../icons/IconTaskCompleted.svg?url"
import failedUrl from "../../icons/IconTaskFailed.svg?url"
import processingUrl from "../../icons/IconTaskProcessing.svg?url"

/**
 * 任务卡片专用图标(spec: docs/specs/ui/task-card.md §5,2026-06 设计稿改版)。
 *
 * - 彩色圆形状态图标(processing 蓝圆弧 / completed 绿勾 / failed 红叉)颜色写死在 SVG,直接 <img> 引入。
 * - 可变色图标(刷新箭头 / 终止圆圈方块 / 眼睛)内联,stroke/fill 用 currentColor,
 *   供"按钮图标"与"stopped 灰色状态图标"两处复用。
 */

type IconProps = { size?: number; class?: string }

/** 刷新箭头(刷新按钮图标)。currentColor 着色。 */
export function IconRefresh(props: IconProps): JSX.Element {
  const s = () => props.size ?? 16
  return (
    <svg
      viewBox="0 0 16 16"
      width={s()}
      height={s()}
      fill="none"
      aria-hidden="true"
      class={props.class}
      style={{ "flex-shrink": "0", display: "inline-block" }}
    >
      <path
        d="M12.2426 12.2426C11.1569 13.3284 9.65687 14 8 14C4.6863 14 2 11.3137 2 8C2 4.6863 4.6863 2 8 2C9.65687 2 11.1569 2.67157 12.2426 3.75737C12.7953 4.31003 14 5.66667 14 5.66667"
        stroke="currentColor"
        stroke-linecap="round"
        stroke-linejoin="round"
        stroke-width="1.4"
      />
      <path
        d="M14 2.66669L14 5.66669L11 5.66669"
        stroke="currentColor"
        stroke-linecap="round"
        stroke-linejoin="round"
        stroke-width="1.4"
      />
    </svg>
  )
}

/** 终止(圆圈+方块)。currentColor 着色，供终止按钮与 stopped 状态图标复用。 */
export function IconStop(props: IconProps): JSX.Element {
  const s = () => props.size ?? 16
  return (
    <svg
      viewBox="0 0 16 16"
      width={s()}
      height={s()}
      fill="none"
      aria-hidden="true"
      class={props.class}
      style={{ "flex-shrink": "0", display: "inline-block" }}
    >
      {/* 中心方块 */}
      <path
        d="M10.6019 10.036C10.6019 10.311 10.3769 10.536 10.1019 10.536L5.89893 10.536C5.81116 10.536 5.72494 10.5129 5.64893 10.469C5.57292 10.4251 5.5098 10.362 5.46591 10.286C5.42203 10.21 5.39893 10.1238 5.39893 10.036L5.39893 5.96399C5.39893 5.87622 5.42203 5.79 5.46591 5.71399C5.5098 5.63798 5.57292 5.57486 5.64893 5.53098C5.72494 5.48709 5.81116 5.46399 5.89893 5.46399L10.1019 5.46399C10.3769 5.46399 10.6019 5.68899 10.6019 5.96399L10.6019 10.036Z"
        fill="currentColor"
        fill-rule="nonzero"
      />
      {/* 外圆圈 */}
      <path
        d="M15.8679 8.00197C15.8708 6.61969 15.5087 5.26115 14.8184 4.06358C14.1281 2.86602 13.1339 1.87186 11.9363 1.18153C10.7388 0.491198 9.38023 0.129156 7.99795 0.131974C6.9647 0.130307 5.9413 0.332717 4.98647 0.727584C4.03165 1.12245 3.16421 1.702 2.43395 2.43297C1.70207 3.16365 1.1219 4.03185 0.726831 4.9876C0.331762 5.94335 0.12959 6.96779 0.131949 8.00197C0.126391 9.03665 0.326303 10.0621 0.72009 11.019C1.11388 11.9758 1.6937 12.8449 2.42595 13.576C3.15643 14.308 4.02508 14.8876 4.98144 15.281C5.93781 15.6745 6.96282 15.874 7.99695 15.868C12.3299 15.824 15.8679 12.333 15.8679 8.00197ZM1.05595 8.00197C1.05525 6.78295 1.37556 5.58523 1.98467 4.52928C2.59377 3.47334 3.4702 2.59641 4.52579 1.98669C5.58139 1.37698 6.77892 1.05597 7.99795 1.05597C11.8569 1.05597 14.9869 4.18297 14.9869 8.00197C14.9869 11.815 11.8569 14.946 7.99795 14.946C6.77758 14.9515 5.57751 14.6337 4.51977 14.025C3.46203 13.4163 2.58434 12.5383 1.97593 11.4804C1.36753 10.4225 1.05011 9.22235 1.05595 8.00197Z"
        fill="currentColor"
        fill-rule="nonzero"
      />
    </svg>
  )
}

/** 查看结果(眼睛)。currentColor 着色。 */
export function IconEye(props: IconProps): JSX.Element {
  const s = () => props.size ?? 16
  return (
    <svg
      viewBox="0 0 16 16"
      width={s()}
      height={s()}
      fill="none"
      aria-hidden="true"
      class={props.class}
      style={{ "flex-shrink": "0", display: "inline-block" }}
    >
      <path
        d="M8 3.5C4.5 3.5 1.8 5.8 1 8c0.8 2.2 3.5 4.5 7 4.5s6.2-2.3 7-4.5C14.2 5.8 11.5 3.5 8 3.5Z"
        stroke="currentColor"
        stroke-width="1.3"
        stroke-linejoin="round"
      />
      <circle cx="8" cy="8" r="2" stroke="currentColor" stroke-width="1.3" />
    </svg>
  )
}

/** 展开/收起箭头(失败卡错误详情)。currentColor。open 时旋转 180°。 */
export function IconChevron(props: IconProps & { open?: boolean }): JSX.Element {
  const s = () => props.size ?? 14
  return (
    <svg
      viewBox="0 0 16 16"
      width={s()}
      height={s()}
      fill="none"
      aria-hidden="true"
      class={props.class}
      style={{
        "flex-shrink": "0",
        display: "inline-block",
        transition: "transform 150ms ease",
        transform: props.open ? "rotate(180deg)" : "none",
      }}
    >
      <path d="M4 6L8 10L12 6" stroke="currentColor" stroke-width="1.4" stroke-linecap="round" stroke-linejoin="round" />
    </svg>
  )
}

/** processing 蓝底白弧圆形(颜色写死在 SVG,20×20)。 */
export function IconStatusProcessing(props: IconProps): JSX.Element {
  const s = () => props.size ?? 20
  return <img src={processingUrl} width={s()} height={s()} alt="" aria-hidden="true" class={props.class} />
}

/** completed 绿勾圆形(颜色写死在 SVG)。 */
export function IconStatusCompleted(props: IconProps): JSX.Element {
  const s = () => props.size ?? 20
  return <img src={completedUrl} width={s()} height={s()} alt="" aria-hidden="true" class={props.class} />
}

/** failed 红叉圆形(颜色写死在 SVG)。 */
export function IconStatusFailed(props: IconProps): JSX.Element {
  const s = () => props.size ?? 20
  return <img src={failedUrl} width={s()} height={s()} alt="" aria-hidden="true" class={props.class} />
}
