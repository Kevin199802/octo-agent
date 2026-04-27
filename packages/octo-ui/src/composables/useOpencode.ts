// 必须从 /client 子路径导入，避免把 server.ts（Node.js only）打包进浏览器 bundle
import { createOpencodeClient, type OpencodeClient } from "@opencode-ai/sdk/client"

declare global {
  interface Window {
    api?: {
      awaitInitialization: (onStep: (step: unknown) => void) => Promise<{
        url: string
        username: string
        password: string
      }>
    }
  }
}

let client: OpencodeClient | null = null

export function setOpencodeClient(c: OpencodeClient) {
  client = c
}

export function useOpencode(): OpencodeClient {
  if (!client) throw new Error("opencode client not initialized")
  return client
}

export async function initOpencodeClient(): Promise<void> {
  // Electron 模式(包括 dev)优先用 preload 注入的真实 url + 认证。
  // opencode Server.listen 用动态端口,不能依赖 vite proxy 的 4096 写死。
  if (window.api) {
    const { url, username, password } = await window.api.awaitInitialization(() => {})
    const auth = btoa(`${username}:${password}`)
    client = createOpencodeClient({ baseUrl: url, headers: { Authorization: `Basic ${auth}` } })
    return
  }

  // 纯浏览器 dev(无 Electron preload):走 vite proxy
  if (import.meta.env.DEV) {
    client = createOpencodeClient({ baseUrl: "/api" })
    return
  }

  // 兜底
  client = createOpencodeClient({ baseUrl: "http://127.0.0.1:4096" })
}
