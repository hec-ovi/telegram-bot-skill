#!/bin/sh
# Writes pi's provider config for the local llama.cpp server, then runs
# whatever the compose service asks for (pi itself, or the bridge).
set -e

mkdir -p /root/.pi/agent/extensions /data/workdir /data/pi-sessions

# Pi only ships /quit; people type /exit and feel trapped in the container.
# Register /exit as an alias that shuts pi down (which ends the container).
cat > /root/.pi/agent/extensions/exit-alias.ts <<'EOF'
export default function (pi) {
  pi.registerCommand("exit", {
    description: "Exit pi (alias of /quit; ends this docker container)",
    handler: async (_args, ctx) => {
      if (ctx && typeof ctx.shutdown === "function") {
        await ctx.shutdown()
      }
      process.exit(0)
    },
  })
}
EOF

cat > /root/.pi/agent/models.json <<EOF
{
  "providers": {
    "local": {
      "baseUrl": "${LLAMA_BASE_URL:-http://llm:8080/v1}",
      "api": "openai-completions",
      "apiKey": "local",
      "compat": {
        "supportsDeveloperRole": false,
        "supportsReasoningEffort": false
      },
      "models": [
        {
          "id": "${LLAMA_MODEL_ID:-gemma-4-26b}",
          "name": "${LLAMA_MODEL_NAME:-Gemma 4 26B heretic (llama.cpp)}",
          "reasoning": false,
          "input": ["text"],
          "contextWindow": ${LLAMA_CONTEXT_WINDOW:-131072},
          "maxTokens": ${LLAMA_MAX_TOKENS:-65536}
        }
      ]
    }
  }
}
EOF

if [ "$1" = "pi" ]; then
  echo "tips: leave pi with /exit or /quit (also: Ctrl+C twice, or Ctrl+D on an empty line)."
  echo "      if ever stuck, from another terminal: docker ps; docker kill <container>"
fi

exec "$@"
