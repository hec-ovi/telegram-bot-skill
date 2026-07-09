import { test } from 'node:test'
import assert from 'node:assert/strict'
import { spawn } from 'node:child_process'
import { existsSync, mkdtempSync, readFileSync, rmSync, statSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { dirname, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { loadEnvConfig } from './config.ts'
import { FakeBotApi } from './telegram/fake-bot-api.ts'

const repoRoot = resolve(dirname(fileURLToPath(import.meta.url)), '..')

function runSetup(
  env: Record<string, string>,
): Promise<{ code: number | null; output: string }> {
  return new Promise((resolvePromise) => {
    const child = spawn(process.execPath, [join(repoRoot, 'src', 'setup.ts')], {
      env: { ...process.env, ...env },
      cwd: repoRoot,
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

test('setup validates the token and writes a secured env file', async () => {
  const fake = new FakeBotApi()
  await fake.start()
  const dir = mkdtempSync(join(tmpdir(), 'setup-'))
  const envFile = join(dir, '.env')
  try {
    const { code, output } = await runSetup({
      TELEGRAM_BOT_TOKEN: fake.token,
      TELEGRAM_API_BASE: fake.baseUrl,
      ENV_FILE: envFile,
      OWNER_ID: '42',
    })
    assert.equal(code, 0, output)
    const written = readFileSync(envFile, 'utf8')
    assert.match(written, new RegExp(`TELEGRAM_BOT_TOKEN=${fake.token}`))
    assert.match(written, /BOT_USERNAME=fake_bot/)
    assert.match(written, /OWNER_ID=42/)
    assert.equal(statSync(envFile).mode & 0o777, 0o600, 'env file must be private')
    assert.match(output, /@fake_bot/)
  } finally {
    await fake.stop()
    rmSync(dir, { recursive: true, force: true })
  }
})

test('setup completes a hand-filled env file (secure route)', async () => {
  const fake = new FakeBotApi()
  await fake.start()
  const dir = mkdtempSync(join(tmpdir(), 'setup-hand-'))
  const envFile = join(dir, '.env')
  try {
    // The human copied the template and pasted only the token, no chat involved.
    writeFileSync(envFile, `TELEGRAM_BOT_TOKEN=${fake.token}\nBOT_USERNAME=\n`)
    const { code, output } = await runSetup({
      TELEGRAM_API_BASE: fake.baseUrl,
      ENV_FILE: envFile,
    })
    assert.equal(code, 0, output)
    const written = readFileSync(envFile, 'utf8')
    assert.match(written, /BOT_USERNAME=fake_bot/)
    assert.equal(statSync(envFile).mode & 0o777, 0o600)
  } finally {
    await fake.stop()
    rmSync(dir, { recursive: true, force: true })
  }
})

test('setup applies name and descriptions when provided', async () => {
  const fake = new FakeBotApi()
  await fake.start()
  const dir = mkdtempSync(join(tmpdir(), 'setup-id-'))
  const envFile = join(dir, '.env')
  try {
    const { code, output } = await runSetup({
      TELEGRAM_BOT_TOKEN: fake.token,
      TELEGRAM_API_BASE: fake.baseUrl,
      ENV_FILE: envFile,
      BOT_NAME: 'Newsroom Agent',
      BOT_DESCRIPTION: 'Writes articles on request',
      BOT_ABOUT: 'my agent, in my pocket',
    })
    assert.equal(code, 0, output)
    assert.deepEqual(fake.callsFor('setMyName')[0].params, { name: 'Newsroom Agent' })
    assert.deepEqual(fake.callsFor('setMyDescription')[0].params, {
      description: 'Writes articles on request',
    })
    assert.deepEqual(fake.callsFor('setMyShortDescription')[0].params, {
      short_description: 'my agent, in my pocket',
    })
    assert.match(readFileSync(envFile, 'utf8'), /BOT_NAME=Newsroom Agent/)
  } finally {
    await fake.stop()
    rmSync(dir, { recursive: true, force: true })
  }
})

test('setup rejects a bad token and writes nothing', async () => {
  const fake = new FakeBotApi()
  await fake.start()
  const dir = mkdtempSync(join(tmpdir(), 'setup-bad-'))
  const envFile = join(dir, '.env')
  try {
    fake.respondOnceWith('getMe', {
      status: 401,
      body: { ok: false, error_code: 401, description: 'Unauthorized' },
    })
    const { code, output } = await runSetup({
      TELEGRAM_BOT_TOKEN: 'bad-token',
      TELEGRAM_API_BASE: fake.baseUrl,
      ENV_FILE: envFile,
    })
    assert.equal(code, 1)
    assert.match(output, /failed/i)
    assert.equal(existsSync(envFile), false)
  } finally {
    await fake.stop()
    rmSync(dir, { recursive: true, force: true })
  }
})

test('loadEnvConfig loads the file without overriding real env vars', () => {
  const dir = mkdtempSync(join(tmpdir(), 'cfg-'))
  try {
    delete process.env.ENV_FILE
    writeFileSync(join(dir, '.env'), 'CFG_TEST_A=from-file\nCFG_TEST_B=file-b\n')
    process.env.CFG_TEST_A = 'from-env'
    delete process.env.CFG_TEST_B
    const loaded = loadEnvConfig(dir)
    assert.equal(loaded, join(dir, '.env'))
    assert.equal(process.env.CFG_TEST_A, 'from-env', 'real env must win over the file')
    assert.equal(process.env.CFG_TEST_B, 'file-b')
  } finally {
    delete process.env.CFG_TEST_A
    delete process.env.CFG_TEST_B
    rmSync(dir, { recursive: true, force: true })
  }
})

test('loadEnvConfig treats empty env vars as unset so the file wins', () => {
  const dir = mkdtempSync(join(tmpdir(), 'cfg-empty-'))
  try {
    delete process.env.ENV_FILE
    writeFileSync(join(dir, '.env'), 'TELEGRAM_BOT_TOKEN=from-file\n')
    process.env.TELEGRAM_BOT_TOKEN = ''
    loadEnvConfig(dir)
    assert.equal(process.env.TELEGRAM_BOT_TOKEN, 'from-file')
  } finally {
    delete process.env.TELEGRAM_BOT_TOKEN
    rmSync(dir, { recursive: true, force: true })
  }
})

test('loadEnvConfig is a no-op without a file', () => {
  const dir = mkdtempSync(join(tmpdir(), 'cfg-none-'))
  try {
    delete process.env.ENV_FILE
    assert.equal(loadEnvConfig(dir), undefined)
  } finally {
    rmSync(dir, { recursive: true, force: true })
  }
})
