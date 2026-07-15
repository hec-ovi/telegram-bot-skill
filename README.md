<h1 align="center">telegram-bot-skill</h1>

<p align="center">
  <strong>Your local CLI coding agent, reachable from your pocket: a zero-dependency bridge that turns any headless agent into a private Telegram bot.</strong>
</p>

<p align="center">
  <img src="https://img.shields.io/badge/Status-usable_·_phase_6_next-orange" alt="Status" />
  <img src="https://img.shields.io/badge/Dependencies-0-success" alt="Zero dependencies" />
  <img src="https://img.shields.io/badge/Node-%3E%3D22.18-339933?logo=nodedotjs&logoColor=white" alt="Node >= 22.18" />
  <img src="https://img.shields.io/badge/Tests-87_passing-brightgreen" alt="Tests" />
  <img src="https://img.shields.io/badge/License-MIT-green" alt="MIT" />
</p>

<p align="center">
  <img src="https://img.shields.io/badge/Telegram-official_Bot_API-26A5E4?logo=telegram&logoColor=white" alt="Telegram Bot API" />
  <img src="https://img.shields.io/badge/Adapters-Claude_Code_·_Pi-D97757?logo=anthropic&logoColor=white" alt="Adapters" />
  <img src="https://img.shields.io/badge/Local_models-noob--cli_·_Pi_·_llama.cpp-8A2BE2" alt="Local models" />
  <img src="https://img.shields.io/badge/MCP-stdio_·_HTTP-9d7bd8" alt="MCP transports" />
  <img src="https://img.shields.io/badge/opencode_·_Codex_·_Gemini-planned-lightgrey" alt="More adapters planned" />
  <img src="https://img.shields.io/badge/TypeScript-native,_no_build-3178C6?logo=typescript&logoColor=white" alt="TypeScript" />
</p>

---

## What this is

A bridge, not an agent. Telegram messages go in, your local agent's answers come out, and every security decision on the way happens in deterministic code before any model sees a byte. It speaks the official Bot API directly over Node's built-in `fetch`: no framework, no wrapper, an empty dependency tree.

One repo, three surfaces: an installable **skill** (an open SKILL.md any CLI agent can follow), the npm **toolkit** behind it (the `setup` / `users` / daemon **tooling** the skill drives), and an **MCP** server, stdio or Streamable HTTP, that makes your live session the agent that answers. All of it is tested against a local LLM, not just cloud models.

It exists to fix the three things that make agent-over-chat setups painful:

- **You never know if the bot is alive.** Here the typing indicator stays lit while the agent works, one status message tracks progress ("🔧 Bash: npm test"), the answer arrives separately, and every run ends in an explicit ✅ / ⚠️ / ⏱.
- **Strangers are all-or-nothing.** Here unknown users land in a pending queue, you get Approve / Guest / Block buttons, and everyone lives in a tier: owner, trusted, guest, blocked.
- **"The prompt says no" is not security.** Tiers map to the agent harness's own config (permission rules, hooks), so a denied tool stays denied no matter what a chat user talks the model into. Adapters that cannot enforce this honestly declare it, and the bridge refuses to route non-owner traffic through them.

### <a href="https://hec-ovi.github.io/telegram-bot-skill/">🗺️ Explore the interactive architecture map →</a>

A pannable blueprint of the whole pipeline: every module, its in/out contract, its status, and a link into its source, on one screen.

## Run it

Requires Node >= 22.18 and, for the default adapter, the `claude` CLI. There is no install step.

```bash
git clone https://github.com/hec-ovi/telegram-bot-skill
cd telegram-bot-skill
TELEGRAM_BOT_TOKEN=123456789:AAE... npm run setup   # once: validates + writes ./.env (mode 600)
npm start                                           # forever after: no arguments needed
```

Prefer not to have the token in your shell history either? `cp .env.example .env`, paste it into the file, and run `npm run setup` with no arguments; it validates and completes the file. `npm start` always reads `./.env` on its own, so a configured checkout is plug and play after any reboot.

First start prints a one-time claim link (`https://t.me/yourbot?start=...`) plus a QR code of it, right in the terminal (our own zero-dep encoder). Scan it, tap Start, and you are the owner. Everyone else who messages the bot waits at the gate until you tap a button.

| Env var | Required | Default | What |
|---|---|---|---|
| `TELEGRAM_BOT_TOKEN` | yes | | Bot token from @BotFather |
| `STATE_FILE` | no | `./bot-state.json` | Users, tiers, sessions, poll offset |
| `AGENT_CWD` | no | current dir | Directory the agent works in |
| `AGENT_ADAPTER` | no | `claude-code` | Which agent answers: `claude-code` or `pi` |
| `PI_MODEL` | no | | Pi model ref, e.g. `local/gemma-4-26b` |
| `OWNER_ID` | no | | Recover mode: numeric Telegram id seeded as owner at boot |
| `TRUSTED_IDS` / `GUEST_IDS` / `BLOCKED_IDS` | no | | Recover mode: comma-separated ids seeded into tiers |
| `BOT_NAME` / `BOT_DESCRIPTION` / `BOT_ABOUT` | no | | Bot identity, applied by `npm run setup` (avatar stays BotFather-only) |

Recover mode means the state file is never precious: wipe it, redeploy, spin up a fresh machine, and a boot with `OWNER_ID` set comes up already owned and usable, no claim link. Env is the source of truth for the ids it names (a stale stored owner gets demoted to trusted).

For a bot that outlives reboots, run `npm start` under your process manager of choice (a systemd unit with `Restart=always` works fine); state lives in the bot-state file, so a restart comes back listening with tiers intact.

### Fully local, no cloud

The bridge is verified live on a local LLM: [noob-cli](https://github.com/hec-ovi/noob-cli) driving qwen3.6-35b on a llama.cpp server served this bridge over the Streamable HTTP transport (`npm run mcp:http`, then `/mcp add telegram http://127.0.0.1:8765/mcp`), answering phone messages from the live terminal session while it kept doing other work. The spawn lane runs local too: set `AGENT_ADAPTER=pi` and point `PI_MODEL` at any llama.cpp / OpenAI-compatible server.

Small local models are the floor on purpose, and everything is verified against the floor. A stronger CLI (Claude Code, Codex, opencode, Hermes) on a bigger model has strictly more capability behind the same bridge, never less.

### No token yet?

Two routes:

- **You know Telegram bots:** paste your existing token and go.
- **First time:** open Telegram, find `@BotFather`, send `/newbot`, pick a name, pick a username ending in `bot`, copy the token it gives you. One minute, free. Or skip reading entirely: tell your CLI agent *"set up the telegram bot from this repo"*. [SKILL.md](SKILL.md) is written for agents, and it will walk you through token creation, start the bridge, and hand you the claim link.

## Install as a skill

The repo is an installable agent skill (open SKILL.md format), so any CLI agent can run the whole setup conversationally. Four routes:

```bash
# any code CLI that speaks the SKILL.md format
npx skills add hec-ovi/telegram-bot-skill

# Claude Code marketplace
/plugin marketplace add hec-ovi/telegram-bot-skill
/plugin install telegram-bot@telegram-bot-skill

# Codex
codex plugin marketplace add hec-ovi/telegram-bot-skill
codex plugin add telegram-bot-codex@telegram-bot-skill

# plain git, for anything that reads ~/.agents/skills (pi, hermes, ...) or ~/.claude/skills
git clone https://github.com/hec-ovi/telegram-bot-skill ~/.agents/skills/telegram-bot
```

Then tell your agent: *"set up the telegram bot"*. Plugin routes carry only the skill file; its step 0 clones the bridge code when it is missing.

## Chat with your live session instead (MCP)

`npm start` spawns a fresh headless agent per message. The MCP surface flips that: the coding session you already have open is the agent that answers, with its context, its tools, and its permission setup. Same `.env`, same state file, same gate; strangers still wait at the door.

Two steps, like `npx skills add` but for a tool server:

```bash
# 1. serve the bridge over HTTP (stays up on this machine, binds 127.0.0.1)
npm run mcp:http                          # port 8765; or: node mcp/server.ts --http <port>

# 2. install it in your CLI by URL
/mcp add telegram http://127.0.0.1:8765/mcp                              # noob-cli
claude mcp add --transport http telegram http://127.0.0.1:8765/mcp      # Claude Code
```

Clients that spawn servers themselves skip step 1: the repo ships `.mcp.json`, so opening this folder in Claude Code (or pointing any stdio MCP client at `node mcp/server.ts`) exposes the bridge as the `telegram` server with zero setup. [noob-cli](https://github.com/hec-ovi/noob-cli) runs its agent in a container without node, which is exactly what the HTTP route is for.

Once connected, telling the agent "serve the telegram bridge" is enough; the tool descriptions carry the loop. Two ways for messages to reach it:

- **Pull, works in any MCP client (stdio and HTTP).** The agent calls `wait_for_message` (blocking, queue-backed, nothing is lost while it works), answers with `send_message`, and calls `wait_for_message` again.
- **Push, Claude Code v2.1.80+ (channels, research preview, stdio only).** Add `--channel` to the server args in `.mcp.json` and start your session with `claude --dangerously-load-development-channels server:telegram`. Incoming messages now inject directly into the session as `<channel>` events: no polling, no blocked tool call, and they queue politely until the agent finishes what it is doing. Replies still go out through `send_message`. Two caveats: without that startup flag the notifications are dropped silently (Claude Code only listens to servers named in it), and messages sent while the very first consent dialog is still open can be missed; the server waits a 5-second grace period after the handshake before flushing, which covers the normal restart case.

The extra tools work in both modes: `list_users`, `set_user_tier`, and `bridge_status` (which carries the claim link while the bot is unclaimed) manage the whitelist without leaving the session. One rule stands: one bot token allows exactly one poller, so stop `npm start` / `npm run bg` before using the MCP surface, and vice versa.

### Manage access from the terminal

Live approvals are one tap in Telegram, and the same whitelist is scriptable:

```bash
npm run users                        # list everyone and their tier
npm run users -- set 123456 trusted  # owner | trusted | guest | blocked | pending
npm run users -- remove 123456
```

## Modules

Each module is isolated behind an explicit in/out contract (full detail in [ARCHITECTURE.md](ARCHITECTURE.md)); agent-specific code exists only inside `src/agents/<adapter>`.

| Module | Job | State |
|---|---|---|
| `src/telegram` | Bot API client: long poll, 429 backoff, 4096-char chunking | ✅ |
| `src/agents` | adapter contract + Claude Code and Pi adapters (live-verified schemas) | ✅ |
| `src/presence` | typing loop, throttled status edits, chunked answers, timeouts | ✅ |
| `src/gate` | deterministic access decisions, owner claim, approvals | ✅ |
| `src/store` | flat JSON state, atomic writes, no database | ✅ |
| `src/runner` | per-chat queue, session resume, capability refusal | ✅ |
| `src/qr` | zero-dep QR encoder for the claim link (byte mode, EC L, v1-6) | ✅ |
| `mcp/` | MCP server: your live session answers, stdio or HTTP, pull or push (channels) | ✅ |
| `src/policy` | tier to harness-config mapping (settings, hooks, flags) | 🔜 next |

## Roadmap

| Phase | What | State |
|---|---|---|
| 0 to 5 | contracts, telegram client, adapters, presence, gate, runnable bot | ✅ |
| 6 | per-tier tool enforcement inside the harness (settings + PreToolUse hooks) | 🔜 next |
| 7 | onboarding: terminal QR, `npm run setup`, `.env` config, agent-guided SKILL.md | ✅ |
| 8 | more adapters: Pi shipped with a local-model rig; opencode, Codex, Gemini pending | 🟡 partial |
| 9 | hardening: rate limits, audit log, token hygiene | ⬜ |
| 10 | packaging: skill install routes, npm publish | ⬜ |
| 11 | MCP surface: session-as-agent, stdio + HTTP, pull + push (channels) | ✅ |

Full plan with the reasoning per phase: [ROADMAP.md](ROADMAP.md).

## Tests

```bash
npm test
```

87 tests on Node's built-in runner: the Telegram client is exercised end to end against a real local `node:http` fake of the Bot API (long-poll holds, flood control, offset resume), the Claude Code and Pi adapters against scripted fake binaries, the QR encoder against the canonical Reed-Solomon vector plus a golden matrix that was cross-verified with an independent decoder (OpenCV), the whole bot through a full simulated conversation (claim, stranger knocks, forged approval rejected, owner approves, agent answers with live status, session resumes, troll blocked), and the MCP server as a spawned process on both transports: real JSON-RPC over stdio (handshake, both duplex modes, gate holds, cancellation, tier tools) and plain POSTs against the HTTP listener (initialize round-trip, 202 notifications, a full message-in/answer-out loop against the fake Bot API, typed refusals for GET/garbage/batches).

## Why zero dependencies

The bridge wraps exactly two things: the official Bot API and a local agent binary. Node 24 already ships everything needed to do that: `fetch`, a test runner, native TypeScript type stripping. Every dependency avoided is a supply-chain door that stays closed, which matters for a program whose job is to stand between the internet and a shell-capable agent. Recent CVE history in this exact product category is the cautionary tale.

```
src/
  telegram/   Bot API client, poller, chunking, flood control
  agents/     contract + claude-code and pi adapters (more to come)
  presence/   the "is it thinking or dead" layer
  gate/       deterministic access decisions
  store/      flat-file state
  runner/     queue + sessions + capability checks
  qr/         claim-link QR, rendered in the terminal
  app.ts      wiring, bot.ts: entry, daemon.ts: bg control
  setup.ts    token wizard, users.ts: whitelist management
mcp/          MCP server: rpc.ts dispatch + stdio wire, http.ts listener, bridge.ts glue, server.ts entry
examples/
plugins/      claude code and codex plugin packaging
```

MIT. Built by [Hector Oviedo](https://github.com/hec-ovi).
