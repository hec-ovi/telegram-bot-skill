# Roadmap

Ground rules for every phase:

- Zero dependencies, Node 24 LTS stdlib only. No frameworks, no wrappers.
- Agent-agnostic core, agents live behind the adapter contract in ARCHITECTURE.md.
- The security boundary is deterministic code (gate + policy), never the model.
- Every phase lands as pushed commits on main, with tests run by `node --test` and docs updated in the same phase.

## Phase 0: bootstrap (done)

Repo, MIT license, README stub, research store. 2026-07-09.

## Phase 1: contracts and docs (done)

ARCHITECTURE.md with module boundaries and each contract's in/out. This roadmap.

## Phase 2: telegram client

`src/telegram`: thin client over `fetch` against the official Bot API, base URL injectable for tests. `getUpdates` long-poll loop with offset tracking and crash-safe resume, `sendMessage`, `editMessageText`, `sendChatAction`, `answerCallbackQuery`, `setMessageReaction`, `getMe`. Outbound queue that honors 429 `retry_after`. Chunking near the 4096-char cap on paragraph or word boundaries. HTML parse mode with `<` `>` `&` escaping.
Tests: `node:test` plus a local `node:http` fake of the Bot API, exercised end to end through the polling loop.

## Phase 3: adapter contract and first adapter

`src/agents/contract.ts` per ARCHITECTURE.md, plus a scripted fake adapter for tests. `src/agents/claude-code`: spawns `claude -p --output-format stream-json --verbose`, parses the NDJSON events, captures `session_id`, resumes with `--resume`. Capture the real event schema from a live run, do not trust docs alone.
Tests: a fake `claude` executable as fixture, no network.

## Phase 4: presence layer

`src/presence`: typing action re-sent about every 4.5s while a run lives, one status message edited in place (at least 1.5s between edits, honors `retry_after`), tool activity shown ("running a command", "editing bot.ts"), final answer as a separate message, explicit resolution on the status message. Hard timeout with a failure state that says so.
Tests: fake adapter plus fake Bot API, assert the exact effect sequence including the timeout path.

## Phase 5: access gate

`src/gate` and `src/store`. Identity is the numeric Telegram user id. Tiers: owner, trusted, guest, blocked, plus a pending state. Unknown user: stored pending, gets a neutral "waiting for approval" reply, owner gets Approve/Deny + tier picker inline keyboard, decision notifies the user. Owner bootstrap: first launch prints a one-time claim deep link (`t.me/BOT?start=CODE`), first valid claim becomes owner.
Tests: end-to-end update-to-decision flows, including hostile cases: wrong claim code, double claim, blocked user, callback forgery.

## Phase 6: tier policy enforcement

`src/policy` maps tiers to `TierPolicy`. The Claude Code adapter turns a policy into generated per-tier settings (permissions allow/deny), `--allowedTools` / `--disallowedTools` flags, and a PreToolUse hook that denies out-of-tier calls (a hook deny holds even in bypassPermissions mode, per the Claude Code docs). Adapters that cannot do this declare `toolGating: 'soft'` or `'none'` and the runner refuses them for non-owner tiers.
Tests: assert the generated config and flags per tier, and that capability downgrades block routing.

## Phase 7: onboarding

`init` wizard: paste the BotFather token, validate with `getMe`, write config, print the owner claim link and a QR code. The QR encoder is our own zero-dep module (byte mode) rendered as terminal blocks, isolated in `src/qr` with its own tests. README rewritten around the three-minute setup.

## Phase 8: more adapters

opencode (`opencode run` plus the `opencode.json` permissions block; verify the reported SDK deny-rule bug does not affect the config path before trusting it as hard gating), Codex CLI (`codex exec --json`, session resume), Gemini CLI. `docs/ADAPTERS.md`: how to write an adapter, how to declare capabilities honestly.

## Phase 9: hardening

Per-user rate limits, append-only audit log (who asked what, which tier, what was denied), token hygiene (the bot token never appears in logs or error dumps, a known CVE class in this space), per-chat run queue, restart resilience for offsets and pending approvals.

## Phase 10: packaging

SKILL.md written so that any harness agent, including a small local model, can install and configure the bridge by following a single file. npm publish with the empty dependency tree. CHANGELOG.

## Phase 11: later

Local MCP server exposing bridge control (approve user, change tier, read audit log) as tools. Group and forum-topic support. `sendMessageDraft` / rich-message streaming where the Bot API offers it, with `editMessageText` as the fallback.
