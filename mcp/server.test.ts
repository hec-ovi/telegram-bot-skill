// End-to-end tests for the MCP surface: spawn the real mcp/server.ts as a
// child process, speak newline-delimited JSON-RPC to it over stdio (exactly
// what an MCP client does), with the FakeBotApi standing in for Telegram.

import assert from 'node:assert/strict'
import { spawn, type ChildProcessWithoutNullStreams } from 'node:child_process'
import { mkdtemp, readFile, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'
import { test } from 'node:test'
import { FakeBotApi } from '../src/telegram/fake-bot-api.ts'

const SERVER = resolve(import.meta.dirname, 'server.ts')
const OWNER = 42

interface Pending {
  resolve: (value: any) => void
  reject: (error: Error) => void
}

class McpClient {
  child: ChildProcessWithoutNullStreams
  stderr = ''
  notifications: Array<{ method: string; params: any }> = []
  #pending = new Map<number, Pending>()
  #notificationWaiters: Array<{ method: string; resolve: (params: any) => void }> = []
  #nextId = 1
  #buffer = ''

  constructor(child: ChildProcessWithoutNullStreams) {
    this.child = child
    child.stderr.on('data', (chunk) => (this.stderr += String(chunk)))
    child.stdout.on('data', (chunk) => {
      this.#buffer += String(chunk)
      let at: number
      while ((at = this.#buffer.indexOf('\n')) !== -1) {
        const line = this.#buffer.slice(0, at)
        this.#buffer = this.#buffer.slice(at + 1)
        if (line.trim().length === 0) continue
        this.#route(JSON.parse(line))
      }
    })
  }

  #route(message: any): void {
    if (message.method !== undefined) {
      this.notifications.push(message)
      const at = this.#notificationWaiters.findIndex((w) => w.method === message.method)
      if (at !== -1) this.#notificationWaiters.splice(at, 1)[0].resolve(message.params)
      return
    }
    const pending = this.#pending.get(message.id)
    if (pending === undefined) return
    this.#pending.delete(message.id)
    if (message.error !== undefined) {
      const error = new Error(message.error.message) as Error & { code?: number }
      error.code = message.error.code
      pending.reject(error)
    } else {
      pending.resolve(message.result)
    }
  }

  send(payload: object): void {
    this.child.stdin.write(JSON.stringify(payload) + '\n')
  }

  request(method: string, params?: unknown, id?: number): Promise<any> {
    const requestId = id ?? this.#nextId++
    return new Promise((resolvePromise, reject) => {
      this.#pending.set(requestId, { resolve: resolvePromise, reject })
      this.send({ jsonrpc: '2.0', id: requestId, method, params })
    })
  }

  hasPending(id: number): boolean {
    return this.#pending.has(id)
  }

  notify(method: string, params?: unknown): void {
    this.send({ jsonrpc: '2.0', method, params })
  }

  async initialize(): Promise<any> {
    const result = await this.request('initialize', {
      protocolVersion: '2025-06-18',
      capabilities: {},
      clientInfo: { name: 'test-client', version: '0.0.1' },
    })
    this.notify('notifications/initialized')
    return result
  }

  waitNotification(method: string, timeoutMs = 3000): Promise<any> {
    const seen = this.notifications.find((n) => n.method === method)
    if (seen !== undefined) return Promise.resolve(seen.params)
    return new Promise((resolvePromise, reject) => {
      const timer = setTimeout(() => reject(new Error(`no ${method} within ${timeoutMs}ms`)), timeoutMs)
      this.#notificationWaiters.push({
        method,
        resolve: (params) => {
          clearTimeout(timer)
          resolvePromise(params)
        },
      })
    })
  }

  async callTool(name: string, args: object = {}): Promise<{ parsed: any; isError?: boolean }> {
    const result = await this.request('tools/call', { name, arguments: args })
    const text = result.content?.[0]?.text ?? ''
    let parsed: any
    try {
      parsed = JSON.parse(text)
    } catch {
      parsed = text
    }
    return { parsed, isError: result.isError }
  }

  close(): void {
    this.child.kill()
  }
}

interface Rig {
  fake: FakeBotApi
  client: McpClient
  stateFile: string
  dir: string
}

async function startRig(
  t: { after: (fn: () => Promise<void> | void) => void },
  options: { channel?: boolean; seedOwner?: boolean; env?: Record<string, string> } = {},
): Promise<Rig> {
  const fake = new FakeBotApi()
  await fake.start()
  const dir = await mkdtemp(join(tmpdir(), 'mcp-test-'))
  const stateFile = join(dir, 'state.json')
  const child = spawn(
    process.execPath,
    [SERVER, ...(options.channel === true ? ['--channel'] : [])],
    {
      env: {
        ...process.env,
        TELEGRAM_BOT_TOKEN: fake.token,
        TELEGRAM_API_BASE: fake.baseUrl,
        STATE_FILE: stateFile,
        // Point at a file that does not exist so a developer's real ./.env
        // can never leak into the test environment.
        ENV_FILE: join(dir, 'no.env'),
        ...(options.seedOwner === false ? {} : { OWNER_ID: String(OWNER) }),
        ...options.env,
      },
      stdio: ['pipe', 'pipe', 'pipe'],
    },
  )
  const client = new McpClient(child as ChildProcessWithoutNullStreams)
  t.after(async () => {
    client.close()
    await fake.stop()
    await rm(dir, { recursive: true, force: true })
  })
  return { fake, client, stateFile, dir }
}

// Polls a probe until it yields a value, so tests never race the server's
// async handling of a pushed update.
async function until<T>(
  probe: () => T | undefined | Promise<T | undefined>,
  what: string,
  timeoutMs = 3000,
): Promise<T> {
  const deadline = Date.now() + timeoutMs
  while (Date.now() < deadline) {
    const value = await probe()
    if (value !== undefined) return value
    await new Promise((r) => setTimeout(r, 20))
  }
  throw new Error(`timed out waiting for ${what}`)
}

test('handshake: version echo, tools capability, five tools in poll mode', async (t) => {
  const { client } = await startRig(t)
  const init = await client.initialize()
  assert.equal(init.protocolVersion, '2025-06-18')
  assert.equal(init.serverInfo.name, 'telegram-bot-skill')
  assert.ok(init.capabilities.tools)
  assert.equal(init.capabilities.experimental, undefined)
  assert.ok(init.instructions.includes('wait_for_message'))

  const { tools } = await client.request('tools/list')
  assert.deepEqual(
    tools.map((tool: any) => tool.name).sort(),
    ['bridge_status', 'list_users', 'send_message', 'set_user_tier', 'wait_for_message'],
  )
  assert.deepEqual(await client.request('ping'), {})
})

test('full duplex, poll mode: owner message in, agent answer out', async (t) => {
  const { client, fake } = await startRig(t)
  await client.initialize()

  fake.pushTextMessage({ chatId: OWNER, userId: OWNER, text: 'what is 2+2?' })
  const { parsed: incoming } = await client.callTool('wait_for_message', { timeout_seconds: 10 })
  assert.equal(incoming.text, 'what is 2+2?')
  assert.equal(incoming.chat_id, OWNER)
  assert.equal(incoming.tier, 'owner')

  const { parsed: sent } = await client.callTool('send_message', { chat_id: OWNER, text: '4' })
  assert.equal(sent.sent_chunks, 1)
  const call = await until(
    () => fake.callsFor('sendMessage').find((c) => c.params.text === '4'),
    'answer delivered to telegram',
  )
  assert.equal(call.params.chat_id, OWNER)
})

test('wait_for_message: returns timed_out on a quiet chat, queues messages while busy', async (t) => {
  const { client, fake } = await startRig(t)
  await client.initialize()

  const { parsed: quiet } = await client.callTool('wait_for_message', { timeout_seconds: 1 })
  assert.equal(quiet.timed_out, true)

  // Two messages arrive while the agent is off doing something else.
  fake.pushTextMessage({ chatId: OWNER, userId: OWNER, text: 'first' })
  fake.pushTextMessage({ chatId: OWNER, userId: OWNER, text: 'second' })
  await until(
    () => (fake.callsFor('getUpdates').length >= 2 ? true : undefined),
    'poller consumed the pushed updates',
  )
  const one = await client.callTool('wait_for_message', { timeout_seconds: 10 })
  const two = await client.callTool('wait_for_message', { timeout_seconds: 10 })
  assert.equal(one.parsed.text, 'first')
  assert.equal(two.parsed.text, 'second')
})

test('gate holds strangers: never delivered to the agent, owner gets the approval ask', async (t) => {
  const { client, fake } = await startRig(t)
  await client.initialize()

  fake.pushTextMessage({ chatId: 777, userId: 777, text: 'let me in' })
  const pendingNotice = await until(
    () => fake.callsFor('sendMessage').find((c) => c.params.chat_id === 777),
    'pending notice to the stranger',
  )
  assert.ok(pendingNotice.params.text.includes('private'))
  const ask = await until(
    () => fake.callsFor('sendMessage').find((c) => c.params.chat_id === OWNER),
    'approval ask to the owner',
  )
  assert.ok(ask.params.reply_markup.inline_keyboard.flat().length >= 3)

  const { parsed } = await client.callTool('wait_for_message', { timeout_seconds: 1 })
  assert.equal(parsed.timed_out, true, 'stranger text must never reach the agent')
})

test('set_user_tier approves a pending user and notifies them; owner is untouchable', async (t) => {
  const { client, fake, stateFile } = await startRig(t)
  await client.initialize()

  fake.pushTextMessage({ chatId: 777, userId: 777, text: 'hello?' })
  await until(
    () => fake.callsFor('sendMessage').find((c) => c.params.chat_id === 777),
    'stranger recorded as pending',
  )

  const { parsed, isError } = await client.callTool('set_user_tier', { user_id: 777, tier: 'trusted' })
  assert.equal(isError, undefined)
  assert.equal(parsed.tier, 'trusted')
  await until(
    () => fake.callsFor('sendMessage').find((c) => c.params.chat_id === 777 && c.params.text.includes('trusted')),
    'tier notice to the user',
  )
  const state = JSON.parse(await readFile(stateFile, 'utf8'))
  assert.equal(state.users['777'].state, 'trusted')

  const { parsed: users } = await client.callTool('list_users')
  assert.equal(users.find((u: any) => u.user_id === 777).state, 'trusted')

  const owner = await client.callTool('set_user_tier', { user_id: OWNER, tier: 'blocked' })
  assert.equal(owner.isError, true)
  const bad = await client.callTool('set_user_tier', { user_id: 777, tier: 'owner' })
  assert.equal(bad.isError, true)
})

test('bridge_status: claimed rig reports the bot and no claim link', async (t) => {
  const { client } = await startRig(t)
  await client.initialize()
  const { parsed } = await until(async () => {
    const result = await client.callTool('bridge_status')
    return result.parsed.bot_username !== undefined ? result : undefined
  }, 'bridge bootstrap finished')
  assert.equal(parsed.bot_username, 'fake_bot')
  assert.equal(parsed.owner_claimed, true)
  assert.equal(parsed.claim_link, undefined)
  assert.equal(parsed.queued_messages, 0)
})

test('bridge_status: unclaimed rig exposes the claim link', async (t) => {
  const { client } = await startRig(t, { seedOwner: false })
  await client.initialize()
  const { parsed } = await until(async () => {
    const result = await client.callTool('bridge_status')
    return result.parsed.claim_link !== undefined ? result : undefined
  }, 'claim link available')
  assert.equal(parsed.owner_claimed, false)
  assert.match(parsed.claim_link, /^https:\/\/t\.me\/fake_bot\?start=/)
})

test('channel mode: capability declared, wait tool gone, messages push as notifications', async (t) => {
  const { client, fake } = await startRig(t, { channel: true })

  // A message that lands during the handshake must flush, not vanish.
  fake.pushTextMessage({ chatId: OWNER, userId: OWNER, text: 'early bird' })
  await until(
    () => (fake.callsFor('getUpdates').length >= 1 ? true : undefined),
    'poller consumed the early update',
  )

  const init = await client.initialize()
  assert.deepEqual(init.capabilities.experimental, { 'claude/channel': {} })
  assert.ok(init.instructions.includes('<channel'))
  const { tools } = await client.request('tools/list')
  assert.ok(!tools.some((tool: any) => tool.name === 'wait_for_message'))

  // The flush waits a grace period so the client's channel listener is
  // registered before anything is pushed (an instant flush loses messages).
  const early = await client.waitNotification('notifications/claude/channel', 9000)
  assert.equal(early.content, 'early bird')
  assert.equal(early.meta.chat_id, String(OWNER))
  assert.equal(early.meta.tier, 'owner')

  // Steady state: a fresh message pushes through immediately.
  client.notifications.length = 0
  fake.pushTextMessage({ chatId: OWNER, userId: OWNER, text: 'and again' })
  const live = await client.waitNotification('notifications/claude/channel')
  assert.equal(live.content, 'and again')

  // Reply path is the same tool as poll mode.
  await client.callTool('send_message', { chat_id: OWNER, text: 'roger' })
  await until(
    () => fake.callsFor('sendMessage').find((c) => c.params.text === 'roger'),
    'reply delivered',
  )
})

test('cancellation: a cancelled wait gets no response and the server keeps serving', async (t) => {
  const { client, fake } = await startRig(t)
  await client.initialize()

  const cancelledId = 900
  void client.request('tools/call', { name: 'wait_for_message', arguments: { timeout_seconds: 60 } }, cancelledId).catch(() => {})
  await new Promise((r) => setTimeout(r, 100))
  client.notify('notifications/cancelled', { requestId: cancelledId, reason: 'user gave up' })
  await new Promise((r) => setTimeout(r, 300))
  assert.equal(client.hasPending(cancelledId), true, 'cancelled request must never be answered')

  fake.pushTextMessage({ chatId: OWNER, userId: OWNER, text: 'still alive?' })
  const { parsed } = await client.callTool('wait_for_message', { timeout_seconds: 10 })
  assert.equal(parsed.text, 'still alive?')
})

test('protocol errors: unknown tool and unknown method', async (t) => {
  const { client } = await startRig(t)
  await client.initialize()
  await assert.rejects(
    client.request('tools/call', { name: 'no_such_tool', arguments: {} }),
    (error: Error & { code?: number }) => error.code === -32602,
  )
  await assert.rejects(
    client.request('no/such/method'),
    (error: Error & { code?: number }) => error.code === -32601,
  )
})

// ------------------------------------------------------------- http mode --

interface HttpRig {
  fake: FakeBotApi
  base: string
}

async function startHttpRig(
  t: { after: (fn: () => Promise<void> | void) => void },
  extraArgs: string[] = [],
): Promise<HttpRig> {
  const fake = new FakeBotApi()
  await fake.start()
  const dir = await mkdtemp(join(tmpdir(), 'mcp-http-test-'))
  const child = spawn(process.execPath, [SERVER, '--http', '0', ...extraArgs], {
    env: {
      ...process.env,
      TELEGRAM_BOT_TOKEN: fake.token,
      TELEGRAM_API_BASE: fake.baseUrl,
      STATE_FILE: join(dir, 'state.json'),
      ENV_FILE: join(dir, 'no.env'),
      OWNER_ID: String(OWNER),
    },
    stdio: ['pipe', 'pipe', 'pipe'],
  })
  let stderr = ''
  child.stderr.on('data', (chunk) => (stderr += String(chunk)))
  t.after(async () => {
    child.kill()
    await fake.stop()
    await rm(dir, { recursive: true, force: true })
  })
  const base = await until(() => {
    const match = stderr.match(/http:\/\/127\.0\.0\.1:(\d+)\/mcp/)
    return match === null ? undefined : `http://127.0.0.1:${match[1]}/mcp`
  }, 'the http listener to announce its port')
  return { fake, base }
}

async function post(base: string, payload: unknown): Promise<{ status: number; body: any }> {
  const response = await fetch(base, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(payload),
  })
  const text = await response.text()
  return { status: response.status, body: text.length > 0 ? JSON.parse(text) : undefined }
}

test('http: initialize round-trip, 202 notifications, tools work over plain POSTs', async (t) => {
  const { fake, base } = await startHttpRig(t)

  const init = await post(base, {
    jsonrpc: '2.0',
    id: 1,
    method: 'initialize',
    params: { protocolVersion: '2025-06-18', capabilities: {}, clientInfo: { name: 'http-test' } },
  })
  assert.equal(init.status, 200)
  assert.equal(init.body.result.protocolVersion, '2025-06-18')
  assert.equal(init.body.result.serverInfo.name, 'telegram-bot-skill')

  const note = await post(base, { jsonrpc: '2.0', method: 'notifications/initialized' })
  assert.equal(note.status, 202)
  assert.equal(note.body, undefined)

  const list = await post(base, { jsonrpc: '2.0', id: 2, method: 'tools/list' })
  assert.equal(list.status, 200)
  const names = list.body.result.tools.map((tool: any) => tool.name).sort()
  assert.deepEqual(names, ['bridge_status', 'list_users', 'send_message', 'set_user_tier', 'wait_for_message'])
  // The http default wait is capped under common per-call client timeouts.
  const wait = list.body.result.tools.find((tool: any) => tool.name === 'wait_for_message')
  assert.ok(wait.inputSchema.properties.timeout_seconds.description.includes('Default 25'))

  // A full tool round-trip against the fake Bot API: message in, answer out.
  fake.pushTextMessage({ chatId: OWNER, userId: OWNER, text: 'ping over http' })
  const incoming = await post(base, {
    jsonrpc: '2.0',
    id: 3,
    method: 'tools/call',
    params: { name: 'wait_for_message', arguments: { timeout_seconds: 10 } },
  })
  assert.equal(incoming.status, 200)
  const message = JSON.parse(incoming.body.result.content[0].text)
  assert.equal(message.text, 'ping over http')
  assert.equal(message.tier, 'owner')

  const sent = await post(base, {
    jsonrpc: '2.0',
    id: 4,
    method: 'tools/call',
    params: { name: 'send_message', arguments: { chat_id: OWNER, text: 'pong over http' } },
  })
  assert.equal(sent.status, 200)
  assert.equal(JSON.parse(sent.body.result.content[0].text).sent_chunks, 1)
  const delivered = await until(
    () => fake.callsFor('sendMessage').find((c) => c.params.text === 'pong over http'),
    'the answer to reach the fake Bot API',
  )
  assert.equal(String(delivered.params.chat_id), String(OWNER))
})

test('http: a short wait returns timed_out instead of hanging the POST', async (t) => {
  const { base } = await startHttpRig(t)
  const result = await post(base, {
    jsonrpc: '2.0',
    id: 1,
    method: 'tools/call',
    params: { name: 'wait_for_message', arguments: { timeout_seconds: 1 } },
  })
  assert.equal(result.status, 200)
  assert.equal(JSON.parse(result.body.result.content[0].text).timed_out, true)
})

test('http: transport misuse gets typed refusals, not crashes', async (t) => {
  const { base } = await startHttpRig(t)

  const got = await fetch(base) // GET: no server-initiated stream on offer
  assert.equal(got.status, 405)
  await got.text()

  const garbage = await fetch(base, { method: 'POST', body: 'not json' })
  assert.equal(garbage.status, 400)
  assert.equal((await garbage.json()).error.code, -32700)

  const batch = await post(base, [{ jsonrpc: '2.0', id: 1, method: 'ping' }])
  assert.equal(batch.status, 400)
  assert.equal(batch.body.error.code, -32602)

  // Still serving after every refusal.
  const ping = await post(base, { jsonrpc: '2.0', id: 2, method: 'ping' })
  assert.equal(ping.status, 200)
  assert.deepEqual(ping.body.result, {})
})

test('http: --channel is refused (channels ride the spawning client)', async (t) => {
  const fake = new FakeBotApi()
  await fake.start()
  const dir = await mkdtemp(join(tmpdir(), 'mcp-http-test-'))
  const child = spawn(process.execPath, [SERVER, '--http', '0', '--channel'], {
    env: {
      ...process.env,
      TELEGRAM_BOT_TOKEN: fake.token,
      TELEGRAM_API_BASE: fake.baseUrl,
      STATE_FILE: join(dir, 'state.json'),
      ENV_FILE: join(dir, 'no.env'),
    },
    stdio: ['pipe', 'pipe', 'pipe'],
  })
  let stderr = ''
  child.stderr.on('data', (chunk) => (stderr += String(chunk)))
  t.after(async () => {
    child.kill()
    await fake.stop()
    await rm(dir, { recursive: true, force: true })
  })
  const code = await new Promise<number | null>((resolvePromise) =>
    child.once('exit', (exitCode) => resolvePromise(exitCode)),
  )
  assert.equal(code, 1)
  assert.ok(stderr.includes('--http and --channel are exclusive'), stderr)
})
