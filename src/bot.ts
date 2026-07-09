// Executable entry: env in, running bot out.
//   TELEGRAM_BOT_TOKEN  required, from @BotFather
//   STATE_FILE          optional, default ./bot-state.json
//   AGENT_CWD           optional, directory the agent works in
//   AGENT_ADAPTER       optional: claude-code (default) | pi
//   PI_MODEL            optional, pi model ref, e.g. local/gemma-4-26b
//   PI_SESSION_DIR      optional, where pi session files live

import { dirname, join, resolve } from 'node:path'
import { ClaudeCodeAdapter } from './agents/claude-code/adapter.ts'
import type { AgentAdapter } from './agents/contract.ts'
import { PiAdapter } from './agents/pi/adapter.ts'
import { createBot } from './app.ts'
import { FileStore } from './store/store.ts'
import { TelegramApi } from './telegram/api.ts'

const token = process.env.TELEGRAM_BOT_TOKEN
if (token === undefined || token.length === 0) {
  console.error('Set TELEGRAM_BOT_TOKEN (create a bot with @BotFather) and run again.')
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

const store = await FileStore.open(stateFile)
const bot = createBot({
  api: new TelegramApi(token),
  store,
  adapter,
  cwd: process.env.AGENT_CWD ?? process.cwd(),
  log: console.log,
})

await bot.bootstrap()
await bot.runLoop()
