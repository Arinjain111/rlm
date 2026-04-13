#!/usr/bin/env python3
"""HTTP API for running live RLM benchmarks against Ollama with streaming events."""

from __future__ import annotations

import json
import os
import queue
import re
import threading
import time
import uuid
from collections.abc import Generator
from pathlib import Path
from typing import Any

import requests
from flask import Flask, Response, jsonify, request, stream_with_context

from rlm import RLM
from rlm.logger import RLMLogger

app = Flask(__name__)

OLLAMA_BASE_URL = os.getenv("OLLAMA_BASE_URL", "http://ollama:11434/v1")
OLLAMA_HEALTH_URL = os.getenv("OLLAMA_HEALTH_URL", "http://ollama:11434/api/tags")
OLLAMA_MODEL = os.getenv("OLLAMA_MODEL", "qwen2.5:0.5b")
LOG_DIR = Path(os.getenv("RLM_LOG_DIR", "/workspace/logs"))
LOG_DIR.mkdir(parents=True, exist_ok=True)


def sse(event: str, data: dict[str, Any]) -> str:
    payload = json.dumps(data, ensure_ascii=False)
    return f"event: {event}\ndata: {payload}\n\n"


def clamp_int(value: Any, default: int, minimum: int, maximum: int) -> int:
    try:
        parsed = int(value)
    except (TypeError, ValueError):
        return default
    return max(minimum, min(maximum, parsed))


def estimate_tokens_from_text(text: str) -> int:
    """Rough token estimate used for lightweight live metrics."""
    if not text:
        return 0
    return max(1, round(len(text) / 4))


def count_subcalls(iterations: list[dict[str, Any]]) -> int:
    total = 0
    for iteration in iterations:
        code_blocks = iteration.get("code_blocks")
        if not isinstance(code_blocks, list):
            continue
        for block in code_blocks:
            if not isinstance(block, dict):
                continue
            result = block.get("result")
            if not isinstance(result, dict):
                continue
            rlm_calls = result.get("rlm_calls")
            if isinstance(rlm_calls, list):
                total += len(rlm_calls)
    return total


def iter_text_chunks(text: str, max_chunks: int = 320) -> list[str]:
    """Split text into token-like chunks for responsive UI replay."""
    if not text:
        return []

    chunks = re.findall(r"\S+\s*", text)
    if not chunks:
        return [text]

    if len(chunks) <= max_chunks:
        return chunks

    head = chunks[: max_chunks - 1]
    tail = "".join(chunks[max_chunks - 1 :])
    return [*head, tail]


def build_run_metrics(
    prompt: str,
    iterations: list[dict[str, Any]],
    total_input_tokens: int,
    total_output_tokens: int,
    execution_time: float,
) -> dict[str, Any]:
    prompt_token_estimate = estimate_tokens_from_text(prompt)
    iteration_count = len(iterations)
    subcall_count = count_subcalls(iterations)
    naive_context_tokens = prompt_token_estimate * max(1, iteration_count)
    context_saved_tokens = max(0, naive_context_tokens - total_input_tokens)
    context_saved_percent = (
        round((context_saved_tokens / naive_context_tokens) * 100, 2)
        if naive_context_tokens > 0
        else 0.0
    )

    return {
        "iterations": iteration_count,
        "subcalls": subcall_count,
        "executionTime": execution_time,
        "inputTokens": total_input_tokens,
        "outputTokens": total_output_tokens,
        "promptTokenEstimate": prompt_token_estimate,
        "naiveContextTokenEstimate": naive_context_tokens,
        "contextSavedTokenEstimate": context_saved_tokens,
        "contextSavedPercentEstimate": context_saved_percent,
        "throughputTokensPerSec": round(
            (total_output_tokens / execution_time) if execution_time > 0 else 0.0,
            3,
        ),
    }


def fetch_ollama_models() -> list[str]:
    resp = requests.get(OLLAMA_HEALTH_URL, timeout=5)
    resp.raise_for_status()
    data = resp.json()
    models = data.get("models", [])
    names: list[str] = []
    for model in models:
        name = model.get("name")
        if isinstance(name, str) and name.strip():
            names.append(name)
    return names


@app.get("/health")
def health() -> Response:
    try:
        models = fetch_ollama_models()
        return jsonify({"ok": True, "models": models})
    except Exception as exc:  # pragma: no cover - runtime-only path
        return jsonify({"ok": False, "error": str(exc)}), 503


@app.get("/models")
def models() -> Response:
    try:
        names = fetch_ollama_models()
        if OLLAMA_MODEL not in names:
            names = [OLLAMA_MODEL, *names]
        return jsonify({"models": names})
    except Exception as exc:  # pragma: no cover - runtime-only path
        return jsonify({"models": [OLLAMA_MODEL], "error": str(exc)}), 200


@app.post("/run/stream")
def run_stream() -> Response:
    payload = request.get_json(silent=True)
    if not isinstance(payload, dict):
        raw_body = request.get_data(as_text=True)
        if raw_body:
            try:
                decoded = json.loads(raw_body)
                payload = decoded if isinstance(decoded, dict) else {}
            except json.JSONDecodeError:
                payload = {}
        else:
            payload = {}

    prompt = str(payload.get("prompt", "")).strip()
    if not prompt:
        return jsonify({"error": "prompt is required"}), 400

    model = str(payload.get("model") or OLLAMA_MODEL)
    runs = clamp_int(payload.get("runs"), default=1, minimum=1, maximum=20)
    max_iterations = clamp_int(
        payload.get("maxIterations"), default=6, minimum=1, maximum=100
    )
    stream_id = str(uuid.uuid4())

    def generate() -> Generator[str, None, None]:
        yield sse(
            "status",
            {
                "streamId": stream_id,
                "message": "starting",
                "runs": runs,
                "model": model,
                "maxIterations": max_iterations,
            },
        )

        for run_index in range(1, runs + 1):
            run_id = f"run_{str(uuid.uuid4())[:8]}"
            event_queue: queue.Queue[tuple[str, dict[str, Any]]] = queue.Queue()
            logger: RLMLogger | None = None

            def run_event_payload(**kwargs: Any) -> dict[str, Any]:
                return {
                    "streamId": stream_id,
                    "runId": run_id,
                    "runIndex": run_index,
                    **kwargs,
                }

            def on_subcall_start(depth: int, sub_model: str, prompt_preview: str) -> None:
                event_queue.put(
                    (
                        "subcall_start",
                        run_event_payload(
                            depth=depth,
                            model=sub_model,
                            promptPreview=prompt_preview[:180],
                            timestamp=time.time(),
                        ),
                    )
                )

            def on_subcall_complete(
                depth: int, sub_model: str, duration: float, error_or_none: str | None
            ) -> None:
                event_queue.put(
                    (
                        "subcall_complete",
                        run_event_payload(
                            depth=depth,
                            model=sub_model,
                            duration=duration,
                            error=error_or_none,
                            timestamp=time.time(),
                        ),
                    )
                )

            def on_iteration_start(depth: int, iteration_num: int) -> None:
                event_queue.put(
                    (
                        "iteration_start",
                        run_event_payload(
                            depth=depth,
                            iteration=iteration_num,
                            timestamp=time.time(),
                        ),
                    )
                )

            def on_iteration_complete(depth: int, iteration_num: int, duration: float) -> None:
                if logger is not None:
                    trajectory = logger.get_trajectory() or {}
                    iterations = trajectory.get("iterations", [])
                    latest_iteration = (
                        iterations[-1]
                        if isinstance(iterations, list) and iterations
                        else None
                    )
                    if isinstance(latest_iteration, dict):
                        response_text = str(latest_iteration.get("response") or "")
                        for chunk in iter_text_chunks(response_text):
                            event_queue.put(
                                (
                                    "response_token",
                                    run_event_payload(
                                        depth=depth,
                                        iteration=iteration_num,
                                        token=chunk,
                                        timestamp=time.time(),
                                    ),
                                )
                            )
                        event_queue.put(
                            (
                                "iteration_snapshot",
                                run_event_payload(
                                    depth=depth,
                                    iteration=iteration_num,
                                    iterationData=latest_iteration,
                                    timestamp=time.time(),
                                ),
                            )
                        )

                event_queue.put(
                    (
                        "iteration_complete",
                        run_event_payload(
                            depth=depth,
                            iteration=iteration_num,
                            duration=duration,
                            timestamp=time.time(),
                        ),
                    )
                )

            def execute_run() -> None:
                nonlocal logger
                logger = RLMLogger(log_dir=str(LOG_DIR), file_name=f"live_{run_id}")
                started = time.perf_counter()

                try:
                    rlm = RLM(
                        backend="openai",
                        backend_kwargs={
                            "model_name": model,
                            "base_url": OLLAMA_BASE_URL,
                            "api_key": "EMPTY",
                        },
                        environment="local",
                        logger=logger,
                        max_iterations=max_iterations,
                        on_subcall_start=on_subcall_start,
                        on_subcall_complete=on_subcall_complete,
                        on_iteration_start=on_iteration_start,
                        on_iteration_complete=on_iteration_complete,
                    )

                    completion = rlm.completion(prompt)
                    elapsed = time.perf_counter() - started
                    trajectory = completion.metadata if isinstance(completion.metadata, dict) else {}
                    iterations = trajectory.get("iterations", [])
                    if not isinstance(iterations, list):
                        iterations = []

                    total_input_tokens = int(completion.usage_summary.total_input_tokens)
                    total_output_tokens = int(completion.usage_summary.total_output_tokens)
                    metrics = build_run_metrics(
                        prompt=prompt,
                        iterations=iterations,
                        total_input_tokens=total_input_tokens,
                        total_output_tokens=total_output_tokens,
                        execution_time=elapsed,
                    )

                    usage_data = completion.usage_summary.to_dict()
                    usage_data["total_input_tokens"] = total_input_tokens
                    usage_data["total_output_tokens"] = total_output_tokens

                    event_queue.put(
                        (
                            "run_complete",
                            run_event_payload(
                                executionTime=elapsed,
                                response=completion.response,
                                usage=usage_data,
                                trajectory=trajectory,
                                metrics=metrics,
                                logFilePath=logger.log_file_path,
                                timestamp=time.time(),
                            ),
                        )
                    )
                except Exception as exc:  # pragma: no cover - runtime-only path
                    event_queue.put(
                        (
                            "error",
                            run_event_payload(
                                message=str(exc),
                                timestamp=time.time(),
                            ),
                        )
                    )
                finally:
                    event_queue.put(
                        (
                            "run_end",
                            run_event_payload(timestamp=time.time()),
                        )
                    )

            yield sse(
                "run_start",
                run_event_payload(
                    status="pending",
                    prompt=prompt,
                    promptPreview=prompt[:180],
                    model=model,
                    maxIterations=max_iterations,
                    timestamp=time.time(),
                ),
            )

            thread = threading.Thread(target=execute_run, daemon=True)
            thread.start()

            last_heartbeat = 0.0
            while True:
                try:
                    event, data = event_queue.get(timeout=0.25)
                    yield sse(event, data)
                    if event == "run_end":
                        break
                except queue.Empty:
                    now = time.time()
                    if now - last_heartbeat >= 1.0:
                        yield sse(
                            "heartbeat",
                            run_event_payload(timestamp=now),
                        )
                        last_heartbeat = now

        yield sse("stream_end", {"ok": True, "streamId": stream_id, "timestamp": time.time()})

    return Response(
        stream_with_context(generate()),
        content_type="text/event-stream",
        headers={
            "Cache-Control": "no-cache",
            "Connection": "keep-alive",
            "X-Accel-Buffering": "no",
        },
    )


if __name__ == "__main__":
    host = os.getenv("BENCHMARK_API_HOST", "0.0.0.0")
    port = clamp_int(os.getenv("BENCHMARK_API_PORT"), default=8787, minimum=1, maximum=65535)
    app.run(host=host, port=port, threaded=True)