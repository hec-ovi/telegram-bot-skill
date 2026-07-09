#!/bin/sh
# Writes pi's provider config for the local llama.cpp server, then runs
# whatever the compose service asks for (pi itself, or the bridge).
set -e

mkdir -p /root/.pi/agent /data/workdir /data/pi-sessions

cat > /root/.pi/agent/models.json <<EOF
{
  "providers": {
    "local": {
      "baseUrl": "${LLAMA_BASE_URL:-http://127.0.0.1:8080/v1}",
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

exec "$@"
