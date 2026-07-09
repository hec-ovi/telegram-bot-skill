// Test stand-in for the `claude` binary: speaks just enough stream-json.
// Modes via FAKE_CLAUDE_MODE: happy (default) | error-result | crash | garbage.
// Records its argv to FAKE_CLAUDE_ARGS_FILE so tests can assert flags.

import { appendFileSync } from 'node:fs'

if (process.env.FAKE_CLAUDE_ARGS_FILE) {
  appendFileSync(process.env.FAKE_CLAUDE_ARGS_FILE, JSON.stringify(process.argv.slice(2)) + '\n')
}

const mode = process.env.FAKE_CLAUDE_MODE ?? 'happy'
const sessionId = process.env.FAKE_CLAUDE_SESSION ?? 'sess-1'
const emit = (value) => process.stdout.write(JSON.stringify(value) + '\n')

if (mode === 'crash') {
  process.stderr.write('spawn blew up: simulated failure\n')
  process.exit(3)
}

emit({ type: 'system', subtype: 'init', session_id: sessionId, model: 'fake-model' })
if (mode === 'garbage') {
  process.stdout.write('this is not json\n')
}
emit({ type: 'rate_limit_event', rate_limit_info: { status: 'allowed' } })
emit({
  type: 'assistant',
  message: {
    role: 'assistant',
    content: [{ type: 'tool_use', name: 'Bash', input: { command: 'ls -la' } }],
  },
  session_id: sessionId,
})
if (mode === 'error-result') {
  emit({
    type: 'result',
    subtype: 'error_during_execution',
    is_error: true,
    result: 'simulated agent failure',
    session_id: sessionId,
  })
} else {
  emit({
    type: 'result',
    subtype: 'success',
    is_error: false,
    result: 'final answer text',
    session_id: sessionId,
  })
}
