import { test } from 'node:test'
import assert from 'node:assert/strict'
import { relayRun, type PresenceTransport } from './presence.ts'
import type { AgentEvent } from '../agents/contract.ts'
import { FakeAdapter } from '../agents/fake-adapter.ts'
import { TelegramApi } from '../telegram/api.ts'
import { FakeBotApi } from '../telegram/fake-bot-api.ts'
import type {
  ChatAction,
  EditMessageTextParams,
  Message,
  SendMessageParams,
} from '../telegram/types.ts'

function wait(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms))
}

class MemoryTransport implements PresenceTransport {
  readonly calls: Array<{ method: string; params: any }> = []
  #nextMessageId = 1

  async sendMessage(params: SendMessageParams): Promise<Message> {
    this.calls.push({ method: 'sendMessage', params })
    return {
      message_id: this.#nextMessageId++,
      date: 1,
      chat: { id: params.chat_id, type: 'private' },
      text: params.text,
    }
  }

  async editMessageText(params: EditMessageTextParams): Promise<Message> {
    this.calls.push({ method: 'editMessageText', params })
    return {
      message_id: params.message_id,
      date: 1,
      chat: { id: params.chat_id, type: 'private' },
      text: params.text,
    }
  }

  async sendChatAction(chatId: number, action: ChatAction): Promise<boolean> {
    this.calls.push({ method: 'sendChatAction', params: { chat_id: chatId, action } })
    return true
  }

  edits(): string[] {
    return this.calls
      .filter((call) => call.method === 'editMessageText')
      .map((call) => call.params.text)
  }

  sent(): string[] {
    return this.calls
      .filter((call) => call.method === 'sendMessage')
      .map((call) => call.params.text)
  }

  typingCount(): number {
    return this.calls.filter((call) => call.method === 'sendChatAction').length
  }
}

test('happy flow: status message, live edits, final answer, resolution', async () => {
  const transport = new MemoryTransport()
  async function* events(): AsyncIterable<AgentEvent> {
    yield { kind: 'status', state: 'thinking' }
    await wait(10)
    yield { kind: 'tool', name: 'Bash', detail: 'ls' }
    await wait(10)
    yield { kind: 'text', text: 'answer' }
    yield { kind: 'done', sessionId: 's1' }
  }
  const result = await relayRun(transport, 7, events(), {
    typingIntervalMs: 100000,
    editThrottleMs: 0,
  })
  assert.deepEqual(result, { outcome: 'done', sessionId: 's1' })
  assert.equal(transport.calls[0].method, 'sendMessage')
  assert.equal(transport.calls[0].params.text, '⏳ working…')
  assert.deepEqual(transport.edits(), ['🧠 thinking…', '🔧 Bash: ls', '✅ done'])
  assert.deepEqual(transport.sent(), ['⏳ working…', 'answer'])
  assert.ok(transport.typingCount() >= 1)
})

test('typing action repeats while the run lives and stops after it ends', async () => {
  const transport = new MemoryTransport()
  async function* events(): AsyncIterable<AgentEvent> {
    yield { kind: 'status', state: 'thinking' }
    await wait(120)
    yield { kind: 'done', sessionId: 's1' }
  }
  await relayRun(transport, 7, events(), { typingIntervalMs: 20, editThrottleMs: 0 })
  const during = transport.typingCount()
  assert.ok(during >= 3, `expected repeated typing actions, got ${during}`)
  await wait(60)
  assert.equal(transport.typingCount(), during, 'typing loop must stop with the run')
})

test('status edits are throttled: rapid updates coalesce, latest wins', async () => {
  const transport = new MemoryTransport()
  async function* events(): AsyncIterable<AgentEvent> {
    yield { kind: 'status', state: 'thinking' }
    yield { kind: 'tool', name: 'Bash', detail: 'first' }
    yield { kind: 'tool', name: 'Bash', detail: 'second' }
    await wait(150)
    yield { kind: 'done', sessionId: 's1' }
  }
  await relayRun(transport, 7, events(), { typingIntervalMs: 100000, editThrottleMs: 60 })
  assert.deepEqual(transport.edits(), ['🧠 thinking…', '🔧 Bash: second', '✅ done'])
})

test('a run that never resolves times out with a visible resolution', async () => {
  const transport = new MemoryTransport()
  async function* events(): AsyncIterable<AgentEvent> {
    yield { kind: 'status', state: 'thinking' }
    await new Promise(() => {})
  }
  const result = await relayRun(transport, 7, events(), {
    typingIntervalMs: 100000,
    editThrottleMs: 0,
    timeoutMs: 50,
  })
  assert.equal(result.outcome, 'timeout')
  assert.equal(transport.edits().at(-1), '⏱ timed out')
})

test('an agent error resolves the status with the reason', async () => {
  const transport = new MemoryTransport()
  const adapter = new FakeAdapter([
    { kind: 'status', state: 'thinking' },
    { kind: 'error', reason: 'model exploded' },
  ])
  const result = await relayRun(
    transport,
    7,
    adapter.run({ prompt: 'x', cwd: '/tmp' }),
    { typingIntervalMs: 100000, editThrottleMs: 0 },
  )
  assert.deepEqual(result, { outcome: 'error', reason: 'model exploded' })
  assert.equal(transport.edits().at(-1), '⚠️ failed: model exploded')
})

test('a stream that ends without a result is reported as an error', async () => {
  const transport = new MemoryTransport()
  const adapter = new FakeAdapter([{ kind: 'status', state: 'thinking' }])
  const result = await relayRun(
    transport,
    7,
    adapter.run({ prompt: 'x', cwd: '/tmp' }),
    { typingIntervalMs: 100000, editThrottleMs: 0 },
  )
  assert.equal(result.outcome, 'error')
  assert.match(result.reason!, /without a result/)
})

test('long final answers are chunked into multiple messages', async () => {
  const transport = new MemoryTransport()
  const adapter = new FakeAdapter([
    { kind: 'text', text: 'x'.repeat(9000) },
    { kind: 'done', sessionId: 's1' },
  ])
  await relayRun(transport, 7, adapter.run({ prompt: 'x', cwd: '/tmp' }), {
    typingIntervalMs: 100000,
    editThrottleMs: 0,
  })
  // 1 status message + 3 chunks of the 9000-char answer.
  assert.equal(transport.sent().length, 4)
})

test('full stack over the wire: fake adapter through TelegramApi to the fake Bot API', async () => {
  const fake = new FakeBotApi()
  await fake.start()
  try {
    const api = new TelegramApi(fake.token, { baseUrl: fake.baseUrl })
    const adapter = new FakeAdapter([
      { kind: 'status', state: 'thinking' },
      { kind: 'tool', name: 'Read', detail: 'notes.md' },
      { kind: 'text', text: 'here you go' },
      { kind: 'done', sessionId: 'live-1' },
    ])
    const result = await relayRun(api, 7, adapter.run({ prompt: 'go', cwd: '/tmp' }), {
      typingIntervalMs: 100000,
      editThrottleMs: 0,
    })
    assert.deepEqual(result, { outcome: 'done', sessionId: 'live-1' })
    const sent = fake.callsFor('sendMessage').map((call) => call.params.text)
    assert.deepEqual(sent, ['⏳ working…', 'here you go'])
    const edits = fake.callsFor('editMessageText').map((call) => call.params.text)
    assert.deepEqual(edits, ['🧠 thinking…', '🔧 Read: notes.md', '✅ done'])
    assert.ok(fake.callsFor('sendChatAction').length >= 1)
  } finally {
    await fake.stop()
  }
})
