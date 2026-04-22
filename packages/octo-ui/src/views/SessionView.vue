<template>
  <div class="session">
    <div class="messages" ref="messagesEl">
      <div v-if="messages.length === 0" class="empty">发送消息开始对话</div>
      <div
        v-for="msg in messages"
        :key="msg.id"
        class="message"
        :class="msg.role"
      >
        <div class="role-label">{{ msg.role === "user" ? "你" : "AI" }}</div>
        <div class="content">{{ msg.text }}<span v-if="msg.streaming" class="cursor">▋</span></div>
      </div>
    </div>

    <div class="composer">
      <textarea
        v-model="input"
        placeholder="输入消息（Enter 发送，Shift+Enter 换行）"
        :disabled="sending"
        @keydown.enter.exact.prevent="send"
      />
      <button :disabled="sending || !input.trim()" @click="send">
        {{ sending ? "…" : "发送" }}
      </button>
    </div>

    <div v-if="error" class="error">{{ error }}</div>
  </div>
</template>

<script setup lang="ts">
import { ref, nextTick, onMounted, onUnmounted } from "vue"
import { useRoute } from "vue-router"
import { useOpencode } from "@/composables/useOpencode"

interface ChatMessage {
  id: string
  role: "user" | "assistant"
  text: string
  streaming: boolean
}

const route = useRoute()
const client = useOpencode()

const messages = ref<ChatMessage[]>([])
const input = ref("")
const sending = ref(false)
const error = ref("")
const messagesEl = ref<HTMLElement>()

let sessionId = route.params.id as string
let abortController: AbortController | null = null
const assistantMessageIds = new Set<string>()

async function scrollToBottom() {
  await nextTick()
  if (messagesEl.value) messagesEl.value.scrollTop = messagesEl.value.scrollHeight
}

async function loadHistory() {
  if (!sessionId) return
  try {
    const res = await client.session.messages({ path: { id: sessionId } })
    if (!res.data) return
    for (const item of res.data) {
      const textParts = item.parts.filter((p: any) => p.type === "text")
      const text = textParts.map((p: any) => p.text).join("")
      messages.value.push({
        id: item.info.id,
        role: item.info.role as "user" | "assistant",
        text,
        streaming: false,
      })
    }
    scrollToBottom()
  } catch {
    // session may be empty
  }
}

async function startEventStream() {
  abortController = new AbortController()
  try {
    const { stream } = await client.event.subscribe({
      signal: abortController.signal,
    } as any)
    ;(async () => {
      for await (const event of stream) {
        if (!event) continue
        const e = event as any
        if (e.type === "message.part.updated") {
          const part = e.properties?.part
          if (part?.type === "step-start" && part.messageID) {
            assistantMessageIds.add(part.messageID)
            if (!messages.value.find((m) => m.id === part.messageID)) {
              messages.value.push({ id: part.messageID, role: "assistant", text: "", streaming: true })
            }
          }
        }
        if (e.type === "message.part.delta") {
          const { messageID, delta } = e.properties ?? {}
          if (!messageID || !delta || !assistantMessageIds.has(messageID)) continue
          const existing = messages.value.find(m => m.id === messageID)
          if (existing) {
            existing.text += delta
            scrollToBottom()
          }
        }
        if (e.type === "session.idle") {
          messages.value.forEach(m => { m.streaming = false })
          sending.value = false
        }
      }
    })()
  } catch (e) {
    console.error("[SessionView] SSE error:", e)
  }
}

async function send() {
  const text = input.value.trim()
  if (!text || sending.value) return

  error.value = ""
  sending.value = true
  input.value = ""

  messages.value.push({ id: Date.now().toString(), role: "user", text, streaming: false })
  scrollToBottom()

  try {
    if (!sessionId) {
      const res = await client.session.create({ body: {} })
      sessionId = res.data!.id
    }

    await client.session.prompt({
      path: { id: sessionId },
      body: { parts: [{ type: "text", text }] },
    })
  } catch (e) {
    error.value = String(e)
    sending.value = false
  }
}

onMounted(async () => {
  await loadHistory()
  startEventStream()
})

onUnmounted(() => {
  abortController?.abort()
})
</script>

<style scoped>
.session {
  display: flex;
  flex-direction: column;
  height: 100vh;
  font-family: sans-serif;
  background: #0f0f0f;
  color: #f5f5f5;
}
.messages {
  flex: 1;
  overflow-y: auto;
  padding: 1rem;
  display: flex;
  flex-direction: column;
  gap: 0.75rem;
}
.empty { color: #888; text-align: center; margin-top: 2rem; }
.message { max-width: 80%; }
.message.user { align-self: flex-end; }
.message.assistant { align-self: flex-start; }
.role-label { font-size: 0.75rem; color: #888; margin-bottom: 0.2rem; }
.content {
  background: #1a1a1a;
  border-radius: 8px;
  padding: 0.5rem 0.75rem;
  white-space: pre-wrap;
  word-break: break-word;
  line-height: 1.6;
}
.message.user .content { background: #1d4ed8; color: #fff; }
.cursor { animation: blink 0.8s step-end infinite; }
@keyframes blink { 50% { opacity: 0; } }
.composer {
  display: flex;
  gap: 0.5rem;
  padding: 1rem;
  border-top: 1px solid #2e2e2e;
}
textarea {
  flex: 1;
  resize: none;
  height: 60px;
  padding: 0.5rem;
  background: #1a1a1a;
  color: #f5f5f5;
  border: 1px solid #2e2e2e;
  border-radius: 6px;
  font-size: 14px;
  font-family: inherit;
}
textarea:focus { outline: none; border-color: #3b82f6; }
button {
  padding: 0 1rem;
  background: #2563eb;
  color: #fff;
  border: none;
  border-radius: 6px;
  cursor: pointer;
  font-size: 14px;
}
button:disabled { opacity: 0.5; cursor: not-allowed; }
.error { padding: 0.5rem 1rem; color: #ef4444; font-size: 0.875rem; }
</style>
