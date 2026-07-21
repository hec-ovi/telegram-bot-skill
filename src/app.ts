// Wires every module into a working bot: poll, normalize, gate, act.
// Kept free of process/env concerns so tests can drive it end to end;
// bot.ts is the thin executable wrapper.

import { randomBytes } from 'node:crypto'
import type { AgentAdapter } from './agents/contract.ts'
import { decide } from './gate/gate.ts'
import { qrMatrix, qrToTerminal } from './qr/qr.ts'
import type { PresenceOptions } from './presence/presence.ts'
import { Runner } from './runner/runner.ts'
import type { FileStore, Tier, UserRecord, UserState } from './store/store.ts'
import type { TelegramApi } from './telegram/api.ts'
import { normalizeUpdate, pollUpdates, type PollerOptions } from './telegram/poller.ts'
import type { IncomingMessage, Update } from './telegram/types.ts'

// Recover mode: declared access seeded from env at every boot, so a fresh
// machine or wiped state file comes up already owned and usable, no claim
// dance. Env is the source of truth for the ids it names.
export interface SeedUsers {
  ownerIds?: number[]
  trusted?: number[]
  guest?: number[]
  blocked?: number[]
}

export type TextMessage = Extract<IncomingMessage, { kind: 'text' }>

export interface BotDeps {
  api: TelegramApi
  store: FileStore
  adapter?: AgentAdapter
  cwd: string
  seed?: SeedUsers
  log?: (line: string) => void
  presence?: PresenceOptions
  poller?: PollerOptions
  // Alternate consumer for gate-approved messages: when set, the built-in
  // runner/adapter path is bypassed and messages land here instead. The
  // MCP surface uses this to hand messages to the connected client.
  onRun?: (message: TextMessage, tier: Tier) => void
}

export const TEXT = {
  ownerClaimed: '👑 you own this bot now. send me anything.',
  pending: '🔒 this bot is private. the owner has been asked to let you in.',
  stillPending: '⏳ still waiting for the owner to decide.',
  approvedPrefix: '✅ you are in. tier: ',
  blockedNotice: '🚫 the owner declined your request.',
}

export function createBot(deps: BotDeps) {
  const log = deps.log ?? (() => {})
  if (deps.adapter === undefined && deps.onRun === undefined) {
    throw new Error('createBot needs an adapter or an onRun handler')
  }
  const runner =
    deps.adapter === undefined
      ? undefined
      : new Runner({
          adapter: deps.adapter,
          transport: deps.api,
          store: deps.store,
          cwd: deps.cwd,
          presence: deps.presence,
        })

  const send = (chatId: number, text: string) =>
    deps.api.sendMessage({ chat_id: chatId, text })

  const findOwner = (): UserRecord | undefined =>
    Object.values(deps.store.data.users).find((user) => user.state === 'owner')

  const owners = (): UserRecord[] =>
    Object.values(deps.store.data.users).filter((user) => user.state === 'owner')

  const nameOf = (message: IncomingMessage): string | undefined =>
    message.kind === 'text' ? message.name : undefined

  async function bootstrap(): Promise<void> {
    const me = await deps.api.getMe()
    const seed = deps.seed
    if (seed !== undefined) {
      await deps.store.update((data) => {
        const upsert = (id: number, state: UserState) => {
          const existing = data.users[String(id)]
          data.users[String(id)] = {
            state,
            // Private-chat id equals the user id, which is all seeding needs.
            chatId: existing?.chatId ?? id,
            name: existing?.name,
            addedAt: existing?.addedAt ?? new Date().toISOString(),
          }
        }
        if (seed.ownerIds !== undefined && seed.ownerIds.length > 0) {
          const ownerIdSet = new Set(seed.ownerIds)
          for (const [id, user] of Object.entries(data.users)) {
            if (user.state === 'owner' && !ownerIdSet.has(Number(id))) user.state = 'trusted'
          }
          for (const id of seed.ownerIds) upsert(id, 'owner')
          delete data.claimCode
        }
        const isOwner = (id: number) => seed.ownerIds?.includes(id) ?? false
        for (const id of seed.trusted ?? []) if (!isOwner(id)) upsert(id, 'trusted')
        for (const id of seed.guest ?? []) if (!isOwner(id)) upsert(id, 'guest')
        for (const id of seed.blocked ?? []) if (!isOwner(id)) upsert(id, 'blocked')
      })
    }
    if (findOwner() === undefined) {
      if (deps.store.data.claimCode === undefined) {
        await deps.store.update((data) => {
          data.claimCode = randomBytes(9).toString('base64url')
        })
      }
      const link = `https://t.me/${me.username}?start=${deps.store.data.claimCode}`
      log(`no owner yet. claim the bot (first tap wins):`)
      log(link)
      try {
        log(qrToTerminal(qrMatrix(link)))
      } catch {
        // A QR failure must never block the boot; the link above suffices.
      }
    }
    log(`@${me.username} is polling`)
  }

  async function handleUpdate(update: Update): Promise<void> {
    const message = normalizeUpdate(update)
    if (message === undefined) return

    if (message.kind === 'callback') {
      // Clear the client-side spinner no matter what the gate decides.
      try {
        await deps.api.answerCallbackQuery({ callback_query_id: message.callbackId })
      } catch {
        // A dead callback is not worth crashing the loop.
      }
    }

    const decision = decide(message, deps.store.data)
    switch (decision.action) {
      case 'ignore':
        return

      case 'claim-owner': {
        await deps.store.update((data) => {
          delete data.claimCode
          data.users[String(message.userId)] = {
            state: 'owner',
            chatId: message.chatId,
            name: nameOf(message),
            addedAt: new Date().toISOString(),
          }
        })
        await send(message.chatId, TEXT.ownerClaimed)
        return
      }

      case 'request-approval': {
        await deps.store.update((data) => {
          data.users[String(message.userId)] = {
            state: 'pending',
            chatId: message.chatId,
            name: nameOf(message),
            addedAt: new Date().toISOString(),
          }
        })
        await send(message.chatId, TEXT.pending)
        for (const owner of owners()) {
          await deps.api.sendMessage({
            chat_id: owner.chatId,
            text: `👤 ${nameOf(message) ?? 'someone'} (id ${message.userId}) asks for access.`,
            reply_markup: {
              inline_keyboard: [
                [
                  { text: '✅ trust', callback_data: `gate:trusted:${message.userId}` },
                  { text: '👤 guest', callback_data: `gate:guest:${message.userId}` },
                  { text: '🚫 block', callback_data: `gate:blocked:${message.userId}` },
                ],
              ],
            },
          })
        }
        return
      }

      case 'still-pending':
        await send(message.chatId, TEXT.stillPending)
        return

      case 'greet':
        await send(message.chatId, `🤖 ready. tier: ${decision.tier}. send me anything.`)
        return

      case 'approve': {
        const target = deps.store.data.users[String(decision.targetUserId)]
        if (target === undefined) return
        await deps.store.update((data) => {
          data.users[String(decision.targetUserId)].state = decision.verdict
        })
        await deps.api.editMessageText({
          chat_id: message.chatId,
          message_id: message.messageId,
          text: `resolved: ${target.name ?? decision.targetUserId} is now ${decision.verdict}`,
        })
        const notice =
          decision.verdict === 'blocked'
            ? TEXT.blockedNotice
            : TEXT.approvedPrefix + decision.verdict
        await send(target.chatId, notice)
        return
      }

      case 'run': {
        if (message.kind !== 'text') return
        if (deps.onRun !== undefined) {
          deps.onRun(message, decision.tier)
          return
        }
        // Fire and forget: the poll loop must not wait on agent runs.
        void runner!.enqueue(message.chatId, message.text, decision.tier)
        return
      }
    }
  }

  async function runLoop(signal?: AbortSignal): Promise<void> {
    const updates = pollUpdates(
      deps.api,
      {
        offset: deps.store.data.offset,
        saveOffset: (offset) =>
          deps.store.update((data) => {
            data.offset = offset
          }),
        onError: (error) => log(`poll error: ${String(error)}`),
        ...deps.poller,
      },
      signal,
    )
    for await (const update of updates) {
      await handleUpdate(update)
    }
  }

  return { bootstrap, handleUpdate, runLoop }
}
