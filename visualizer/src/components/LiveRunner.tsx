'use client';

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { ScrollArea } from '@/components/ui/scroll-area';
import { parseTrajectoryData } from '@/lib/parse-logs';
import { LiveRunMetrics, RLMLogFile, LiveRunStatus, SessionStats } from '@/lib/types';

interface LiveRunnerProps {
  onLogProduced: (log: RLMLogFile) => void;
  onLogPatched?: (log: RLMLogFile) => void;
  chatSessionStats?: SessionStats | null;
  externalPrompt?: string | null;
  externalPromptKey?: number;
}

interface LiveEvent {
  id: string;
  name: string;
  timestamp: number;
  message: string;
}

interface LiveStats {
  runStarts: number;
  runCompletes: number;
  runErrors: number;
  iterationStarts: number;
  iterationCompletes: number;
  subcallStarts: number;
  subcallCompletes: number;
  responseChunks: number;
}

interface SSEPayload extends Record<string, unknown> {
  runId?: string;
  runIndex?: number;
  iteration?: number;
  token?: string;
  duration?: number;
  prompt?: string;
  model?: string;
  maxIterations?: number;
  response?: string;
  message?: string;
  executionTime?: number;
  trajectory?: {
    run_metadata?: Record<string, unknown>;
    iterations?: unknown[];
  };
  iterationData?: Record<string, unknown>;
  metrics?: LiveRunMetrics;
}

interface MutableTrajectory {
  run_metadata?: Record<string, unknown>;
  iterations: Array<Record<string, unknown>>;
}

// Lightweight card shown in the live mini-trajectory during a run
interface LiveIterCard {
  num: number;          // 1-indexed iteration number
  status: 'running' | 'done' | 'error';
  tokenCount: number;   // response tokens received so far
  subcalls: number;
  durationSec: number | null;
  hasError: boolean;
  responseSnippet: string; // first ~60 chars of response
}

interface LiveRunState {
  runId: string;
  runIndex: number;
  fileName: string;
  prompt: string;
  model: string;
  maxIterations: number;
  status: LiveRunStatus;
  trajectory: MutableTrajectory;
  metrics?: LiveRunMetrics;
}

const DEFAULT_PROMPT =
  `You are a career counsellor. A software engineer with 3 years of experience asks: \
"I want to transition into machine learning engineering. I know Python and have built some REST APIs, \
but I have no ML experience. What is a realistic 6-month roadmap for me, and what are the top 3 skills \
I should focus on first?" Analyse their background, identify skill gaps, and return a structured roadmap.`;

function emptyStats(): LiveStats {
  return {
    runStarts: 0,
    runCompletes: 0,
    runErrors: 0,
    iterationStarts: 0,
    iterationCompletes: 0,
    subcallStarts: 0,
    subcallCompletes: 0,
    responseChunks: 0,
  };
}

function safeNumber(value: unknown, fallback: number): number {
  return typeof value === 'number' && Number.isFinite(value) ? value : fallback;
}

function metricLabelValue(value: number | undefined, suffix = ''): string {
  if (typeof value !== 'number' || Number.isNaN(value)) {
    return '-';
  }
  return `${value}${suffix}`;
}

interface EventMeta {
  icon: string;
  label: string;
  detail: string;
  colorClass: string;        // text colour
  bgClass: string;           // pill / dot bg
  isTerminal?: boolean;      // run_complete / error
}

function getEventMeta(name: string, data: unknown): EventMeta {
  const p = (data ?? {}) as Record<string, unknown>;

  switch (name) {
    case 'status':
      return {
        icon: '▶',
        label: 'Benchmark started',
        detail: `Model: ${String(p.model ?? 'unknown')}`,
        colorClass: 'text-sky-400',
        bgClass: 'bg-sky-500/20',
      };
    case 'run_start':
      return {
        icon: '◉',
        label: `Run ${String(p.runIndex ?? '?')} initialised`,
        detail: `Prompt queued for execution`,
        colorClass: 'text-indigo-400',
        bgClass: 'bg-indigo-500/20',
      };
    case 'iteration_start':
      return {
        icon: '⟳',
        label: `Iteration ${String(p.iteration ?? '?')} — reasoning`,
        detail: 'LLM generating recursive response…',
        colorClass: 'text-amber-400',
        bgClass: 'bg-amber-500/20',
      };
    case 'iteration_complete': {
      const dur = Number(p.duration ?? 0).toFixed(2);
      return {
        icon: '✓',
        label: `Iteration ${String(p.iteration ?? '?')} complete`,
        detail: `Finished in ${dur}s`,
        colorClass: 'text-emerald-400',
        bgClass: 'bg-emerald-500/20',
      };
    }
    case 'subcall_start':
      return {
        icon: '◇',
        label: 'Sub-LM call dispatched',
        detail: `Recursive depth ${String(p.depth ?? '?')} — child RLM spawned`,
        colorClass: 'text-fuchsia-400',
        bgClass: 'bg-fuchsia-500/20',
      };
    case 'subcall_complete': {
      const err = p.error;
      const failed = typeof err === 'string' && err.length > 0;
      return {
        icon: failed ? '✗' : '◈',
        label: failed ? 'Sub-LM call failed' : 'Sub-LM call resolved',
        detail: failed ? String(err) : `Returned in ${Number(p.duration ?? 0).toFixed(2)}s`,
        colorClass: failed ? 'text-red-400' : 'text-fuchsia-300',
        bgClass: failed ? 'bg-red-500/20' : 'bg-fuchsia-500/15',
      };
    }
    case 'run_complete': {
      const t = Number(p.executionTime ?? 0).toFixed(2);
      return {
        icon: '🏁',
        label: `Run ${String(p.runIndex ?? '?')} finished`,
        detail: `Total execution time ${t}s`,
        colorClass: 'text-emerald-300',
        bgClass: 'bg-emerald-500/20',
        isTerminal: true,
      };
    }
    case 'error':
      return {
        icon: '⚠',
        label: 'Error occurred',
        detail: String(p.message ?? 'Unknown error'),
        colorClass: 'text-red-400',
        bgClass: 'bg-red-500/20',
        isTerminal: true,
      };
    case 'stream_end':
      return {
        icon: '■',
        label: 'Stream closed',
        detail: 'Server-side SSE stream ended',
        colorClass: 'text-muted-foreground',
        bgClass: 'bg-muted/40',
        isTerminal: true,
      };
    default:
      return {
        icon: '·',
        label: name,
        detail: typeof data === 'object' ? JSON.stringify(data).slice(0, 80) : String(data ?? ''),
        colorClass: 'text-muted-foreground',
        bgClass: 'bg-muted/30',
      };
  }
}

// Legacy helper kept for backwards-compatibility (appendEvent still calls it internally)
function eventToMessage(name: string, data: unknown): string {
  return getEventMeta(name, data).label;
}

export function LiveRunner({ onLogProduced, onLogPatched, chatSessionStats, externalPrompt, externalPromptKey }: LiveRunnerProps) {
  const [prompt, setPrompt] = useState(DEFAULT_PROMPT);
  const [model, setModel] = useState('qwen2.5:0.5b');
  const [runs, setRuns] = useState(1);
  const [maxIterations, setMaxIterations] = useState(6);
  const [events, setEvents] = useState<LiveEvent[]>([]);
  const [models, setModels] = useState<string[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [isRunning, setIsRunning] = useState(false);
  const [lastAnswer, setLastAnswer] = useState<string | null>(null);
  const [stats, setStats] = useState<LiveStats>(emptyStats());
  const [latestMetrics, setLatestMetrics] = useState<LiveRunMetrics | null>(null);

  const liveRunsRef = useRef<Record<string, LiveRunState>>({});
  const responseChunkCounterRef = useRef<Record<string, number>>({});
  const [liveIterCards, setLiveIterCards] = useState<LiveIterCard[]>([]);
  const liveIterCardsRef = useRef<LiveIterCard[]>([]);

  // Keep ref in sync for use inside handleStreamEvent callbacks
  const updateLiveCards = useCallback((updater: (prev: LiveIterCard[]) => LiveIterCard[]) => {
    liveIterCardsRef.current = updater(liveIterCardsRef.current);
    setLiveIterCards([...liveIterCardsRef.current]);
  }, []);

  const toLogFile = useCallback((run: LiveRunState): RLMLogFile => {
    const liveLog = parseTrajectoryData(run.fileName, {
      run_metadata: run.trajectory.run_metadata,
      iterations: run.trajectory.iterations,
    });

    // Always use the run's own prompt as the context/question display —
    // extractContextQuestion() picks up the RLM REPL's internal
    // "Your context is a str with N total characters…" message instead of
    // the actual user prompt, so we must hard-override it here.
    liveLog.metadata.contextQuestion = run.prompt.slice(0, 300) + (run.prompt.length > 300 ? '…' : '');

    if (!liveLog.config.root_model) {
      liveLog.config.root_model = run.model;
    }
    if (!liveLog.config.max_iterations) {
      liveLog.config.max_iterations = run.maxIterations;
    }

    return {
      ...liveLog,
      runId: run.runId,
      source: 'live',
      status: run.status,
      liveMetrics: run.metrics,
      updatedAt: Date.now(),
    };
  }, []);

  const emitRunUpdate = useCallback(
    (runId: string, asFinal: boolean) => {
      const run = liveRunsRef.current[runId];
      if (!run) {
        return;
      }

      const liveLog = toLogFile(run);
      onLogPatched?.(liveLog);

      if (asFinal) {
        onLogProduced(liveLog);
      }
    },
    [onLogPatched, onLogProduced, toLogFile],
  );

  const ensureIteration = useCallback((run: LiveRunState, iterationNum: number) => {
    const safeIterationNum = Math.max(1, iterationNum);
    while (run.trajectory.iterations.length < safeIterationNum) {
      const nextIteration = run.trajectory.iterations.length + 1;
      run.trajectory.iterations.push({
        type: 'iteration',
        iteration: nextIteration,
        timestamp: new Date().toISOString(),
        prompt: [],
        response: '',
        code_blocks: [],
        final_answer: null,
        iteration_time: null,
      });
    }

    return run.trajectory.iterations[safeIterationNum - 1];
  }, []);

  useEffect(() => {
    async function loadModels() {
      try {
        const resp = await fetch('/api/live/models', { cache: 'no-store' });
        if (!resp.ok) return;
        const body = (await resp.json()) as { models?: string[] };
        if (Array.isArray(body.models) && body.models.length > 0) {
          setModels(body.models);
          if (!body.models.includes(model)) {
            setModel(body.models[0]);
          }
        }
      } catch {
        // Ignore transient model-loading failures in UI.
      }
    }

    loadModels();
  }, [model]);

  const appendEvent = useCallback((name: string, data: unknown) => {
    if (name === 'heartbeat' || name === 'response_token') {
      return;
    }

    const row: LiveEvent = {
      id: `${Date.now()}_${Math.random()}`,
      name,
      timestamp: Date.now(),
      message: eventToMessage(name, data),
    };

    setEvents((prev) => {
      const next = [...prev, row];
      return next.slice(-250);
    });

    if (name === 'iteration_start') {
      setStats((prev) => ({ ...prev, iterationStarts: prev.iterationStarts + 1 }));
    } else if (name === 'iteration_complete') {
      setStats((prev) => ({ ...prev, iterationCompletes: prev.iterationCompletes + 1 }));
    } else if (name === 'subcall_start') {
      setStats((prev) => ({ ...prev, subcallStarts: prev.subcallStarts + 1 }));
    } else if (name === 'subcall_complete') {
      setStats((prev) => ({ ...prev, subcallCompletes: prev.subcallCompletes + 1 }));
    }
  }, []);

  const handleStreamEvent = useCallback((eventName: string, parsed: SSEPayload) => {
    const runId = typeof parsed.runId === 'string' ? parsed.runId : null;

    if (eventName === 'run_start' && runId) {
      const runIndex = safeNumber(parsed.runIndex, 1);
      const fileName = `live_${runId}_run${runIndex}.jsonl`;
      const runState: LiveRunState = {
        runId,
        runIndex,
        fileName,
        prompt: typeof parsed.prompt === 'string' ? parsed.prompt : prompt,
        model: typeof parsed.model === 'string' ? parsed.model : model,
        maxIterations: safeNumber(parsed.maxIterations, maxIterations),
        status: 'pending',
        trajectory: {
          run_metadata: {
            root_model: typeof parsed.model === 'string' ? parsed.model : model,
            max_iterations: safeNumber(parsed.maxIterations, maxIterations),
            backend: 'openai',
            environment_type: 'local',
          },
          iterations: [],
        },
      };

      liveRunsRef.current[runId] = runState;
      responseChunkCounterRef.current[runId] = 0;
      setStats((prev) => ({ ...prev, runStarts: prev.runStarts + 1 }));
      setLastAnswer('');
      // Reset the live trajectory cards for this new run
      liveIterCardsRef.current = [];
      setLiveIterCards([]);
      emitRunUpdate(runId, false);
      return;
    }

    if (eventName === 'response_token' && runId) {
      const run = liveRunsRef.current[runId];
      if (!run) {
        return;
      }

      run.status = 'running';
      const iterationNum = safeNumber(parsed.iteration, run.trajectory.iterations.length || 1);
      const token = typeof parsed.token === 'string' ? parsed.token : '';
      const targetIteration = ensureIteration(run, iterationNum);
      const existingResponse =
        typeof targetIteration.response === 'string' ? targetIteration.response : '';
      const newResponse = `${existingResponse}${token}`;
      targetIteration.response = newResponse;
      setLastAnswer((prev) => `${prev ?? ''}${token}`);
      setStats((prev) => ({ ...prev, responseChunks: prev.responseChunks + 1 }));

      // Update the matching iter card's token count + snippet live
      updateLiveCards((prev) => prev.map((c) =>
        c.num === iterationNum && c.status === 'running'
          ? { ...c, tokenCount: c.tokenCount + 1, responseSnippet: newResponse.slice(0, 60).replace(/\n/g, ' ') }
          : c,
      ));

      responseChunkCounterRef.current[runId] =
        (responseChunkCounterRef.current[runId] ?? 0) + 1;
      if (responseChunkCounterRef.current[runId] % 6 === 0) {
        emitRunUpdate(runId, false);
      }
      return;
    }

    if (eventName === 'iteration_start' && runId) {
      const run = liveRunsRef.current[runId];
      if (!run) return;
      run.status = 'running';
      const iterationNum = safeNumber(parsed.iteration, run.trajectory.iterations.length + 1);
      ensureIteration(run, iterationNum);
      // Push a new live card for this iteration
      updateLiveCards((prev) => {
        const exists = prev.some((c) => c.num === iterationNum);
        if (exists) return prev;
        return [...prev, { num: iterationNum, status: 'running', tokenCount: 0, subcalls: 0, durationSec: null, hasError: false, responseSnippet: '' }];
      });
      emitRunUpdate(runId, false);
      return;
    }

    if (eventName === 'iteration_snapshot' && runId) {
      const run = liveRunsRef.current[runId];
      if (!run) {
        return;
      }

      const snapshot =
        parsed.iterationData && typeof parsed.iterationData === 'object'
          ? parsed.iterationData
          : null;
      if (!snapshot) {
        return;
      }

      const iterationNum = safeNumber(
        parsed.iteration,
        safeNumber(snapshot.iteration, run.trajectory.iterations.length + 1),
      );

      ensureIteration(run, iterationNum);
      run.trajectory.iterations[iterationNum - 1] = {
        ...run.trajectory.iterations[iterationNum - 1],
        ...snapshot,
      };
      emitRunUpdate(runId, false);
      return;
    }

    if (eventName === 'iteration_complete' && runId) {
      const run = liveRunsRef.current[runId];
      if (!run) return;
      const iterationNum = safeNumber(parsed.iteration, run.trajectory.iterations.length || 1);
      const targetIteration = ensureIteration(run, iterationNum);
      const dur = safeNumber(parsed.duration, 0);
      targetIteration.iteration_time = dur;
      // Mark card done
      updateLiveCards((prev) => prev.map((c) =>
        c.num === iterationNum ? { ...c, status: 'done', durationSec: dur } : c,
      ));
      emitRunUpdate(runId, false);
      return;
    }

    if (eventName === 'subcall_start' && runId) {
      const run = liveRunsRef.current[runId];
      if (!run) return;
      run.metrics = { ...run.metrics, subcalls: (run.metrics?.subcalls ?? 0) + 1 };
      // Increment subcall count on the current running card
      updateLiveCards((prev) => {
        const lastRunning = [...prev].reverse().find((c) => c.status === 'running');
        if (!lastRunning) return prev;
        return prev.map((c) => c.num === lastRunning.num ? { ...c, subcalls: c.subcalls + 1 } : c);
      });
      emitRunUpdate(runId, false);
      return;
    }

    if (eventName === 'run_complete' && runId) {
      const run = liveRunsRef.current[runId];
      if (!run) {
        return;
      }

      if (parsed.trajectory && typeof parsed.trajectory === 'object') {
        run.trajectory = {
          run_metadata:
            parsed.trajectory.run_metadata && typeof parsed.trajectory.run_metadata === 'object'
              ? parsed.trajectory.run_metadata
              : run.trajectory.run_metadata,
          iterations: Array.isArray(parsed.trajectory.iterations)
            ? parsed.trajectory.iterations
                .filter((item): item is Record<string, unknown> => !!item && typeof item === 'object')
                .map((item) => ({ ...item }))
            : run.trajectory.iterations,
        };
      }

      if (parsed.metrics && typeof parsed.metrics === 'object') {
        run.metrics = parsed.metrics;
        setLatestMetrics(parsed.metrics);
      }

      run.status = 'completed';

      if (typeof parsed.response === 'string' && parsed.response.trim()) {
        const finalResponse = parsed.response.trim();
        setLastAnswer(finalResponse);

        // Inject the top-level response as final_answer on the last iteration
        // if no iteration explicitly called FINAL_VAR(). This ensures
        // computeMetadata() always finds a finalAnswer for the LogViewer header.
        const iters = run.trajectory.iterations;
        const hasExplicitFinalAnswer = iters.some(
          (it) => !!(it as Record<string, unknown>).final_answer,
        );
        if (!hasExplicitFinalAnswer && iters.length > 0) {
          const last = iters[iters.length - 1] as Record<string, unknown>;
          last.final_answer = finalResponse;
        }
      }

      // Mark all cards done on run_complete
      updateLiveCards((prev) => prev.map((c) => c.status === 'running' ? { ...c, status: 'done' } : c));
      setStats((prev) => ({ ...prev, runCompletes: prev.runCompletes + 1 }));
      emitRunUpdate(runId, true);
      return;
    }


    if (eventName === 'error') {
      if (runId) {
        const run = liveRunsRef.current[runId];
        if (run) {
          run.status = 'failed';
          emitRunUpdate(runId, false);
        }
      }
      setStats((prev) => ({ ...prev, runErrors: prev.runErrors + 1 }));
      setError(typeof parsed.message === 'string' ? parsed.message : 'Live run failed');
    }
  }, [emitRunUpdate, ensureIteration, maxIterations, model, prompt]);

  // Allow Dashboard to inject a prompt + auto-fire a benchmark run (e.g. from topic card clicks)
  const runLiveBenchmarkRef = useRef<((overridePrompt?: string) => Promise<void>) | null>(null);

  useEffect(() => {
    if (!externalPrompt || !externalPromptKey) return;
    setPrompt(externalPrompt);
    // Small delay to let React flush the prompt state before running
    const t = setTimeout(() => {
      runLiveBenchmarkRef.current?.(externalPrompt);
    }, 80);
    return () => clearTimeout(t);
  // Only fire when the key increments — not on every render
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [externalPromptKey]);

  const runLiveBenchmark = useCallback(async (overridePrompt?: string) => {
    const effectivePrompt = overridePrompt ?? prompt;
    setError(null);
    setIsRunning(true);
    setEvents([]);
    setLastAnswer(null);
    setStats(emptyStats());
    setLatestMetrics(null);
    liveRunsRef.current = {};
    responseChunkCounterRef.current = {};

    try {
      const response = await fetch('/api/live/run', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          prompt: effectivePrompt,
          model,
          runs,
          maxIterations,
        }),
      });

      if (!response.ok || !response.body) {
        const payload = (await response.json().catch(() => ({}))) as {
          error?: string;
          details?: string;
        };
        throw new Error(payload.details || payload.error || 'Failed to start live run');
      }

      const reader = response.body.getReader();
      const decoder = new TextDecoder();
      let buffer = '';

      while (true) {
        const { value, done } = await reader.read();
        if (done) break;

        buffer += decoder.decode(value, { stream: true });
        const messages = buffer.split('\n\n');
        buffer = messages.pop() ?? '';

        for (const msg of messages) {
          if (!msg.trim()) continue;

          let eventName = 'message';
          const dataLines: string[] = [];

          for (const line of msg.split('\n')) {
            if (line.startsWith('event:')) {
              eventName = line.slice(6).trim();
            } else if (line.startsWith('data:')) {
              dataLines.push(line.slice(5).trim());
            }
          }

          const rawData = dataLines.join('\n');
          let parsed: SSEPayload = {};
          if (rawData) {
            try {
              parsed = JSON.parse(rawData) as SSEPayload;
            } catch {
              parsed = { raw: rawData };
            }
          }

          handleStreamEvent(eventName, parsed);
          appendEvent(eventName, parsed);
        }
      }
    } catch (err) {
      const message = err instanceof Error ? err.message : 'Live run failed';
      setError(message);
      appendEvent('error', { message });
    } finally {
      setIsRunning(false);
    }
  }, [appendEvent, handleStreamEvent, maxIterations, model, prompt, runs]);

  // Keep ref in sync so the external-prompt effect can call the latest version
  useEffect(() => {
    runLiveBenchmarkRef.current = runLiveBenchmark;
  }, [runLiveBenchmark]);

  const sortedModels = useMemo(() => {
    const unique = Array.from(new Set(models));
    return unique.sort((a, b) => a.localeCompare(b));
  }, [models]);

  return (
    <Card>
      <CardHeader className="pb-3">
        <div className="flex items-center justify-between gap-3">
          <CardTitle className="text-sm">Live Benchmarks</CardTitle>
          <Badge className="text-[10px] bg-sky-500/20 text-sky-600 border-sky-500/30 dark:text-sky-300">
            REAL-TIME
          </Badge>
        </div>
      </CardHeader>
      <CardContent className="space-y-4">
        <div className="grid grid-cols-2 gap-2">
          <div>
            <label className="text-[11px] text-muted-foreground block mb-1">Model</label>
            <input
              list="live-models"
              value={model}
              onChange={(e) => setModel(e.target.value)}
              className="w-full rounded-md border border-border bg-background px-2 py-1.5 text-xs"
              placeholder="qwen2.5:0.5b"
            />
            <datalist id="live-models">
              {sortedModels.map((item) => (
                <option key={item} value={item} />
              ))}
            </datalist>
          </div>
          <div>
            <label className="text-[11px] text-muted-foreground block mb-1">Runs</label>
            <input
              type="number"
              min={1}
              max={20}
              value={runs}
              onChange={(e) => setRuns(Number(e.target.value) || 1)}
              className="w-full rounded-md border border-border bg-background px-2 py-1.5 text-xs"
            />
          </div>
        </div>

        <div>
          <label className="text-[11px] text-muted-foreground block mb-1">Max Iterations</label>
          <input
            type="number"
            min={1}
            max={100}
            value={maxIterations}
            onChange={(e) => setMaxIterations(Number(e.target.value) || 1)}
            className="w-full rounded-md border border-border bg-background px-2 py-1.5 text-xs"
          />
        </div>

        <div>
          <label className="text-[11px] text-muted-foreground block mb-1">Prompt</label>
          <textarea
            value={prompt}
            onChange={(e) => setPrompt(e.target.value)}
            rows={4}
            className="w-full rounded-md border border-border bg-background px-2 py-1.5 text-xs font-mono"
            placeholder="Write your benchmark prompt..."
          />
        </div>

        <div className="flex items-center justify-between gap-3">
          <div className="flex flex-wrap gap-2 text-[10px]">
            <Badge variant="outline">runs {stats.runCompletes}/{stats.runStarts}</Badge>
            {stats.runErrors > 0 && <Badge variant="destructive">errors {stats.runErrors}</Badge>}
            <Badge variant="outline">iter start {stats.iterationStarts}</Badge>
            <Badge variant="outline">iter done {stats.iterationCompletes}</Badge>
            <Badge variant="outline">subcalls {stats.subcallStarts}</Badge>
            <Badge variant="outline">resp chunks {stats.responseChunks}</Badge>
          </div>
          <Button size="sm" onClick={() => runLiveBenchmark()} disabled={isRunning || !prompt.trim()}>
            {isRunning ? 'Running...' : 'Run Live'}
          </Button>
        </div>

        {latestMetrics && (
          <div className="rounded-md border border-primary/20 bg-primary/5 p-2">
            <p className="text-[10px] uppercase tracking-wider text-primary mb-1">Run Metrics</p>
            <div className="grid grid-cols-2 md:grid-cols-3 gap-2 text-[11px] font-mono">
              <div>input: {metricLabelValue(latestMetrics.inputTokens)}</div>
              <div>output: {metricLabelValue(latestMetrics.outputTokens)}</div>
              <div>subcalls: {metricLabelValue(latestMetrics.subcalls)}</div>
              <div>time: {metricLabelValue(latestMetrics.executionTime, 's')}</div>
              <div>ctx saved: {metricLabelValue(latestMetrics.contextSavedTokenEstimate)} tok</div>
              <div>ctx saved %: {metricLabelValue(latestMetrics.contextSavedPercentEstimate, '%')}</div>
            </div>
          </div>
        )}

        {chatSessionStats && chatSessionStats.turnCount > 0 && (
          <div className="rounded-md border border-primary/20 bg-primary/5 p-2 space-y-2">
            <div className="flex items-center justify-between">
              <p className="text-[10px] uppercase tracking-wider text-primary">Chat Session Cost</p>
              <span className="text-[9px] font-mono px-1.5 py-0.5 rounded bg-emerald-500/20 text-emerald-600 dark:text-emerald-400 border border-emerald-500/30">
                LIVE
              </span>
            </div>
            <div className="grid grid-cols-2 gap-x-4 gap-y-1 text-[11px] font-mono">
              <div className="text-muted-foreground">Turns</div>
              <div className="text-foreground">{chatSessionStats.turnCount}</div>
              <div className="text-muted-foreground">Input tokens</div>
              <div className="text-foreground">{chatSessionStats.totalInputTokens.toLocaleString()}</div>
              <div className="text-muted-foreground">Output tokens</div>
              <div className="text-foreground">{chatSessionStats.totalOutputTokens.toLocaleString()}</div>
              <div className="text-muted-foreground">Naive ctx input</div>
              <div className="text-foreground">{chatSessionStats.naiveRecursiveInputTokens.toLocaleString()}</div>
              <div className="text-muted-foreground">Context saved</div>
              <div className="text-primary font-semibold">~{chatSessionStats.recursiveSavingsPercent}% ({chatSessionStats.recursiveSavingsEstimate.toLocaleString()} tok)</div>
            </div>
            <div className="border-t border-border/50 pt-2 grid grid-cols-2 gap-x-4 gap-y-1 text-[11px] font-mono">
              <div className="text-muted-foreground">Local (Qwen 2.5)</div>
              <div className="text-emerald-600 dark:text-emerald-400 font-semibold">$0.0000 ✓ FREE</div>
              <div className="text-muted-foreground">Cloud (GPT-4o-mini)</div>
              <div className="text-amber-600 dark:text-amber-400">
                {chatSessionStats.equivalentCloudCostUsd < 0.001
                  ? `$${chatSessionStats.equivalentCloudCostUsd.toFixed(5)}`
                  : `$${chatSessionStats.equivalentCloudCostUsd.toFixed(4)}`}
              </div>
              <div className="text-muted-foreground">You saved</div>
              <div className="text-primary font-semibold">
                {chatSessionStats.equivalentCloudCostUsd < 0.001
                  ? `$${chatSessionStats.equivalentCloudCostUsd.toFixed(5)}`
                  : `$${chatSessionStats.equivalentCloudCostUsd.toFixed(4)}`} this session
              </div>
            </div>
            <p className="text-[9px] text-muted-foreground/60">
              * GPT-4o-mini pricing: $0.15/1M in · $0.60/1M out · naive recursive context assumed
            </p>
          </div>
        )}

        {lastAnswer !== null && (
          <div className="rounded-md border border-emerald-500/30 bg-emerald-500/10 p-2">
            <p className="text-[10px] uppercase tracking-wider text-emerald-600 dark:text-emerald-400 mb-1">
              Live Agent Response
            </p>
            <p className="text-xs text-foreground whitespace-pre-wrap">
              {lastAnswer || 'Waiting for first response tokens...'}
            </p>
          </div>
        )}

        {error && (
          <div className="rounded-md border border-red-500/30 bg-red-500/10 p-2 text-xs text-red-600 dark:text-red-400">
            {error}
          </div>
        )}

        {/* ── Live Trajectory Cards ── */}
        {(isRunning || liveIterCards.length > 0) && (
          <div>
            <p className="text-[11px] text-muted-foreground mb-2 flex items-center gap-1.5">
              <span className="text-primary font-mono">◈</span>
              Live Trajectory
              {isRunning && <span className="w-1.5 h-1.5 rounded-full bg-amber-500 animate-pulse ml-1" />}
              <span className="ml-auto text-[10px]">({liveIterCards.length} iter)</span>
            </p>
            <div className="flex gap-2 overflow-x-auto pb-2">
              {liveIterCards.map((card) => (
                <div
                  key={card.num}
                  className={`flex-shrink-0 w-52 rounded-lg border p-2.5 transition-all duration-300 ${
                    card.status === 'running'
                      ? 'border-amber-500/50 bg-amber-500/8 shadow-sm shadow-amber-500/10'
                      : card.hasError
                        ? 'border-red-500/40 bg-red-500/5'
                        : 'border-primary/30 bg-primary/5'
                  }`}
                >
                  <div className="flex items-center gap-2 mb-1.5">
                    <div className={`w-6 h-6 rounded-full flex items-center justify-center text-[10px] font-bold flex-shrink-0 ${
                      card.status === 'running' ? 'bg-amber-500 text-white' :
                      card.hasError ? 'bg-red-500 text-white' : 'bg-primary text-primary-foreground'
                    }`}>
                      {card.num}
                    </div>
                    <div className="flex-1 min-w-0">
                      <div className="flex items-center gap-1 flex-wrap">
                        {card.status === 'running' && (
                          <span className="text-[9px] font-mono text-amber-600 dark:text-amber-400 flex items-center gap-0.5">
                            <span className="w-1 h-1 rounded-full bg-amber-500 animate-pulse" /> running
                          </span>
                        )}
                        {card.status === 'done' && (
                          <span className="text-[9px] font-mono text-primary">✓ done</span>
                        )}
                        {card.subcalls > 0 && (
                          <span className="text-[9px] text-fuchsia-600 dark:text-fuchsia-400">
                            {card.subcalls} sub
                          </span>
                        )}
                      </div>
                    </div>
                    {card.durationSec !== null && (
                      <span className="text-[9px] font-mono text-muted-foreground flex-shrink-0">
                        {card.durationSec.toFixed(1)}s
                      </span>
                    )}
                  </div>
                  <p className="text-[10px] font-mono text-muted-foreground truncate leading-relaxed">
                    {card.responseSnippet || (card.status === 'running' ? '…' : 'Awaiting response')}
                  </p>
                  <div className="mt-1.5 flex items-center gap-1.5 text-[9px] font-mono text-muted-foreground/60">
                    <span className="text-sky-600 dark:text-sky-400">{card.tokenCount} tok</span>
                  </div>
                </div>
              ))}
              {isRunning && (
                <div className="flex-shrink-0 w-52 rounded-lg border border-dashed border-border/50 p-2.5 flex items-center justify-center">
                  <span className="text-[10px] text-muted-foreground/50 font-mono">next iter…</span>
                </div>
              )}
            </div>
          </div>
        )}

        <div>
          <div className="flex items-center justify-between mb-2">
            <p className="text-[11px] font-medium text-foreground/80 flex items-center gap-1.5">
              <span className="text-primary">◎</span> Execution Timeline
            </p>
            {events.length > 0 && (
              <span className="text-[9px] font-mono text-muted-foreground">{events.length} events</span>
            )}
          </div>
          <ScrollArea className="h-48 rounded-lg border border-border bg-background/60">
            <div className="p-3">
              {events.length === 0 ? (
                <div className="flex flex-col items-center justify-center h-24 gap-2 text-muted-foreground/50">
                  <span className="text-2xl">◎</span>
                  <p className="text-[11px]">Run a prompt to see the execution timeline</p>
                </div>
              ) : (
                <div className="relative">
                  {/* Vertical connector line */}
                  <div className="absolute left-[13px] top-4 bottom-4 w-px bg-border/50" />
                  <div className="space-y-2">
                    {events.map((evt, i) => {
                      const meta = getEventMeta(evt.name, null);
                      return (
                        <div key={evt.id} className="flex items-start gap-3 relative">
                          {/* Icon dot */}
                          <div className={`w-7 h-7 rounded-full flex-shrink-0 flex items-center justify-center text-[11px] z-10 ${meta.bgClass}`}>
                            <span className={meta.colorClass}>{meta.icon}</span>
                          </div>
                          {/* Content */}
                          <div className={`flex-1 min-w-0 rounded-lg px-3 py-2 border transition-all ${
                            meta.isTerminal
                              ? 'border-primary/20 bg-primary/5'
                              : 'border-border/40 bg-muted/30'
                          }`}>
                            <div className="flex items-center justify-between gap-2">
                              <span className={`text-[11px] font-medium ${meta.colorClass}`}>
                                {meta.label}
                              </span>
                              <span className="text-[9px] font-mono text-muted-foreground/60 flex-shrink-0">
                                {new Date(evt.timestamp).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit', second: '2-digit' })}
                              </span>
                            </div>
                            <p className="text-[10px] text-muted-foreground/70 mt-0.5 truncate">
                              {evt.message !== meta.label ? evt.message : meta.detail || ''}
                            </p>
                          </div>
                        </div>
                      );
                    })}
                  </div>
                </div>
              )}
            </div>
          </ScrollArea>
        </div>

      </CardContent>
    </Card>
  );
}
