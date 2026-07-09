// Runs the Pi coding agent (github.com/earendil-works/pi) headless:
// `pi --mode json -p <prompt> --session <file>` emits JSONL events.
// Session continuity is file-based: --session accepts a path that does
// not exist yet, so this adapter uses one session file per conversation
// and reports that path as the sessionId.

import { spawn } from 'node:child_process'
import { randomUUID } from 'node:crypto'
import { mkdirSync } from 'node:fs'
import { join } from 'node:path'
import { createInterface } from 'node:readline'
import type {
  AgentAdapter,
  AgentCapabilities,
  AgentEvent,
  AgentRunInput,
} from '../contract.ts'
import { summarizeToolInput } from '../util.ts'

export interface PiAdapterOptions {
  // Override for tests or unusual installs, e.g. [process.execPath, '/path/fake.mjs'].
  command?: string[]
  // Model reference as pi expects it, e.g. "local/gemma-4-26b".
  model?: string
  // Where per-conversation session files live.
  sessionDir?: string
}

export class PiAdapter implements AgentAdapter {
  readonly name = 'pi'
  // Pi has config-level tool restriction (--tools / --exclude-tools), but
  // mapping tiers onto it lands with phase 6. Until then, be honest.
  readonly capabilities: AgentCapabilities = { sessionResume: true, toolGating: 'none' }

  #command: string[]
  #model: string | undefined
  #sessionDir: string

  constructor(options: PiAdapterOptions = {}) {
    this.#command = options.command ?? ['pi']
    this.#model = options.model
    this.#sessionDir = options.sessionDir ?? join(process.cwd(), 'pi-sessions')
  }

  async *run(input: AgentRunInput): AsyncIterable<AgentEvent> {
    let sessionFile = input.sessionId
    if (sessionFile === undefined) {
      mkdirSync(this.#sessionDir, { recursive: true })
      sessionFile = join(this.#sessionDir, `${randomUUID()}.jsonl`)
    }

    const args = [
      ...this.#command.slice(1),
      '--mode',
      'json',
      '-p',
      input.prompt,
      '--session',
      sessionFile,
    ]
    if (this.#model !== undefined) args.push('--model', this.#model)

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

    let finished = false
    let streamed = ''

    for await (const line of createInterface({ input: child.stdout })) {
      const event = parseLine(line)
      if (event === undefined) continue

      if (event.type === 'agent_start') {
        yield { kind: 'status', state: 'thinking' }
        continue
      }
      if (event.type === 'message_update') {
        const update = event.assistantMessageEvent
        if (update?.type === 'text_delta' && typeof update.delta === 'string') {
          streamed += update.delta
        }
        continue
      }
      if (event.type === 'tool_execution_start') {
        yield {
          kind: 'tool',
          name: typeof event.toolName === 'string' ? event.toolName : 'tool',
          detail: summarizeToolInput(event.args),
        }
        continue
      }
      if (event.type === 'agent_end') {
        finished = true
        const finalText = extractFinalText(event.messages) ?? streamed
        yield { kind: 'text', text: finalText }
        yield { kind: 'done', sessionId: sessionFile }
      }
      // Everything else (session header, turn_end, tool updates) is noise here.
    }

    const code = await exited
    if (!finished) {
      const reason = stderrTail.trim() || `pi exited with code ${code} before finishing`
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

// agent_end carries the run's messages; shapes vary, so read defensively
// and fall back to the streamed deltas when in doubt.
function extractFinalText(messages: unknown): string | undefined {
  if (!Array.isArray(messages)) return undefined
  for (let i = messages.length - 1; i >= 0; i--) {
    const message = messages[i] as { role?: string; content?: unknown }
    if (message?.role !== 'assistant') continue
    if (typeof message.content === 'string') return message.content
    if (Array.isArray(message.content)) {
      const text = message.content
        .filter((block: any) => block?.type === 'text' && typeof block.text === 'string')
        .map((block: any) => block.text)
        .join('')
      if (text.length > 0) return text
    }
  }
  return undefined
}
