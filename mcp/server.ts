// MCP surface: the same private-bot bridge, but the agent that answers is
// the MCP client itself (the session connected to this server) instead of a
// CLI spawned per message. Every log line goes to stderr.
//
// Two transports:
//   default       stdio: the client spawns this process (`node mcp/server.ts`,
//                 wired by the shipped .mcp.json); stdout is the JSON-RPC wire.
//   --http [port] Streamable HTTP on 127.0.0.1 (default port 8765): start it
//                 once on the host, then point any MCP client at
//                 http://127.0.0.1:<port>/mcp. For CLIs that cannot spawn a
//                 node child (noob's sandbox has no node, for example).
//
// Two duplex modes:
//   default      pull: the agent calls wait_for_message in a loop; messages
//                that arrive while it works are queued, nothing is lost.
//   --channel    push (stdio only): Claude Code channels (research preview,
//                v2.1.80+) inject approved messages straight into the
//                session. Start the client with:
//                  claude --dangerously-load-development-channels server:telegram
//
// Env is identical to `npm start` (reads ./.env): TELEGRAM_BOT_TOKEN,
// STATE_FILE, TELEGRAM_API_BASE, OWNER_ID / TRUSTED_IDS / GUEST_IDS /
// BLOCKED_IDS. State is shared with the bridge, one whitelist everywhere.

import { dirname, isAbsolute, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import type { SeedUsers } from '../src/app.ts'
import { loadEnvConfig, parseIds } from '../src/config.ts'
import { FileStore } from '../src/store/store.ts'
import { TelegramApi } from '../src/telegram/api.ts'
import { TelegramBridge, type BridgeMessage } from './bridge.ts'
import { serveHttp } from './http.ts'
import { RPC_ERROR, RpcError, RpcRouter, bindStdio, type RequestContext } from './rpc.ts'

const log = (line: string) => process.stderr.write(`[telegram-mcp] ${line}\n`)

const repoRoot = resolve(dirname(fileURLToPath(import.meta.url)), '..')
loadEnvConfig(repoRoot)

const token = process.env.TELEGRAM_BOT_TOKEN
if (token === undefined || token.length === 0) {
  log('TELEGRAM_BOT_TOKEN is not set. Run `npm run setup` once in the repo, or set the env var.')
  process.exit(1)
}

const channelMode = process.argv.includes('--channel')
const httpFlagAt = process.argv.indexOf('--http')
const httpMode = httpFlagAt !== -1
const httpPortArg = httpMode ? (process.argv[httpFlagAt + 1] ?? '8765') : ''
const httpPort = httpMode ? Number(httpPortArg) : 0
if (httpMode && channelMode) {
  log('--http and --channel are exclusive: channel pushes ride the stdio connection of the client that spawned this server.')
  process.exit(1)
}
if (httpMode && (!Number.isInteger(httpPort) || httpPort < 0 || httpPort > 65535)) {
  log(`--http needs a port between 0 and 65535, got ${JSON.stringify(httpPortArg)}.`)
  process.exit(1)
}

const stateFileEnv = process.env.STATE_FILE ?? 'bot-state.json'
const stateFile = isAbsolute(stateFileEnv) ? stateFileEnv : join(repoRoot, stateFileEnv)

const ownerId = parseIds(process.env.OWNER_ID)?.[0]
const seed: SeedUsers = {
  ownerId,
  trusted: parseIds(process.env.TRUSTED_IDS),
  guest: parseIds(process.env.GUEST_IDS),
  blocked: parseIds(process.env.BLOCKED_IDS),
}
const hasSeed = Object.values(seed).some((value) => value !== undefined)

const apiBase = process.env.TELEGRAM_API_BASE
const store = await FileStore.open(stateFile)
const bridge = new TelegramBridge({
  api: new TelegramApi(token, apiBase !== undefined ? { baseUrl: apiBase } : {}),
  store,
  seed: hasSeed ? seed : undefined,
  log,
})

// ---------------------------------------------------------------- tools --

interface Tool {
  name: string
  description: string
  inputSchema: object
}

// Over HTTP the wait holds a plain POST open, and HTTP clients commonly cap a
// call at 30 s (noob's default), so the default wait stays safely under that.
// Over stdio the shipped .mcp.json grants 10 minutes.
const DEFAULT_WAIT_SECONDS = httpMode ? 25 : 50

const WAIT_TOOL: Tool = {
  name: 'wait_for_message',
  description:
    'Block until the next approved Telegram message arrives, then return it. ' +
    'Serve loop: handle the returned message, answer with send_message to the same chat_id, ' +
    'then call wait_for_message again. A timed_out result is not an error; call again to keep ' +
    'listening. Messages that arrive while you are busy are queued, none are lost. Unknown ' +
    'senders never reach you: the gate holds them for owner approval in Telegram.',
  inputSchema: {
    type: 'object',
    properties: {
      timeout_seconds: {
        type: 'number',
        minimum: 1,
        maximum: 3600,
        description: httpMode
          ? `Seconds to wait before returning timed_out. Default ${DEFAULT_WAIT_SECONDS}; keep it ` +
            'under your client\'s per-call timeout (a held POST that outlives it reads as a dead call).'
          : `Seconds to wait before returning timed_out. Default ${DEFAULT_WAIT_SECONDS}, safe with any client. ` +
            'This repo ships .mcp.json with a 10-minute client timeout, so up to ~590 works here.',
      },
    },
    required: [],
  },
}

const SEND_TOOL: Tool = {
  name: 'send_message',
  description:
    'Send a text message to a Telegram chat, normally the chat_id of the message being ' +
    'answered. Long text is split under the 4096-char Telegram limit automatically.',
  inputSchema: {
    type: 'object',
    properties: {
      chat_id: { type: 'number', description: 'Target chat, from the incoming message' },
      text: { type: 'string', description: 'Plain text to send' },
    },
    required: ['chat_id', 'text'],
  },
}

const LIST_USERS_TOOL: Tool = {
  name: 'list_users',
  description: 'List every known Telegram user and their access tier (owner, trusted, guest, blocked, pending).',
  inputSchema: { type: 'object', properties: {}, required: [] },
}

const SET_TIER_TOOL: Tool = {
  name: 'set_user_tier',
  description:
    'Set a Telegram user to trusted, guest, or blocked; the same power as the owner approval ' +
    'buttons. The user is notified. The owner tier cannot be granted or changed from here.',
  inputSchema: {
    type: 'object',
    properties: {
      user_id: { type: 'number', description: 'Numeric Telegram user id' },
      tier: { type: 'string', enum: ['trusted', 'guest', 'blocked'] },
    },
    required: ['user_id', 'tier'],
  },
}

const STATUS_TOOL: Tool = {
  name: 'bridge_status',
  description:
    'Bridge health: bot username, owner claim state (with claim link while unclaimed), known ' +
    'users, queued message count, and the last Telegram polling error if any.',
  inputSchema: { type: 'object', properties: {}, required: [] },
}

// In channel mode messages arrive on their own, so the wait tool is not
// offered; everything else is mode-independent.
const tools: Tool[] = channelMode
  ? [SEND_TOOL, LIST_USERS_TOOL, SET_TIER_TOOL, STATUS_TOOL]
  : [WAIT_TOOL, SEND_TOOL, LIST_USERS_TOOL, SET_TIER_TOOL, STATUS_TOOL]

const instructions = channelMode
  ? 'This server is a private Telegram bot bridge. Messages from approved users arrive as ' +
    '<channel source="telegram" chat_id="..." user_id="..." tier="...."> events. Do what the ' +
    'message asks, then answer with the send_message tool using the chat_id from the event. ' +
    'The sender only sees what you send through send_message, never your terminal output.'
  : 'This server is a private Telegram bot bridge. Approved users message the bot and expect ' +
    'you to answer. To serve them: call wait_for_message; when it returns a message, do what ' +
    'it asks, answer with send_message to the same chat_id, then call wait_for_message again. ' +
    'On timed_out, call wait_for_message again unless the user asked you to stop serving.'

// ------------------------------------------------------------ rpc wiring --

const toolText = (value: unknown) => ({
  content: [{ type: 'text', text: JSON.stringify(value, null, 2) }],
})
const toolError = (message: string) => ({
  content: [{ type: 'text', text: message }],
  isError: true,
})

const DATE_VERSION = /^\d{4}-\d{2}-\d{2}$/

const rpc = new RpcRouter(log)

rpc.onRequest('initialize', (params) => {
  // Tools-only servers are compatible across every spec revision to date,
  // so accept whatever date the client asks for and fall back otherwise.
  const requested = params?.protocolVersion
  const version = typeof requested === 'string' && DATE_VERSION.test(requested) ? requested : '2025-06-18'
  log(
    `initialize from ${JSON.stringify(params?.clientInfo ?? 'unknown client')}, ` +
      `client capabilities: ${JSON.stringify(params?.capabilities ?? {})}`,
  )
  return {
    protocolVersion: version,
    capabilities: {
      tools: { listChanged: false },
      ...(channelMode ? { experimental: { 'claude/channel': {} } } : {}),
    },
    serverInfo: { name: 'telegram-bot-skill', version: '0.1.0' },
    instructions,
  }
})

// Claude Code registers its channel listener shortly after the MCP
// handshake (later still on the first-ever consent dialog). Notifications
// sent before that are dropped silently, so the queue flush waits a beat.
// Verified live: an instant flush loses the message, a delayed one lands.
const CHANNEL_FLUSH_GRACE_MS = 5000

rpc.onNotification('notifications/initialized', () => {
  log(`client ready (${channelMode ? 'channel' : 'poll'} mode)`)
  if (channelMode) {
    // From here on messages push straight into the session; anything that
    // arrived during the handshake flushes out first, in order.
    setTimeout(() => {
      bridge.setSink((message) => {
        rpc.notify('notifications/claude/channel', {
          content: message.text,
          meta: {
            chat_id: String(message.chat_id),
            user_id: String(message.user_id),
            tier: message.tier,
            ...(message.name !== undefined ? { user_name: message.name } : {}),
          },
        })
      })
    }, CHANNEL_FLUSH_GRACE_MS).unref()
  }
})

rpc.onRequest('ping', () => ({}))
rpc.onRequest('tools/list', () => ({ tools }))

async function waitForMessage(args: any, context: RequestContext) {
  const requested =
    typeof args?.timeout_seconds === 'number' ? args.timeout_seconds : DEFAULT_WAIT_SECONDS
  const timeoutSeconds = Math.min(Math.max(requested, 1), 3600)
  const startedAt = Date.now()
  // Progress ticks keep the client's idle watchdog quiet on long waits.
  const ticker = setInterval(
    () => context.progress('waiting for a telegram message', Math.round((Date.now() - startedAt) / 1000)),
    10_000,
  )
  ticker.unref()
  try {
    const message = await bridge.waitForMessage(timeoutSeconds * 1000, context.signal)
    if (message === undefined) {
      return toolText({ timed_out: true, waited_seconds: timeoutSeconds })
    }
    return toolText(message)
  } finally {
    clearInterval(ticker)
  }
}

rpc.onRequest('tools/call', async (params, context) => {
  const name = params?.name
  const args = params?.arguments ?? {}
  const known = tools.some((tool) => tool.name === name)
  if (!known) throw new RpcError(RPC_ERROR.invalidParams, `unknown tool: ${String(name)}`)

  try {
    switch (name) {
      case 'wait_for_message':
        return await waitForMessage(args, context)

      case 'send_message': {
        if (typeof args.chat_id !== 'number' || typeof args.text !== 'string' || args.text.length === 0) {
          return toolError('send_message needs chat_id (number) and text (non-empty string)')
        }
        const sent = await bridge.sendText(args.chat_id, args.text)
        return toolText({ sent_chunks: sent })
      }

      case 'list_users':
        return toolText(bridge.listUsers())

      case 'set_user_tier': {
        if (
          typeof args.user_id !== 'number' ||
          !['trusted', 'guest', 'blocked'].includes(args.tier)
        ) {
          return toolError('set_user_tier needs user_id (number) and tier (trusted | guest | blocked)')
        }
        await bridge.setUserTier(args.user_id, args.tier)
        return toolText({ user_id: args.user_id, tier: args.tier })
      }

      case 'bridge_status':
        return toolText(bridge.status())
    }
  } catch (error) {
    // Execution failures go back as tool results so the model can react;
    // only protocol misuse (unknown tool) is a JSON-RPC error.
    return toolError(error instanceof Error ? error.message : String(error))
  }
})

// -------------------------------------------------------------- lifetime --

const shutdown = () => {
  bridge.stop()
  process.exit(0)
}
process.on('SIGINT', shutdown)
process.on('SIGTERM', shutdown)

if (httpMode) {
  // A URL-connected server outlives any one client; only signals stop it.
  await serveHttp(rpc, httpPort, log)
} else {
  bindStdio(rpc, process.stdin, process.stdout)
  // The spawning client owns this process: its stdin closing is the shutdown.
  process.stdin.on('close', shutdown)
}

// The handshake must not wait on Telegram, so the bridge boots in the
// background; bridge_status reports any startup trouble.
void bridge.start()
log(`serving (${channelMode ? 'channel' : 'poll'} mode), state: ${stateFile}`)
