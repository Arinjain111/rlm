'use client';

import { useState, useCallback, useEffect } from 'react';
import { Card, CardContent } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { ScrollArea } from '@/components/ui/scroll-area';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { FileUploader } from './FileUploader';
import { LogViewer } from './LogViewer';
import { AsciiRLM } from './AsciiGlobe';
import { ThemeToggle } from './ThemeToggle';
import { LiveRunner } from './LiveRunner';
import { ChatAgent } from './ChatAgent';
import { parseLogFile, extractContextVariable } from '@/lib/parse-logs';
import { RLMLogFile, SessionStats } from '@/lib/types';
import { cn } from '@/lib/utils';

// ── Topic cards shown on the landing page ──────────────────────────────────
interface TopicCard {
  icon: string;
  label: string;
  question: string;
  color: string;
}

const TOPIC_CATEGORIES: { title: string; topics: TopicCard[] }[] = [
  {
    title: 'Career Navigation',
    topics: [
      { icon: '🗺️', label: 'Career roadmap', question: 'Can you help me build a career roadmap for a software engineer with 2 years of experience?', color: 'oklch(0.5 0.18 145)' },
      { icon: '🔄', label: 'Career pivot', question: 'I want to pivot from software engineering to product management. What steps should I take?', color: 'oklch(0.55 0.15 200)' },
      { icon: '🚀', label: 'Break into AI/ML', question: 'How do I break into AI and machine learning as a backend developer?', color: 'oklch(0.5 0.18 260)' },
      { icon: '📊', label: 'Data science path', question: 'What is the best path to become a data scientist in 2025?', color: 'oklch(0.5 0.18 320)' },
    ],
  },
  {
    title: 'Job Search & Applications',
    topics: [
      { icon: '📄', label: 'Resume review', question: 'What makes a strong software engineering resume? What sections are most important?', color: 'oklch(0.5 0.18 145)' },
      { icon: '💼', label: 'Interview prep', question: 'How should I prepare for a technical interview at a big tech company?', color: 'oklch(0.55 0.15 200)' },
      { icon: '🎯', label: 'Job search strategy', question: 'What is the most effective job search strategy for senior software engineers?', color: 'oklch(0.5 0.18 260)' },
      { icon: '🏢', label: 'Startup vs big tech', question: 'What are the pros and cons of joining a startup versus a big tech company?', color: 'oklch(0.5 0.18 25)' },
    ],
  },
  {
    title: 'Compensation & Growth',
    topics: [
      { icon: '💰', label: 'Salary negotiation', question: 'How should I negotiate my salary for a senior software engineer offer?', color: 'oklch(0.5 0.18 145)' },
      { icon: '📈', label: 'Skill gap analysis', question: 'What skills do I need to grow from a mid-level to senior software engineer?', color: 'oklch(0.55 0.15 200)' },
      { icon: '🎓', label: 'Learning roadmap', question: 'What is the most efficient learning roadmap to become a full stack engineer?', color: 'oklch(0.5 0.18 260)' },
      { icon: '⭐', label: 'Stand out as a candidate', question: 'How can I stand out from other candidates when applying to top tech companies?', color: 'oklch(0.5 0.18 320)' },
    ],
  },
];

// ── Quick one-liner chips ──────────────────────────────────────────────────
const QUICK_CHIPS = [
  { label: 'What is in demand right now?', question: 'What tech skills are most in demand in the job market right now?' },
  { label: 'Am I underpaid?', question: 'How do I know if I am being underpaid as a software engineer?' },
  { label: 'Remote work tips', question: 'How do I find and land remote software engineering jobs?' },
  { label: 'Side project to career', question: 'How can I turn my side projects into a career advantage?' },
  { label: 'Impostor syndrome', question: 'How do I deal with impostor syndrome as a software engineer?' },
  { label: 'Manager role or IC?', question: 'Should I pursue a management track or stay as an individual contributor?' },
];

// ── Demo log helpers ───────────────────────────────────────────────────────
interface DemoLogInfo {
  fileName: string;
  contextPreview: string | null;
  hasFinalAnswer: boolean;
  iterations: number;
}

function getLogStatus(log: RLMLogFile): 'pending' | 'running' | 'completed' | 'failed' {
  if (log.status) return log.status;
  return log.metadata.finalAnswer ? 'completed' : 'pending';
}

function statusDotClass(status: 'pending' | 'running' | 'completed' | 'failed'): string {
  if (status === 'completed') return 'bg-primary';
  if (status === 'failed') return 'bg-red-500';
  if (status === 'running') return 'bg-amber-500';
  return 'bg-muted-foreground/40';
}

// ── Component ──────────────────────────────────────────────────────────────
export function Dashboard() {
  const [logFiles, setLogFiles] = useState<RLMLogFile[]>([]);
  const [selectedLog, setSelectedLog] = useState<RLMLogFile | null>(null);
  const [demoLogs, setDemoLogs] = useState<DemoLogInfo[]>([]);
  const [loadingDemos, setLoadingDemos] = useState(true);
  const [chatSessionStats, setChatSessionStats] = useState<SessionStats | null>(null);
  const [pendingChatMessage, setPendingChatMessage] = useState<string | null>(null);
  // { prompt, key } — incrementing key causes LiveRunner to re-trigger even for the same prompt
  const [liveRunTrigger, setLiveRunTrigger] = useState<{ prompt: string; key: number } | null>(null);
  const [autoSelectNextLog, setAutoSelectNextLog] = useState(false);

  const upsertLog = useCallback((incoming: RLMLogFile, select = false) => {
    const normalized: RLMLogFile = { ...incoming, updatedAt: incoming.updatedAt ?? Date.now() };

    setLogFiles((prev) => {
      if (prev.some((item) => item.fileName === normalized.fileName)) {
        return prev.map((item) => (item.fileName === normalized.fileName ? normalized : item));
      }
      return [...prev, normalized];
    });

    if (select) { setSelectedLog(normalized); return; }

    setSelectedLog((current) => {
      if (!current) return current;
      if (current.fileName === normalized.fileName) return normalized;
      if (current.runId && normalized.runId && current.runId === normalized.runId) return normalized;
      return current;
    });
  }, []);

  useEffect(() => {
    async function loadDemoPreviews() {
      try {
        const listResponse = await fetch('/api/logs');
        if (!listResponse.ok) throw new Error('Failed to fetch log list');
        const { files } = await listResponse.json();
        const previews: DemoLogInfo[] = [];
        for (const fileName of files) {
          try {
            const response = await fetch(`/logs/${fileName}`);
            if (!response.ok) continue;
            const content = await response.text();
            const parsed = parseLogFile(fileName, content);
            const contextVar = extractContextVariable(parsed.iterations);
            previews.push({
              fileName,
              contextPreview: contextVar,
              hasFinalAnswer: !!parsed.metadata.finalAnswer,
              iterations: parsed.metadata.totalIterations,
            });
          } catch (e) { console.error('Failed to load demo preview:', fileName, e); }
        }
        setDemoLogs(previews);
      } catch (e) { console.error('Failed to load demo logs:', e); }
      finally { setLoadingDemos(false); }
    }
    loadDemoPreviews();
  }, []);

  const handleFileLoaded = useCallback((fileName: string, content: string) => {
    const parsed = parseLogFile(fileName, content);
    upsertLog({ ...parsed, source: 'upload', status: parsed.metadata.finalAnswer ? 'completed' : 'pending' }, true);
  }, [upsertLog]);

  const handleLiveLogProduced = useCallback((liveLog: RLMLogFile) => {
    upsertLog({ ...liveLog, source: 'live', status: liveLog.status ?? 'completed' }, false);
    // If this run was triggered by a topic card click, auto-open the trace viewer
    setAutoSelectNextLog((shouldSelect) => {
      if (shouldSelect) {
        setSelectedLog({ ...liveLog, source: 'live', status: liveLog.status ?? 'completed' });
        return false; // reset flag
      }
      return shouldSelect;
    });
  }, [upsertLog]);

  const handleLiveLogPatched = useCallback((liveLog: RLMLogFile) => {
    upsertLog({ ...liveLog, source: 'live', status: liveLog.status ?? 'running' }, false);
  }, [upsertLog]);

  const loadDemoLog = useCallback(async (fileName: string) => {
    try {
      const response = await fetch(`/logs/${fileName}`);
      if (!response.ok) throw new Error('Failed to load demo log');
      const content = await response.text();
      const parsed = parseLogFile(fileName, content);
      upsertLog({ ...parsed, source: 'demo', status: parsed.metadata.finalAnswer ? 'completed' : 'pending' }, true);
    } catch (error) {
      console.error('Error loading demo log:', error);
      alert('Failed to load demo log. Make sure the log files are in the public/logs folder.');
    }
  }, [upsertLog]);

  const sessionLogs = [...logFiles].sort((a, b) => (b.updatedAt ?? 0) - (a.updatedAt ?? 0));
  const loadedNames = new Set(sessionLogs.map((item) => item.fileName));
  const unselectedDemoLogs = demoLogs.filter((item) => !loadedNames.has(item.fileName));

  const handleTopicClick = (question: string) => {
    setPendingChatMessage(question);
    // Also fire a live benchmark run with the same prompt so the user can see the RLM trace
    setAutoSelectNextLog(true);
    setLiveRunTrigger((prev) => ({ prompt: question, key: (prev?.key ?? 0) + 1 }));
  };

  return (
    <>
      <div className={cn('min-h-screen bg-background relative overflow-hidden', selectedLog ? 'hidden' : 'block')}>

        {/* ── Ambient background blobs ── */}
        <div className="absolute inset-0 grid-pattern opacity-30 dark:opacity-15 pointer-events-none" />
        <div className="pointer-events-none absolute -top-32 left-1/4 w-[600px] h-[600px] rounded-full blur-3xl" style={{ background: 'oklch(0.5 0.18 145 / 0.06)' }} />
        <div className="pointer-events-none absolute top-1/2 right-0 w-96 h-96 rounded-full blur-3xl" style={{ background: 'oklch(0.55 0.15 200 / 0.05)' }} />
        <div className="pointer-events-none absolute bottom-0 left-1/3 w-80 h-80 rounded-full blur-3xl" style={{ background: 'oklch(0.5 0.18 260 / 0.05)' }} />

        <div className="relative z-10">

          {/* ── Header ── */}
          <header className="border-b border-border backdrop-blur-sm sticky top-0 z-20 bg-background/80">
            <div className="max-w-7xl mx-auto px-6 py-4 flex items-center justify-between">
              <div className="flex items-center gap-3">
                {/* Logo mark */}
                <div className="w-8 h-8 rounded-lg flex items-center justify-center flex-shrink-0"
                  style={{ background: 'linear-gradient(135deg, oklch(0.5 0.18 145), oklch(0.4 0.15 160))' }}>
                  <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="white" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
                    <circle cx="12" cy="8" r="4" /><path d="M20 21a8 8 0 1 0-16 0" />
                  </svg>
                </div>
                <div>
                  <h1 className="text-lg font-bold tracking-tight leading-none">
                    <span className="text-primary">Career</span>
                    <span className="text-foreground"> · RLM</span>
                  </h1>
                  <p className="text-[10px] text-muted-foreground font-mono mt-0.5">Powered by Qwen 2.5 · Local · Free</p>
                </div>
              </div>

              <div className="flex items-center gap-3">
                <div className="hidden sm:flex items-center gap-2 rounded-full border border-primary/30 bg-primary/10 px-3 py-1.5">
                  <span className="w-1.5 h-1.5 rounded-full bg-emerald-500 animate-pulse" />
                  <span className="text-[10px] font-mono text-primary">AI Counsellor Online</span>
                </div>
                <ThemeToggle />
              </div>
            </div>
          </header>

          {/* ── Hero Section ── */}
          <section className="max-w-7xl mx-auto px-6 pt-12 pb-8">
            <div className="text-center mb-2">
              <div className="inline-flex items-center gap-2 rounded-full border border-primary/30 bg-primary/10 px-4 py-1.5 mb-5">
                <span className="text-[11px] font-mono text-primary">✦ Recursive Language Model · Career Intelligence</span>
              </div>
              <h2 className="text-4xl sm:text-5xl font-bold tracking-tight mb-4 leading-tight">
                Your Personal
                <span className="block" style={{
                  background: 'linear-gradient(135deg, oklch(0.55 0.2 145), oklch(0.6 0.15 200))',
                  WebkitBackgroundClip: 'text',
                  WebkitTextFillColor: 'transparent',
                  backgroundClip: 'text',
                }}>
                  AI Career Counsellor
                </span>
              </h2>
              <p className="text-muted-foreground text-base max-w-xl mx-auto leading-relaxed">
                Get personalised career guidance, interview prep, salary insights, and learning roadmaps — powered entirely by a local Qwen 2.5 model. No API costs. No data leaving your machine.
              </p>
            </div>

            {/* Stats row */}
            <div className="flex items-center justify-center gap-6 mt-8 flex-wrap">
              {[
                { value: '$0', label: 'Cost per conversation' },
                { value: '100%', label: 'Local & private' },
                { value: 'Qwen 2.5', label: 'Model powering it' },
                { value: '∞', label: 'Questions you can ask' },
              ].map((s) => (
                <div key={s.label} className="text-center">
                  <div className="text-2xl font-bold text-primary">{s.value}</div>
                  <div className="text-[11px] text-muted-foreground mt-0.5">{s.label}</div>
                </div>
              ))}
            </div>
          </section>

          {/* ── Quick chip bar ── */}
          <section className="max-w-7xl mx-auto px-6 pb-10">
            <p className="text-[11px] text-muted-foreground mb-3 font-mono">Quick questions →</p>
            <div className="flex flex-wrap gap-2">
              {QUICK_CHIPS.map((chip) => (
                <button
                  key={chip.label}
                  onClick={() => handleTopicClick(chip.question)}
                  className="group flex items-center gap-2 text-xs px-4 py-2 rounded-full border border-border bg-card hover:border-primary/60 hover:bg-primary/8 transition-all duration-200 hover:scale-[1.02] active:scale-[0.98]"
                >
                  <span className="text-foreground/80 group-hover:text-primary transition-colors">{chip.label}</span>
                  <svg width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round" className="text-muted-foreground/50 group-hover:text-primary transition-colors">
                    <line x1="5" y1="12" x2="19" y2="12" /><polyline points="12 5 19 12 12 19" />
                  </svg>
                </button>
              ))}
            </div>
          </section>

          {/* ── Topic Cards Grid ── */}
          <section className="max-w-7xl mx-auto px-6 pb-12">
            <div className="space-y-8">
              {TOPIC_CATEGORIES.map((cat) => (
                <div key={cat.title}>
                  <h3 className="text-sm font-semibold text-muted-foreground mb-4 flex items-center gap-2">
                    <span className="text-primary font-mono">◈</span>
                    {cat.title}
                  </h3>
                  <div className="grid sm:grid-cols-2 lg:grid-cols-4 gap-3">
                    {cat.topics.map((topic) => (
                      <button
                        key={topic.label}
                        onClick={() => handleTopicClick(topic.question)}
                        className="group text-left rounded-xl border border-border bg-card p-4 hover:border-primary/50 transition-all duration-200 hover:scale-[1.02] hover:shadow-lg hover:shadow-primary/5 active:scale-[0.99]"
                      >
                        <div className="flex items-start gap-3">
                          <div
                            className="w-9 h-9 rounded-lg flex items-center justify-center flex-shrink-0 text-lg transition-transform group-hover:scale-110"
                            style={{ background: `${topic.color.replace(')', ' / 0.15)')}`, border: `1px solid ${topic.color.replace(')', ' / 0.3)')}` }}
                          >
                            {topic.icon}
                          </div>
                          <div className="flex-1 min-w-0">
                            <p className="text-sm font-medium text-foreground group-hover:text-primary transition-colors truncate">
                              {topic.label}
                            </p>
                            <p className="text-[11px] text-muted-foreground mt-0.5 leading-relaxed line-clamp-2">
                              {topic.question}
                            </p>
                          </div>
                        </div>
                        <div className="mt-3 flex items-center gap-1.5 text-[10px] font-mono text-primary/60 group-hover:text-primary transition-colors">
                          <span>Ask counsellor</span>
                          <svg width="10" height="10" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
                            <line x1="5" y1="12" x2="19" y2="12" /><polyline points="12 5 19 12 12 19" />
                          </svg>
                        </div>
                      </button>
                    ))}
                  </div>
                </div>
              ))}
            </div>
          </section>

          {/* ── Divider ── */}
          <div className="max-w-7xl mx-auto px-6">
            <div className="border-t border-border" />
          </div>

          {/* ── RLM Debugger Section ── */}
          <main className="max-w-7xl mx-auto px-6 py-10">
            <div className="mb-6">
              <h3 className="text-sm font-semibold text-muted-foreground flex items-center gap-2 mb-1">
                <span className="text-primary font-mono">⌬</span>
                RLM Debugger
              </h3>
              <p className="text-xs text-muted-foreground/70">Run live RLM traces, upload logs, and inspect recursive execution patterns.</p>
            </div>

            <div className="grid lg:grid-cols-2 gap-10">

              {/* Left — Input Mode */}
              <div className="space-y-6">
                <div>
                  <h4 className="text-xs font-medium mb-3 flex items-center gap-2 text-muted-foreground">
                    <span className="text-primary font-mono">00</span>
                    Input Mode
                  </h4>
                  <Tabs defaultValue="live" className="space-y-3">
                    <TabsList className="grid w-full grid-cols-2">
                      <TabsTrigger value="live" className="text-xs">Live Run</TabsTrigger>
                      <TabsTrigger value="upload" className="text-xs">Upload Log</TabsTrigger>
                    </TabsList>
                    <TabsContent value="live">
                      <LiveRunner
                        onLogProduced={handleLiveLogProduced}
                        onLogPatched={handleLiveLogPatched}
                        chatSessionStats={chatSessionStats}
                        externalPrompt={liveRunTrigger?.prompt ?? null}
                        externalPromptKey={liveRunTrigger?.key ?? 0}
                      />
                    </TabsContent>
                    <TabsContent value="upload">
                      <FileUploader onFileLoaded={handleFileLoaded} />
                    </TabsContent>
                  </Tabs>
                </div>
              </div>

              {/* Right — Recent Traces + Architecture */}
              <div className="space-y-8">

                {/* Recent Traces */}
                <div>
                  <h4 className="text-xs font-medium mb-3 flex items-center gap-2 text-muted-foreground">
                    <span className="text-primary font-mono">02</span>
                    Recent Traces
                    <span className="text-[10px] text-muted-foreground/60 ml-1">(latest 10)</span>
                  </h4>

                  {loadingDemos ? (
                    <Card>
                      <CardContent className="p-6 text-center">
                        <div className="animate-pulse flex items-center justify-center gap-2 text-muted-foreground text-sm">
                          Loading traces...
                        </div>
                      </CardContent>
                    </Card>
                  ) : sessionLogs.length === 0 && unselectedDemoLogs.length === 0 ? (
                    <Card className="border-dashed">
                      <CardContent className="p-6 text-center text-muted-foreground text-sm">
                        No log files found in /public/logs/
                      </CardContent>
                    </Card>
                  ) : (
                    <ScrollArea className="h-[320px]">
                      <div className="space-y-2 pr-4">
                        {sessionLogs.map((log) => {
                          const status = getLogStatus(log);
                          return (
                            <Card
                              key={log.fileName}
                              onClick={() => setSelectedLog(log)}
                              className={cn(
                                'cursor-pointer transition-all hover:scale-[1.01]',
                                'hover:border-primary/50 hover:bg-primary/5',
                                status !== 'completed' && 'border-amber-500/30',
                                status === 'failed' && 'border-red-500/30',
                              )}
                            >
                              <CardContent className="p-3">
                                <div className="flex items-center gap-3">
                                  <div className="relative flex-shrink-0">
                                    <div className={cn('w-2.5 h-2.5 rounded-full', statusDotClass(status))} />
                                    {(status === 'running' || status === 'completed') && (
                                      <div className={cn(
                                        'absolute inset-0 w-2.5 h-2.5 rounded-full animate-ping opacity-50',
                                        status === 'completed' ? 'bg-primary' : 'bg-amber-500',
                                      )} />
                                    )}
                                  </div>
                                  <div className="flex-1 min-w-0">
                                    <div className="flex items-center gap-2 mb-1">
                                      <span className="font-mono text-xs text-foreground/80 truncate">{log.fileName}</span>
                                      <Badge variant="outline" className="text-[9px] px-1.5 py-0 h-4">{log.metadata.totalIterations} iter</Badge>
                                      <Badge
                                        variant="outline"
                                        className={cn(
                                          'text-[9px] px-1.5 py-0 h-4 uppercase',
                                          status === 'failed' && 'text-red-500 border-red-500/40',
                                          (status === 'pending' || status === 'running') && 'text-amber-600 border-amber-500/40',
                                        )}
                                      >
                                        {status}
                                      </Badge>
                                    </div>
                                    <p className="text-[11px] font-mono text-muted-foreground truncate">{log.metadata.contextQuestion}</p>
                                  </div>
                                </div>
                              </CardContent>
                            </Card>
                          );
                        })}

                        {unselectedDemoLogs.map((demo) => (
                          <Card
                            key={demo.fileName}
                            onClick={() => loadDemoLog(demo.fileName)}
                            className={cn('cursor-pointer transition-all hover:scale-[1.01]', 'hover:border-primary/50 hover:bg-primary/5')}
                          >
                            <CardContent className="p-3">
                              <div className="flex items-center gap-3">
                                <div className="relative flex-shrink-0">
                                  <div className={cn('w-2.5 h-2.5 rounded-full', demo.hasFinalAnswer ? 'bg-primary' : 'bg-muted-foreground/30')} />
                                  {demo.hasFinalAnswer && (
                                    <div className="absolute inset-0 w-2.5 h-2.5 rounded-full bg-primary animate-ping opacity-50" />
                                  )}
                                </div>
                                <div className="flex-1 min-w-0">
                                  <div className="flex items-center gap-2 mb-1">
                                    <span className="font-mono text-xs text-foreground/80">{demo.fileName}</span>
                                    <Badge variant="outline" className="text-[9px] px-1.5 py-0 h-4">{demo.iterations} iter</Badge>
                                  </div>
                                  {demo.contextPreview && (
                                    <p className="text-[11px] font-mono text-muted-foreground truncate">
                                      {demo.contextPreview.length > 80 ? demo.contextPreview.slice(0, 80) + '...' : demo.contextPreview}
                                    </p>
                                  )}
                                </div>
                              </div>
                            </CardContent>
                          </Card>
                        ))}
                      </div>
                    </ScrollArea>
                  )}
                </div>

                {/* Loaded files (conditional) */}
                {logFiles.length > 0 && (
                  <div>
                    <h4 className="text-xs font-medium mb-3 flex items-center gap-2 text-muted-foreground">
                      <span className="text-primary font-mono">03</span>
                      Loaded Files
                    </h4>
                    <ScrollArea className="h-[200px]">
                      <div className="space-y-2 pr-4">
                        {logFiles.map((log) => (
                          <Card
                            key={log.fileName}
                            className={cn('cursor-pointer transition-all hover:scale-[1.01]', 'hover:border-primary/50 hover:bg-primary/5')}
                            onClick={() => setSelectedLog(log)}
                          >
                            <CardContent className="p-3">
                              <div className="flex items-center gap-3">
                                <div className="relative flex-shrink-0">
                                  <div className={cn('w-2.5 h-2.5 rounded-full', statusDotClass(getLogStatus(log)))} />
                                  {getLogStatus(log) === 'completed' && (
                                    <div className="absolute inset-0 w-2.5 h-2.5 rounded-full bg-primary animate-ping opacity-50" />
                                  )}
                                </div>
                                <div className="flex-1 min-w-0">
                                  <div className="flex items-center gap-2 mb-1">
                                    <span className="font-mono text-xs truncate text-foreground/80">{log.fileName}</span>
                                    <Badge variant="outline" className="text-[9px] px-1.5 py-0 h-4">{log.metadata.totalIterations} iter</Badge>
                                    <Badge variant="outline" className="text-[9px] px-1.5 py-0 h-4 uppercase">{getLogStatus(log)}</Badge>
                                  </div>
                                  <p className="text-[11px] text-muted-foreground truncate">{log.metadata.contextQuestion}</p>
                                </div>
                              </div>
                            </CardContent>
                          </Card>
                        ))}
                      </div>
                    </ScrollArea>
                  </div>
                )}

                {/* ── How It Works — user-friendly architecture ── */}
                <div>
                  <h4 className="text-xs font-medium mb-3 flex items-center gap-2 text-muted-foreground">
                    <span className="text-primary font-mono">◈</span>
                    How It Works
                    <span className="text-[10px] text-muted-foreground/60 ml-1">— your question to personalised guidance</span>
                  </h4>
                  <div className="bg-muted/30 border border-border rounded-xl p-4 overflow-x-auto">
                    <AsciiRLM />
                  </div>
                </div>


              </div>
            </div>
          </main>

          {/* ── Footer ── */}
          <footer className="border-t border-border">
            <div className="max-w-7xl mx-auto px-6 py-5 flex items-center justify-between flex-wrap gap-3">
              <div className="flex items-center gap-3">
                <div className="w-6 h-6 rounded-md flex items-center justify-center"
                  style={{ background: 'linear-gradient(135deg, oklch(0.5 0.18 145), oklch(0.4 0.15 160))' }}>
                  <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="white" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
                    <circle cx="12" cy="8" r="4" /><path d="M20 21a8 8 0 1 0-16 0" />
                  </svg>
                </div>
                <p className="text-[10px] text-muted-foreground font-mono">Career · RLM Visualizer — Recursive Language Models</p>
              </div>
              <p className="text-[10px] text-muted-foreground font-mono">Prompt → [LM ↔ REPL] → Answer · Local · Private · Free</p>
            </div>
          </footer>
        </div>
      </div>

      {selectedLog && (
        <LogViewer logFile={selectedLog} onBack={() => setSelectedLog(null)} />
      )}

      <ChatAgent
        onSessionUpdate={setChatSessionStats}
        pendingMessage={pendingChatMessage}
        onClearPending={() => setPendingChatMessage(null)}
      />
    </>
  );
}
