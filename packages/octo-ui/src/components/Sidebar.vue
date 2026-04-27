<template>
  <aside class="sidebar">
    <div class="sidebar-top">
      <div class="brand">
        <svg width="20" height="20" viewBox="0 0 24 24" fill="none" aria-hidden="true">
          <circle cx="12" cy="12" r="10" stroke="#3b82f6" stroke-width="1.8"/>
          <circle cx="12" cy="12" r="4" fill="#3b82f6"/>
          <line x1="12" y1="2" x2="12" y2="6" stroke="#3b82f6" stroke-width="1.8" stroke-linecap="round"/>
          <line x1="12" y1="18" x2="12" y2="22" stroke="#3b82f6" stroke-width="1.8" stroke-linecap="round"/>
          <line x1="2" y1="12" x2="6" y2="12" stroke="#3b82f6" stroke-width="1.8" stroke-linecap="round"/>
          <line x1="18" y1="12" x2="22" y2="12" stroke="#3b82f6" stroke-width="1.8" stroke-linecap="round"/>
        </svg>
        <span class="brand-name">Octo Agent</span>
      </div>
      <button class="new-chat-btn" title="新建对话" @click="createSession">
        <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round">
          <line x1="12" y1="5" x2="12" y2="19"/>
          <line x1="5" y1="12" x2="19" y2="12"/>
        </svg>
      </button>
    </div>

    <div class="sessions-label">近期对话</div>

    <nav class="sessions-list">
      <div v-if="loading" class="sessions-empty">加载中…</div>
      <div v-else-if="sessions.length === 0" class="sessions-empty">暂无对话</div>
      <RouterLink
        v-for="s in sessions"
        :key="s.id"
        :to="`/session/${s.id}`"
        class="session-item"
        active-class="session-item--active"
      >
        <span class="session-title">{{ s.title || "新对话" }}</span>
      </RouterLink>
    </nav>

    <div class="sidebar-footer">
      <RouterLink to="/settings" class="footer-link" active-class="footer-link--active">
        <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round">
          <circle cx="12" cy="12" r="3"/>
          <path d="M12 1v4M12 19v4M4.22 4.22l2.83 2.83M16.95 16.95l2.83 2.83M1 12h4M19 12h4M4.22 19.78l2.83-2.83M16.95 7.05l2.83-2.83"/>
        </svg>
        <span>设置</span>
      </RouterLink>
    </div>
  </aside>
</template>

<script setup lang="ts">
import { ref, onMounted } from "vue"
import { useRouter } from "vue-router"
import { useOpencode } from "@/composables/useOpencode"

const router = useRouter()
const client = useOpencode()
const sessions = ref<any[]>([])
const loading = ref(true)

onMounted(async () => {
  try {
    const res = await client.session.list()
    sessions.value = (res.data ?? []).filter((s: any) => s?.id).slice(0, 40)
  } catch {
    // ignore
  } finally {
    loading.value = false
  }
})

async function createSession() {
  try {
    const res = await client.session.create({ body: {} })
    if (res.data?.id) {
      sessions.value.unshift(res.data)
      router.push(`/session/${res.data.id}`)
    }
  } catch {
    // ignore
  }
}
</script>

<style scoped>
.sidebar {
  width: var(--sidebar-w);
  min-width: var(--sidebar-w);
  background: var(--bg-sidebar);
  border-right: 1px solid var(--border);
  display: flex;
  flex-direction: column;
  overflow: hidden;
  user-select: none;
  -webkit-app-region: drag;
}

.sidebar-top {
  display: flex;
  align-items: center;
  justify-content: space-between;
  padding: 16px 12px 12px;
  -webkit-app-region: drag;
}

.brand {
  display: flex;
  align-items: center;
  gap: 8px;
}

.brand-name {
  font-size: 13px;
  font-weight: 600;
  color: var(--text-primary);
  letter-spacing: -0.01em;
}

.new-chat-btn {
  -webkit-app-region: no-drag;
  width: 28px;
  height: 28px;
  display: flex;
  align-items: center;
  justify-content: center;
  background: none;
  border: 1px solid var(--border);
  border-radius: var(--radius-sm);
  color: var(--text-secondary);
  cursor: pointer;
  transition: border-color 0.15s, color 0.15s;
  flex-shrink: 0;
}
.new-chat-btn:hover {
  border-color: var(--border-input);
  color: var(--text-primary);
}

.sessions-label {
  padding: 0 12px 6px;
  font-size: 11px;
  font-weight: 500;
  color: var(--text-muted);
  letter-spacing: 0.04em;
  text-transform: uppercase;
}

.sessions-list {
  flex: 1;
  overflow-y: auto;
  padding: 0 6px;
  -webkit-app-region: no-drag;
}

.sessions-empty {
  padding: 8px 6px;
  font-size: 12px;
  color: var(--text-muted);
}

.session-item {
  display: block;
  padding: 7px 8px;
  border-radius: var(--radius-sm);
  text-decoration: none;
  color: var(--text-secondary);
  font-size: 13px;
  line-height: 1.4;
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
  transition: background 0.1s, color 0.1s;
  cursor: pointer;
}
.session-item:hover {
  background: var(--bg-hover);
  color: var(--text-primary);
}
.session-item--active {
  background: var(--bg-active);
  color: var(--text-primary);
}

.session-title {
  overflow: hidden;
  text-overflow: ellipsis;
}

.sidebar-footer {
  padding: 8px 6px 12px;
  border-top: 1px solid var(--border);
  -webkit-app-region: no-drag;
}

.footer-link {
  display: flex;
  align-items: center;
  gap: 8px;
  padding: 7px 8px;
  border-radius: var(--radius-sm);
  text-decoration: none;
  color: var(--text-secondary);
  font-size: 13px;
  transition: background 0.1s, color 0.1s;
}
.footer-link:hover {
  background: var(--bg-hover);
  color: var(--text-primary);
}
.footer-link--active {
  background: var(--bg-active);
  color: var(--text-primary);
}
</style>
