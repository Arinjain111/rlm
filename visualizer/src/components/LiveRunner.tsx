'use client';

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { ScrollArea } from '@/components/ui/scroll-area';
import { parseTrajectoryData } from '@/lib/parse-logs';
import { LiveRunMetrics, RLMLogFile, LiveRunStatus } from '@/lib/types';

interface LiveRunnerProps {
  onLogProduced: (log: RLMLogFile) => void;
  onLogPatched?: (log: RLMLogFile) => void;
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
  'Find the secret code in the context and return only the number: CONTEXT=alpha,beta,SECRET_CODE=12345,gamma';

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

function eventToMessage(name: string, data: unknown): string {
  const payload = (data ?? {}) as Record<string, unknown>;

  if (name === 'status') {
    return `Run started for model ${String(payload.model ?? 'unknown')}`;
  }
  if (name === 'run_start') {
    return `Run ${String(payload.runIndex ?? '?')} is pending`;
  }
  if (name === 'iteration_start') {
    return `Iteration ${String(payload.iteration ?? '?')} started`;
  }
  if (name === 'iteration_complete') {
    return `Iteration ${String(payload.iteration ?? '?')} completed in ${Number(payload.duration ?? 0).toFixed(2)}s`;
  }
  if (name === 'subcall_start') {
    return `Subcall started at depth ${String(payload.depth ?? '?')}`;
  }
  if (name === 'subcall_complete') {
    const err = payload.error;
    if (typeof err === 'string' && err.length > 0) {
      return `Subcall failed: ${err}`;
    }
    return `Subcall finished in ${Number(payload.duration ?? 0).toFixed(2)}s`;
  }
  if (name === 'run_complete') {
    return `Run ${String(payload.runIndex ?? '?')} completed in ${Number(payload.executionTime ?? 0).toFixed(2)}s`;
  }
  if (name === 'response_token') {
    return 'Streaming response chunk';
  }
  if (name === 'error') {
    return `Error: ${String(payload.message ?? 'unknown error')}`;
  }
  if (name === 'stream_end') {
    return 'Stream ended';
  }
  if (name === 'heartbeat') {
    return 'Heartbeat';
  }

  return `${name}: ${JSON.stringify(payload)}`;
}

export function LiveRunner({ onLogProduced, onLogPatched }: LiveRunnerProps) {
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

  const toLogFile = useCallback((run: LiveRunState): RLMLogFile => {
    const liveLog = parseTrajectoryData(run.fileName, {
      run_metadata: run.trajectory.run_metadata,
      iterations: run.trajectory.iterations,
    });

    if (!liveLog.metadata.contextQuestion || liveLog.metadata.contextQuestion === 'No context found') {
      liveLog.metadata.contextQuestion = run.prompt.slice(0, 200);
    }

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
      targetIteration.response = `${existingResponse}${token}`;
      setLastAnswer((prev) => `${prev ?? ''}${token}`);
      setStats((prev) => ({ ...prev, responseChunks: prev.responseChunks + 1 }));

      responseChunkCounterRef.current[runId] =
        (responseChunkCounterRef.current[runId] ?? 0) + 1;
      if (responseChunkCounterRef.current[runId] % 6 === 0) {
        emitRunUpdate(runId, false);
      }
      return;
    }

    if (eventName === 'iteration_start' && runId) {
      const run = liveRunsRef.current[runId];
      if (!run) {
        return;
      }

      run.status = 'running';
      const iterationNum = safeNumber(parsed.iteration, run.trajectory.iterations.length + 1);
      ensureIteration(run, iterationNum);
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
      if (!run) {
        return;
      }

      const iterationNum = safeNumber(parsed.iteration, run.trajectory.iterations.length || 1);
      const targetIteration = ensureIteration(run, iterationNum);
      targetIteration.iteration_time = safeNumber(parsed.duration, 0);
      emitRunUpdate(runId, false);
      return;
    }

    if (eventName === 'subcall_start' && runId) {
      const run = liveRunsRef.current[runId];
      if (!run) {
        return;
      }
      run.metrics = {
        ...run.metrics,
        subcalls: (run.metrics?.subcalls ?? 0) + 1,
      };
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
      if (typeof parsed.response === 'string') {
        setLastAnswer(parsed.response);
      }

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

  const runLiveBenchmark = useCallback(async () => {
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
          prompt,
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
          <Button size="sm" onClick={runLiveBenchmark} disabled={isRunning || !prompt.trim()}>
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

        <div>
          <p className="text-[11px] text-muted-foreground mb-1">Live Event Stream</p>
          <ScrollArea className="h-44 rounded-md border border-border bg-background">
            <div className="p-2 space-y-1">
              {events.length === 0 ? (
                <p className="text-[11px] text-muted-foreground">No events yet. Run a prompt to stream iterations and subcalls.</p>
              ) : (
                events.map((evt) => (
                  <div key={evt.id} className="text-[11px] font-mono rounded px-2 py-1 bg-muted/50">
                    <span className="text-muted-foreground mr-2">
                      {new Date(evt.timestamp).toLocaleTimeString()}
                    </span>
                    <span className="text-primary mr-2">[{evt.name}]</span>
                    <span>{evt.message}</span>
                  </div>
                ))
              )}
            </div>
          </ScrollArea>
        </div>
      </CardContent>
    </Card>
  );
}
