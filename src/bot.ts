// Executable entry: env in, running bot out.
//   TELEGRAM_BOT_TOKEN  required, from @BotFather
//   STATE_FILE          optional, default ./bot-state.json
//   AGENT_CWD           optional, directory the agent works in
//   AGENT_ADAPTER       optional: claude-code (default) | pi
//   PI_MODEL            optional, pi model ref, e.g. local/gemma-4-26b
//   PI_SESSION_DIR      optional, where pi session files live
//   OWNER_ID            optional, numeric Telegram id seeded as owner (recover mode)
//   TRUSTED_IDS         optional, comma-separated ids seeded as trusted
//   GUEST_IDS           optional, comma-separated ids seeded as guest
//   BLOCKED_IDS         optional, comma-separated ids seeded as blocked

import { dirname, join, resolve } from 'node:path'
import { ClaudeCodeAdapter } from './agents/claude-code/adapter.ts'
import type { AgentAdapter } from './agents/contract.ts'
import { PiAdapter } from './agents/pi/adapter.ts'
import { createBot, type SeedUsers } from './app.ts'
import { loadEnvConfig } from './config.ts'
import { FileStore } from './store/store.ts'
import { TelegramApi } from './telegram/api.ts'

const envFile = loadEnvConfig()
if (envFile !== undefined) console.log(`config loaded from ${envFile}`)

const token = process.env.TELEGRAM_BOT_TOKEN
if (token === undefined || token.length === 0) {
  console.error('Not configured yet. Run `npm run setup` once (it saves ./.env), or set TELEGRAM_BOT_TOKEN.')
  process.exit(1)
}

const stateFile = resolve(process.env.STATE_FILE ?? 'bot-state.json')
const adapterName = process.env.AGENT_ADAPTER ?? 'claude-code'
let adapter: AgentAdapter
if (adapterName === 'claude-code') {
  adapter = new ClaudeCodeAdapter()
} else if (adapterName === 'pi') {
  adapter = new PiAdapter({
    model: process.env.PI_MODEL,
    sessionDir: process.env.PI_SESSION_DIR ?? join(dirname(stateFile), 'pi-sessions'),
  })
} else {
  console.error(`Unknown AGENT_ADAPTER "${adapterName}". Use claude-code or pi.`)
  process.exit(1)
}

function parseIds(value: string | undefined): number[] | undefined {
  if (value === undefined || value.trim().length === 0) return undefined
  const ids = value
    .split(/[\s,]+/)
    .filter((part) => part.length > 0)
    .map(Number)
    .filter(Number.isFinite)
  return ids.length > 0 ? ids : undefined
}

const ownerId = parseIds(process.env.OWNER_ID)?.[0]
const seed: SeedUsers = {
  ownerId,
  trusted: parseIds(process.env.TRUSTED_IDS),
  guest: parseIds(process.env.GUEST_IDS),
  blocked: parseIds(process.env.BLOCKED_IDS),
}
const hasSeed = Object.values(seed).some((value) => value !== undefined)

const store = await FileStore.open(stateFile)
const apiBase = process.env.TELEGRAM_API_BASE
const bot = createBot({
  api: new TelegramApi(token, apiBase !== undefined ? { baseUrl: apiBase } : {}),
  store,
  adapter,
  cwd: process.env.AGENT_CWD ?? process.cwd(),
  seed: hasSeed ? seed : undefined,
  log: console.log,
})

await bot.bootstrap()
await bot.runLoop()
