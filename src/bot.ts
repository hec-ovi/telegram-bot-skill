// Executable entry: env in, running bot out.
//   TELEGRAM_BOT_TOKEN  required, from @BotFather
//   STATE_FILE          optional, default ./bot-state.json
//   AGENT_CWD           optional, directory the agent works in

import { ClaudeCodeAdapter } from './agents/claude-code/adapter.ts'
import { createBot } from './app.ts'
import { FileStore } from './store/store.ts'
import { TelegramApi } from './telegram/api.ts'

const token = process.env.TELEGRAM_BOT_TOKEN
if (token === undefined || token.length === 0) {
  console.error('Set TELEGRAM_BOT_TOKEN (create a bot with @BotFather) and run again.')
  process.exit(1)
}

const store = await FileStore.open(process.env.STATE_FILE ?? 'bot-state.json')
const bot = createBot({
  api: new TelegramApi(token),
  store,
  adapter: new ClaudeCodeAdapter(),
  cwd: process.env.AGENT_CWD ?? process.cwd(),
  log: console.log,
})

await bot.bootstrap()
await bot.runLoop()
