// Copies the root SKILL.md into every install-route location. The root file
// is the single source of truth; a test fails if the copies drift.
import { copyFileSync, mkdirSync } from 'node:fs'
import { dirname } from 'node:path'

const targets = [
  'skills/telegram-bot/SKILL.md',
  'plugins/telegram-bot/skills/telegram-bot/SKILL.md',
  'plugins/telegram-bot-codex/skills/telegram-bot/SKILL.md',
]

for (const target of targets) {
  mkdirSync(dirname(target), { recursive: true })
  copyFileSync('SKILL.md', target)
  console.log('synced', target)
}
