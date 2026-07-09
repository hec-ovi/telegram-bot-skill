// In-process fake of api.telegram.org for tests: a real node:http server
// speaking the Bot API wire format, with scriptable one-shot responses
// and long-poll holds that resolve when an update is pushed.

import { createServer, type Server, type ServerResponse } from 'node:http'
import type { AddressInfo } from 'node:net'
import type { Update } from './types.ts'

export interface RecordedCall {
  method: string
  params: any
}

export interface FakeResponse {
  status?: number
  body: unknown
}

export class FakeBotApi {
  readonly token = 'TEST_TOKEN'
  readonly calls: RecordedCall[] = []
  baseUrl = ''

  #server: Server | undefined
  #updates: Update[] = []
  #nextUpdateId = 1
  #nextMessageId = 100
  #overrides = new Map<string, FakeResponse[]>()
  #waiters: Array<() => void> = []

  async start(): Promise<void> {
    this.#server = createServer((request, response) => {
      void this.#handle(request, response)
    })
    await new Promise<void>((resolve) => this.#server!.listen(0, '127.0.0.1', resolve))
    const address = this.#server!.address() as AddressInfo
    this.baseUrl = `http://127.0.0.1:${address.port}`
  }

  async stop(): Promise<void> {
    for (const wake of this.#waiters.splice(0)) wake()
    this.#server?.closeAllConnections()
    await new Promise<void>((resolve, reject) => {
      this.#server?.close((error) => (error ? reject(error) : resolve()))
    })
  }

  // Queue a scripted response for the next call to `method`.
  respondOnceWith(method: string, response: FakeResponse): void {
    const queue = this.#overrides.get(method) ?? []
    queue.push(response)
    this.#overrides.set(method, queue)
  }

  pushTextMessage(input: { chatId: number; userId: number; text: string }): Update {
    return this.#push({
      message: {
        message_id: this.#nextMessageId++,
        date: 1,
        chat: { id: input.chatId, type: 'private' },
        from: { id: input.userId, is_bot: false, first_name: 'user' },
        text: input.text,
      },
    })
  }

  pushCallbackQuery(input: { chatId: number; userId: number; data: string }): Update {
    return this.#push({
      callback_query: {
        id: `cb${this.#nextUpdateId}`,
        from: { id: input.userId, is_bot: false, first_name: 'user' },
        message: {
          message_id: this.#nextMessageId++,
          date: 1,
          chat: { id: input.chatId, type: 'private' },
        },
        data: input.data,
      },
    })
  }

  callsFor(method: string): RecordedCall[] {
    return this.calls.filter((call) => call.method === method)
  }

  #push(partial: Omit<Update, 'update_id'>): Update {
    const update: Update = { update_id: this.#nextUpdateId++, ...partial }
    this.#updates.push(update)
    for (const wake of this.#waiters.splice(0)) wake()
    return update
  }

  async #handle(request: import('node:http').IncomingMessage, response: ServerResponse): Promise<void> {
    const match = (request.url ?? '').match(/^\/bot[^/]+\/(.+)$/)
    if (!match) {
      this.#respond(response, 404, { ok: false, error_code: 404, description: 'Not Found' })
      return
    }
    const method = match[1]
    const chunks: Buffer[] = []
    for await (const chunk of request) chunks.push(chunk as Buffer)
    const raw = Buffer.concat(chunks).toString()
    const params = raw.length > 0 ? JSON.parse(raw) : {}
    this.calls.push({ method, params })

    const override = this.#overrides.get(method)?.shift()
    if (override) {
      this.#respond(response, override.status ?? 200, override.body)
      return
    }
    const result = await this.#defaultResult(method, params)
    this.#respond(response, 200, { ok: true, result })
  }

  async #defaultResult(method: string, params: any): Promise<unknown> {
    if (method === 'getUpdates') {
      const matching = () =>
        this.#updates.filter(
          (update) => params.offset === undefined || update.update_id >= params.offset,
        )
      let result = matching()
      const timeoutSeconds: number = params.timeout ?? 0
      if (result.length === 0 && timeoutSeconds > 0) {
        await new Promise<void>((resolve) => {
          const timer = setTimeout(resolve, timeoutSeconds * 1000)
          timer.unref()
          this.#waiters.push(() => {
            clearTimeout(timer)
            resolve()
          })
        })
        result = matching()
      }
      return result
    }
    if (method === 'sendMessage') {
      return {
        message_id: this.#nextMessageId++,
        date: 1,
        chat: { id: params.chat_id, type: 'private' },
        text: params.text,
      }
    }
    if (method === 'getMe') {
      return { id: 1, is_bot: true, first_name: 'fake', username: 'fake_bot' }
    }
    return true
  }

  #respond(response: ServerResponse, status: number, body: unknown): void {
    response.writeHead(status, { 'content-type': 'application/json' })
    response.end(JSON.stringify(body))
  }
}
