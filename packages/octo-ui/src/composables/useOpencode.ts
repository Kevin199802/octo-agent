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
  let baseUrl: string
  if (import.meta.env.DEV) {
    baseUrl = "/api"
  } else if (window.api) {
    const { url, username, password } = await window.api.awaitInitialization(() => {})
    baseUrl = url
    const auth = btoa(`${username}:${password}`)
    client = createOpencodeClient({ baseUrl, headers: { Authorization: `Basic ${auth}` } })
    return
  } else {
    baseUrl = "http://127.0.0.1:4096"
  }
  client = createOpencodeClient({ baseUrl })
}
