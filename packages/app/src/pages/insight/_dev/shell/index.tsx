import { type ParentProps } from "solid-js"
import { SettingsProvider } from "@/context/settings"
import { PermissionProvider } from "@/context/permission"
import { NotificationProvider } from "@/context/notification"
import { OctoTopbar } from "./topbar"

/**
 * LocalShell —— 仅本地开发用的壳(SPEC-INS-010 §11:_shell 已废弃)
 *
 * ⚠️ 本地专用,不合入 UXAI:位于 _dev/ 下(octo-sync 排除 _dev),UXAI 用他们自己的壳。
 *
 * 职责:topbar + 内容区。**不渲染侧栏**——侧栏已归 insight 自带([insight/sidebar.tsx])。
 * 补齐 Settings/Permission/Notification:insight 侧栏状态点(权限/未读/错误)依赖它们,
 * 而本壳分支不经过 app.tsx 的 AppShellProviders。UXAI 侧由他们的壳提供等价 provider。
 */
function LocalShellProviders(props: ParentProps) {
  return (
    <SettingsProvider>
      <PermissionProvider>
        <NotificationProvider>{props.children}</NotificationProvider>
      </PermissionProvider>
    </SettingsProvider>
  )
}

export function LocalShell(props: ParentProps) {
  return (
    <LocalShellProviders>
      <div class="flex flex-col h-dvh overflow-hidden" style={{ background: "#f3f6fb" }}>
        <OctoTopbar />
        <div class="flex flex-1 min-h-0 overflow-hidden">
          <div class="flex flex-col flex-1 min-w-0 overflow-hidden">{props.children}</div>
        </div>
      </div>
    </LocalShellProviders>
  )
}
