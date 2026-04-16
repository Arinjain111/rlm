# Career · RLM Visualizer

> A Next.js web app that acts as an **AI Career Counsellor** powered by local Recursive Language Models (RLMs) and Ollama.

<p align="center">
  <img src="../media/screenshot_landing.png" alt="Landing Page" width="860"/>
  <br/><em>Landing page — career topic cards, quick questions, and stats strip</em>
</p>

---

## What this is

This visualizer has two jobs:

1. **AI Career Counsellor** — a chat interface where users ask career questions and receive personalised, streaming guidance from a local Qwen 2.5 model. The AI goes through visible "thinking phases" (analyzing query → pulling weights → generating response) before streaming the answer token-by-token.

2. **RLM Trace Viewer** — a live dashboard that lets you run recursive language model benchmarks and inspect every iteration, sub-call, and execution event as it streams in.

---

## Features

### Chat Counsellor
- 💬 Token-by-token streaming with typewriter cursor
- 🔍 Animated thinking phases before the first token arrives
- 📎 Quick starter chips and topic-card one-click questions
- 💰 Session token tracking + cloud cost savings estimate

### Live Benchmark Runner
- ▶ Real-time SSE stream from the Python RLM backend
- 🃏 Iteration card strip — live status, token counts, response snippets
- ⏱ Execution Timeline — colour-coded event log with icons for every event type
- 📈 Final answer extraction — shown even when the model doesn't call `FINAL_VAR()`

### Trajectory Viewer
- Per-iteration conversation panel with sub-recursive call highlighting
- Code block detection with copy/collapse toggles
- Expandable Final Answer cell with "show full answer" toggle
- Context/Question always shows the actual user prompt (not internal REPL messages)

<p align="center">
  <img src="../media/screenshot_chat.png" alt="Chat Widget" width="860"/>
  <br/><em>Chat widget with thinking animation and quick starter chips</em>
</p>

<p align="center">
  <img src="../media/screenshot_arch.png" alt="How It Works + Live Runner" width="860"/>
  <br/><em>Live runner (left) and "How It Works" animated flow diagram (right)</em>
</p>

---

## Stack

| Layer | Tech |
|---|---|
| Framework | Next.js 16 (App Router, Turbopack) |
| UI | Tailwind CSS + shadcn/ui |
| LLM | Ollama · Qwen 2.5:0.5b (local) |
| LLM client | `@langchain/ollama` |
| Streaming | Server-Sent Events (SSE) |
| State | React hooks + `useRef` for streaming IDs |

---

## Running locally

```bash
npm install
npm run dev   # http://localhost:3001
```

**Required env vars** (create `.env.local`):

```bash
OLLAMA_BASE_URL=http://localhost:11434
OLLAMA_CHAT_MODEL=qwen2.5:0.5b
```

Make sure Ollama is running and the model is pulled:

```bash
ollama serve
ollama pull qwen2.5:0.5b
```

---

## Running with Docker Compose (full stack)

From the repo root:

```bash
docker compose up -d --build
docker compose exec ollama ollama pull qwen2.5:0.5b
# Open http://localhost:3001
```

---

## Project structure

```
src/
  app/
    api/
      chat/route.ts         ← SSE streaming chat endpoint
      live/run/route.ts     ← Live benchmark SSE endpoint
      live/models/route.ts  ← Available models endpoint
      logs/route.ts         ← Log file listing
    page.tsx                ← Entry point → Dashboard
  components/
    Dashboard.tsx           ← Main orchestration (chat + runner + log list)
    ChatAgent.tsx           ← Chat UI with streaming + thinking phases
    LiveRunner.tsx          ← Live benchmark runner + execution timeline
    LogViewer.tsx           ← Full trajectory deep-dive viewer
    TrajectoryPanel.tsx     ← Conversation + sub-call highlighting
    ExecutionPanel.tsx      ← Code block + REPL output viewer
    IterationTimeline.tsx   ← Horizontal iteration strip
    AsciiGlobe.tsx          ← "How It Works" animated flow diagram
  lib/
    parse-logs.ts           ← JSONL parsing + metadata extraction
    types.ts                ← Shared TypeScript types
    chat-store.ts           ← Session stats accumulator
```
