import { test } from 'node:test'
import assert from 'node:assert/strict'
import { mkdtempSync, readFileSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { ClaudeCodeAdapter } from './adapter.ts'
import type { AgentEvent } from '../contract.ts'

const fixture = join(dirname(fileURLToPath(import.meta.url)), 'fake-claude.mjs')

async function collect(events: AsyncIterable<AgentEvent>): Promise<AgentEvent[]> {
  const collected: AgentEvent[] = []
  for await (const event of events) collected.push(event)
  return collected
}

interface Scenario {
  mode?: string
  sessionId?: string
}

async function runScenario(
  scenario: Scenario,
  input: { prompt: string; sessionId?: string },
): Promise<{ events: AgentEvent[]; argv: string[] }> {
  const dir = mkdtempSync(join(tmpdir(), 'fake-claude-'))
  const argsFile = join(dir, 'args.jsonl')
  process.env.FAKE_CLAUDE_ARGS_FILE = argsFile
  if (scenario.mode) process.env.FAKE_CLAUDE_MODE = scenario.mode
  if (scenario.sessionId) process.env.FAKE_CLAUDE_SESSION = scenario.sessionId
  try {
    const adapter = new ClaudeCodeAdapter({ command: [process.execPath, fixture] })
    const events = await collect(adapter.run({ ...input, cwd: dir }))
    let argv: string[] = []
    try {
      argv = JSON.parse(readFileSync(argsFile, 'utf8').trim())
    } catch {
      // crash mode may exit before writing; argv stays empty
    }
    return { events, argv }
  } finally {
    delete process.env.FAKE_CLAUDE_ARGS_FILE
    delete process.env.FAKE_CLAUDE_MODE
    delete process.env.FAKE_CLAUDE_SESSION
    rmSync(dir, { recursive: true, force: true })
  }
}

test('happy path: thinking, tool activity, final text, done with session id', async () => {
  const { events, argv } = await runScenario({}, { prompt: 'say hi' })
  assert.deepEqual(events, [
    { kind: 'status', state: 'thinking' },
    { kind: 'tool', name: 'Bash', detail: 'ls -la' },
    { kind: 'text', text: 'final answer text' },
    { kind: 'done', sessionId: 'sess-1' },
  ])
  assert.deepEqual(argv, ['-p', 'say hi', '--output-format', 'stream-json', '--verbose'])
})

test('passes --resume when a session id is provided', async () => {
  const { argv } = await runScenario({ sessionId: 'prev-9' }, { prompt: 'continue', sessionId: 'prev-9' })
  assert.deepEqual(argv, [
    '-p',
    'continue',
    '--output-format',
    'stream-json',
    '--verbose',
    '--resume',
    'prev-9',
  ])
})

test('an is_error result becomes a single error event, no done', async () => {
  const { events } = await runScenario({ mode: 'error-result' }, { prompt: 'fail please' })
  assert.deepEqual(events.at(-1), { kind: 'error', reason: 'simulated agent failure' })
  assert.ok(!events.some((event) => event.kind === 'done'))
})

test('a crash before any result surfaces stderr as the error reason', async () => {
  const { events } = await runScenario({ mode: 'crash' }, { prompt: 'boom' })
  assert.equal(events.length, 1)
  assert.equal(events[0].kind, 'error')
  assert.match((events[0] as { reason: string }).reason, /spawn blew up/)
})

test('unparseable output lines are skipped, run still completes', async () => {
  const { events } = await runScenario({ mode: 'garbage' }, { prompt: 'noisy' })
  assert.deepEqual(events.at(-1), { kind: 'done', sessionId: 'sess-1' })
})

test('a missing binary yields an error event instead of throwing', async () => {
  const adapter = new ClaudeCodeAdapter({ command: ['/nonexistent/claude-binary'] })
  const events = await collect(adapter.run({ prompt: 'hi', cwd: tmpdir() }))
  assert.equal(events.length, 1)
  assert.equal(events[0].kind, 'error')
})
