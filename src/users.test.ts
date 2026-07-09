import { test } from 'node:test'
import assert from 'node:assert/strict'
import { spawn } from 'node:child_process'
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { dirname, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

const repoRoot = resolve(dirname(fileURLToPath(import.meta.url)), '..')

function runUsers(
  args: string[],
  stateFile: string,
): Promise<{ code: number | null; output: string }> {
  return new Promise((resolvePromise) => {
    const child = spawn(process.execPath, [join(repoRoot, 'src', 'users.ts'), ...args], {
      cwd: repoRoot,
      env: { ...process.env, STATE_FILE: stateFile, ENV_FILE: join(dirname(stateFile), 'none.env') },
      stdio: ['ignore', 'pipe', 'pipe'],
    })
    let output = ''
    child.stdout.on('data', (chunk) => {
      output += chunk
    })
    child.stderr.on('data', (chunk) => {
      output += chunk
    })
    child.on('close', (code) => resolvePromise({ code, output }))
  })
}

test('users cli: set, list, owner handover, remove', async () => {
  const dir = mkdtempSync(join(tmpdir(), 'users-'))
  const stateFile = join(dir, 'state.json')
  try {
    writeFileSync(
      stateFile,
      JSON.stringify({
        users: { '100': { state: 'owner', chatId: 100, addedAt: 'x' } },
        sessions: {},
        claimCode: 'LEFTOVER',
      }),
    )

    const set = await runUsers(['set', '200', 'trusted'], stateFile)
    assert.equal(set.code, 0, set.output)
    assert.match(set.output, /200 is now trusted/)
    assert.match(set.output, /restart it to apply/)

    const list = await runUsers(['list'], stateFile)
    assert.match(list.output, /100 {2}owner/)
    assert.match(list.output, /200 {2}trusted/)

    // Owner handover demotes the previous owner and kills any claim code.
    const handover = await runUsers(['set', '200', 'owner'], stateFile)
    assert.equal(handover.code, 0, handover.output)
    const state = JSON.parse(readFileSync(stateFile, 'utf8'))
    assert.equal(state.users['200'].state, 'owner')
    assert.equal(state.users['100'].state, 'trusted')
    assert.equal(state.claimCode, undefined)

    const removed = await runUsers(['remove', '100'], stateFile)
    assert.equal(removed.code, 0)
    assert.equal(JSON.parse(readFileSync(stateFile, 'utf8')).users['100'], undefined)
  } finally {
    rmSync(dir, { recursive: true, force: true })
  }
})

test('users cli rejects bad tiers and unknown removals', async () => {
  const dir = mkdtempSync(join(tmpdir(), 'users-bad-'))
  const stateFile = join(dir, 'state.json')
  try {
    const badTier = await runUsers(['set', '300', 'root'], stateFile)
    assert.equal(badTier.code, 2)
    const badRemove = await runUsers(['remove', '999'], stateFile)
    assert.equal(badRemove.code, 1)
  } finally {
    rmSync(dir, { recursive: true, force: true })
  }
})
