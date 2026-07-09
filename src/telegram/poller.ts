import { defaultSleep, type Sleep, type TelegramApi } from './api.ts'
import type { IncomingMessage, Update } from './types.ts'

export interface PollerOptions {
  // Long-poll hold time asked of Telegram, in seconds.
  pollTimeoutSeconds?: number
  // Resume point: the offset persisted by a previous run.
  offset?: number
  // Called with the next offset as soon as an update is handed out,
  // so a crash never re-delivers what was already consumed.
  saveOffset?: (offset: number) => void | Promise<void>
  onError?: (error: unknown) => void
  // Backoff after a failed getUpdates before polling again.
  errorDelayMs?: number
  sleep?: Sleep
}

export async function* pollUpdates(
  api: TelegramApi,
  options: PollerOptions = {},
  signal?: AbortSignal,
): AsyncGenerator<Update, void> {
  const sleep = options.sleep ?? defaultSleep
  let offset = options.offset

  while (!signal?.aborted) {
    let updates: Update[]
    try {
      updates = await api.call<Update[]>(
        'getUpdates',
        {
          offset,
          timeout: options.pollTimeoutSeconds ?? 50,
          allowed_updates: ['message', 'callback_query'],
        },
        signal,
      )
    } catch (error) {
      if (signal?.aborted) return
      options.onError?.(error)
      await sleep(options.errorDelayMs ?? 1000)
      continue
    }
    for (const update of updates) {
      offset = update.update_id + 1
      await options.saveOffset?.(offset)
      yield update
    }
  }
}

// Raw Update -> the one shape the rest of the bridge understands.
// Returns undefined for update kinds this bridge does not handle.
export function normalizeUpdate(update: Update): IncomingMessage | undefined {
  const message = update.message
  if (message?.text !== undefined && message.from !== undefined) {
    return {
      kind: 'text',
      chatId: message.chat.id,
      userId: message.from.id,
      messageId: message.message_id,
      text: message.text,
    }
  }
  const callback = update.callback_query
  if (callback?.message !== undefined) {
    return {
      kind: 'callback',
      chatId: callback.message.chat.id,
      userId: callback.from.id,
      messageId: callback.message.message_id,
      callbackId: callback.id,
      callbackData: callback.data,
    }
  }
  return undefined
}
