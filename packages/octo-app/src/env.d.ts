/// <reference types="vite/client" />

import type { ElectronAPI } from "../../desktop-electron/src/preload/types"

declare global {
  interface Window {
    api: ElectronAPI
    __OPENCODE__?: {
      updaterEnabled?: boolean
      wsl?: boolean
      deepLinks?: string[]
      windowChrome?: {
        platform?: string
        sidebarHeaderInset?: {
          top?: number
          left?: number
          min_height?: number
        }
      }
    }
  }
}
