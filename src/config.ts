// Boot config: if a ./.env file exists (or ENV_FILE points at one), load it
// into process.env before anything reads it. Real environment variables win
// over the file (Node's loadEnvFile does not override existing vars), so a
// container env or a one-off override always beats the saved config.

import { existsSync } from 'node:fs'
import { resolve } from 'node:path'

export function loadEnvConfig(cwd: string = process.cwd()): string | undefined {
  const file = process.env.ENV_FILE !== undefined && process.env.ENV_FILE.length > 0
    ? resolve(process.env.ENV_FILE)
    : resolve(cwd, '.env')
  if (!existsSync(file)) return undefined
  process.loadEnvFile(file)
  return file
}
