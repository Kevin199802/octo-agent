export interface AgentTask {
  sessionId: string
  input: string
  context?: Record<string, unknown>
}

export type AgentOutputChunk =
  | { type: "token"; content: string }
  | { type: "complete" }
  | { type: "error"; message: string }

export interface Agent {
  readonly id: string
  readonly name: string
  run(task: AgentTask): AsyncIterable<AgentOutputChunk>
  abort(): void
}
