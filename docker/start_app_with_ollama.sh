#!/usr/bin/env bash
set -euo pipefail

OLLAMA_HOST_VALUE="${OLLAMA_HOST:-0.0.0.0:11434}"
OLLAMA_MODEL="${OLLAMA_MODEL:-qwen2.5:0.5b}"
OLLAMA_STARTUP_TIMEOUT="${OLLAMA_STARTUP_TIMEOUT:-180}"
APP_MODEL_NAME="${APP_MODEL_NAME:-${OLLAMA_MODEL}}"
APP_BASE_URL="${APP_BASE_URL:-http://127.0.0.1:11434/v1}"

if [[ -n "${PYTHON_BIN:-}" ]]; then
  PYTHON_EXEC="${PYTHON_BIN}"
elif command -v python >/dev/null 2>&1; then
  PYTHON_EXEC="python"
elif command -v python3 >/dev/null 2>&1; then
  PYTHON_EXEC="python3"
else
  echo "No python interpreter found in container." >&2
  exit 1
fi

cleanup() {
  if [[ -n "${APP_PID:-}" ]] && kill -0 "${APP_PID}" 2>/dev/null; then
    kill "${APP_PID}" 2>/dev/null || true
  fi
  if [[ -n "${OLLAMA_PID:-}" ]] && kill -0 "${OLLAMA_PID}" 2>/dev/null; then
    kill "${OLLAMA_PID}" 2>/dev/null || true
  fi
}

trap cleanup EXIT INT TERM

export OLLAMA_HOST="${OLLAMA_HOST_VALUE}"

echo "Starting Ollama server at ${OLLAMA_HOST}"
ollama serve &
OLLAMA_PID=$!

for _ in $(seq 1 "${OLLAMA_STARTUP_TIMEOUT}"); do
  if curl -fsS "http://127.0.0.1:11434/api/tags" > /dev/null; then
    echo "Ollama server is ready."
    break
  fi

  if ! kill -0 "${OLLAMA_PID}" 2>/dev/null; then
    echo "Ollama process exited before readiness." >&2
    wait "${OLLAMA_PID}" || true
    exit 1
  fi
  sleep 1
done

if ! curl -fsS "http://127.0.0.1:11434/api/tags" > /dev/null; then
  echo "Timed out waiting for Ollama to become ready after ${OLLAMA_STARTUP_TIMEOUT}s." >&2
  exit 1
fi

if [[ "${OLLAMA_SKIP_PULL:-0}" != "1" ]]; then
  echo "Pulling Ollama model: ${OLLAMA_MODEL}"
  ollama pull "${OLLAMA_MODEL}"
fi

default_app_cmd="${PYTHON_EXEC} -m examples.local_model_docker_benchmark --backend openai --environment local --base-url ${APP_BASE_URL} --model ${APP_MODEL_NAME} --api-key EMPTY --runs 1"
APP_CMD="${APP_CMD:-${default_app_cmd}}"

if ! command -v python >/dev/null 2>&1; then
  APP_CMD="${APP_CMD//python /${PYTHON_EXEC} }"
fi

echo "Starting application command: ${APP_CMD}"
bash -lc "${APP_CMD}" &
APP_PID=$!

wait "${APP_PID}"
app_exit_code=$?

if kill -0 "${OLLAMA_PID}" 2>/dev/null; then
  kill "${OLLAMA_PID}" 2>/dev/null || true
  wait "${OLLAMA_PID}" 2>/dev/null || true
fi

exit "${app_exit_code}"