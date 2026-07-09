---
name: telegram-bot
description: Set up and run a private Telegram bot that lets the human chat with this coding agent from their phone. Use when the human asks to set up the telegram bot, to talk to the agent from Telegram, or to manage who can access it. This is a checklist to execute, not a document to describe. Start at step 1 right away by asking the token question.
---

# Telegram bot setup

This is a checklist to run, not a document to explain. Do not describe this file, do not list features, do not ask permission to start. Your next message to the human is the step 1 question. One step per message, short messages, wait for the answer.

## Step 1: ask for the token

Ask: "Do you already have a Telegram bot token from @BotFather? If yes, paste it here. If no, just say no and I will guide you, it takes a minute."

If they paste a token (it looks like `123456789:AAE...`), skip to step 3.

## Step 2: help them create one

Send these five messages one at a time. Wait for the human's answer between each.

1. "Open Telegram and search for @BotFather. It has a blue verified check. Say ready when it is open."
2. "Send it this message: /newbot"
3. "It asks for a name. Reply with anything, for example: My Agent"
4. "It asks for a username. It must end in bot, for example: maria_agent_bot. If it says taken, try another one ending in bot."
5. "It now sent you a long token that looks like 123456789:AAE... Copy the whole thing and paste it here."

## Step 3: check the token

Run:

```bash
curl -s https://api.telegram.org/bot<TOKEN>/getMe
```

If the reply contains `"ok":true`, continue. If it is a 401, the token is wrong: go back to step 1. Do not repeat the full token back to the human and do not write it into any file of the repo.

## Step 4: start the bridge

From the folder that contains this SKILL.md:

```bash
TELEGRAM_BOT_TOKEN=<token> npm start
```

There is nothing to install first; the project has zero dependencies. The bridge must stay running: start it as a background process if you can, otherwise ask the human to run that command in a second terminal and paste back what it prints.

Special case, docker rig: if your working directory is `/skill`, you are inside the examples/pi-gemma container and cannot start the bridge yourself. Tell the human: put the token into `examples/pi-gemma/.env` as `TELEGRAM_BOT_TOKEN=<token>`, then run on the host: `docker compose up bot`.

## Step 5: hand over the claim link

The first start prints a one-time link like `https://t.me/<botname>?start=<code>` and a QR code of it. Tell the human: scan the QR with your phone or tap the link, then press Start in Telegram. The first tap becomes the owner and the code stops working.

## Step 6: confirm it works

Tell the human to send the bot any message from their phone. They should see the typing indicator, a status message that updates while the agent works, then the answer. Anyone else who messages the bot gets "this bot is private", and the owner gets Approve / Guest / Block buttons for them.

## If something fails

- Telegram answers 401: bad or revoked token. Redo steps 1 to 3.
- The bot never replies: check the bridge process is still running and the machine has internet. No ports or public IP are needed.
- A non-owner gets "cannot enforce per-tier tool limits": expected until per-tier enforcement ships (phase 6); only the owner can run the agent for now.

Optional env vars for step 4: `STATE_FILE` (default `./bot-state.json`), `AGENT_CWD` (folder the agent works in), `AGENT_ADAPTER` (`claude-code` default, or `pi`), `PI_MODEL` (for pi, e.g. `local/llm`), `OWNER_ID` (recover mode: numeric Telegram id seeded as owner at boot, skips the claim link entirely; also `TRUSTED_IDS` / `GUEST_IDS` / `BLOCKED_IDS`, comma-separated).
