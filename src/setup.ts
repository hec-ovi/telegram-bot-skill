// One-shot setup: validate the bot token and save the bridge config to
// ./.env (mode 600, gitignored) so that from then on a plain `npm start`
// boots fully configured. Non-interactive when TELEGRAM_BOT_TOKEN is set;
// otherwise asks on the terminal.
//
//   TELEGRAM_BOT_TOKEN=123:AAE... npm run setup
//   npm run setup                      (prompts for the token)

import { chmodSync, writeFileSync } from 'node:fs'
import { createInterface } from 'node:readline/promises'
import { loadEnvConfig } from './config.ts'
import { TelegramApi } from './telegram/api.ts'

// A half-filled .env (e.g. the human pasted the token into the template
// themselves) is picked up here, validated, and completed.
loadEnvConfig()

let token = process.env.TELEGRAM_BOT_TOKEN
if (token === undefined || token.trim().length === 0) {
  const readline = createInterface({ input: process.stdin, output: process.stdout })
  token = (await readline.question('Paste your bot token from @BotFather: ')).trim()
  readline.close()
}
if (token === undefined || token.length === 0) {
  console.error('No token provided. Get one from @BotFather and run setup again.')
  process.exit(1)
}

const baseUrl = process.env.TELEGRAM_API_BASE
const api = new TelegramApi(token, baseUrl !== undefined ? { baseUrl } : {})

let username: string
try {
  const me = await api.getMe()
  username = me.username ?? String(me.id)
} catch (error) {
  console.error(`Token check against Telegram failed: ${String(error)}`)
  process.exit(1)
}

// Optional identity: display name and descriptions are the only things the
// Bot API lets a bot change about itself (avatar and username are not).
const identity: Array<[string, string, (value: string) => Promise<boolean>]> = [
  ['BOT_NAME', 'name', (value) => api.setMyName(value)],
  ['BOT_DESCRIPTION', 'description', (value) => api.setMyDescription(value)],
  ['BOT_ABOUT', 'short description', (value) => api.setMyShortDescription(value)],
]
for (const [key, label, apply] of identity) {
  const value = process.env[key]
  if (value === undefined || value.length === 0) continue
  try {
    await apply(value)
    console.log(`applied ${label}: ${value}`)
  } catch (error) {
    // Telegram rate-limits identity changes; a miss should not undo setup.
    console.error(`warning: could not apply ${label}: ${String(error)}`)
  }
}

const lines = [
  '# telegram-bot-skill config. Contains a secret; keep out of git (mode 600).',
  `TELEGRAM_BOT_TOKEN=${token}`,
  `BOT_USERNAME=${username}`,
]
// Carry through whatever else was declared at setup time, so one command
// captures the whole intended configuration.
for (const key of [
  'BOT_NAME',
  'BOT_DESCRIPTION',
  'BOT_ABOUT',
  'OWNER_ID',
  'TRUSTED_IDS',
  'GUEST_IDS',
  'BLOCKED_IDS',
  'AGENT_ADAPTER',
  'PI_MODEL',
  'PI_SESSION_DIR',
  'AGENT_CWD',
  'STATE_FILE',
]) {
  const value = process.env[key]
  if (value !== undefined && value.length > 0) lines.push(`${key}=${value}`)
}

const target = process.env.ENV_FILE !== undefined && process.env.ENV_FILE.length > 0
  ? process.env.ENV_FILE
  : '.env'
writeFileSync(target, lines.join('\n') + '\n')
chmodSync(target, 0o600)
console.log(`Saved ${target} for @${username}. Start the bridge with: npm start`)
