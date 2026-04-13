FROM ollama/ollama:latest

WORKDIR /workspace

RUN apt-get update \
    && apt-get install -y --no-install-recommends python3 python3-pip python3-venv curl ca-certificates \
    && ln -sf /usr/bin/python3 /usr/bin/python \
    && rm -rf /var/lib/apt/lists/*

RUN python3 -m venv /opt/venv
ENV PATH="/opt/venv/bin:${PATH}"

COPY pyproject.toml README.md MANIFEST.IN LICENSE /workspace/
COPY rlm /workspace/rlm
COPY examples /workspace/examples
COPY docker/start_app_with_ollama.sh /usr/local/bin/start_app_with_ollama.sh

RUN pip install --no-cache-dir --upgrade pip setuptools wheel
RUN pip install --no-cache-dir -e /workspace
RUN chmod +x /usr/local/bin/start_app_with_ollama.sh

ENV OLLAMA_HOST=0.0.0.0:11434
ENV OLLAMA_MODEL=qwen2.5:0.5b
ENV APP_MODEL_NAME=qwen2.5:0.5b
ENV OLLAMA_STARTUP_TIMEOUT=180

EXPOSE 11434

ENTRYPOINT ["/usr/local/bin/start_app_with_ollama.sh"]