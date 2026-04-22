import type { Agent, AgentTask, AgentOutputChunk } from "@octo/shell"

export class ResearchAgent implements Agent {
  readonly id = "research"
  readonly name = "用研 Agent"

  private abortController: AbortController | null = null

  async *run(task: AgentTask): AsyncIterable<AgentOutputChunk> {
    this.abortController = new AbortController()
    try {
      // TODO(M6): 接入 opencode SDK，订阅 session 流式输出
      yield { type: "token", content: `[用研 Agent] 收到任务：${task.input}` }
      yield { type: "complete" }
    } catch (err) {
      yield { type: "error", message: String(err) }
    }
  }

  abort(): void {
    this.abortController?.abort()
  }
}
