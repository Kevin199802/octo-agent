import type { Agent } from "./types.js"

export class AgentRegistry {
  private agents = new Map<string, Agent>()

  register(agent: Agent): void {
    this.agents.set(agent.id, agent)
  }

  get(id: string): Agent {
    const agent = this.agents.get(id)
    if (!agent) throw new Error(`Agent "${id}" not registered`)
    return agent
  }

  list(): Agent[] {
    return Array.from(this.agents.values())
  }
}

export const registry = new AgentRegistry()
