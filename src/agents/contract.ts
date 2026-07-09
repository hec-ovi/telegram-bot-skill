// The one boundary between the bridge and any agent harness. Everything
// outside src/agents/ programs against these types and nothing else.

export interface TierPolicy {
  // Tool patterns in the harness's own syntax, e.g. "Bash(git *)".
  allowTools?: string[]
  denyTools?: string[]
  // Directory the agent must stay inside.
  pathScope?: string
  timeoutMs?: number
}

export type AgentEvent =
  | { kind: 'status'; state: 'thinking' }
  | { kind: 'tool'; name: string; detail?: string }
  | { kind: 'text'; text: string }
  | { kind: 'done'; sessionId?: string }
  | { kind: 'error'; reason: string }

export interface AgentRunInput {
  prompt: string
  // Continue a previous conversation; adapters without sessionResume ignore it.
  sessionId?: string
  cwd: string
  policy?: TierPolicy
}

export interface AgentCapabilities {
  sessionResume: boolean
  // 'hard': the harness itself enforces the policy, whatever the model says.
  // 'soft': best effort. 'none': cannot restrict tools. Declare honestly;
  // the runner refuses non-owner tiers on anything below 'hard'.
  toolGating: 'hard' | 'soft' | 'none'
}

export interface AgentAdapter {
  readonly name: string
  readonly capabilities: AgentCapabilities
  run(input: AgentRunInput): AsyncIterable<AgentEvent>
}
