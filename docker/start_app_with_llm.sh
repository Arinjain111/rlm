#!/usr/bin/env bash
set -euo pipefail

VLLM_HOST="${VLLM_HOST:-0.0.0.0}"
VLLM_PORT="${VLLM_PORT:-8000}"
VLLM_MODEL="${VLLM_MODEL:-Qwen/Qwen2.5-0.5B-Instruct}"
VLLM_STARTUP_TIMEOUT="${VLLM_STARTUP_TIMEOUT:-180}"
VLLM_API_BASE="http://127.0.0.1:${VLLM_PORT}/v1"
APP_MODEL_NAME="${APP_MODEL_NAME:-${VLLM_MODEL}}"

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
  if [[ -n "${LLM_PID:-}" ]] && kill -0 "${LLM_PID}" 2>/dev/null; then
    kill "${LLM_PID}" 2>/dev/null || true
  fi
}

trap cleanup EXIT INT TERM

echo "Starting vLLM server with model: ${VLLM_MODEL}"
vllm_cmd=(
  "${PYTHON_EXEC}" -m vllm.entrypoints.openai.api_server
  --host "${VLLM_HOST}"
  --port "${VLLM_PORT}"
  --model "${VLLM_MODEL}"
)

if [[ -n "${VLLM_EXTRA_ARGS:-}" ]]; then
  # shellcheck disable=SC2206
  extra_args=(${VLLM_EXTRA_ARGS})
  vllm_cmd+=("${extra_args[@]}")
fi

"${vllm_cmd[@]}" &
LLM_PID=$!

for _ in $(seq 1 "${VLLM_STARTUP_TIMEOUT}"); do
  if curl -fsS "${VLLM_API_BASE}/models" > /dev/null; then
    echo "vLLM server is ready at ${VLLM_API_BASE}"
    break
  fi

  if ! kill -0 "${LLM_PID}" 2>/dev/null; then
    echo "vLLM process exited before readiness." >&2
    wait "${LLM_PID}" || true
    exit 1
  fi
  sleep 1
done

if ! curl -fsS "${VLLM_API_BASE}/models" > /dev/null; then
  echo "Timed out waiting for vLLM to become ready after ${VLLM_STARTUP_TIMEOUT}s." >&2
  exit 1
fi

default_app_cmd="${PYTHON_EXEC} -m examples.local_model_docker_benchmark --backend vllm --base-url ${VLLM_API_BASE} --model ${APP_MODEL_NAME} --runs 1"
APP_CMD="${APP_CMD:-${default_app_cmd}}"

# Normalize common APP_CMD usage when image only has python3.
if ! command -v python >/dev/null 2>&1; then
  APP_CMD="${APP_CMD//python /${PYTHON_EXEC} }"
fi

echo "Starting application command: ${APP_CMD}"
bash -lc "${APP_CMD}" &
APP_PID=$!

wait "${APP_PID}"
app_exit_code=$?

if kill -0 "${LLM_PID}" 2>/dev/null; then
  kill "${LLM_PID}" 2>/dev/null || true
  wait "${LLM_PID}" 2>/dev/null || true
fi

exit "${app_exit_code}"