// Whitelist management from the terminal: list, set, remove users in the
// bridge state. Edits apply instantly when the bridge is stopped; a running
// bridge keeps state in memory, so restart it after changes
// (npm run stop && npm run bg). Live approvals still happen in Telegram
// through the owner's Approve / Guest / Block buttons.
//
//   npm run users                          -> list
//   npm run users -- set 123456 trusted    -> owner|trusted|guest|blocked|pending
//   npm run users -- remove 123456

import { resolve } from 'node:path'
import { loadEnvConfig } from './config.ts'
import { FileStore, type UserState } from './store/store.ts'

loadEnvConfig()
const stateFile = resolve(process.env.STATE_FILE ?? 'bot-state.json')
const store = await FileStore.open(stateFile)
const [command = 'list', idArg, tierArg] = process.argv.slice(2)

const TIERS: UserState[] = ['owner', 'trusted', 'guest', 'blocked', 'pending']
const RESTART_HINT = 'if the bridge is running, restart it to apply: npm run stop && npm run bg'

if (command === 'list') {
  const entries = Object.entries(store.data.users)
  if (entries.length === 0) {
    console.log(`no users yet (${stateFile})`)
  } else {
    console.log(`users in ${stateFile}:`)
    for (const [id, user] of entries) {
      console.log(`  ${id}  ${user.state.padEnd(8)} ${user.name ?? ''}`)
    }
  }
} else if (command === 'set') {
  const id = Number(idArg)
  const tier = tierArg as UserState
  if (!Number.isInteger(id) || id <= 0 || !TIERS.includes(tier)) {
    console.error('usage: npm run users -- set <numeric-telegram-id> <owner|trusted|guest|blocked|pending>')
    process.exit(2)
  }
  await store.update((data) => {
    const existing = data.users[String(id)]
    data.users[String(id)] = {
      state: tier,
      chatId: existing?.chatId ?? id,
      name: existing?.name,
      addedAt: existing?.addedAt ?? new Date().toISOString(),
    }
    // Multiple owners can coexist: setting a new one does not demote existing owners.
    if (tier === 'owner') delete data.claimCode
  })
  console.log(`${id} is now ${tier}.`)
  console.log(RESTART_HINT)
} else if (command === 'remove') {
  const id = String(Number(idArg))
  if (store.data.users[id] === undefined) {
    console.error(`${idArg} is not in the list.`)
    process.exit(1)
  }
  await store.update((data) => {
    delete data.users[id]
  })
  console.log(`${idArg} removed.`)
  console.log(RESTART_HINT)
} else {
  console.error('usage: npm run users -- [list | set <id> <tier> | remove <id>]')
  process.exit(2)
}
