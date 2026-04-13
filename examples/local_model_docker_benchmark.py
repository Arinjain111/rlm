"""
Benchmark RLM end-to-end using Docker REPL + local OpenAI-compatible models.

This benchmark measures full `RLM.completion()` latency, including Docker REPL startup.
Because DockerREPL is currently non-persistent, each run launches a fresh container.

Examples:
    python -m examples.local_model_docker_benchmark \
        --backend vllm \
        --base-url http://127.0.0.1:8000/v1 \
        --model meta-llama/Llama-3.1-8B-Instruct \
        --runs 3

    python -m examples.local_model_docker_benchmark \
        --backend openai \
        --base-url http://127.0.0.1:11434/v1 \
        --model llama3.1:8b \
        --api-key EMPTY \
        --runs 3
"""

import argparse
import statistics
import time

from rlm import RLM


def build_query(secret: int) -> str:
    context = (
        "This is a synthetic benchmark context.\n"
        "There are many distractor lines.\n"
        "Alpha=foo\n"
        "Beta=bar\n"
        f"SECRET_CODE={secret}\n"
        "Gamma=baz\n"
        "Return only the digits for SECRET_CODE."
    )
    return (
        "Find the SECRET_CODE in the context and return only the numeric value.\n\n"
        f"{context}"
    )


def run_benchmark(args: argparse.Namespace) -> None:
    environment_kwargs = {"image": args.docker_image} if args.environment == "docker" else {}

    rlm = RLM(
        backend=args.backend,
        backend_kwargs={
            "model_name": args.model,
            "base_url": args.base_url,
            "api_key": args.api_key,
        },
        environment=args.environment,
        environment_kwargs=environment_kwargs,
        max_iterations=args.max_iterations,
        verbose=args.verbose,
    )

    latencies: list[float] = []
    correctness: list[bool] = []

    for run_idx in range(args.runs):
        secret = 100_000 + run_idx
        query = build_query(secret)

        started = time.perf_counter()
        completion = rlm.completion(query)
        elapsed = time.perf_counter() - started

        answer = completion.response.strip()
        ok = answer == str(secret)

        latencies.append(elapsed)
        correctness.append(ok)

        print(
            f"Run {run_idx + 1}/{args.runs}: "
            f"latency={elapsed:.2f}s, "
            f"answer={answer!r}, "
            f"expected={secret}, "
            f"correct={ok}"
        )

    mean_latency = statistics.mean(latencies)
    median_latency = statistics.median(latencies)
    min_latency = min(latencies)
    max_latency = max(latencies)
    pass_rate = sum(correctness) / len(correctness)

    print("\nSummary")
    print(f"  backend: {args.backend}")
    print(f"  model: {args.model}")
    print(f"  base_url: {args.base_url}")
    print(f"  runs: {args.runs}")
    print(f"  mean latency: {mean_latency:.2f}s")
    print(f"  median latency: {median_latency:.2f}s")
    print(f"  min latency: {min_latency:.2f}s")
    print(f"  max latency: {max_latency:.2f}s")
    print(f"  pass rate: {pass_rate * 100:.1f}%")


if __name__ == "__main__":
    parser = argparse.ArgumentParser(description="Benchmark RLM with local models via Docker REPL")
    parser.add_argument("--backend", choices=["vllm", "openai"], default="vllm")
    parser.add_argument("--environment", choices=["local", "docker"], default="docker")
    parser.add_argument("--base-url", default="http://127.0.0.1:8000/v1")
    parser.add_argument("--model", default="meta-llama/Llama-3.1-8B-Instruct")
    parser.add_argument("--api-key", default="EMPTY")
    parser.add_argument("--runs", type=int, default=3)
    parser.add_argument("--max-iterations", type=int, default=6)
    parser.add_argument("--docker-image", default="python:3.11-slim")
    parser.add_argument("--verbose", action="store_true")

    run_benchmark(parser.parse_args())
