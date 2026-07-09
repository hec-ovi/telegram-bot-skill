# telegram-bot-skill

Expose your local CLI coding agent (Claude Code first) as a Telegram bot, so you can talk to the agent running on your own machine from your phone.

Three problems this focuses on:

- You never know if the bot is thinking or dead. The bridge keeps Telegram's typing indicator alive and posts status while the agent works.
- Strangers are hard to handle. A deterministic, non-agentic gate sits in front of the agent: unknown users land in a pending queue, the owner approves them with one tap, and every user gets a tier.
- A convinced model is not a security boundary. Tiers map to agent-harness config (permission rules, hooks), so a blocked tool stays blocked no matter what a chat user talks the agent into.

Status: early. Research and roadmap phase, code lands next.

License: MIT.
