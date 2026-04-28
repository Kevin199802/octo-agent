<template>
  <div class="chat">
    <template v-if="!sessionId">
      <section class="landing-state">
        <div class="landing-panel">
          <div class="landing-badge">Octo Workspace</div>
          <h2>你好!我是 Octo AI。</h2>
          <p>请描述你的设计需求,我将会根据你的描述自动执行任务</p>
          <button class="start-btn" @click="createAndStart">新建对话</button>
        </div>
      </section>
    </template>

    <template v-else>
      <div class="messages" ref="messagesEl">
        <section v-if="showWelcomeState" class="welcome-state">
          <div class="welcome-badge">Octo AI</div>
          <h2>你好!我是 Octo AI。</h2>
          <p>请描述你的设计需求,我将会根据你的描述自动执行任务</p>
          <ul class="capability-list">
            <li>
              <strong>通用问答:</strong>
              <span>回答各类问题</span>
            </li>
            <li>
              <strong>用研助手:</strong>
              <span>模拟用户访谈,生成用研报告</span>
            </li>
            <li>
              <strong>代码助手:</strong>
              <span>阅读修改代码</span>
            </li>
            <li>
              <strong>评审助手:</strong>
              <span>文档与代码评审</span>
            </li>
          </ul>
          <p class="welcome-footnote">每种类型对应右侧一个 agent。</p>
        </section>

        <div
          v-for="msg in messages"
          :key="msg.id"
          class="message-row"
          :class="`message-row--${msg.role}`"
        >
          <template v-if="msg.role === 'assistant'">
            <div class="msg-avatar" aria-hidden="true">
              <svg width="16" height="16" viewBox="0 0 24 24" fill="none">
                <circle cx="12" cy="12" r="7.5" stroke="currentColor" stroke-width="1.8" />
                <circle cx="12" cy="12" r="2.5" fill="currentColor" />
              </svg>
            </div>

            <div class="msg-body">
              <div class="msg-label">Octo AI</div>

              <div v-if="msg.reasoning" class="reasoning-block">
                <button class="reasoning-toggle" @click="msg.reasoningOpen = !msg.reasoningOpen">
                  <svg
                    width="12" height="12" viewBox="0 0 24 24" fill="none"
                    stroke="currentColor" stroke-width="2" stroke-linecap="round"
                    :style="{ transform: msg.reasoningOpen ? 'rotate(90deg)' : 'none', transition: 'transform 0.15s' }"
                  >
                    <polyline points="9 18 15 12 9 6" />
                  </svg>
                  <span>思维过程</span>
                  <span class="reasoning-len">{{ Math.round(msg.reasoning.length / 4) }} tokens</span>
                </button>
                <div v-if="msg.reasoningOpen" class="reasoning-content md" v-html="renderMd(msg.reasoning)" />
              </div>

              <div v-if="msg.text" class="msg-content md" v-html="renderMd(msg.text)" />
              <span v-if="msg.streaming && !msg.text && !msg.error" class="cursor">▋</span>

              <div v-if="msg.error" class="msg-error" role="alert">
                <div class="msg-error-title">⚠️ 调用出错</div>
                <pre class="msg-error-detail">{{ msg.error }}</pre>
              </div>
            </div>
          </template>

          <template v-else>
            <div class="msg-body msg-body--user">
              <div class="msg-content msg-content--user">{{ msg.text }}</div>
            </div>
          </template>
        </div>

        <div v-if="sending && !hasStreamingMsg" class="message-row message-row--assistant">
          <div class="msg-avatar" aria-hidden="true">
            <svg width="16" height="16" viewBox="0 0 24 24" fill="none">
              <circle cx="12" cy="12" r="7.5" stroke="currentColor" stroke-width="1.8" />
              <circle cx="12" cy="12" r="2.5" fill="currentColor" />
            </svg>
          </div>
          <div class="msg-body">
            <div class="msg-label">Octo AI</div>
            <div class="typing">
              <span />
              <span />
              <span />
            </div>
          </div>
        </div>
      </div>

      <div class="composer-shell">
        <div class="composer">
          <textarea
            ref="inputEl"
            v-model="input"
            placeholder="描述你想生成的内容,输入 / 唤起技能,或通过 + 添加上下文"
            :disabled="sending"
            rows="1"
            @keydown.enter.exact.prevent="send"
            @input="autoResize"
          />

          <div class="composer-toolbar">
            <button class="tool-btn" type="button" title="添加内容" :disabled="sending">
              <svg width="16" height="16" viewBox="0 0 24 24" fill="none" aria-hidden="true">
                <path d="M12 5V19M5 12H19" stroke="currentColor" stroke-width="2" stroke-linecap="round" />
              </svg>
            </button>

            <button class="agent-pill" type="button" title="Agent 选择器" :disabled="sending">
              <svg width="14" height="14" viewBox="0 0 24 24" fill="none" aria-hidden="true">
                <path d="M12 4.5 14 9l5 .7-3.6 3.5.9 5-4.3-2.3-4.3 2.3.9-5L5 9.7 10 9l2-4.5Z" stroke="currentColor" stroke-width="1.6" stroke-linejoin="round" />
              </svg>
              <span>通用问答</span>
              <svg width="12" height="12" viewBox="0 0 24 24" fill="none" aria-hidden="true">
                <path d="m6 9 6 6 6-6" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" />
              </svg>
            </button>

            <button
              class="send-btn"
              :disabled="sending || !input.trim()"
              @click="send"
              title="发送 (Enter)"
            >
              <svg width="16" height="16" viewBox="0 0 24 24" fill="none" aria-hidden="true">
                <path d="M12 5v14M12 5l-5 5M12 5l5 5" stroke="currentColor" stroke-width="2.1" stroke-linecap="round" stroke-linejoin="round" />
              </svg>
            </button>
          </div>
        </div>

        <div v-if="error" class="composer-error">{{ error }}</div>
      </div>
    </template>
  </div>
</template>

<script setup lang="ts">
import { computed, nextTick, onMounted, onUnmounted, ref, watch } from "vue"
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
  error?: string
}

type MessagePart = {
  type?: string
  text?: string
}

type MessageErrorData = {
  name?: string
  data?: { message?: string; providerID?: string }
}

type SessionMessageRecord = {
  info?: {
    id?: string
    role?: "user" | "assistant"
    error?: MessageErrorData
  }
  parts?: MessagePart[]
}

type StreamEvent = {
  type?: string
  properties?: {
    field?: string
    delta?: string
    messageID?: string
    part?: {
      type?: string
      messageID?: string
    }
    error?: MessageErrorData
  }
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
const hasStreamingMsg = computed(() => messages.value.some((message) => message.streaming))
const showWelcomeState = computed(() => messages.value.length === 0 && !sending.value)

let abortController: AbortController | null = null

function renderMd(text: string): string {
  if (!text) return ""
  return marked(text) as string
}

async function scrollToBottom() {
  await nextTick()
  if (messagesEl.value) messagesEl.value.scrollTop = messagesEl.value.scrollHeight
}

function autoResize() {
  if (!inputEl.value) return
  inputEl.value.style.height = "auto"
  inputEl.value.style.height = `${Math.min(inputEl.value.scrollHeight, 220)}px`
}

function formatMessageError(error: MessageErrorData): string {
  const name = error.name ?? "Error"
  const message = error.data?.message ?? "(无详细信息)"
  const provider = error.data?.providerID ? ` · provider: ${error.data.providerID}` : ""
  return `${name}${provider}\n${message}`
}

function parseMessages(input: unknown): ChatMessage[] {
  if (!Array.isArray(input)) return []
  return input
    .map((item) => {
      const record = item as SessionMessageRecord
      if (!record.info?.id || !record.info.role || !Array.isArray(record.parts)) return null
      const text = record.parts.filter((part) => part.type === "text").map((part) => part.text ?? "").join("")
      const reasoning = record.parts.filter((part) => part.type === "reasoning").map((part) => part.text ?? "").join("")
      const error = record.info.error ? formatMessageError(record.info.error) : undefined
      // 没有任何文字也没有错误的消息(空步骤)才丢弃
      if (!text.trim() && !reasoning.trim() && !error) return null
      const message: ChatMessage = {
        id: record.info.id,
        role: record.info.role,
        text,
        reasoning,
        reasoningOpen: false,
        streaming: false,
      }
      if (error) message.error = error
      return message
    })
    .filter((message): message is ChatMessage => message !== null)
}

async function loadMessages() {
  const id = sessionId.value
  if (!id) return
  try {
    const res = await client.session.messages({ path: { id } })
    messages.value = parseMessages(res.data)
    scrollToBottom()
  } catch {
    // ignore empty session load failures
  }
}

function ensureStreamingMessage(messageID: string) {
  if (messages.value.find((message) => message.id === messageID)) return
  messages.value.push({
    id: messageID,
    role: "assistant",
    text: "",
    reasoning: "",
    reasoningOpen: true,
    streaming: true,
  })
  scrollToBottom()
}

function startEventStream() {
  abortController = new AbortController()

  ;(async () => {
    try {
      const { stream } = await client.event.subscribe({ signal: abortController.signal } as never)
      for await (const rawEvent of stream) {
        const event = rawEvent as StreamEvent | null
        if (!event?.type) continue

        if (event.type === "message.part.updated") {
          const part = event.properties?.part
          if (part?.type === "step-start" && part.messageID) ensureStreamingMessage(part.messageID)
        }

        if (event.type === "message.part.delta") {
          const messageID = event.properties?.messageID
          const delta = event.properties?.delta
          if (!messageID || !delta || event.properties?.field !== "text") continue
          const message = messages.value.find((item) => item.id === messageID && item.role === "assistant")
          if (!message) continue
          message.text += delta
          message.streaming = true
          scrollToBottom()
        }

        if (event.type === "session.idle") {
          await loadMessages()
          sending.value = false
        }

        if (event.type === "session.error") {
          const errPayload = event.properties?.error
          if (errPayload) {
            error.value = formatMessageError(errPayload)
          } else {
            error.value = "对话中断,请查看服务端日志"
          }
          sending.value = false
          // 也尝试拉取最新消息,可能已经把 error 写到 assistant message 上
          await loadMessages()
        }
      }
    } catch {
      // ignore stream disconnects
    }
  })()
}

async function send() {
  const text = input.value.trim()
  if (!text || sending.value || !sessionId.value) return

  error.value = ""
  sending.value = true
  input.value = ""
  if (inputEl.value) inputEl.value.style.height = "auto"

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
  } catch (cause) {
    error.value = String(cause)
    sending.value = false
  }
}

async function createAndStart() {
  try {
    const res = await client.session.create({ body: {} })
    if (res.data?.id) router.push(`/session/${res.data.id}`)
  } catch (cause) {
    error.value = String(cause)
  }
}

watch(
  sessionId,
  async (id) => {
    if (!id) {
      messages.value = []
      sending.value = false
      error.value = ""
      return
    }
    messages.value = []
    sending.value = false
    error.value = ""
    await loadMessages()
  },
  { immediate: true },
)

onMounted(startEventStream)

onUnmounted(() => {
  abortController?.abort()
})
</script>

<style scoped>
.chat {
  display: flex;
  flex-direction: column;
  height: 100%;
  background:
    radial-gradient(circle at top right, color-mix(in srgb, var(--accent-bg) 72%, transparent), transparent 32%),
    linear-gradient(180deg, color-mix(in srgb, var(--bg-app) 76%, var(--bg-soft)), var(--bg-app));
}

.landing-state,
.welcome-state {
  display: flex;
  flex-direction: column;
  align-items: flex-start;
  justify-content: center;
}

.landing-state {
  flex: 1;
  padding: 40px;
}

.landing-panel {
  width: min(100%, 560px);
  margin: 0 auto;
  padding: 40px;
  border: 1px solid var(--border);
  border-radius: 28px;
  background: linear-gradient(180deg, var(--bg-elevated), color-mix(in srgb, var(--bg-elevated) 72%, var(--accent-bg)));
  box-shadow: var(--shadow-card);
}

.landing-badge,
.welcome-badge {
  width: fit-content;
  padding: 7px 12px;
  border-radius: 999px;
  background: var(--accent-bg);
  color: var(--accent);
  font-size: 12px;
  font-weight: 600;
}

.landing-badge {
  margin-bottom: 22px;
}

.landing-panel h2,
.welcome-state h2 {
  font-size: clamp(32px, 4vw, 40px);
  line-height: 1.08;
  color: var(--text-primary);
}

.landing-panel p,
.welcome-state p {
  max-width: 560px;
  margin-top: 14px;
  color: var(--text-secondary);
  font-size: 15px;
  line-height: 1.75;
}

.start-btn {
  margin-top: 28px;
  padding: 12px 18px;
  border: none;
  border-radius: 14px;
  background: var(--accent);
  color: var(--accent-text);
  font-size: 14px;
  font-weight: 600;
  cursor: pointer;
  transition: background 0.15s ease, transform 0.15s ease;
}

.start-btn:hover {
  background: var(--accent-hover);
  transform: translateY(-1px);
}

.messages {
  flex: 1;
  overflow-y: auto;
  padding: 38px 0 12px;
}

.welcome-state {
  max-width: 780px;
  margin: 0 auto 18px;
  padding: 12px 32px 28px;
}

.welcome-badge {
  margin-bottom: 18px;
}

.capability-list {
  width: 100%;
  margin-top: 26px;
  padding: 0;
  list-style: none;
  display: grid;
  gap: 12px;
}

.capability-list li {
  display: flex;
  gap: 8px;
  padding: 14px 16px;
  border: 1px solid var(--border);
  border-radius: 18px;
  background: color-mix(in srgb, var(--bg-elevated) 82%, var(--accent-bg));
  color: var(--text-secondary);
  box-shadow: var(--shadow-soft);
  flex-wrap: wrap;
}

.capability-list strong {
  color: var(--text-primary);
  font-size: 14px;
}

.capability-list span,
.welcome-footnote {
  font-size: 14px;
}

.welcome-footnote {
  margin-top: 20px;
  color: var(--text-muted);
}

.message-row {
  display: flex;
  gap: 14px;
  max-width: 860px;
  margin: 0 auto;
  padding: 10px 32px;
}

.message-row--user {
  justify-content: flex-end;
}

.msg-avatar {
  width: 32px;
  height: 32px;
  display: flex;
  align-items: center;
  justify-content: center;
  border-radius: 11px;
  background: var(--accent-bg);
  color: var(--accent);
  flex-shrink: 0;
  box-shadow: inset 0 0 0 1px color-mix(in srgb, var(--accent) 18%, transparent);
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
  margin-bottom: 8px;
  color: var(--text-muted);
  font-size: 12px;
  font-weight: 600;
  letter-spacing: 0.04em;
  text-transform: uppercase;
}

.msg-content {
  color: var(--text-primary);
  font-size: 14px;
  line-height: 1.8;
  word-break: break-word;
}

.msg-content--user {
  max-width: min(620px, 100%);
  padding: 14px 16px;
  border: 1px solid color-mix(in srgb, var(--accent) 16%, var(--border));
  border-radius: 22px;
  background: var(--bg-msg-user);
  box-shadow: var(--shadow-soft);
  white-space: pre-wrap;
}

.reasoning-block {
  margin-bottom: 12px;
  border: 1px solid var(--border);
  border-radius: 16px;
  background: color-mix(in srgb, var(--bg-elevated) 90%, var(--bg-soft));
}

.reasoning-toggle {
  width: 100%;
  display: flex;
  align-items: center;
  gap: 8px;
  padding: 12px 14px;
  background: transparent;
  border: none;
  color: var(--text-secondary);
  cursor: pointer;
  font-size: 12px;
  font-weight: 600;
}

.reasoning-len {
  margin-left: auto;
  color: var(--text-muted);
  font-weight: 500;
}

.reasoning-content {
  padding: 0 14px 14px;
  color: var(--text-secondary);
  font-size: 13px;
}

.typing {
  display: flex;
  align-items: center;
  gap: 6px;
  height: 28px;
}

.typing span {
  width: 7px;
  height: 7px;
  border-radius: 999px;
  background: color-mix(in srgb, var(--accent) 40%, var(--text-muted));
  animation: typing-bounce 1.2s infinite ease-in-out;
}

.typing span:nth-child(2) {
  animation-delay: 0.15s;
}

.typing span:nth-child(3) {
  animation-delay: 0.3s;
}

@keyframes typing-bounce {
  0%,
  80%,
  100% {
    transform: translateY(0);
    opacity: 0.45;
  }
  40% {
    transform: translateY(-4px);
    opacity: 1;
  }
}

.cursor {
  display: inline-block;
  color: var(--text-secondary);
  animation: blink 0.8s step-end infinite;
}

@keyframes blink {
  50% {
    opacity: 0;
  }
}

.composer-shell {
  padding: 18px 24px 22px;
}

.composer {
  max-width: 860px;
  margin: 0 auto;
  padding: 16px 16px 14px;
  border: 1px solid var(--border-input);
  border-radius: 24px;
  background: color-mix(in srgb, var(--bg-elevated) 90%, var(--accent-bg));
  box-shadow: var(--shadow-card);
  transition: border-color 0.15s ease, box-shadow 0.15s ease;
}

.composer:focus-within {
  border-color: var(--accent);
  box-shadow: 0 0 0 4px color-mix(in srgb, var(--accent) 12%, transparent), var(--shadow-card);
}

textarea {
  width: 100%;
  min-height: 88px;
  max-height: 220px;
  resize: none;
  border: none;
  outline: none;
  background: transparent;
  color: var(--text-primary);
  font-family: var(--font-sans);
  font-size: 15px;
  line-height: 1.75;
}

textarea::placeholder {
  color: var(--text-muted);
}

textarea:disabled {
  opacity: 0.6;
}

.composer-toolbar {
  display: flex;
  align-items: center;
  gap: 10px;
  margin-top: 16px;
  padding-top: 14px;
  border-top: 1px solid var(--border);
}

.tool-btn,
.send-btn,
.agent-pill {
  border: 1px solid var(--border);
  background: var(--bg-elevated);
  color: var(--text-secondary);
  transition: background 0.15s ease, border-color 0.15s ease, color 0.15s ease, transform 0.15s ease;
}

.tool-btn,
.send-btn {
  width: 38px;
  height: 38px;
  display: inline-flex;
  align-items: center;
  justify-content: center;
  border-radius: 12px;
  flex-shrink: 0;
  cursor: pointer;
}

.agent-pill {
  display: inline-flex;
  align-items: center;
  gap: 8px;
  min-height: 38px;
  padding: 0 12px;
  border-radius: 999px;
  font-size: 13px;
  font-weight: 600;
  cursor: pointer;
}

.tool-btn:hover:not(:disabled),
.agent-pill:hover:not(:disabled) {
  background: var(--bg-hover);
  color: var(--text-primary);
}

.send-btn {
  margin-left: auto;
  border-color: transparent;
  background: var(--accent);
  color: var(--accent-text);
}

.send-btn:hover:not(:disabled) {
  background: var(--accent-hover);
  transform: translateY(-1px);
}

.tool-btn:disabled,
.agent-pill:disabled,
.send-btn:disabled {
  cursor: not-allowed;
  opacity: 0.5;
  transform: none;
}

.composer-error {
  max-width: 860px;
  margin: 10px auto 0;
  color: var(--danger);
  font-size: 13px;
}

.msg-error {
  margin-top: 10px;
  padding: 12px 14px;
  border: 1px solid color-mix(in srgb, var(--danger) 35%, transparent);
  border-radius: 12px;
  background: color-mix(in srgb, var(--danger) 8%, transparent);
}
.msg-error-title {
  color: var(--danger);
  font-size: 13px;
  font-weight: 600;
  margin-bottom: 6px;
}
.msg-error-detail {
  margin: 0;
  font-family: var(--font-mono);
  font-size: 12px;
  line-height: 1.55;
  color: var(--text-secondary);
  white-space: pre-wrap;
  word-break: break-word;
}

@media (max-width: 960px) {
  .landing-state {
    padding: 24px;
  }

  .landing-panel,
  .welcome-state,
  .message-row,
  .composer-shell {
    padding-left: 20px;
    padding-right: 20px;
  }
}
</style>
