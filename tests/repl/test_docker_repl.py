"""Tests for DockerREPL execution script scaffolding."""

from rlm.environments.docker_repl import _build_exec_script


def test_exec_script_exposes_recursive_query_aliases():
    """The Docker exec script should expose rlm_query fallbacks for prompt consistency."""
    script = _build_exec_script("x = 1", proxy_port=5010, depth=3)

    assert "def rlm_query(prompt, model=None):" in script
    assert "def rlm_query_batched(prompts, model=None):" in script
    assert '"rlm_query": rlm_query' in script
    assert '"rlm_query_batched": rlm_query_batched' in script
    assert '"depth": 3' in script
