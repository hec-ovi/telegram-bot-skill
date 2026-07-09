import { test } from 'node:test'
import assert from 'node:assert/strict'
import { TelegramApi, TelegramError } from './api.ts'
import { FakeBotApi } from './fake-bot-api.ts'

test('sendMessage round-trips through the wire format', async () => {
  const fake = new FakeBotApi()
  await fake.start()
  try {
    const api = new TelegramApi(fake.token, { baseUrl: fake.baseUrl })
    const message = await api.sendMessage({ chat_id: 5, text: 'hello', parse_mode: 'HTML' })
    assert.equal(message.text, 'hello')
    const recorded = fake.callsFor('sendMessage')
    assert.equal(recorded.length, 1)
    assert.deepEqual(recorded[0].params, { chat_id: 5, text: 'hello', parse_mode: 'HTML' })
  } finally {
    await fake.stop()
  }
})

test('waits out 429 flood control honoring retry_after, then succeeds', async () => {
  const fake = new FakeBotApi()
  await fake.start()
  try {
    const sleeps: number[] = []
    const api = new TelegramApi(fake.token, {
      baseUrl: fake.baseUrl,
      sleep: async (ms) => {
        sleeps.push(ms)
      },
    })
    fake.respondOnceWith('sendMessage', {
      status: 429,
      body: {
        ok: false,
        error_code: 429,
        description: 'Too Many Requests: retry after 2',
        parameters: { retry_after: 2 },
      },
    })
    const message = await api.sendMessage({ chat_id: 5, text: 'hello' })
    assert.equal(typeof message.message_id, 'number')
    assert.deepEqual(sleeps, [2000])
    assert.equal(fake.callsFor('sendMessage').length, 2)
  } finally {
    await fake.stop()
  }
})

test('gives up after maxRetries consecutive 429s', async () => {
  const fake = new FakeBotApi()
  await fake.start()
  try {
    const flood = {
      status: 429,
      body: {
        ok: false,
        error_code: 429,
        description: 'Too Many Requests: retry after 1',
        parameters: { retry_after: 1 },
      },
    }
    fake.respondOnceWith('sendMessage', flood)
    fake.respondOnceWith('sendMessage', flood)
    const sleeps: number[] = []
    const api = new TelegramApi(fake.token, {
      baseUrl: fake.baseUrl,
      maxRetries: 1,
      sleep: async (ms) => {
        sleeps.push(ms)
      },
    })
    await assert.rejects(
      api.sendMessage({ chat_id: 5, text: 'hello' }),
      (error: unknown) => error instanceof TelegramError && error.code === 429,
    )
    assert.deepEqual(sleeps, [1000])
  } finally {
    await fake.stop()
  }
})

test('throws TelegramError carrying the API error code', async () => {
  const fake = new FakeBotApi()
  await fake.start()
  try {
    const api = new TelegramApi(fake.token, { baseUrl: fake.baseUrl })
    fake.respondOnceWith('sendMessage', {
      status: 400,
      body: { ok: false, error_code: 400, description: 'Bad Request: chat not found' },
    })
    await assert.rejects(
      api.sendMessage({ chat_id: 5, text: 'hello' }),
      (error: unknown) =>
        error instanceof TelegramError &&
        error.code === 400 &&
        error.message.includes('chat not found'),
    )
  } finally {
    await fake.stop()
  }
})

test('getMe returns the bot identity', async () => {
  const fake = new FakeBotApi()
  await fake.start()
  try {
    const api = new TelegramApi(fake.token, { baseUrl: fake.baseUrl })
    const me = await api.getMe()
    assert.equal(me.is_bot, true)
    assert.equal(me.username, 'fake_bot')
  } finally {
    await fake.stop()
  }
})
