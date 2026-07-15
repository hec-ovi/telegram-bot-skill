// Streamable HTTP binding for the MCP tool server: JSON-RPC over POST, one
// message per request, plain application/json responses, stateless (no
// session header, nothing to expire). This is the transport for clients that
// connect to a URL instead of spawning a child: start the server once on the
// host, then point any MCP-capable CLI at http://127.0.0.1:<port>/mcp.
//
// Deliberately minimal against the spec: no GET stream (servers MAY answer
// 405; server-initiated notifications have no one to go to here), and no
// batching (removed from the spec in 2025-06-18). Binds 127.0.0.1 only; this
// is a private bot bridge, never a LAN service.

import { createServer } from 'node:http'
import { RPC_ERROR, type RpcRouter } from './rpc.ts'

const MAX_BODY_BYTES = 4 * 1024 * 1024

export interface HttpBinding {
  port: number
  close: () => void
}

export function serveHttp(
  router: RpcRouter,
  port: number,
  log: (line: string) => void,
): Promise<HttpBinding> {
  const server = createServer((req, res) => {
    if (req.method !== 'POST') {
      res.writeHead(405, { allow: 'POST', 'content-type': 'text/plain' })
      res.end('POST one JSON-RPC message per request; this server offers no GET stream\n')
      return
    }
    let body = ''
    let overflow = false
    req.on('data', (chunk) => {
      body += chunk
      if (body.length > MAX_BODY_BYTES) {
        overflow = true
        res.writeHead(413).end()
        req.destroy()
      }
    })
    req.on('end', () => {
      if (overflow) return
      let message: any
      try {
        message = JSON.parse(body)
      } catch {
        res.writeHead(400, { 'content-type': 'application/json' })
        res.end(
          JSON.stringify({
            jsonrpc: '2.0',
            id: null,
            error: { code: RPC_ERROR.parse, message: 'parse error' },
          }),
        )
        return
      }
      if (Array.isArray(message)) {
        res.writeHead(400, { 'content-type': 'application/json' })
        res.end(
          JSON.stringify({
            jsonrpc: '2.0',
            id: null,
            error: {
              code: RPC_ERROR.invalidParams,
              message: 'batching was removed from the MCP spec; send one message per POST',
            },
          }),
        )
        return
      }
      const expectsResponse =
        message?.method !== undefined && message?.id !== undefined && message?.id !== null
      if (!expectsResponse) {
        // A notification (initialized, cancelled) or a stray response:
        // accepted, nothing to answer.
        void router.dispatch(message, () => {})
        res.writeHead(202).end()
        return
      }
      void router.dispatch(message, (response) => {
        res.writeHead(200, { 'content-type': 'application/json' })
        res.end(JSON.stringify(response))
      })
    })
  })
  // A wait_for_message can legitimately hold its POST open for minutes.
  server.requestTimeout = 0
  return new Promise((resolvePromise, reject) => {
    server.once('error', reject)
    server.listen(port, '127.0.0.1', () => {
      const address = server.address()
      const bound = typeof address === 'object' && address !== null ? address.port : port
      log(`mcp over http: POST http://127.0.0.1:${bound}/mcp (one JSON-RPC message per request)`)
      resolvePromise({ port: bound, close: () => server.close() })
    })
  })
}
