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
import { parseLogFile, extractContextVariable } from '@/lib/parse-logs';
import { RLMLogFile } from '@/lib/types';
import { cn } from '@/lib/utils';

interface DemoLogInfo {
  fileName: string;
  contextPreview: string | null;
  hasFinalAnswer: boolean;
  iterations: number;
}

function getLogStatus(log: RLMLogFile): 'pending' | 'running' | 'completed' | 'failed' {
  if (log.status) {
    return log.status;
  }
  return log.metadata.finalAnswer ? 'completed' : 'pending';
}

function statusDotClass(status: 'pending' | 'running' | 'completed' | 'failed'): string {
  if (status === 'completed') return 'bg-primary';
  if (status === 'failed') return 'bg-red-500';
  if (status === 'running') return 'bg-amber-500';
  return 'bg-muted-foreground/40';
}

export function Dashboard() {
  const [logFiles, setLogFiles] = useState<RLMLogFile[]>([]);
  const [selectedLog, setSelectedLog] = useState<RLMLogFile | null>(null);
  const [demoLogs, setDemoLogs] = useState<DemoLogInfo[]>([]);
  const [loadingDemos, setLoadingDemos] = useState(true);

  const upsertLog = useCallback((incoming: RLMLogFile, select = false) => {
    const normalized: RLMLogFile = {
      ...incoming,
      updatedAt: incoming.updatedAt ?? Date.now(),
    };

    setLogFiles((prev) => {
      if (prev.some((item) => item.fileName === normalized.fileName)) {
        return prev.map((item) =>
          item.fileName === normalized.fileName ? normalized : item,
        );
      }
      return [...prev, normalized];
    });

    if (select) {
      setSelectedLog(normalized);
      return;
    }

    setSelectedLog((current) => {
      if (!current) {
        return current;
      }
      if (current.fileName === normalized.fileName) {
        return normalized;
      }
      if (current.runId && normalized.runId && current.runId === normalized.runId) {
        return normalized;
      }
      return current;
    });
  }, []);

  // Load demo log previews on mount - fetches latest 10 from API
  useEffect(() => {
    async function loadDemoPreviews() {
      try {
        // Fetch list of log files from API
        const listResponse = await fetch('/api/logs');
        if (!listResponse.ok) {
          throw new Error('Failed to fetch log list');
        }
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
          } catch (e) {
            console.error('Failed to load demo preview:', fileName, e);
          }
        }
        
        setDemoLogs(previews);
      } catch (e) {
        console.error('Failed to load demo logs:', e);
      } finally {
        setLoadingDemos(false);
      }
    }
    
    loadDemoPreviews();
  }, []);

  const handleFileLoaded = useCallback((fileName: string, content: string) => {
    const parsed = parseLogFile(fileName, content);
    upsertLog(
      {
        ...parsed,
        source: 'upload',
        status: parsed.metadata.finalAnswer ? 'completed' : 'pending',
      },
      true,
    );
  }, [upsertLog]);

  const handleLiveLogProduced = useCallback((liveLog: RLMLogFile) => {
    upsertLog(
      {
        ...liveLog,
        source: 'live',
        status: liveLog.status ?? 'completed',
      },
      false,
    );
  }, [upsertLog]);

  const handleLiveLogPatched = useCallback((liveLog: RLMLogFile) => {
    upsertLog(
      {
        ...liveLog,
        source: 'live',
        status: liveLog.status ?? 'running',
      },
      false,
    );
  }, [upsertLog]);

  const loadDemoLog = useCallback(async (fileName: string) => {
    try {
      const response = await fetch(`/logs/${fileName}`);
      if (!response.ok) throw new Error('Failed to load demo log');
      const content = await response.text();
      const parsed = parseLogFile(fileName, content);
      upsertLog(
        {
          ...parsed,
          source: 'demo',
          status: parsed.metadata.finalAnswer ? 'completed' : 'pending',
        },
        true,
      );
    } catch (error) {
      console.error('Error loading demo log:', error);
      alert('Failed to load demo log. Make sure the log files are in the public/logs folder.');
    }
  }, [upsertLog]);

  const sessionLogs = [...logFiles].sort(
    (a, b) => (b.updatedAt ?? 0) - (a.updatedAt ?? 0),
  );
  const loadedNames = new Set(sessionLogs.map((item) => item.fileName));
  const unselectedDemoLogs = demoLogs.filter((item) => !loadedNames.has(item.fileName));

  return (
    <>
    <div className={cn('min-h-screen bg-background relative overflow-hidden', selectedLog ? 'hidden' : 'block')}>
      {/* Background effects */}
      <div className="absolute inset-0 grid-pattern opacity-30 dark:opacity-15" />
      <div className="absolute top-0 left-1/3 w-[500px] h-[500px] bg-primary/5 rounded-full blur-3xl" />
      <div className="absolute bottom-0 right-1/4 w-96 h-96 bg-primary/3 rounded-full blur-3xl" />
      
      <div className="relative z-10">
        {/* Header */}
        <header className="border-b border-border">
          <div className="max-w-7xl mx-auto px-6 py-6">
            <div className="flex items-center justify-between">
              <div>
                <h1 className="text-3xl font-bold tracking-tight">
                  <span className="text-primary">RLM</span>
                  <span className="text-muted-foreground ml-2 font-normal">Visualizer</span>
                </h1>
                <p className="text-sm text-muted-foreground mt-1">
                  Debug recursive language model execution traces
                </p>
              </div>
              <div className="flex items-center gap-4">
                <ThemeToggle />
                <div className="flex items-center gap-2 text-[10px] text-muted-foreground font-mono">
                  <span className="flex items-center gap-1.5">
                    <span className="w-1.5 h-1.5 rounded-full bg-primary animate-pulse" />
                    READY
                  </span>
                </div>
              </div>
            </div>
          </div>
        </header>

        {/* Main Content */}
        <main className="max-w-7xl mx-auto px-6 py-8">
          <div className="grid lg:grid-cols-2 gap-10">
            {/* Left Column - Upload & ASCII Art */}
            <div className="space-y-8">
              {/* Input Mode Section */}
              <div>
                <h2 className="text-sm font-medium mb-3 flex items-center gap-2 text-muted-foreground">
                  <span className="text-primary font-mono">00</span>
                  Input Mode
                </h2>
                <Tabs defaultValue="live" className="space-y-3">
                  <TabsList className="grid w-full grid-cols-2">
                    <TabsTrigger value="live" className="text-xs">Live Run</TabsTrigger>
                    <TabsTrigger value="upload" className="text-xs">Upload Log</TabsTrigger>
                  </TabsList>

                  <TabsContent value="live">
                    <LiveRunner
                      onLogProduced={handleLiveLogProduced}
                      onLogPatched={handleLiveLogPatched}
                    />
                  </TabsContent>

                  <TabsContent value="upload">
                    <FileUploader onFileLoaded={handleFileLoaded} />
                  </TabsContent>
                </Tabs>
              </div>
              
              {/* ASCII Architecture Diagram */}
              <div className="hidden lg:block">
                <h2 className="text-sm font-medium mb-3 flex items-center gap-2 text-muted-foreground">
                  <span className="text-primary font-mono">◈</span>
                  RLM Architecture
                </h2>
                <div className="bg-muted/50 border border-border rounded-lg p-4 overflow-x-auto">
                  <AsciiRLM />
                </div>
              </div>
            </div>

            {/* Right Column - Demo Logs & Loaded Files */}
            <div className="space-y-8">
              {/* Demo Logs Section */}
              <div>
                <h2 className="text-sm font-medium mb-3 flex items-center gap-2 text-muted-foreground">
                  <span className="text-primary font-mono">02</span>
                  Recent Traces
                  <span className="text-[10px] text-muted-foreground/60 ml-1">(latest 10)</span>
                </h2>
                
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
                            status === 'failed' && 'border-red-500/30'
                          )}
                        >
                          <CardContent className="p-3">
                            <div className="flex items-center gap-3">
                              <div className="relative flex-shrink-0">
                                <div className={cn('w-2.5 h-2.5 rounded-full', statusDotClass(status))} />
                                {(status === 'running' || status === 'completed') && (
                                  <div
                                    className={cn(
                                      'absolute inset-0 w-2.5 h-2.5 rounded-full animate-ping opacity-50',
                                      status === 'completed' ? 'bg-primary' : 'bg-amber-500',
                                    )}
                                  />
                                )}
                              </div>

                              <div className="flex-1 min-w-0">
                                <div className="flex items-center gap-2 mb-1">
                                  <span className="font-mono text-xs text-foreground/80 truncate">
                                    {log.fileName}
                                  </span>
                                  <Badge variant="outline" className="text-[9px] px-1.5 py-0 h-4">
                                    {log.metadata.totalIterations} iter
                                  </Badge>
                                  <Badge
                                    variant="outline"
                                    className={cn(
                                      'text-[9px] px-1.5 py-0 h-4 uppercase',
                                      status === 'failed' && 'text-red-500 border-red-500/40',
                                      (status === 'pending' || status === 'running') &&
                                        'text-amber-600 border-amber-500/40',
                                    )}
                                  >
                                    {status}
                                  </Badge>
                                </div>
                                <p className="text-[11px] font-mono text-muted-foreground truncate">
                                  {log.metadata.contextQuestion}
                                </p>
                              </div>
                            </div>
                          </CardContent>
                        </Card>
                      )})}

                      {unselectedDemoLogs.map((demo) => (
                        <Card
                          key={demo.fileName}
                          onClick={() => loadDemoLog(demo.fileName)}
                          className={cn(
                            'cursor-pointer transition-all hover:scale-[1.01]',
                            'hover:border-primary/50 hover:bg-primary/5'
                          )}
                        >
                          <CardContent className="p-3">
                            <div className="flex items-center gap-3">
                              <div className="relative flex-shrink-0">
                                <div className={cn(
                                  'w-2.5 h-2.5 rounded-full',
                                  demo.hasFinalAnswer 
                                    ? 'bg-primary' 
                                    : 'bg-muted-foreground/30'
                                )} />
                                {demo.hasFinalAnswer && (
                                  <div className="absolute inset-0 w-2.5 h-2.5 rounded-full bg-primary animate-ping opacity-50" />
                                )}
                              </div>
                              
                              {/* Content */}
                              <div className="flex-1 min-w-0">
                                <div className="flex items-center gap-2 mb-1">
                                  <span className="font-mono text-xs text-foreground/80">
                                    {demo.fileName}
                                  </span>
                                  <Badge variant="outline" className="text-[9px] px-1.5 py-0 h-4">
                                    {demo.iterations} iter
                                  </Badge>
                                </div>
                                {demo.contextPreview && (
                                  <p className="text-[11px] font-mono text-muted-foreground truncate">
                                    {demo.contextPreview.length > 80 
                                      ? demo.contextPreview.slice(0, 80) + '...'
                                      : demo.contextPreview}
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

              {/* Loaded Files Section */}
              {logFiles.length > 0 && (
                <div>
                  <h2 className="text-sm font-medium mb-3 flex items-center gap-2 text-muted-foreground">
                    <span className="text-primary font-mono">03</span>
                    Loaded Files
                  </h2>
                  <ScrollArea className="h-[200px]">
                    <div className="space-y-2 pr-4">
                      {logFiles.map((log) => (
                        <Card
                          key={log.fileName}
                          className={cn(
                            'cursor-pointer transition-all hover:scale-[1.01]',
                            'hover:border-primary/50 hover:bg-primary/5'
                          )}
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
                                  <span className="font-mono text-xs truncate text-foreground/80">
                                    {log.fileName}
                                  </span>
                                  <Badge variant="outline" className="text-[9px] px-1.5 py-0 h-4">
                                    {log.metadata.totalIterations} iter
                                  </Badge>
                                  <Badge variant="outline" className="text-[9px] px-1.5 py-0 h-4 uppercase">
                                    {getLogStatus(log)}
                                  </Badge>
                                </div>
                                <p className="text-[11px] text-muted-foreground truncate">
                                  {log.metadata.contextQuestion}
                                </p>
                              </div>
                            </div>
                          </CardContent>
                        </Card>
                      ))}
                    </div>
                  </ScrollArea>
                </div>
              )}
            </div>
          </div>
        </main>

        {/* Footer */}
        <footer className="border-t border-border mt-8">
          <div className="max-w-7xl mx-auto px-6 py-4 flex items-center justify-between">
            <p className="text-[10px] text-muted-foreground font-mono">
              RLM Visualizer • Recursive Language Models
            </p>
            <p className="text-[10px] text-muted-foreground font-mono">
              Prompt → [LM ↔ REPL] → Answer
            </p>
          </div>
        </footer>
      </div>
    </div>
    {selectedLog && (
      <LogViewer
        logFile={selectedLog}
        onBack={() => setSelectedLog(null)}
      />
    )}
    </>
  );
}
