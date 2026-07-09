# Pi + local Gemma test rig

One compose file, three containers, one `.env`: [llama.cpp](https://github.com/ggml-org/llama.cpp) serving a local GGUF on Vulkan (service config mirrors [llama-vulkan-strix](https://github.com/hec-ovi/llama-vulkan-strix), weights pinned to GTT on Strix Halo), the [Pi coding agent](https://github.com/earendil-works/pi) wired to it, and the bridge answering Telegram through both. No cloud, no API keys.

## Tested on the floor, on purpose

This rig is the project's reference test bench, and it is deliberately the weakest reasonable stack: a small local model (Gemma 4 26B MoE, about 4B active parameters per token, Q4 quantized) driven by a tiny CLI agent (Pi). The bridge does all the deterministic work itself: the gate, the tiers, the typing and status feedback, the sessions, the QR onboarding. The agent behind it only has to read SKILL.md and answer questions. So if setup and chat survive this floor, a stronger CLI (Claude Code, Codex, opencode, Hermes) on a bigger model has strictly more capability to work with, never less. That is the design bet, and this rig is how it keeps getting verified.

## Run it

Prerequisites: Docker, an AMD box with `/dev/dri` (the reference is a Strix Halo APU), and a GGUF on disk.

```bash
cd examples/pi-gemma
cp .env.example .env
# edit .env: MODELS_DIR, LLM_MODEL, RENDER_GID / VIDEO_GID (and later the token)
```

**Step 1, get a token** (skip if you already have one, expert route: paste it into `.env`):

```bash
docker compose run --rm pi
```

Tell Pi: `set up the telegram bot skill for me`. It reads SKILL.md and walks you through @BotFather one message at a time. Put the token it validates into `.env` as `TELEGRAM_BOT_TOKEN`, exit Pi.

**Step 2, start the bridge:**

```bash
docker compose up bot        # first time: watch the claim link + QR appear
```

First boot prints the one-time owner claim link and a QR code. Scan it with your phone, tap Start, you are the owner. (With `OWNER_ID` set in `.env` there is no claim step at all; it boots owned.)

For keeps, run it detached:

```bash
docker compose up -d bot
```

Both `llm` and `bot` carry `restart: unless-stopped`, so after a PC reboot the Docker daemon brings the whole rig back by itself: token and access re-read from the container env, poll offset and per-chat sessions from the `data` volume. It resumes listening with no human involved; `docker compose logs -f bot` to peek.

**Step 3, talk to it** from your phone: typing indicator, a working-status message that updates while Pi and Gemma think, then the answer. Follow-ups resume the same per-chat session. Anyone else who messages the bot waits at the gate for your Approve / Guest / Block tap.

## Notes

- Leaving pi: `/exit` or `/quit` (also Ctrl+C twice, or Ctrl+D on an empty line). `/exit` is an alias this rig adds via a pi extension; stock pi only has `/quit`. If ever stuck: `docker ps` then `docker kill <container>` from another terminal.
- The first `up` pulls the llama.cpp image and loads the model; the healthcheck allows about 5 minutes for that.
- The llama.cpp API is also published on the host at `:${LLM_PORT}` (default 8080) for curl debugging; the containers talk over the compose network regardless.
- All state (owner, tiers, sessions) lives in the `data` volume. `docker compose down -v` resets the whole test to zero.
- Recover mode: set `OWNER_ID` (and optionally `TRUSTED_IDS` / `GUEST_IDS` / `BLOCKED_IDS`) in `.env` and even a wiped rig boots already owned, no claim link. Get your numeric id from @userinfobot, or claim once and copy it from the state file.
- Non-owner users are refused agent runs until phase 6 lands (per-tier tool enforcement); that refusal is deliberate, not a bug.
