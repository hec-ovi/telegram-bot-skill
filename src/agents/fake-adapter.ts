// Scripted adapter for tests of everything that consumes AgentEvents.

import type {
  AgentAdapter,
  AgentCapabilities,
  AgentEvent,
  AgentRunInput,
} from './contract.ts'

export class FakeAdapter implements AgentAdapter {
  readonly name = 'fake'
  readonly capabilities: AgentCapabilities
  readonly runs: AgentRunInput[] = []
  #script: AgentEvent[]

  constructor(script: AgentEvent[], capabilities: Partial<AgentCapabilities> = {}) {
    this.#script = script
    this.capabilities = { sessionResume: true, toolGating: 'hard', ...capabilities }
  }

  async *run(input: AgentRunInput): AsyncIterable<AgentEvent> {
    this.runs.push(input)
    yield* this.#script
  }
}
