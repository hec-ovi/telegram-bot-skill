import { test } from 'node:test'
import assert from 'node:assert/strict'
import { mkdtempSync, readFileSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { PiAdapter, type PiAdapterOptions } from './adapter.ts'
import type { AgentEvent } from '../contract.ts'

const fixture = join(dirname(fileURLToPath(import.meta.url)), 'fake-pi.mjs')

async function collect(events: AsyncIterable<AgentEvent>): Promise<AgentEvent[]> {
  const collected: AgentEvent[] = []
  for await (const event of events) collected.push(event)
  return collected
}

async function runScenario(
  scenario: { mode?: string; options?: Partial<PiAdapterOptions> },
  input: { prompt: string; sessionId?: string },
): Promise<{ events: AgentEvent[]; argv: string[]; dir: string }> {
  const dir = mkdtempSync(join(tmpdir(), 'fake-pi-'))
  const argsFile = join(dir, 'args.jsonl')
  process.env.FAKE_PI_ARGS_FILE = argsFile
  if (scenario.mode) process.env.FAKE_PI_MODE = scenario.mode
  try {
    const adapter = new PiAdapter({
      command: [process.execPath, fixture],
      sessionDir: join(dir, 'sessions'),
      ...scenario.options,
    })
    const events = await collect(adapter.run({ ...input, cwd: dir }))
    let argv: string[] = []
    try {
      argv = JSON.parse(readFileSync(argsFile, 'utf8').trim())
    } catch {
      // crash mode may exit before writing
    }
    return { events, argv, dir }
  } finally {
    delete process.env.FAKE_PI_ARGS_FILE
    delete process.env.FAKE_PI_MODE
    rmSync(dir, { recursive: true, force: true })
  }
}

test('happy path: thinking, tool, final text from agent_end messages, done', async () => {
  const { events, argv } = await runScenario({}, { prompt: 'write an article' })
  assert.deepEqual(events[0], { kind: 'status', state: 'thinking' })
  assert.deepEqual(events[1], { kind: 'tool', name: 'bash', detail: 'ls -la' })
  assert.deepEqual(events[2], { kind: 'text', text: 'final pi answer' })
  assert.equal(events[3].kind, 'done')
  assert.deepEqual(argv.slice(0, 4), ['--mode', 'json', '-p', 'write an article'])
  assert.equal(argv[4], '--session')
})

test('a fresh run creates a session file path and reports it as sessionId', async () => {
  const { events, argv } = await runScenario({}, { prompt: 'hi' })
  const done = events.find((event) => event.kind === 'done') as { sessionId?: string }
  assert.ok(done.sessionId, 'expected a generated session path')
  assert.ok(done.sessionId!.endsWith('.jsonl'))
  assert.equal(argv[argv.indexOf('--session') + 1], done.sessionId)
})

test('a provided sessionId path is reused verbatim for resume', async () => {
  const session = '/data/pi-sessions/existing.jsonl'
  const { events, argv } = await runScenario({}, { prompt: 'again', sessionId: session })
  assert.equal(argv[argv.indexOf('--session') + 1], session)
  const done = events.find((event) => event.kind === 'done') as { sessionId?: string }
  assert.equal(done.sessionId, session)
})

test('passes --model when configured', async () => {
  const { argv } = await runScenario(
    { options: { model: 'local/gemma-4-26b' } },
    { prompt: 'hola' },
  )
  assert.equal(argv[argv.indexOf('--model') + 1], 'local/gemma-4-26b')
})

test('falls back to streamed deltas when agent_end has no messages', async () => {
  const { events } = await runScenario({ mode: 'deltas-only' }, { prompt: 'hi' })
  assert.deepEqual(events[2], { kind: 'text', text: 'streamed reply' })
})

test('a crash before agent_end surfaces stderr as the error', async () => {
  const { events } = await runScenario({ mode: 'crash' }, { prompt: 'boom' })
  assert.equal(events.length, 1)
  assert.equal(events[0].kind, 'error')
  assert.match((events[0] as { reason: string }).reason, /pi blew up/)
})

test('unparseable lines are skipped, run still completes', async () => {
  const { events } = await runScenario({ mode: 'garbage' }, { prompt: 'noisy' })
  assert.equal(events.at(-1)!.kind, 'done')
})
