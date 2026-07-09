import { test } from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { dirname, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

const repoRoot = resolve(dirname(fileURLToPath(import.meta.url)), '..')

test('every install route ships the same SKILL.md (run npm run sync-skill after edits)', () => {
  const source = readFileSync(join(repoRoot, 'SKILL.md'), 'utf8')
  for (const copy of [
    'skills/telegram-bot/SKILL.md',
    'plugins/telegram-bot/skills/telegram-bot/SKILL.md',
    'plugins/telegram-bot-codex/skills/telegram-bot/SKILL.md',
  ]) {
    assert.equal(
      readFileSync(join(repoRoot, copy), 'utf8'),
      source,
      `${copy} is out of sync with the root SKILL.md; run: npm run sync-skill`,
    )
  }
})
