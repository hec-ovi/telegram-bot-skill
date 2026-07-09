// Turns an AgentEvent stream into visible Telegram behavior, so the user
// always knows whether the agent is thinking, working, done, or dead:
// a typing action kept alive inside Telegram's 5-second window, one status
// message edited in place (throttled to respect flood control), the final
// answer as its own message, and an explicit resolution on the status.

import type { AgentEvent } from '../agents/contract.ts'
import { chunkText } from '../telegram/format.ts'
import type {
  ChatAction,
  EditMessageTextParams,
  Message,
  SendMessageParams,
} from '../telegram/types.ts'

export interface PresenceTransport {
  sendMessage(params: SendMessageParams): Promise<Message>
  editMessageText(params: EditMessageTextParams): Promise<Message>
  sendChatAction(chatId: number, action: ChatAction): Promise<boolean>
}

export interface PresenceOptions {
  // Telegram drops the typing indicator after ~5s; stay under that.
  typingIntervalMs?: number
  // Minimum spacing between status edits; community-safe is >= 1s.
  editThrottleMs?: number
  // Hard cap on a run before it is declared dead.
  timeoutMs?: number
  now?: () => number
}

export interface PresenceResult {
  outcome: 'done' | 'error' | 'timeout'
  sessionId?: string
  reason?: string
}

const TIMEOUT: unique symbol = Symbol('timeout')

function sleep(ms: number, signal?: AbortSignal): Promise<void> {
  return new Promise((resolve) => {
    if (signal?.aborted) {
      resolve()
      return
    }
    const onAbort = () => {
      clearTimeout(timer)
      resolve()
    }
    const timer = setTimeout(() => {
      signal?.removeEventListener('abort', onAbort)
      resolve()
    }, ms)
    signal?.addEventListener('abort', onAbort, { once: true })
  })
}

export async function relayRun(
  transport: PresenceTransport,
  chatId: number,
  events: AsyncIterable<AgentEvent>,
  options: PresenceOptions = {},
): Promise<PresenceResult> {
  const typingIntervalMs = options.typingIntervalMs ?? 4500
  const editThrottleMs = options.editThrottleMs ?? 1500
  const timeoutMs = options.timeoutMs ?? 10 * 60 * 1000
  const now = options.now ?? Date.now
  const abort = new AbortController()

  const status = await transport.sendMessage({ chat_id: chatId, text: '⏳ working…' })

  void (async () => {
    while (!abort.signal.aborted) {
      try {
        await transport.sendChatAction(chatId, 'typing')
      } catch {
        // Liveness signaling must never kill the run.
      }
      await sleep(typingIntervalMs, abort.signal)
    }
  })()

  let lastEditAt = Number.NEGATIVE_INFINITY
  let pending: string | undefined
  let flushScheduled = false

  const editStatus = async (text: string) => {
    lastEditAt = now()
    try {
      await transport.editMessageText({
        chat_id: chatId,
        message_id: status.message_id,
        text,
      })
    } catch {
      // A stale or duplicate edit is not worth failing the run over.
    }
  }

  // Latest-wins status updates, spaced at least editThrottleMs apart.
  const setStatus = (text: string) => {
    pending = text
    if (flushScheduled) return
    const wait = lastEditAt + editThrottleMs - now()
    if (wait <= 0) {
      const value = pending
      pending = undefined
      void editStatus(value)
      return
    }
    flushScheduled = true
    void sleep(wait, abort.signal).then(() => {
      flushScheduled = false
      if (abort.signal.aborted || pending === undefined) return
      const value = pending
      pending = undefined
      void editStatus(value)
    })
  }

  const iterator = events[Symbol.asyncIterator]()
  const deadline = sleep(timeoutMs, abort.signal).then(() => TIMEOUT)

  let terminal: PresenceResult | undefined
  while (terminal === undefined) {
    const step = await Promise.race([iterator.next(), deadline])
    if (step === TIMEOUT) {
      terminal = { outcome: 'timeout', reason: `no result after ${timeoutMs}ms` }
      void iterator.return?.(undefined)
      break
    }
    const { done, value } = step as IteratorResult<AgentEvent>
    if (done) {
      terminal = { outcome: 'error', reason: 'agent stream ended without a result' }
      break
    }
    switch (value.kind) {
      case 'status':
        setStatus('🧠 thinking…')
        break
      case 'tool':
        setStatus(`🔧 ${value.name}${value.detail !== undefined ? `: ${value.detail}` : ''}`)
        break
      case 'text':
        // Sent as plain text: LLM output with parse_mode enabled is how
        // messages get rejected over one stray character.
        for (const chunk of chunkText(value.text)) {
          await transport.sendMessage({ chat_id: chatId, text: chunk })
        }
        break
      case 'done':
        terminal = { outcome: 'done', sessionId: value.sessionId }
        break
      case 'error':
        terminal = { outcome: 'error', reason: value.reason }
        break
    }
  }

  abort.abort()
  const resolution =
    terminal.outcome === 'done'
      ? '✅ done'
      : terminal.outcome === 'timeout'
        ? '⏱ timed out'
        : `⚠️ failed: ${(terminal.reason ?? 'unknown error').slice(0, 500)}`
  await editStatus(resolution)
  return terminal
}
