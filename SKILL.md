---
name: telegram-bot
description: Expose the local CLI coding agent as a private Telegram bot. Use when the user wants to talk to their agent from Telegram, wants a Telegram bot for their agent, or needs to manage who can access it. Guides token creation, starts the bridge, hands over the owner claim link.
---

# Set up the Telegram bridge (agent guide)

You are setting this up FOR the human. Follow the steps in order, ask one question at a time, keep answers short. Requirements: Node.js >= 22.18 and (for the default adapter) the `claude` CLI on PATH.

## 1. Get a bot token

Ask: "Do you already have a Telegram bot token?"

**Yes (expert route):** ask them to paste it. It looks like `123456789:AAE...`.

**No (guided route):** tell them to do this in Telegram (phone or desktop, about one minute, free):

1. Search for `@BotFather` and open it.
2. Send `/newbot`.
3. Pick any display name (example: "My Agent").
4. Pick a username; Telegram requires it to end in `bot` (example: `hector_agent_bot`).
5. BotFather replies with a token. Paste it here.

Handle the token as a secret: never echo it back in full, never commit it, never write it into a tracked file.

## 2. Start the bridge

From the repo root:

```bash
TELEGRAM_BOT_TOKEN=<token> npm start
```

Optional env vars: `STATE_FILE` (default `./bot-state.json`), `AGENT_CWD` (directory the agent works in, default: current directory).

There is no dependency install step. The dependency tree is empty by design.

## 3. Hand over the claim link

On first start with no owner, the bridge prints a one-time claim link:

```
https://t.me/<botname>?start=<code>
```

Show it to the human and say: open it in Telegram and tap Start. First valid tap becomes the owner; the code dies with the claim.

## 4. Verify it works

- The owner sends any message: the bot must show a "working…" status, then answer.
- Anyone else messaging the bot must get a "this bot is private" reply, and the owner must receive Approve / Guest / Block buttons for them.

## Troubleshooting

- Telegram answers 401: the token is wrong or revoked. Redo step 1.
- Bot never replies: confirm the process is running and the machine has outbound internet. Long polling needs no public IP, no open ports, no certificates.
- Runs from non-owner users answer with a "cannot enforce per-tier tool limits" refusal: expected until per-tier enforcement ships (phase 6); only the owner can run the agent through adapters that cannot hard-gate tools.
