import type {
  AnswerCallbackQueryParams,
  ApiResponse,
  EditMessageTextParams,
  ChatAction,
  Message,
  SendMessageParams,
  SetMessageReactionParams,
  User,
} from './types.ts'

export type Sleep = (ms: number) => Promise<void>

export const defaultSleep: Sleep = (ms) =>
  new Promise((resolve) => setTimeout(resolve, ms))

export interface TelegramApiOptions {
  baseUrl?: string
  sleep?: Sleep
  maxRetries?: number
}

export class TelegramError extends Error {
  readonly code: number

  constructor(code: number, description: string) {
    super(`Telegram API error ${code}: ${description}`)
    this.name = 'TelegramError'
    this.code = code
  }
}

export class TelegramApi {
  readonly #token: string
  readonly #baseUrl: string
  readonly #sleep: Sleep
  readonly #maxRetries: number

  constructor(token: string, options: TelegramApiOptions = {}) {
    this.#token = token
    this.#baseUrl = options.baseUrl ?? 'https://api.telegram.org'
    this.#sleep = options.sleep ?? defaultSleep
    this.#maxRetries = options.maxRetries ?? 3
  }

  // Single entry point for every Bot API method. Waits out 429 flood
  // control (retry_after) up to maxRetries times before giving up.
  async call<T>(method: string, params?: object, signal?: AbortSignal): Promise<T> {
    for (let attempt = 0; ; attempt++) {
      const response = await fetch(`${this.#baseUrl}/bot${this.#token}/${method}`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify(params ?? {}),
        signal,
      })
      const body = (await response.json()) as ApiResponse<T>
      if (body.ok) return body.result
      const retryAfter = body.parameters?.retry_after
      if (body.error_code === 429 && retryAfter !== undefined && attempt < this.#maxRetries) {
        await this.#sleep(retryAfter * 1000)
        continue
      }
      throw new TelegramError(body.error_code, body.description)
    }
  }

  getMe(): Promise<User> {
    return this.call<User>('getMe')
  }

  sendMessage(params: SendMessageParams): Promise<Message> {
    return this.call<Message>('sendMessage', params)
  }

  editMessageText(params: EditMessageTextParams): Promise<Message> {
    return this.call<Message>('editMessageText', params)
  }

  sendChatAction(chatId: number, action: ChatAction): Promise<boolean> {
    return this.call<boolean>('sendChatAction', { chat_id: chatId, action })
  }

  answerCallbackQuery(params: AnswerCallbackQueryParams): Promise<boolean> {
    return this.call<boolean>('answerCallbackQuery', params)
  }

  setMessageReaction(params: SetMessageReactionParams): Promise<boolean> {
    return this.call<boolean>('setMessageReaction', params)
  }
}
