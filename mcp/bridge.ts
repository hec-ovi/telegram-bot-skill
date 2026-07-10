// The Telegram side of the MCP surface: the exact same wiring as `npm
// start` (poller, gate, store, claim flow, approval buttons), except that
// gate-approved messages are handed to the MCP client instead of being
// spawned into a CLI adapter run. The agent answering is the client itself.

import { createBot, type SeedUsers, type TextMessage } from '../src/app.ts'
import type { FileStore, Tier, UserState } from '../src/store/store.ts'
import type { TelegramApi } from '../src/telegram/api.ts'
import { chunkText } from '../src/telegram/format.ts'
import type { User } from '../src/telegram/types.ts'

export interface BridgeMessage {
  chat_id: number
  user_id: number
  message_id: number
  name?: string
  tier: Tier
  text: string
  received_at: string
}

export interface BridgeUser {
  user_id: number
  state: UserState
  name?: string
  added_at: string
}

export interface BridgeStatus {
  bot_username?: string
  owner_claimed: boolean
  // Only present while unclaimed: the first person to open it owns the bot.
  claim_link?: string
  users: BridgeUser[]
  queued_messages: number
  last_poll_error?: string
}

export interface BridgeOptions {
  api: TelegramApi
  store: FileStore
  seed?: SeedUsers
  log?: (line: string) => void
}

// Messages a private bot can realistically accumulate while nobody drains
// them; beyond this the oldest are dropped (and the drop is logged).
const QUEUE_CAP = 500

interface Waiter {
  resolve: (message: BridgeMessage | undefined) => void
  timer: NodeJS.Timeout
}

export class TelegramBridge {
  readonly #api: TelegramApi
  readonly #store: FileStore
  readonly #log: (line: string) => void
  readonly #abort = new AbortController()
  readonly #bot: ReturnType<typeof createBot>
  #queue: BridgeMessage[] = []
  #waiters: Waiter[] = []
  // Channel mode plugs in a sink; while unset, messages queue up.
  #sink: ((message: BridgeMessage) => void) | undefined
  #me: User | undefined
  #lastPollError: string | undefined

  constructor(options: BridgeOptions) {
    this.#api = options.api
    this.#store = options.store
    this.#log = options.log ?? (() => {})
    this.#bot = createBot({
      api: options.api,
      store: options.store,
      cwd: process.cwd(),
      seed: options.seed,
      log: this.#log,
      onRun: (message, tier) => this.#receive(message, tier),
      poller: {
        errorDelayMs: 5000,
        onError: (error) => {
          this.#lastPollError = String(error)
          this.#log(`poll error: ${String(error)}`)
        },
      },
    })
  }

  // Boots the gate (seeding, claim link when unclaimed) and starts the
  // long-poll loop in the background. A Telegram outage at boot is reported,
  // not fatal: the poller retries on its own and status() carries the error.
  async start(): Promise<void> {
    try {
      this.#me = await this.#api.getMe()
      await this.#bot.bootstrap()
    } catch (error) {
      this.#lastPollError = String(error)
      this.#log(`bootstrap failed (will keep retrying): ${String(error)}`)
    }
    void this.#bot.runLoop(this.#abort.signal).catch((error) => {
      this.#lastPollError = String(error)
      this.#log(`poll loop died: ${String(error)}`)
    })
  }

  stop(): void {
    this.#abort.abort()
    for (const waiter of this.#waiters.splice(0)) {
      clearTimeout(waiter.timer)
      waiter.resolve(undefined)
    }
  }

  // Channel mode: deliver every gate-approved message here as it arrives.
  // Anything queued before the sink existed is flushed into it first, so
  // messages received during the MCP handshake are not lost.
  setSink(sink: (message: BridgeMessage) => void): void {
    this.#sink = sink
    for (const message of this.#queue.splice(0)) sink(message)
  }

  #receive(message: TextMessage, tier: Tier): void {
    const bridged: BridgeMessage = {
      chat_id: message.chatId,
      user_id: message.userId,
      message_id: message.messageId,
      name: message.name,
      tier,
      text: message.text,
      received_at: new Date().toISOString(),
    }
    if (this.#sink !== undefined) {
      this.#sink(bridged)
      return
    }
    const waiter = this.#waiters.shift()
    if (waiter !== undefined) {
      clearTimeout(waiter.timer)
      waiter.resolve(bridged)
      return
    }
    this.#queue.push(bridged)
    if (this.#queue.length > QUEUE_CAP) {
      const dropped = this.#queue.shift()
      this.#log(`queue full, dropped message from user ${dropped?.user_id}`)
    }
  }

  // Resolves with the next approved message, or undefined on timeout or
  // cancellation. Never rejects: a quiet chat is not an error.
  waitForMessage(timeoutMs: number, signal?: AbortSignal): Promise<BridgeMessage | undefined> {
    const queued = this.#queue.shift()
    if (queued !== undefined) return Promise.resolve(queued)
    return new Promise((resolve) => {
      const waiter: Waiter = {
        resolve,
        timer: setTimeout(() => this.#drop(waiter), timeoutMs),
      }
      waiter.timer.unref()
      signal?.addEventListener('abort', () => this.#drop(waiter), { once: true })
      this.#waiters.push(waiter)
    })
  }

  #drop(waiter: Waiter): void {
    const at = this.#waiters.indexOf(waiter)
    if (at === -1) return
    this.#waiters.splice(at, 1)
    clearTimeout(waiter.timer)
    waiter.resolve(undefined)
  }

  // Sends plain text, chunked under Telegram's 4096-char cap. Returns the
  // number of messages actually sent.
  async sendText(chatId: number, text: string): Promise<number> {
    const chunks = chunkText(text)
    for (const chunk of chunks) {
      await this.#api.sendMessage({ chat_id: chatId, text: chunk })
    }
    return chunks.length
  }

  listUsers(): BridgeUser[] {
    return Object.entries(this.#store.data.users).map(([id, user]) => ({
      user_id: Number(id),
      state: user.state,
      name: user.name,
      added_at: user.addedAt,
    }))
  }

  // Same power as the owner's inline approve buttons, exposed as a tool.
  // The owner tier itself is untouchable from here: no owner demotion, no
  // second owner. Unknown ids are upserted like env seeding does (a private
  // chat id equals the user id, which is all a notification needs).
  async setUserTier(userId: number, tier: 'trusted' | 'guest' | 'blocked'): Promise<void> {
    const existing = this.#store.data.users[String(userId)]
    if (existing?.state === 'owner') {
      throw new Error(`user ${userId} is the owner; the owner tier cannot be changed from here`)
    }
    await this.#store.update((data) => {
      const previous = data.users[String(userId)]
      data.users[String(userId)] = {
        state: tier,
        chatId: previous?.chatId ?? userId,
        name: previous?.name,
        addedAt: previous?.addedAt ?? new Date().toISOString(),
      }
    })
    const record = this.#store.data.users[String(userId)]
    const notice = tier === 'blocked' ? '🚫 the owner declined your request.' : `✅ you are in. tier: ${tier}`
    try {
      await this.#api.sendMessage({ chat_id: record.chatId, text: notice })
    } catch (error) {
      // The tier change already persisted; a failed courtesy notice (user
      // never opened the chat, network hiccup) must not undo it.
      this.#log(`tier notice to ${userId} failed: ${String(error)}`)
    }
  }

  status(): BridgeStatus {
    const data = this.#store.data
    const ownerClaimed = Object.values(data.users).some((user) => user.state === 'owner')
    const claimLink =
      !ownerClaimed && data.claimCode !== undefined && this.#me?.username !== undefined
        ? `https://t.me/${this.#me.username}?start=${data.claimCode}`
        : undefined
    return {
      bot_username: this.#me?.username,
      owner_claimed: ownerClaimed,
      claim_link: claimLink,
      users: this.listUsers(),
      queued_messages: this.#queue.length,
      last_poll_error: this.#lastPollError,
    }
  }
}
