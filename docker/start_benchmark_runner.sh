#!/usr/bin/env bash
set -euo pipefail

OLLAMA_BASE_URL="${OLLAMA_BASE_URL:-http://ollama:11434/v1}"
OLLAMA_HEALTH_URL="${OLLAMA_HEALTH_URL:-http://ollama:11434/api/tags}"
OLLAMA_MODEL="${OLLAMA_MODEL:-qwen2.5:0.5b}"
BENCHMARK_RUNS="${BENCHMARK_RUNS:-3}"
BENCHMARK_MAX_ITERATIONS="${BENCHMARK_MAX_ITERATIONS:-6}"
BENCHMARK_AUTORUN="${BENCHMARK_AUTORUN:-0}"
BENCHMARK_STARTUP_TIMEOUT="${BENCHMARK_STARTUP_TIMEOUT:-300}"
BENCHMARK_API_HOST="${BENCHMARK_API_HOST:-0.0.0.0}"
BENCHMARK_API_PORT="${BENCHMARK_API_PORT:-8787}"

wait_for_ollama() {
  echo "Waiting for Ollama at ${OLLAMA_HEALTH_URL}"
  for _ in $(seq 1 "${BENCHMARK_STARTUP_TIMEOUT}"); do
    if curl -fsS "${OLLAMA_HEALTH_URL}" > /dev/null; then
      echo "Ollama is ready for benchmark calls."
      return 0
    fi
    sleep 1
  done

  echo "Timed out waiting for Ollama after ${BENCHMARK_STARTUP_TIMEOUT}s." >&2
  return 1
}

benchmark_cmd=(
  python -m examples.local_model_docker_benchmark
  --backend openai
  --environment local
  --base-url "${OLLAMA_BASE_URL}"
  --model "${OLLAMA_MODEL}"
  --api-key EMPTY
  --runs "${BENCHMARK_RUNS}"
  --max-iterations "${BENCHMARK_MAX_ITERATIONS}"
)

wait_for_ollama

if [[ "${BENCHMARK_AUTORUN}" == "1" ]]; then
  echo "Running benchmark automatically in background."
  "${benchmark_cmd[@]}" &
fi

echo "Benchmark runner is ready."
echo "Run this inside the container:"
echo "  ${benchmark_cmd[*]}"
echo "Starting benchmark API server on ${BENCHMARK_API_HOST}:${BENCHMARK_API_PORT}"

exec python /usr/local/bin/benchmark_api.py
