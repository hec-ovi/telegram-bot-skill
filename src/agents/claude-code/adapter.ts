// Runs Claude Code headless (`claude -p --output-format stream-json`) and
// translates its NDJSON events into the adapter contract. Event shapes were
// captured from a live run of claude 2.1.205, not assumed from docs.

import { spawn } from 'node:child_process'
import { createInterface } from 'node:readline'
import type {
  AgentAdapter,
  AgentCapabilities,
  AgentEvent,
  AgentRunInput,
} from '../contract.ts'

export interface ClaudeCodeAdapterOptions {
  // Override for tests or unusual installs, e.g. [process.execPath, '/path/fake.mjs'].
  command?: string[]
}

export class ClaudeCodeAdapter implements AgentAdapter {
  readonly name = 'claude-code'
  // toolGating flips to 'hard' in phase 6, when TierPolicy is mapped to
  // settings permissions and a PreToolUse hook. Until then, be honest.
  readonly capabilities: AgentCapabilities = { sessionResume: true, toolGating: 'none' }

  #command: string[]

  constructor(options: ClaudeCodeAdapterOptions = {}) {
    this.#command = options.command ?? ['claude']
  }

  async *run(input: AgentRunInput): AsyncIterable<AgentEvent> {
    const args = [
      ...this.#command.slice(1),
      '-p',
      input.prompt,
      '--output-format',
      'stream-json',
      '--verbose',
    ]
    if (input.sessionId !== undefined) {
      args.push('--resume', input.sessionId)
    }

    const child = spawn(this.#command[0], args, {
      cwd: input.cwd,
      stdio: ['ignore', 'pipe', 'pipe'],
    })

    let stderrTail = ''
    child.stderr.on('data', (chunk: Buffer) => {
      stderrTail = (stderrTail + chunk.toString()).slice(-2000)
    })

    const exited = new Promise<number | null>((resolve) => {
      child.on('error', () => resolve(null))
      child.on('close', (code) => resolve(code))
    })

    let sessionId: string | undefined
    let finished = false

    for await (const line of createInterface({ input: child.stdout })) {
      const event = parseLine(line)
      if (event === undefined) continue

      if (event.type === 'system' && event.subtype === 'init') {
        sessionId = event.session_id
        yield { kind: 'status', state: 'thinking' }
        continue
      }
      if (event.type === 'assistant') {
        for (const block of event.message?.content ?? []) {
          if (block.type === 'tool_use') {
            yield { kind: 'tool', name: block.name, detail: summarizeInput(block.input) }
          }
        }
        continue
      }
      if (event.type === 'result') {
        sessionId = event.session_id ?? sessionId
        finished = true
        if (event.is_error) {
          const reason =
            typeof event.result === 'string' && event.result.length > 0
              ? event.result
              : `claude failed (${event.subtype})`
          yield { kind: 'error', reason }
        } else {
          yield { kind: 'text', text: typeof event.result === 'string' ? event.result : '' }
          yield { kind: 'done', sessionId }
        }
      }
      // Everything else (rate_limit_event, stream_event, ...) is noise here.
    }

    const code = await exited
    if (!finished) {
      const reason =
        stderrTail.trim() || `claude exited with code ${code} before producing a result`
      yield { kind: 'error', reason }
    }
  }
}

function parseLine(line: string): any | undefined {
  const trimmed = line.trim()
  if (trimmed.length === 0) return undefined
  try {
    return JSON.parse(trimmed)
  } catch {
    return undefined
  }
}

// One short human-readable hint about what the tool call touches.
function summarizeInput(input: unknown): string | undefined {
  if (typeof input !== 'object' || input === null) return undefined
  const record = input as Record<string, unknown>
  for (const key of ['command', 'file_path', 'path', 'pattern', 'url', 'description']) {
    const value = record[key]
    if (typeof value === 'string' && value.length > 0) return value.slice(0, 200)
  }
  return undefined
}
