# telegram-bot-skill

Expose a local CLI coding agent as a Telegram bot, so you can talk to the agent running on your own machine from your phone.

Design rules:

- Zero dependencies. Node 24 stdlib only: `fetch` against the official Bot API, `node:test` for tests, native type stripping for TypeScript. Empty dependency tree, no framework underneath.
- Agent-agnostic. The core speaks one adapter contract. Claude Code is the first adapter; opencode, Codex CLI, Gemini CLI and any other harness with a headless mode plug in the same way.
- You always know what the bot is doing. The typing indicator stays alive, one status message tracks progress, the answer arrives separately.
- Strangers hit a gate, not the agent. A deterministic, non-agentic layer holds unknown users in a pending queue until the owner approves them into a tier with one tap.
- A convinced model is not a security boundary. Tiers map to harness-level config (permission rules, hooks), so a blocked tool stays blocked no matter what a chat user talks the agent into.

Status: Telegram client, agent adapter contract with the Claude Code adapter, and the presence layer are in (`npm test`, Node >= 22.18). Next up: the access gate. Plan lives in ROADMAP.md, module contracts in ARCHITECTURE.md.

License: MIT.
