# Pi + local Gemma test rig

Runs the bridge with a fully local brain: the [Pi coding agent](https://github.com/earendil-works/pi) talking to a llama.cpp server on your host (tested target: Gemma 4 26B heretic on Vulkan). Docker gives Pi a sandbox; the skill repo is mounted read-write at `/skill`.

## Prerequisites

- Your llama.cpp server running on the host with the OpenAI-compatible API. Set `LLAMA_BASE_URL` if it is not `http://127.0.0.1:8080/v1`, and `LLAMA_MODEL_ID` to the id your server reports at `/v1/models`.
- Docker.

## The full-cycle test

Step 1, let the agent guide the setup:

```bash
cd examples/pi-gemma
docker compose run --rm pi
```

Inside Pi, type: `set up the telegram bot skill for me` (or `/skill:telegram-bot`). The agent follows SKILL.md: it asks whether you already have a bot token, and if not it walks you through @BotFather step by step. Keep the token it gives you. Exit Pi.

Step 2, start the bridge:

```bash
TELEGRAM_BOT_TOKEN=123456789:AAE... docker compose up bot
```

First boot prints the one-time owner claim link and a QR code in the terminal. Scan the QR with your phone (or tap the link), press Start in Telegram, and you are the owner.

Step 3, talk to it. Send the bot a message from your phone. You should see the typing indicator, a working-status message that updates while Pi and Gemma think, and then the answer. Each chat keeps its own Pi session, so follow-ups have context.

## Notes

- If Pi cannot find the model, run `pi` interactively and check `/model`; adjust `LLAMA_MODEL_ID` so `local/<id>` matches what your llama.cpp server serves.
- Non-owner users get a pending message and you get Approve / Guest / Block buttons. Until per-tier tool enforcement lands (phase 6), approved non-owners are refused agent runs by design, since Pi's tool limits are not yet mapped per tier.
- State (owner, tiers, sessions) lives in the `data` volume; wipe it with `docker compose down -v` to start the test from zero.
