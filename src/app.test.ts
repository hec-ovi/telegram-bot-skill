// The "use it like a real bot" test: a full conversation driven through
// the actual poll loop against the fake Bot API server, with a scripted
// agent behind the real gate, runner and presence layers.

import { test } from 'node:test'
import assert from 'node:assert/strict'
import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { FakeAdapter } from './agents/fake-adapter.ts'
import { createBot, TEXT } from './app.ts'
import { GATING_REFUSAL } from './runner/runner.ts'
import { FileStore } from './store/store.ts'
import { TelegramApi } from './telegram/api.ts'
import { FakeBotApi } from './telegram/fake-bot-api.ts'

const OWNER = 100
const FRIEND = 200
const TROLL = 300

function wait(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms))
}

test('full conversation: claim, stranger, approval, agent runs, block holds', async () => {
  const fake = new FakeBotApi()
  await fake.start()
  const dir = mkdtempSync(join(tmpdir(), 'bot-e2e-'))
  const controller = new AbortController()
  try {
    const api = new TelegramApi(fake.token, { baseUrl: fake.baseUrl })
    const store = await FileStore.open(join(dir, 'state.json'))
    const adapter = new FakeAdapter([
      { kind: 'status', state: 'thinking' },
      { kind: 'text', text: 'final answer text' },
      { kind: 'done', sessionId: 's1' },
    ])
    const logs: string[] = []
    const bot = createBot({
      api,
      store,
      adapter,
      cwd: dir,
      log: (line) => logs.push(line),
      presence: { typingIntervalMs: 100000, editThrottleMs: 0 },
      poller: { pollTimeoutSeconds: 30 },
    })

    const textsTo = (chatId: number) =>
      fake
        .callsFor('sendMessage')
        .filter((call) => call.params.chat_id === chatId)
        .map((call) => call.params.text as string)

    // Boot: no owner yet, a claim link must be printed.
    await bot.bootstrap()
    const claimCode = store.data.claimCode
    assert.ok(claimCode, 'expected a claim code to be generated')
    assert.ok(
      logs.some((line) => line.includes(`?start=${claimCode}`)),
      'expected the claim deep link in the logs',
    )

    const loop = bot.runLoop(controller.signal)

    // 1. The owner claims the bot through the deep link payload.
    fake.pushTextMessage({ chatId: OWNER, userId: OWNER, text: `/start ${claimCode}` })
    await wait(60)
    assert.deepEqual(textsTo(OWNER), [TEXT.ownerClaimed])
    assert.equal(store.data.claimCode, undefined, 'claim code must die with the claim')

    // 2. A stranger writes: held at the gate, owner gets the approval keyboard.
    fake.pushTextMessage({ chatId: FRIEND, userId: FRIEND, text: 'hola, let me in?' })
    await wait(60)
    assert.deepEqual(textsTo(FRIEND), [TEXT.pending])
    const approvalRequest = fake
      .callsFor('sendMessage')
      .find((call) => call.params.chat_id === OWNER && call.params.reply_markup !== undefined)
    assert.ok(approvalRequest, 'owner must receive the approval request')
    const buttons = approvalRequest.params.reply_markup.inline_keyboard[0]
    assert.deepEqual(
      buttons.map((button: { callback_data: string }) => button.callback_data),
      [`gate:trusted:${FRIEND}`, `gate:guest:${FRIEND}`, `gate:blocked:${FRIEND}`],
    )

    // 3. A forged approval from the stranger themselves changes nothing.
    fake.pushCallbackQuery({ chatId: FRIEND, userId: FRIEND, data: `gate:trusted:${FRIEND}` })
    await wait(60)
    assert.equal(store.data.users[String(FRIEND)].state, 'pending')

    // 4. The owner taps trust: the stranger is notified and upgraded.
    fake.pushCallbackQuery({ chatId: OWNER, userId: OWNER, data: `gate:trusted:${FRIEND}` })
    await wait(60)
    assert.equal(store.data.users[String(FRIEND)].state, 'trusted')
    assert.deepEqual(textsTo(FRIEND), [TEXT.pending, TEXT.approvedPrefix + 'trusted'])

    // 5. The trusted friend asks something: the agent runs with presence.
    fake.pushTextMessage({ chatId: FRIEND, userId: FRIEND, text: 'write me an article' })
    await wait(120)
    assert.deepEqual(textsTo(FRIEND), [
      TEXT.pending,
      TEXT.approvedPrefix + 'trusted',
      '⏳ working…',
      'final answer text',
    ])
    assert.equal(adapter.runs.length, 1)
    assert.equal(adapter.runs[0].prompt, 'write me an article')
    assert.equal(adapter.runs[0].sessionId, undefined)
    assert.equal(store.data.sessions[String(FRIEND)], 's1')

    // 6. The next message resumes the same agent session.
    fake.pushTextMessage({ chatId: FRIEND, userId: FRIEND, text: 'make it shorter' })
    await wait(120)
    assert.equal(adapter.runs.length, 2)
    assert.equal(adapter.runs[1].sessionId, 's1')

    // 7. A troll shows up and gets blocked; after that, silence.
    fake.pushTextMessage({ chatId: TROLL, userId: TROLL, text: 'hey' })
    await wait(60)
    fake.pushCallbackQuery({ chatId: OWNER, userId: OWNER, data: `gate:blocked:${TROLL}` })
    await wait(60)
    assert.deepEqual(textsTo(TROLL), [TEXT.pending, TEXT.blockedNotice])
    fake.pushTextMessage({ chatId: TROLL, userId: TROLL, text: 'hey again' })
    await wait(60)
    assert.deepEqual(textsTo(TROLL), [TEXT.pending, TEXT.blockedNotice], 'blocked stays silent')
  } finally {
    controller.abort()
    await fake.stop()
    rmSync(dir, { recursive: true, force: true })
  }
})

test('recover mode: env seed makes a fresh, stateless boot immediately owned and ready', async () => {
  const fake = new FakeBotApi()
  await fake.start()
  const dir = mkdtempSync(join(tmpdir(), 'bot-seed-'))
  try {
    const api = new TelegramApi(fake.token, { baseUrl: fake.baseUrl })
    const store = await FileStore.open(join(dir, 'state.json')) // no file: simulated wipe
    const adapter = new FakeAdapter([
      { kind: 'text', text: 'seeded answer' },
      { kind: 'done', sessionId: 's1' },
    ])
    const logs: string[] = []
    const bot = createBot({
      api,
      store,
      adapter,
      cwd: dir,
      seed: { ownerId: OWNER, trusted: [FRIEND], blocked: [TROLL] },
      log: (line) => logs.push(line),
      presence: { typingIntervalMs: 100000, editThrottleMs: 0 },
    })
    await bot.bootstrap()

    // No claim dance: ownership came from env.
    assert.ok(!logs.some((line) => line.includes('?start=')), 'no claim link when seeded')
    assert.equal(store.data.claimCode, undefined)
    assert.equal(store.data.users[String(OWNER)].state, 'owner')
    assert.equal(store.data.users[String(FRIEND)].state, 'trusted')
    assert.equal(store.data.users[String(TROLL)].state, 'blocked')

    // The seeded owner can use the agent on the very first message.
    await bot.handleUpdate(fake.pushTextMessage({ chatId: OWNER, userId: OWNER, text: 'hi' }))
    await wait(80)
    assert.equal(adapter.runs.length, 1)

    // Seeded blocked users stay silent, no pending flow.
    await bot.handleUpdate(fake.pushTextMessage({ chatId: TROLL, userId: TROLL, text: 'hey' }))
    await wait(40)
    const trollTexts = fake
      .callsFor('sendMessage')
      .filter((call) => call.params.chat_id === TROLL)
    assert.equal(trollTexts.length, 0)
  } finally {
    await fake.stop()
    rmSync(dir, { recursive: true, force: true })
  }
})

test('recover mode: the env owner wins over a stale stored owner', async () => {
  const fake = new FakeBotApi()
  await fake.start()
  const dir = mkdtempSync(join(tmpdir(), 'bot-seed2-'))
  try {
    const api = new TelegramApi(fake.token, { baseUrl: fake.baseUrl })
    const store = await FileStore.open(join(dir, 'state.json'))
    await store.update((data) => {
      data.users['999'] = { state: 'owner', chatId: 999, addedAt: 'x' }
    })
    const bot = createBot({
      api,
      store,
      adapter: new FakeAdapter([]),
      cwd: dir,
      seed: { ownerId: OWNER },
    })
    await bot.bootstrap()
    assert.equal(store.data.users[String(OWNER)].state, 'owner')
    assert.equal(store.data.users['999'].state, 'trusted', 'old owner demoted, not deleted')
  } finally {
    await fake.stop()
    rmSync(dir, { recursive: true, force: true })
  }
})

test('non-owner tiers are refused when the adapter cannot hard-gate tools', async () => {
  const fake = new FakeBotApi()
  await fake.start()
  const dir = mkdtempSync(join(tmpdir(), 'bot-refusal-'))
  try {
    const api = new TelegramApi(fake.token, { baseUrl: fake.baseUrl })
    const store = await FileStore.open(join(dir, 'state.json'))
    await store.update((data) => {
      data.users[String(OWNER)] = { state: 'owner', chatId: OWNER, addedAt: 'x' }
      data.users[String(FRIEND)] = { state: 'trusted', chatId: FRIEND, addedAt: 'x' }
    })
    const adapter = new FakeAdapter(
      [
        { kind: 'text', text: 'ran anyway' },
        { kind: 'done', sessionId: 's1' },
      ],
      { toolGating: 'none' },
    )
    const bot = createBot({
      api,
      store,
      adapter,
      cwd: dir,
      presence: { typingIntervalMs: 100000, editThrottleMs: 0 },
    })

    const friendUpdate = fake.pushTextMessage({ chatId: FRIEND, userId: FRIEND, text: 'run this' })
    await bot.handleUpdate(friendUpdate)
    await wait(60)
    assert.equal(adapter.runs.length, 0, 'the agent must never see the request')
    const friendTexts = fake
      .callsFor('sendMessage')
      .filter((call) => call.params.chat_id === FRIEND)
      .map((call) => call.params.text)
    assert.deepEqual(friendTexts, [GATING_REFUSAL])

    const ownerUpdate = fake.pushTextMessage({ chatId: OWNER, userId: OWNER, text: 'run this' })
    await bot.handleUpdate(ownerUpdate)
    await wait(60)
    assert.equal(adapter.runs.length, 1, 'the owner still runs')
  } finally {
    await fake.stop()
    rmSync(dir, { recursive: true, force: true })
  }
})
