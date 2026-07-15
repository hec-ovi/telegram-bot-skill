# Architecture

One idea drives everything: the bridge is a channel, not an agent. Telegram in, agent out, and every security decision happens in deterministic code before the model sees a byte.

## Zero dependencies

Runtime is Node 24 LTS (works on anything >= 22.18): built-in `fetch` talks to `api.telegram.org`, `node:test` runs the tests, native type stripping runs the TypeScript. `package.json` ships an empty dependency tree. The bridge wraps exactly two things, the official Bot API and a local agent binary, and nothing else.

## Modules

```
telegram --> gate --> runner --> agents/<adapter>
               |        |
             store   presence --> telegram
                     policy
```

Each module is isolated, speaks only through its contract, and is replaceable on its own.

### telegram

Zero-dep Bot API client.
In: bot token, injectable base URL (tests point it at a local fake).
Out: normalized `IncomingMessage`, a discriminated union: `{ kind: 'text', chatId, userId, messageId, text }` or `{ kind: 'callback', chatId, userId, messageId, callbackId, callbackData? }` (the callback id is what `answerCallbackQuery` needs).
Accepts: `OutgoingEffect` (sendText, editText, chatAction, reaction, inlineKeyboard, answerCallback).
Owns: the long-poll loop with offset tracking, 429 `retry_after` backoff, chunking near the 4096-char cap on paragraph boundaries, HTML-mode escaping of `<` `>` `&`.
Knows nothing about agents or tiers.

### gate

Deterministic and non-agentic, by design and forever.
In: `IncomingMessage` plus the user store.
Out: exactly one of `allow(tier)`, `pending`, `deny`.
Owns: the owner-claim bootstrap (one-time deep-link code), the pending queue, the Approve/Deny + tier-picker callbacks.
No message text reaches any model until this module says `allow`.

### policy

In: tier name.
Out: `TierPolicy { tool allow/deny patterns, path scope, timeout, budget }`.
Adapter-agnostic data. Each adapter maps it to its harness's real enforcement mechanism (for Claude Code: generated settings permissions, `--allowedTools` / `--disallowedTools`, and a PreToolUse hook that denies out-of-tier calls). Prompt text is never an enforcement mechanism here.

### agents (the adapter contract)

In: `{ prompt, sessionId?, cwd, policy }`.
Out: async iterable of `AgentEvent`: `status('thinking') | tool(name, detail) | text(final) | done(sessionId) | error(reason)`.
Each adapter declares `capabilities { sessionResume: boolean, toolGating: 'hard' | 'soft' | 'none' }` and must declare them honestly. Adapters are the only agent-specific code in the repo. Claude Code is adapter #1; opencode, Codex CLI, Gemini CLI, Hermes or anything else with a headless mode implements the same interface.

### presence

In: the `AgentEvent` stream.
Out: `OutgoingEffect`s: a typing action re-sent inside Telegram's 5-second window while the run lives, one status message edited in place (throttled), tool activity surfaced in that status, the final answer as a separate message, and an explicit resolution mark on completion or failure. This module is why the user always knows whether the bot is thinking, working, or dead.

### store

Flat JSON files with atomic writes: users and tiers, pending approvals, chat-to-session map, poll offset. No database.

### runner

Composition root. Takes gate-approved messages, resolves the tier's policy, invokes the adapter, feeds presence, persists session ids. One active run per chat, later messages queue behind it. Refuses to route non-owner tiers to adapters that cannot enforce `toolGating: 'hard'`.

## MCP surface

`mcp/` is a consumer of the same contracts, not a second pipeline. `mcp/bridge.ts` builds the standard bot through `createBot` and plugs into its `onRun` hook, so telegram, gate, and store behave exactly as under `npm start`; only the last hop changes: the gate-approved message goes to the connected MCP client (your live coding session) instead of a spawned adapter. `mcp/rpc.ts` is a zero-dep JSON-RPC 2.0 router (request dispatch, cancellation via `notifications/cancelled`, progress ticks) plus the newline-delimited stdio binding; `mcp/http.ts` binds the same router to Streamable HTTP (one JSON-RPC message per POST, 127.0.0.1 only, stateless). `mcp/server.ts` wires it all and defines the tools: `wait_for_message`, `send_message`, `list_users`, `set_user_tier`, `bridge_status`.

Two duplex modes:

- **Pull** (default, any MCP client): `wait_for_message` blocks until the gate approves a message, backed by a queue so nothing is lost while the agent works.
- **Push** (`--channel` arg): declares the experimental `claude/channel` capability and emits `notifications/claude/channel`, which Claude Code (v2.1.80+, channels research preview) injects into the running session as `<channel>` events. Messages arriving mid-task queue in the session and are delivered on the next turn, so they never interrupt running work.

In both modes the gate rule holds: no message text reaches the client before `decide` says allow.

## Other surfaces

SKILL.md packaging (phase 10) sits on top the same way: a consumer of the contracts, not a resident of them.
