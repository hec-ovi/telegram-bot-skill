import { test } from 'node:test'
import assert from 'node:assert/strict'
import { TelegramApi } from './api.ts'
import { normalizeUpdate, pollUpdates } from './poller.ts'
import { FakeBotApi } from './fake-bot-api.ts'

test('end to end: long-poll hold resolves on pushed message, normalized and offset saved', async () => {
  const fake = new FakeBotApi()
  await fake.start()
  try {
    const api = new TelegramApi(fake.token, { baseUrl: fake.baseUrl })
    const saved: number[] = []
    const iterator = pollUpdates(api, {
      pollTimeoutSeconds: 30,
      saveOffset: (offset) => {
        saved.push(offset)
      },
    })
    // Ask for the first update while nothing is queued: the fake holds
    // the request open exactly like Telegram long polling does.
    const first = iterator.next()
    await new Promise((resolve) => setTimeout(resolve, 50))
    const pushed = fake.pushTextMessage({ chatId: 7, userId: 42, text: 'hi agent' })

    const { value } = await first
    assert.ok(value, 'expected an update')
    assert.deepEqual(normalizeUpdate(value), {
      kind: 'text',
      chatId: 7,
      userId: 42,
      messageId: pushed.message!.message_id,
      text: 'hi agent',
    })
    assert.deepEqual(saved, [pushed.update_id + 1])
    await iterator.return()
  } finally {
    await fake.stop()
  }
})

test('resumes from a persisted offset without re-delivering consumed updates', async () => {
  const fake = new FakeBotApi()
  await fake.start()
  try {
    const api = new TelegramApi(fake.token, { baseUrl: fake.baseUrl })
    fake.pushTextMessage({ chatId: 7, userId: 42, text: 'first' })
    fake.pushTextMessage({ chatId: 7, userId: 42, text: 'second' })

    let lastOffset = 0
    const firstRun = pollUpdates(api, {
      pollTimeoutSeconds: 30,
      saveOffset: (offset) => {
        lastOffset = offset
      },
    })
    const seen: string[] = []
    for await (const update of firstRun) {
      seen.push(update.message!.text!)
      if (seen.length === 2) break
    }
    assert.deepEqual(seen, ['first', 'second'])

    // Simulated restart: a new poller starts from the persisted offset.
    const third = fake.pushTextMessage({ chatId: 7, userId: 42, text: 'third' })
    const secondRun = pollUpdates(api, { pollTimeoutSeconds: 30, offset: lastOffset })
    const { value } = await secondRun.next()
    assert.equal(value!.update_id, third.update_id)
    assert.equal(value!.message!.text, 'third')
    await secondRun.return()

    const polls = fake.callsFor('getUpdates')
    assert.equal(polls.at(-1)!.params.offset, lastOffset)
  } finally {
    await fake.stop()
  }
})

test('survives a failing getUpdates: reports, backs off, keeps polling', async () => {
  const fake = new FakeBotApi()
  await fake.start()
  try {
    const api = new TelegramApi(fake.token, { baseUrl: fake.baseUrl })
    fake.respondOnceWith('getUpdates', {
      status: 502,
      body: { ok: false, error_code: 502, description: 'Bad Gateway' },
    })
    const errors: unknown[] = []
    const backoffs: number[] = []
    fake.pushTextMessage({ chatId: 7, userId: 42, text: 'after recovery' })
    const iterator = pollUpdates(api, {
      pollTimeoutSeconds: 30,
      onError: (error) => {
        errors.push(error)
      },
      errorDelayMs: 5,
      sleep: async (ms) => {
        backoffs.push(ms)
      },
    })
    const { value } = await iterator.next()
    assert.equal(value!.message!.text, 'after recovery')
    assert.equal(errors.length, 1)
    assert.deepEqual(backoffs, [5])
    await iterator.return()
  } finally {
    await fake.stop()
  }
})

test('normalizes callback queries with their answer id', async () => {
  const fake = new FakeBotApi()
  await fake.start()
  try {
    const api = new TelegramApi(fake.token, { baseUrl: fake.baseUrl })
    const pushed = fake.pushCallbackQuery({ chatId: 7, userId: 42, data: 'approve:99' })
    const iterator = pollUpdates(api, { pollTimeoutSeconds: 30 })
    const { value } = await iterator.next()
    const normalized = normalizeUpdate(value!)
    assert.deepEqual(normalized, {
      kind: 'callback',
      chatId: 7,
      userId: 42,
      messageId: pushed.callback_query!.message!.message_id,
      callbackId: pushed.callback_query!.id,
      callbackData: 'approve:99',
    })
    await iterator.return()
  } finally {
    await fake.stop()
  }
})

test('normalizeUpdate ignores update kinds the bridge does not handle', () => {
  assert.equal(normalizeUpdate({ update_id: 1 }), undefined)
  assert.equal(
    normalizeUpdate({
      update_id: 2,
      message: { message_id: 1, date: 1, chat: { id: 1, type: 'private' } },
    }),
    undefined,
  )
})
