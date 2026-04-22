<template>
  <div class="home">
    <h1>Octo Agent</h1>
    <div v-if="loading">连接后端中…</div>
    <div v-else-if="error" class="error">后端连接失败：{{ error }}</div>
    <template v-else>
      <p>项目：{{ projectPath }}</p>
      <p>历史会话：{{ sessions.length }} 个</p>
      <button @click="newSession">+ 新建会话</button>
      <div class="sessions" v-if="sessions.length > 0">
        <div
          v-for="s in sessions"
          :key="s.id"
          class="session-item"
          @click="$router.push(`/session/${s.id}`)"
        >
          {{ s.title || s.id?.slice(0, 8) }}
        </div>
      </div>
    </template>
  </div>
</template>

<script setup lang="ts">
import { ref, onMounted } from "vue"
import { useRouter } from "vue-router"
import { useOpencode } from "@/composables/useOpencode"
import type { Session } from "@opencode-ai/sdk/client"

const router = useRouter()
const client = useOpencode()
const loading = ref(true)
const error = ref("")
const projectPath = ref("")
const sessions = ref<Session[]>([])

onMounted(async () => {
  const timeout = new Promise<never>((_, reject) =>
    setTimeout(() => reject(new Error("连接超时，请确认后端已启动：bun run dev:serve")), 8000),
  )
  try {
    const [projectRes, sessionRes] = await Promise.race([
      Promise.all([client.project.current(), client.session.list()]),
      timeout,
    ])
    projectPath.value = projectRes.data?.worktree ?? "未知"
    const raw = sessionRes.data ?? []
    console.log("[HomeView] sessions raw:", raw)
    sessions.value = raw.filter((s: any) => s?.id)
  } catch (e) {
    error.value = String(e)
  } finally {
    loading.value = false
  }
})

async function newSession() {
  try {
    const res = await client.session.create({ body: {} })
    if (!res.data?.id) {
      const detail = (res as any).error ?? (res as any).response?.statusText ?? "后端返回空响应"
      throw new Error(typeof detail === "object" ? JSON.stringify(detail) : String(detail))
    }
    router.push(`/session/${res.data.id}`)
  } catch (e) {
    error.value = `新建会话失败：${String(e)}`
  }
}
</script>

<style scoped>
.home { padding: 2rem; font-family: sans-serif; }
.error { color: #ef4444; }
button {
  margin: 1rem 0;
  padding: 0.5rem 1rem;
  background: #2563eb;
  color: #fff;
  border: none;
  border-radius: 6px;
  cursor: pointer;
  font-size: 14px;
}
.sessions { display: flex; flex-direction: column; gap: 0.5rem; margin-top: 0.5rem; }
.session-item {
  padding: 0.5rem 0.75rem;
  background: #1e1e1e;
  border-radius: 6px;
  cursor: pointer;
  font-size: 14px;
}
.session-item:hover { background: #2e2e2e; }
</style>
