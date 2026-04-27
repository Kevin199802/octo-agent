<template>
  <div class="chat">
    <!-- 空状态 -->
    <template v-if="!sessionId">
      <div class="empty-state">
        <div class="empty-icon">
          <svg width="40" height="40" viewBox="0 0 24 24" fill="none" aria-hidden="true">
            <circle cx="12" cy="12" r="10" stroke="#3b82f6" stroke-width="1.5"/>
            <circle cx="12" cy="12" r="4" fill="#3b82f6" opacity="0.8"/>
          </svg>
        </div>
        <h2>有什么可以帮你的？</h2>
        <p>开始一段新对话，或从左侧选择历史记录</p>
        <button class="start-btn" @click="createAndStart">新建对话</button>
      </div>
    </template>

    <!-- 聊天区域 -->
    <template v-else>
      <div class="messages" ref="messagesEl">
        <div v-if="messages.length === 0 && !sending" class="messages-empty">
          发送消息开始对话
        </div>

        <div
          v-for="msg in messages"
          :key="msg.id"
          class="message-row"
          :class="`message-row--${msg.role}`"
        >
          <!-- assistant 消息 -->
          <template v-if="msg.role === 'assistant'">
            <div class="msg-avatar">
              <svg width="16" height="16" viewBox="0 0 24 24" fill="none">
                <circle cx="12" cy="12" r="10" stroke="#3b82f6" stroke-width="1.8"/>
                <circle cx="12" cy="12" r="4" fill="#3b82f6"/>
              </svg>
            </div>
            <div class="msg-body">
              <div class="msg-label">Octo Agent</div>

              <!-- 思维链（折叠） -->
              <div v-if="msg.reasoning" class="reasoning-block">
                <button class="reasoning-toggle" @click="msg.reasoningOpen = !msg.reasoningOpen">
                  <svg
                    width="12" height="12" viewBox="0 0 24 24" fill="none"
                    stroke="currentColor" stroke-width="2" stroke-linecap="round"
                    :style="{ transform: msg.reasoningOpen ? 'rotate(90deg)' : 'none', transition: 'transform 0.15s' }"
                  >
                    <polyline points="9 18 15 12 9 6"/>
                  </svg>
                  <span>思维过程</span>
                  <span class="reasoning-len">{{ Math.round(msg.reasoning.length / 4) }} tokens</span>
                </button>
                <div v-if="msg.reasoningOpen" class="reasoning-content md" v-html="renderMd(msg.reasoning)" />
              </div>

              <div v-if="msg.text" class="msg-content md" v-html="renderMd(msg.text)" />
              <span v-if="msg.streaming && !msg.text" class="cursor">▋</span>
            </div>
          </template>

          <!-- user 消息 -->
          <template v-else>
            <div class="msg-body msg-body--user">
              <div class="msg-content msg-content--user">{{ msg.text }}</div>
            </div>
          </template>
        </div>

        <!-- 正在思考 -->
        <div v-if="sending && !hasStreamingMsg" class="message-row message-row--assistant">
          <div class="msg-avatar">
            <svg width="16" height="16" viewBox="0 0 24 24" fill="none">
              <circle cx="12" cy="12" r="10" stroke="#3b82f6" stroke-width="1.8"/>
              <circle cx="12" cy="12" r="4" fill="#3b82f6"/>
            </svg>
          </div>
          <div class="msg-body">
            <div class="msg-label">Octo Agent</div>
            <div class="typing">
              <span/><span/><span/>
            </div>
          </div>
        </div>
      </div>

      <!-- 输入区 -->
      <div class="composer">
        <div class="composer-inner">
          <textarea
            ref="inputEl"
            v-model="input"
            placeholder="给 Octo Agent 发消息…"
            :disabled="sending"
            rows="1"
            @keydown.enter.exact.prevent="send"
            @input="autoResize"
          />
          <button
            class="send-btn"
            :disabled="sending || !input.trim()"
            @click="send"
            title="发送 (Enter)"
          >
            <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round">
              <line x1="12" y1="19" x2="12" y2="5"/>
              <polyline points="5 12 12 5 19 12"/>
            </svg>
          </button>
        </div>
        <div v-if="error" class="composer-error">{{ error }}</div>
      </div>
    </template>
  </div>
</template>

<script setup lang="ts">
import { ref, computed, watch, nextTick, onMounted, onUnmounted } from "vue"
import { useRoute, useRouter } from "vue-router"
import { marked } from "marked"
import { useOpencode } from "@/composables/useOpencode"

marked.setOptions({ breaks: true })

interface ChatMessage {
  id: string
  role: "user" | "assistant"
  text: string
  reasoning: string
  reasoningOpen: boolean
  streaming: boolean
}

const route = useRoute()
const router = useRouter()
const client = useOpencode()

const messages = ref<ChatMessage[]>([])
const input = ref("")
const sending = ref(false)
const error = ref("")
const messagesEl = ref<HTMLElement>()
const inputEl = ref<HTMLTextAreaElement>()

const sessionId = computed(() => route.params.id as string | undefined)
const hasStreamingMsg = computed(() => messages.value.some(m => m.streaming))

let abortController: AbortController | null = null

function renderMd(text: string): string {
  if (!text) return ""
  return marked(text) as string
}

async function scrollToBottom() {
  await nextTick()
  if (messagesEl.value) {
    messagesEl.value.scrollTop = messagesEl.value.scrollHeight
  }
}

function autoResize() {
  if (!inputEl.value) return
  inputEl.value.style.height = "auto"
  inputEl.value.style.height = Math.min(inputEl.value.scrollHeight, 180) + "px"
}

async function loadMessages() {
  const id = sessionId.value
  if (!id) return
  try {
    const res = await client.session.messages({ path: { id } })
    if (!res.data) return
    messages.value = res.data
      .filter((item: any) => item?.info?.role && item?.parts)
      .map((item: any) => {
        const text = item.parts
          .filter((p: any) => p.type === "text")
          .map((p: any) => p.text ?? "")
          .join("")
        const reasoning = item.parts
          .filter((p: any) => p.type === "reasoning")
          .map((p: any) => p.text ?? "")
          .join("")
        return {
          id: item.info.id,
          role: item.info.role as "user" | "assistant",
          text,
          reasoning,
          reasoningOpen: false,
          streaming: false,
        }
      })
      .filter((m: ChatMessage) => m.text.trim() !== "" || m.reasoning.trim() !== "")
    scrollToBottom()
  } catch {
    // session 为空时忽略
  }
}

function startEventStream() {
  abortController = new AbortController()
  ;(async () => {
    try {
      const { stream } = await client.event.subscribe({ signal: abortController!.signal } as any)
      for await (const event of stream) {
        if (!event) continue
        const e = event as any

        if (e.type === "message.part.updated") {
          const part = e.properties?.part
          if (part?.type === "step-start" && part.messageID) {
            if (!messages.value.find(m => m.id === part.messageID)) {
              messages.value.push({
                id: part.messageID,
                role: "assistant",
                text: "",
                reasoning: "",
                reasoningOpen: true,
                streaming: true,
              })
              scrollToBottom()
            }
          }
        }

        if (e.type === "message.part.delta") {
          const { messageID, delta, field } = e.properties ?? {}
          if (!messageID || !delta || field !== "text") continue
          const msg = messages.value.find(m => m.id === messageID && m.role === "assistant")
          if (msg) {
            msg.text += delta
            msg.streaming = true
            scrollToBottom()
          }
        }

        if (e.type === "session.idle") {
          // 重新从 REST API 加载，确保消息内容和角色完全正确
          await loadMessages()
          sending.value = false
        }
      }
    } catch {
      // SSE 连接断开，静默处理
    }
  })()
}

async function send() {
  const text = input.value.trim()
  if (!text || sending.value || !sessionId.value) return

  error.value = ""
  sending.value = true
  input.value = ""
  if (inputEl.value) {
    inputEl.value.style.height = "auto"
  }

  messages.value.push({
    id: `user-${Date.now()}`,
    role: "user",
    text,
    reasoning: "",
    reasoningOpen: false,
    streaming: false,
  })
  scrollToBottom()

  try {
    await client.session.prompt({
      path: { id: sessionId.value },
      body: { parts: [{ type: "text", text }] },
    })
  } catch (e) {
    error.value = String(e)
    sending.value = false
  }
}

async function createAndStart() {
  try {
    const res = await client.session.create({ body: {} })
    if (res.data?.id) {
      router.push(`/session/${res.data.id}`)
    }
  } catch (e) {
    error.value = String(e)
  }
}

watch(sessionId, async (id) => {
  if (id) {
    messages.value = []
    sending.value = false
    error.value = ""
    await loadMessages()
  }
}, { immediate: true })

onMounted(() => {
  startEventStream()
})

onUnmounted(() => {
  abortController?.abort()
})
</script>

<style scoped>
.chat {
  display: flex;
  flex-direction: column;
  height: 100%;
  background: var(--bg-app);
}

/* 空状态 */
.empty-state {
  flex: 1;
  display: flex;
  flex-direction: column;
  align-items: center;
  justify-content: center;
  gap: 12px;
  padding: 2rem;
  text-align: center;
  color: var(--text-secondary);
}
.empty-icon {
  opacity: 0.6;
  margin-bottom: 4px;
}
.empty-state h2 {
  font-size: 1.25rem;
  font-weight: 600;
  color: var(--text-primary);
  margin: 0;
}
.empty-state p {
  font-size: 0.875rem;
  margin: 0;
}
.start-btn {
  margin-top: 8px;
  padding: 8px 20px;
  background: var(--accent);
  color: white;
  border: none;
  border-radius: var(--radius-md);
  font-size: 14px;
  font-weight: 500;
  cursor: pointer;
  transition: background 0.15s;
}
.start-btn:hover { background: var(--accent-hover); }

/* 消息列表 */
.messages {
  flex: 1;
  overflow-y: auto;
  padding: 24px 0 8px;
  display: flex;
  flex-direction: column;
}

.messages-empty {
  text-align: center;
  color: var(--text-muted);
  font-size: 13px;
  margin-top: 32px;
}

.message-row {
  display: flex;
  gap: 12px;
  padding: 6px 24px;
  max-width: 800px;
  width: 100%;
  margin: 0 auto;
}
.message-row--user {
  justify-content: flex-end;
}

.msg-avatar {
  width: 28px;
  height: 28px;
  display: flex;
  align-items: flex-start;
  justify-content: center;
  padding-top: 3px;
  flex-shrink: 0;
}

.msg-body {
  flex: 1;
  min-width: 0;
}
.msg-body--user {
  display: flex;
  justify-content: flex-end;
}

.msg-label {
  font-size: 12px;
  font-weight: 600;
  color: var(--text-secondary);
  margin-bottom: 4px;
  letter-spacing: 0.01em;
}

.msg-content {
  font-size: 14px;
  line-height: 1.7;
  color: var(--text-primary);
  word-break: break-word;
}
.msg-content--user {
  background: var(--bg-msg-user);
  border: 1px solid var(--border);
  border-radius: var(--radius-lg);
  padding: 10px 14px;
  max-width: 480px;
  font-size: 14px;
  line-height: 1.6;
  color: var(--text-primary);
  white-space: pre-wrap;
}

/* 打字指示器 */
.typing {
  display: flex;
  align-items: center;
  gap: 4px;
  padding: 4px 0;
  height: 24px;
}
.typing span {
  display: block;
  width: 6px;
  height: 6px;
  border-radius: 50%;
  background: var(--text-muted);
  animation: typing-bounce 1.2s infinite ease-in-out;
}
.typing span:nth-child(2) { animation-delay: 0.15s; }
.typing span:nth-child(3) { animation-delay: 0.3s; }
@keyframes typing-bounce {
  0%, 80%, 100% { transform: translateY(0); opacity: 0.4; }
  40% { transform: translateY(-4px); opacity: 1; }
}

/* 流式光标 */
.cursor {
  display: inline-block;
  animation: blink 0.8s step-end infinite;
  color: var(--text-secondary);
  margin-left: 1px;
}
@keyframes blink { 50% { opacity: 0; } }

/* 输入区 */
.composer {
  padding: 12px 24px 20px;
  border-top: 1px solid var(--border);
  background: var(--bg-app);
}
.composer-inner {
  display: flex;
  align-items: flex-end;
  gap: 8px;
  background: var(--bg-input);
  border: 1px solid var(--border-input);
  border-radius: var(--radius-lg);
  padding: 10px 10px 10px 14px;
  max-width: 800px;
  margin: 0 auto;
  transition: border-color 0.15s;
}
.composer-inner:focus-within {
  border-color: #3b3b3b;
}
textarea {
  flex: 1;
  background: none;
  border: none;
  outline: none;
  resize: none;
  color: var(--text-primary);
  font-family: var(--font-sans);
  font-size: 14px;
  line-height: 1.6;
  max-height: 180px;
  overflow-y: auto;
  padding: 0;
}
textarea::placeholder { color: var(--text-muted); }
textarea:disabled { opacity: 0.5; }

.send-btn {
  width: 32px;
  height: 32px;
  display: flex;
  align-items: center;
  justify-content: center;
  background: var(--accent);
  color: white;
  border: none;
  border-radius: var(--radius-sm);
  cursor: pointer;
  flex-shrink: 0;
  transition: background 0.15s, opacity 0.15s;
}
.send-btn:hover:not(:disabled) { background: var(--accent-hover); }
.send-btn:disabled { opacity: 0.35; cursor: not-allowed; }

.composer-error {
  margin-top: 8px;
  font-size: 12px;
  color: #ef4444;
  max-width: 800px;
  margin-left: auto;
  margin-right: auto;
}

/* 思维链 */
.reasoning-block {
  margin-bottom: 10px;
}
.reasoning-toggle {
  display: flex;
  align-items: center;
  gap: 6px;
  background: none;
  border: none;
  cursor: pointer;
  color: var(--text-muted);
  font-size: 12px;
  font-family: var(--font-sans);
  padding: 4px 0;
  transition: color 0.15s;
}
.reasoning-toggle:hover { color: var(--text-secondary); }
.reasoning-len {
  color: var(--text-muted);
  font-size: 11px;
}
.reasoning-content {
  margin-top: 6px;
  padding: 10px 12px;
  background: #0f0f0f;
  border: 1px solid var(--border);
  border-radius: var(--radius-sm);
  font-size: 13px;
  color: var(--text-muted);
  line-height: 1.65;
  max-height: 400px;
  overflow-y: auto;
}
</style>
