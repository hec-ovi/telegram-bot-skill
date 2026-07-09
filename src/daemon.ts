// Non-blocking bridge control, built for agents whose shell tool cannot run
// background processes (the floor: one synchronous bash tool). `start`
// detaches the bridge, waits until the claim link / polling line reaches the
// log, prints that output, and RETURNS. `stop` and `status` do what they say.
//
//   npm run bg      -> node src/daemon.ts start
//   npm run stop    -> node src/daemon.ts stop
//   npm run status  -> node src/daemon.ts status

import { spawn } from 'node:child_process'
import { existsSync, openSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { dirname, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

const PID_FILE = resolve('.bridge.pid')
const LOG_FILE = resolve('.bridge.log')
const botScript = join(dirname(fileURLToPath(import.meta.url)), 'bot.ts')

function alivePid(): number | undefined {
  if (!existsSync(PID_FILE)) return undefined
  const pid = Number(readFileSync(PID_FILE, 'utf8').trim())
  if (!Number.isFinite(pid) || pid <= 0) return undefined
  try {
    process.kill(pid, 0)
    return pid
  } catch {
    return undefined
  }
}

function readLog(): string {
  return existsSync(LOG_FILE) ? readFileSync(LOG_FILE, 'utf8') : ''
}

const sleep = (ms: number) => new Promise((resolvePromise) => setTimeout(resolvePromise, ms))

async function start(): Promise<number> {
  const existing = alivePid()
  if (existing !== undefined) {
    console.log(`bridge already running (pid ${existing}). logs: ${LOG_FILE}`)
    return 0
  }
  rmSync(LOG_FILE, { force: true })
  const log = openSync(LOG_FILE, 'a')
  const child = spawn(process.execPath, [botScript], {
    detached: true,
    stdio: ['ignore', log, log],
  })
  child.unref()
  writeFileSync(PID_FILE, String(child.pid))

  for (let i = 0; i < 60; i++) {
    await sleep(250)
    const text = readLog()
    let dead = false
    try {
      process.kill(child.pid!, 0)
    } catch {
      dead = true
    }
    if (text.includes('is polling')) {
      console.log(text.trimEnd())
      console.log(`\nbridge running in the background (pid ${child.pid}). stop it with: npm run stop`)
      return 0
    }
    if (dead) {
      console.error(text.trimEnd())
      console.error('\nbridge exited during startup.')
      rmSync(PID_FILE, { force: true })
      return 1
    }
  }
  console.log(readLog().trimEnd())
  console.log(`\nstill starting (pid ${child.pid}); watch ${LOG_FILE}`)
  return 0
}

function stop(): number {
  const pid = alivePid()
  if (pid === undefined) {
    console.log('bridge is not running.')
    rmSync(PID_FILE, { force: true })
    return 0
  }
  process.kill(pid)
  rmSync(PID_FILE, { force: true })
  console.log(`bridge stopped (pid ${pid}).`)
  return 0
}

function status(): number {
  const pid = alivePid()
  if (pid === undefined) {
    console.log('bridge is not running. start it with: npm run bg')
    return 1
  }
  console.log(`bridge running (pid ${pid}). recent log:`)
  console.log(readLog().split('\n').slice(-12).join('\n'))
  return 0
}

const command = process.argv[2]
if (command === 'start') process.exit(await start())
else if (command === 'stop') process.exit(stop())
else if (command === 'status') process.exit(status())
else {
  console.error('usage: node src/daemon.ts start|stop|status')
  process.exit(2)
}
