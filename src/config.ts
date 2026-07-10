// Boot config: if a ./.env file exists (or ENV_FILE points at one), load it
// into process.env before anything reads it. Real environment variables win
// over the file (Node's loadEnvFile does not override existing vars), so a
// container env or a one-off override always beats the saved config.

import { existsSync } from 'node:fs'
import { resolve } from 'node:path'

// Keys this project reads. Container setups (compose) often define them as
// empty strings; empty must mean unset, or it would mask the .env file.
const CONFIG_KEYS = [
  'TELEGRAM_BOT_TOKEN',
  'BOT_USERNAME',
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
]

// "123, 456 789" -> [123, 456, 789]; undefined when nothing parses.
export function parseIds(value: string | undefined): number[] | undefined {
  if (value === undefined || value.trim().length === 0) return undefined
  const ids = value
    .split(/[\s,]+/)
    .filter((part) => part.length > 0)
    .map(Number)
    .filter(Number.isFinite)
  return ids.length > 0 ? ids : undefined
}

export function loadEnvConfig(cwd: string = process.cwd()): string | undefined {
  for (const key of CONFIG_KEYS) {
    if (process.env[key] === '') delete process.env[key]
  }
  const file = process.env.ENV_FILE !== undefined && process.env.ENV_FILE.length > 0
    ? resolve(process.env.ENV_FILE)
    : resolve(cwd, '.env')
  if (!existsSync(file)) return undefined
  process.loadEnvFile(file)
  return file
}
