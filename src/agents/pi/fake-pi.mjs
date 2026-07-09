// Test stand-in for the `pi` binary: speaks just enough of pi's
// --mode json JSONL event stream (session, agent_start, message_update,
// tool_execution_start, agent_end).
// Modes via FAKE_PI_MODE: happy (default) | deltas-only | crash | garbage.
// Records its argv to FAKE_PI_ARGS_FILE so tests can assert flags.

import { appendFileSync } from 'node:fs'

if (process.env.FAKE_PI_ARGS_FILE) {
  appendFileSync(process.env.FAKE_PI_ARGS_FILE, JSON.stringify(process.argv.slice(2)) + '\n')
}

const mode = process.env.FAKE_PI_MODE ?? 'happy'
const emit = (value) => process.stdout.write(JSON.stringify(value) + '\n')

if (mode === 'crash') {
  process.stderr.write('pi blew up: simulated failure\n')
  process.exit(2)
}

emit({ type: 'session', version: 3, id: 'pi-uuid-1', timestamp: 't', cwd: process.cwd() })
emit({ type: 'agent_start' })
if (mode === 'garbage') {
  process.stdout.write('not json at all\n')
}
emit({ type: 'tool_execution_start', toolName: 'bash', args: { command: 'ls -la' } })
emit({ type: 'message_update', assistantMessageEvent: { type: 'text_delta', delta: 'streamed ' } })
emit({ type: 'message_update', assistantMessageEvent: { type: 'text_delta', delta: 'reply' } })
if (mode === 'deltas-only') {
  emit({ type: 'agent_end' })
} else {
  emit({
    type: 'agent_end',
    messages: [
      { role: 'user', content: 'hi' },
      { role: 'assistant', content: [{ type: 'text', text: 'final pi answer' }] },
    ],
  })
}
