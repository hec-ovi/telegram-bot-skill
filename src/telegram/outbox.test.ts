import { test } from 'node:test'
import assert from 'node:assert/strict'
import { Outbox, type ApiCaller } from './outbox.ts'

function tick(): Promise<void> {
  return new Promise((resolve) => setImmediate(resolve))
}

test('serializes calls: the next starts only after the previous settles', async () => {
  const order: string[] = []
  const releases: Array<() => void> = []
  const api: ApiCaller = {
    call<T>(_method: string, params?: object): Promise<T> {
      const tag = (params as { tag: string }).tag
      order.push(`start:${tag}`)
      return new Promise((resolve) => {
        releases.push(() => {
          order.push(`end:${tag}`)
          resolve(true as T)
        })
      })
    },
  }
  const outbox = new Outbox(api)
  const a = outbox.enqueue('sendMessage', { tag: 'a' })
  const b = outbox.enqueue('sendMessage', { tag: 'b' })

  await tick()
  assert.deepEqual(order, ['start:a'], 'b must not start while a is in flight')

  releases[0]()
  await a
  await tick()
  assert.deepEqual(order, ['start:a', 'end:a', 'start:b'])

  releases[1]()
  await b
  assert.deepEqual(order, ['start:a', 'end:a', 'start:b', 'end:b'])
})

test('a failed call rejects for its caller but does not jam the queue', async () => {
  const attempted: string[] = []
  const api: ApiCaller = {
    call<T>(_method: string, params?: object): Promise<T> {
      const tag = (params as { tag: string }).tag
      attempted.push(tag)
      if (tag === 'bad') return Promise.reject(new Error('boom'))
      return Promise.resolve(true as T)
    },
  }
  const outbox = new Outbox(api)
  const bad = outbox.enqueue('sendMessage', { tag: 'bad' })
  const good = outbox.enqueue('sendMessage', { tag: 'good' })

  await assert.rejects(bad, /boom/)
  assert.equal(await good, true)
  assert.deepEqual(attempted, ['bad', 'good'])
})
