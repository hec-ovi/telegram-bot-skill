// Newline-delimited JSON-RPC 2.0 over stdio: the MCP wire format for stdio
// transports. Zero dependencies, hand-rolled like the rest of the repo; the
// server side of MCP is small enough that the SDK would be the only package
// in an otherwise empty tree.
//
// Covers what an MCP tool server needs: request dispatch, notifications in
// both directions, per-request cancellation (notifications/cancelled), and
// progress ticks for callers that sent a progressToken.

import { createInterface } from 'node:readline'
import type { Readable, Writable } from 'node:stream'

interface RpcMessage {
  jsonrpc?: string
  id?: number | string | null
  method?: string
  params?: any
  result?: unknown
  error?: unknown
}

export interface RequestContext {
  // Aborts when the client cancels this request; a cancelled request must
  // not be answered, which the dispatcher enforces on its own.
  signal: AbortSignal
  // Emits notifications/progress if the caller asked for it, else a no-op.
  progress: (message: string, value: number) => void
}

export type RequestHandler = (params: any, context: RequestContext) => unknown

export const RPC_ERROR = {
  parse: -32700,
  methodNotFound: -32601,
  invalidParams: -32602,
  internal: -32603,
} as const

// Handlers can throw this to pick the JSON-RPC error code; anything else
// thrown becomes an internal error with the thrown message.
export class RpcError extends Error {
  readonly code: number

  constructor(code: number, message: string) {
    super(message)
    this.name = 'RpcError'
    this.code = code
  }
}

export class RpcConnection {
  #output: Writable
  #handlers = new Map<string, RequestHandler>()
  #notifications = new Map<string, (params: any) => void>()
  #inflight = new Map<number | string, AbortController>()
  #log: (line: string) => void

  constructor(input: Readable, output: Writable, log: (line: string) => void = () => {}) {
    this.#output = output
    this.#log = log
    const lines = createInterface({ input, crlfDelay: Infinity })
    lines.on('line', (line) => this.#receive(line))
  }

  onRequest(method: string, handler: RequestHandler): void {
    this.#handlers.set(method, handler)
  }

  onNotification(method: string, handler: (params: any) => void): void {
    this.#notifications.set(method, handler)
  }

  notify(method: string, params?: unknown): void {
    this.#write({ jsonrpc: '2.0', method, params })
  }

  #receive(line: string): void {
    if (line.trim().length === 0) return
    let message: RpcMessage
    try {
      message = JSON.parse(line)
    } catch {
      this.#write({
        jsonrpc: '2.0',
        id: null,
        error: { code: RPC_ERROR.parse, message: 'parse error' },
      })
      return
    }
    void this.#dispatch(message)
  }

  async #dispatch(message: RpcMessage): Promise<void> {
    // A response to a server-initiated request: this server never sends
    // requests (only notifications), so there is nothing to match it to.
    if (message.method === undefined) return

    if (message.id === undefined || message.id === null) {
      if (message.method === 'notifications/cancelled') {
        const id = message.params?.requestId
        this.#inflight.get(id)?.abort()
        return
      }
      this.#notifications.get(message.method)?.(message.params)
      return
    }

    const id = message.id
    const handler = this.#handlers.get(message.method)
    if (handler === undefined) {
      this.#write({
        jsonrpc: '2.0',
        id,
        error: { code: RPC_ERROR.methodNotFound, message: `method not found: ${message.method}` },
      })
      return
    }

    const controller = new AbortController()
    this.#inflight.set(id, controller)
    const progressToken = message.params?._meta?.progressToken
    const context: RequestContext = {
      signal: controller.signal,
      progress:
        progressToken === undefined
          ? () => {}
          : (text, value) =>
              this.notify('notifications/progress', {
                progressToken,
                progress: value,
                message: text,
              }),
    }
    try {
      const result = await handler(message.params, context)
      // The spec forbids answering a cancelled request.
      if (!controller.signal.aborted) this.#write({ jsonrpc: '2.0', id, result })
    } catch (error) {
      this.#log(`request ${String(message.method)} failed: ${String(error)}`)
      if (!controller.signal.aborted) {
        const code = error instanceof RpcError ? error.code : RPC_ERROR.internal
        this.#write({
          jsonrpc: '2.0',
          id,
          error: { code, message: error instanceof Error ? error.message : String(error) },
        })
      }
    } finally {
      this.#inflight.delete(id)
    }
  }

  #write(message: object): void {
    this.#output.write(JSON.stringify(message) + '\n')
  }
}
