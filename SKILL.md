---
name: telegram-bot
description: Expose the local CLI coding agent as a private Telegram bot. Use when the user wants to talk to their agent from Telegram, wants a Telegram bot for their agent, or needs to manage who can access it. Guides token creation, starts the bridge, hands over the owner claim link.
---

# Set up the Telegram bridge (agent guide)

You are setting this up FOR the human. Follow the steps in order, ask one question at a time, keep answers short. Requirements: Node.js >= 22.18 and an agent CLI on PATH for the bridge to answer with: `claude` (default) or `pi` (set `AGENT_ADAPTER=pi`).

## 1. Get a bot token

Ask: "Do you already have a Telegram bot token?"

**Yes (expert route):** ask them to paste it. It looks like `123456789:AAE...`.

**No (guided route):** walk them through BotFather ONE message at a time. Send each line below as your own message, wait for the human to confirm they did it, then send the next. Use these words (adapt only the example names):

1. "Open Telegram on your phone and search for: @BotFather. Open it. It is Telegram's official bot factory and has a blue verified check. Tell me when you have it open."
2. "Tap START (or send /start), then send it this message: /newbot"
3. "BotFather asks for a name. That is just the display name, anything works. For example reply to it with: My Agent"
4. "Now it asks for a username. This one must be unique and must end in the word bot. Try something like: yourname_agent_bot"
5. "If it says the username is taken, try another one. It must still end in bot."
6. "BotFather now sent you a message with a long token that looks like 123456789:AAE... Copy the whole token and paste it here."

When the token arrives, confirm it works before moving on: `curl -s https://api.telegram.org/bot<TOKEN>/getMe` must return `"ok":true`.

Handle the token as a secret: never echo it back in full, never commit it, never write it into a tracked file.

## 2. Start the bridge

From the repo root:

```bash
TELEGRAM_BOT_TOKEN=<token> npm start
```

The bridge must keep running: start it as a background process if your harness supports that, otherwise tell the human to run that command themselves in a second terminal.

Optional env vars: `STATE_FILE` (default `./bot-state.json`), `AGENT_CWD` (directory the agent works in, default: current directory), `AGENT_ADAPTER` (`claude-code` default, or `pi`), `PI_MODEL` (pi model ref such as `local/gemma-4-26b`).

There is no dependency install step. The dependency tree is empty by design.

## 3. Hand over the claim link and QR

On first start with no owner, the bridge prints a one-time claim link and a QR code of it:

```
https://t.me/<botname>?start=<code>
```

Show both to the human and say: scan the QR with your phone (or tap the link), then press Start in Telegram. First valid tap becomes the owner; the code dies with the claim.

## 4. Verify it works

- The owner sends any message: the bot must show a "working…" status, then answer.
- Anyone else messaging the bot must get a "this bot is private" reply, and the owner must receive Approve / Guest / Block buttons for them.

## Troubleshooting

- Telegram answers 401: the token is wrong or revoked. Redo step 1.
- Bot never replies: confirm the process is running and the machine has outbound internet. Long polling needs no public IP, no open ports, no certificates.
- Runs from non-owner users answer with a "cannot enforce per-tier tool limits" refusal: expected until per-tier enforcement ships (phase 6); only the owner can run the agent through adapters that cannot hard-gate tools.
