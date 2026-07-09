// Wires every module into a working bot: poll, normalize, gate, act.
// Kept free of process/env concerns so tests can drive it end to end;
// bot.ts is the thin executable wrapper.

import { randomBytes } from 'node:crypto'
import type { AgentAdapter } from './agents/contract.ts'
import { decide } from './gate/gate.ts'
import type { PresenceOptions } from './presence/presence.ts'
import { Runner } from './runner/runner.ts'
import type { FileStore, UserRecord } from './store/store.ts'
import type { TelegramApi } from './telegram/api.ts'
import { normalizeUpdate, pollUpdates, type PollerOptions } from './telegram/poller.ts'
import type { IncomingMessage, Update } from './telegram/types.ts'

export interface BotDeps {
  api: TelegramApi
  store: FileStore
  adapter: AgentAdapter
  cwd: string
  log?: (line: string) => void
  presence?: PresenceOptions
  poller?: PollerOptions
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
  const runner = new Runner({
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

  const nameOf = (message: IncomingMessage): string | undefined =>
    message.kind === 'text' ? message.name : undefined

  async function bootstrap(): Promise<void> {
    const me = await deps.api.getMe()
    if (findOwner() === undefined) {
      if (deps.store.data.claimCode === undefined) {
        await deps.store.update((data) => {
          data.claimCode = randomBytes(9).toString('base64url')
        })
      }
      log(`no owner yet. claim the bot (first tap wins):`)
      log(`https://t.me/${me.username}?start=${deps.store.data.claimCode}`)
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
        const owner = findOwner()
        if (owner !== undefined) {
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
        // Fire and forget: the poll loop must not wait on agent runs.
        void runner.enqueue(message.chatId, message.text, decision.tier)
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
