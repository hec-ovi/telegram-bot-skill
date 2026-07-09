---
name: telegram-bot
description: Set up and run a private Telegram bot that lets the human chat with this coding agent from their phone. Use when the human asks to set up the telegram bot, to talk to the agent from Telegram, or to manage who can access it. This is a checklist to execute, not a document to describe. Start at step 1 right away by asking the token question.
---

# Telegram bot setup

This is a checklist to run, not a document to explain. Do not describe this file, do not list features, do not ask permission to start. Begin at step 0. One step per message, short messages, wait for the answer.

## Step 0: is it already configured?

Check for an existing token before asking anything, in this order, without ever printing it:

1. The environment variable (containers and rigs pass it this way):

```bash
[ -n "$TELEGRAM_BOT_TOKEN" ] && curl -s "https://api.telegram.org/bot${TELEGRAM_BOT_TOKEN}/getMe"
```

2. A `.env` file next to this SKILL.md:

```bash
curl -s "https://api.telegram.org/bot$(grep '^TELEGRAM_BOT_TOKEN=' .env | cut -d= -f2-)/getMe"
```

No curl on this machine? Run `npm run setup` with no arguments instead: it finds the token the same way (env first, then `.env`), validates it against Telegram using Node alone, and prints the bot's username.

If the check says `"ok":true` (or setup prints the bot name), everything is already set up. Tell the human which bot it is and go straight to step 4 (start it) and step 6 (confirm). Only continue to step 1 when no place has a usable token.

## Step 1: ask for the token

Ask: "Do you already have a Telegram bot token from @BotFather? If yes: safest is to NOT paste it in this chat. Copy .env.example to .env, put the token after TELEGRAM_BOT_TOKEN=, save, and say done. (Pasting it here works too if you prefer.) If no, just say no and I will guide you, it takes a minute."

If they say done (secure route), skip to step 3. If they paste a token (it looks like `123456789:AAE...`), also skip to step 3.

## Step 2: help them create one

Send these five messages one at a time. Wait for the human's answer between each.

1. "Open Telegram and search for @BotFather. It has a blue verified check. Say ready when it is open."
2. "Send it this message: /newbot"
3. "It asks for a name. Reply with anything, for example: My Agent"
4. "It asks for a username. It must end in bot, for example: maria_agent_bot. If it says taken, try another one ending in bot."
5. "It now sent you a long token that looks like 123456789:AAE... That token is a SECRET, whoever has it controls your bot. Safest: copy .env.example to .env, put it after TELEGRAM_BOT_TOKEN=, save, and say done. Or paste it here and I will store it for you."

## Step 3: check and store the token

The token is a secret: never repeat it back to the human, never commit it, it lives only in `.env` (gitignored).

If the human filled `.env` themselves (secure route), validate and complete the file:

```bash
npm run setup
```

If the human pasted the token in chat instead, store and validate in one go:

```bash
TELEGRAM_BOT_TOKEN=<token> npm run setup
```

Either way, setup checks the token against Telegram, writes `.env` with file mode 600, and records the bot's username. If it fails with 401, the token is wrong: go back to step 1.

## Step 4: start the bridge

From the folder that contains this SKILL.md:

```bash
npm start
```

It reads `.env` by itself, so this exact command also works after any reboot or in a fresh session: no arguments, no reconfiguration. There is nothing to install; the project has zero dependencies. The bridge must stay running: start it as a background process if you can, otherwise ask the human to run it in a second terminal and paste back what it prints.

Special case, docker rig: if your working directory is `/skill`, you are inside the examples/pi-gemma container and cannot start the bridge yourself. Tell the human: put the token into `examples/pi-gemma/.env` as `TELEGRAM_BOT_TOKEN=<token>`, then run on the host: `docker compose up bot`.

## Step 5: hand over the claim link

The first start prints a one-time link like `https://t.me/<botname>?start=<code>` and a QR code of it. Tell the human: scan the QR with your phone or tap the link, then press Start in Telegram. The first tap becomes the owner and the code stops working.

## Step 6: confirm it works

Tell the human to send the bot any message from their phone. They should see the typing indicator, a status message that updates while the agent works, then the answer. Anyone else who messages the bot gets "this bot is private", and the owner gets Approve / Guest / Block buttons for them.

## Optional: rename the bot, set its description or avatar

If the human wants to change how the bot looks (any time, not just during setup):

- Display name, profile description, and the short "about" line can be set from here:

```bash
BOT_NAME="My Agent" BOT_DESCRIPTION="What this bot does" BOT_ABOUT="short profile line" npm run setup
```

- The @username can never be changed; that would mean creating a new bot.
- The avatar cannot be set through the Bot API. Guide the human: open @BotFather, send `/setuserpic`, pick the bot, then send it the photo.

## If something fails

- Telegram answers 401: bad or revoked token. Redo steps 1 to 3.
- "Is the bridge online?" Check where it runs: the process, or `docker compose ps bot` in the docker rig. From Telegram's side, `curl -s "https://api.telegram.org/bot${TELEGRAM_BOT_TOKEN}/getUpdates"` returning a 409 conflict proves a bridge is polling; a normal reply proves nothing (and the probe may briefly bump the real bridge, which recovers by itself). Never look for the process from inside a different container.
- The bot never replies: check the bridge process is still running and the machine has internet. No ports or public IP are needed.
- A non-owner gets "cannot enforce per-tier tool limits": expected until per-tier enforcement ships (phase 6); only the owner can run the agent for now.

Optional env vars for step 4: `STATE_FILE` (default `./bot-state.json`), `AGENT_CWD` (folder the agent works in), `AGENT_ADAPTER` (`claude-code` default, or `pi`), `PI_MODEL` (for pi, e.g. `local/llm`), `OWNER_ID` (recover mode: numeric Telegram id seeded as owner at boot, skips the claim link entirely; also `TRUSTED_IDS` / `GUEST_IDS` / `BLOCKED_IDS`, comma-separated).
