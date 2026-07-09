import { test } from 'node:test'
import assert from 'node:assert/strict'
import { mkdtempSync, readFileSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { FileStore } from './store.ts'

function tempStorePath(): { dir: string; path: string } {
  const dir = mkdtempSync(join(tmpdir(), 'store-'))
  return { dir, path: join(dir, 'state.json') }
}

test('opens empty when the file does not exist', async () => {
  const { dir, path } = tempStorePath()
  try {
    const store = await FileStore.open(path)
    assert.deepEqual(store.data, { users: {}, sessions: {} })
  } finally {
    rmSync(dir, { recursive: true, force: true })
  }
})

test('update persists and a reopened store reads the same state', async () => {
  const { dir, path } = tempStorePath()
  try {
    const store = await FileStore.open(path)
    await store.update((data) => {
      data.users['42'] = { state: 'owner', chatId: 42, addedAt: '2026-07-09T00:00:00Z' }
      data.sessions['42'] = 'sess-9'
      data.offset = 17
    })
    const reopened = await FileStore.open(path)
    assert.equal(reopened.data.users['42'].state, 'owner')
    assert.equal(reopened.data.sessions['42'], 'sess-9')
    assert.equal(reopened.data.offset, 17)
  } finally {
    rmSync(dir, { recursive: true, force: true })
  }
})

test('concurrent updates all land and the file stays valid JSON', async () => {
  const { dir, path } = tempStorePath()
  try {
    const store = await FileStore.open(path)
    await Promise.all(
      Array.from({ length: 10 }, (_, i) =>
        store.update((data) => {
          data.sessions[`chat-${i}`] = `sess-${i}`
        }),
      ),
    )
    const onDisk = JSON.parse(readFileSync(path, 'utf8'))
    assert.equal(Object.keys(onDisk.sessions).length, 10)
  } finally {
    rmSync(dir, { recursive: true, force: true })
  }
})
