import { test } from 'node:test'
import assert from 'node:assert/strict'
import { spawn } from 'node:child_process'
import { existsSync, mkdtempSync, readFileSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { dirname, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { FakeBotApi } from './telegram/fake-bot-api.ts'

const repoRoot = resolve(dirname(fileURLToPath(import.meta.url)), '..')

function runDaemon(
  command: string,
  cwd: string,
  env: Record<string, string>,
): Promise<{ code: number | null; output: string }> {
  return new Promise((resolvePromise) => {
    const child = spawn(process.execPath, [join(repoRoot, 'src', 'daemon.ts'), command], {
      cwd,
      env: { ...process.env, ...env },
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

function killLeftover(dir: string): void {
  const pidFile = join(dir, '.bridge.pid')
  if (!existsSync(pidFile)) return
  const pid = Number(readFileSync(pidFile, 'utf8').trim())
  try {
    process.kill(pid)
  } catch {
    // already gone
  }
}

test('daemon lifecycle: start returns with the claim output, status sees it, stop kills it', async () => {
  const fake = new FakeBotApi()
  await fake.start()
  const dir = mkdtempSync(join(tmpdir(), 'daemon-'))
  const env = {
    TELEGRAM_BOT_TOKEN: fake.token,
    TELEGRAM_API_BASE: fake.baseUrl,
    STATE_FILE: join(dir, 'state.json'),
  }
  try {
    const started = await runDaemon('start', dir, env)
    assert.equal(started.code, 0, started.output)
    assert.match(started.output, /claim the bot/, 'must hand back the claim link output')
    assert.match(started.output, /is polling/)
    assert.match(started.output, /running in the background/)
    assert.ok(existsSync(join(dir, '.bridge.pid')))

    const status = await runDaemon('status', dir, env)
    assert.equal(status.code, 0)
    assert.match(status.output, /bridge running/)

    const stopped = await runDaemon('stop', dir, env)
    assert.equal(stopped.code, 0)
    assert.match(stopped.output, /stopped/)
    assert.ok(!existsSync(join(dir, '.bridge.pid')))

    const after = await runDaemon('status', dir, env)
    assert.equal(after.code, 1)
    assert.match(after.output, /not running/)
  } finally {
    killLeftover(dir)
    await fake.stop()
    rmSync(dir, { recursive: true, force: true })
  }
})

test('daemon start fails loudly when the bridge is not configured', async () => {
  const dir = mkdtempSync(join(tmpdir(), 'daemon-bad-'))
  try {
    const started = await runDaemon('start', dir, { TELEGRAM_BOT_TOKEN: '' })
    assert.equal(started.code, 1)
    assert.match(started.output, /Not configured|exited during startup/)
    assert.ok(!existsSync(join(dir, '.bridge.pid')), 'no pid file for a dead bridge')
  } finally {
    killLeftover(dir)
    rmSync(dir, { recursive: true, force: true })
  }
})

test('a second start is a friendly no-op while one is running', async () => {
  const fake = new FakeBotApi()
  await fake.start()
  const dir = mkdtempSync(join(tmpdir(), 'daemon-dup-'))
  const env = {
    TELEGRAM_BOT_TOKEN: fake.token,
    TELEGRAM_API_BASE: fake.baseUrl,
    STATE_FILE: join(dir, 'state.json'),
  }
  try {
    const first = await runDaemon('start', dir, env)
    assert.equal(first.code, 0, first.output)
    const second = await runDaemon('start', dir, env)
    assert.equal(second.code, 0)
    assert.match(second.output, /already running/)
    await runDaemon('stop', dir, env)
  } finally {
    killLeftover(dir)
    await fake.stop()
    rmSync(dir, { recursive: true, force: true })
  }
})
