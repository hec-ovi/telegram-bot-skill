// Composition between gate and agent: one active run per chat (others
// queue behind it), session continuity persisted in the store, and the
// capability check that refuses to hand non-owner tiers to an adapter
// that cannot enforce tool limits.

import type { AgentAdapter } from '../agents/contract.ts'
import { relayRun, type PresenceOptions, type PresenceTransport } from '../presence/presence.ts'
import type { FileStore, Tier } from '../store/store.ts'

export const GATING_REFUSAL =
  '🔐 this agent backend cannot enforce per-tier tool limits yet, so only the owner can use it for now.'

export interface RunnerDeps {
  adapter: AgentAdapter
  transport: PresenceTransport
  store: FileStore
  cwd: string
  presence?: PresenceOptions
}

export class Runner {
  #deps: RunnerDeps
  #queues = new Map<number, Promise<void>>()

  constructor(deps: RunnerDeps) {
    this.#deps = deps
  }

  enqueue(chatId: number, prompt: string, tier: Tier): Promise<void> {
    const previous = this.#queues.get(chatId) ?? Promise.resolve()
    const next = previous.then(() => this.#run(chatId, prompt, tier))
    this.#queues.set(
      chatId,
      next.then(
        () => undefined,
        () => undefined,
      ),
    )
    return next
  }

  async #run(chatId: number, prompt: string, tier: Tier): Promise<void> {
    const { adapter, transport, store, cwd, presence } = this.#deps
    if (tier !== 'owner' && adapter.capabilities.toolGating !== 'hard') {
      await transport.sendMessage({ chat_id: chatId, text: GATING_REFUSAL })
      return
    }
    const sessionId = store.data.sessions[String(chatId)]
    const events = adapter.run({ prompt, sessionId, cwd })
    const result = await relayRun(transport, chatId, events, presence)
    if (result.sessionId !== undefined) {
      const id = result.sessionId
      await store.update((data) => {
        data.sessions[String(chatId)] = id
      })
    }
  }
}
