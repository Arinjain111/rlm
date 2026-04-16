'use client';

import { useState } from 'react';
import { Badge } from '@/components/ui/badge';
import { ScrollArea } from '@/components/ui/scroll-area';
import { cn } from '@/lib/utils';
import { RLMIteration, extractFinalAnswer } from '@/lib/types';

interface TrajectoryPanelProps {
  iterations: RLMIteration[];
  selectedIteration: number;
  onSelectIteration: (index: number) => void;
}

// ── Segment types produced by parseResponse() ──────────────────────────────
interface TextSegment  { type: 'text'; content: string }
interface CodeSegment  { type: 'code'; lang: string; content: string }
interface SubCallSegment { type: 'subcall'; call: string; content: string }
type Segment = TextSegment | CodeSegment | SubCallSegment;

/** Split a raw response string into alternating text, code-fence, and sub-call segments. */
function parseResponse(response: string): Segment[] {
  const segments: Segment[] = [];
  // Match either code fences or rlm_query/llm_query calls
  const re = /```(\w*)\n?([\s\S]*?)```|((?:rlm_query|llm_query)\s*\([\s\S]*?\))/g;
  let last = 0;
  let match: RegExpExecArray | null;

  while ((match = re.exec(response)) !== null) {
    // Text before the match
    if (match.index > last) {
      const text = response.slice(last, match.index);
      if (text.trim()) segments.push({ type: 'text', content: text });
    }

    if (match[1] !== undefined && match[2] !== undefined) {
      // Code fence block
      segments.push({ type: 'code', lang: match[1] || 'text', content: match[2].trimEnd() });
    } else if (match[3]) {
      // Sub-call (rlm_query / llm_query)
      const full = match[3];
      const name = full.startsWith('rlm_query') ? 'rlm_query' : 'llm_query';
      segments.push({ type: 'subcall', call: name, content: full });
    }
    last = match.index + match[0].length;
  }

  // Remaining text
  const tail = response.slice(last);
  if (tail.trim()) segments.push({ type: 'text', content: tail });

  return segments;
}

/** Compute which messages in the CURRENT iteration's prompt are new vs previous iteration. */
function getDiffedPrompt(
  current: RLMIteration,
  previous: RLMIteration | null,
): Array<{ msg: { role: string; content: string }; isNew: boolean }> {
  const prevCount = previous ? previous.prompt.length : 0;
  return current.prompt.map((msg, idx) => ({
    msg,
    isNew: idx >= prevCount,
  }));
}

// ── Sub-components ──────────────────────────────────────────────────────────

function CopyButton({ text }: { text: string }) {
  const [copied, setCopied] = useState(false);
  const copy = () => {
    void navigator.clipboard.writeText(text);
    setCopied(true);
    setTimeout(() => setCopied(false), 1500);
  };
  return (
    <button
      onClick={copy}
      className="text-[9px] font-mono px-1.5 py-0.5 rounded border border-border/50 text-muted-foreground hover:text-foreground hover:border-primary/40 transition-colors"
    >
      {copied ? '✓ copied' : 'copy'}
    </button>
  );
}

function RoleIcon({ role }: { role: string }) {
  if (role === 'system') return (
    <div className="w-8 h-8 rounded-lg bg-gradient-to-br from-violet-500 to-purple-600 flex items-center justify-center shadow-lg shadow-violet-500/20">
      <svg className="w-4 h-4 text-white" fill="none" viewBox="0 0 24 24" stroke="currentColor">
        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M10.325 4.317c.426-1.756 2.924-1.756 3.35 0a1.724 1.724 0 002.573 1.066c1.543-.94 3.31.826 2.37 2.37a1.724 1.724 0 001.065 2.572c1.756.426 1.756 2.924 0 3.35a1.724 1.724 0 00-1.066 2.573c-.94 1.543.826 3.31 2.37 2.37a1.724 1.724 0 002.572 1.065c-.426 1.756-2.924 1.756-3.35 0a1.724 1.724 0 00-2.573-1.066c-1.543.94-3.31-.826-2.37-2.37a1.724 1.724 0 00-1.065-2.572c-1.756-.426-1.756-2.924 0-3.35a1.724 1.724 0 001.066-2.573c-.94-1.543.826-3.31 2.37-2.37.996.608 2.296.07 2.572-1.065z" />
        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M15 12a3 3 0 11-6 0 3 3 0 016 0z" />
      </svg>
    </div>
  );
  if (role === 'user') return (
    <div className="w-8 h-8 rounded-lg bg-gradient-to-br from-emerald-500 to-green-600 flex items-center justify-center shadow-lg shadow-emerald-500/20">
      <svg className="w-4 h-4 text-white" fill="none" viewBox="0 0 24 24" stroke="currentColor">
        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M16 7a4 4 0 11-8 0 4 4 0 018 0zM12 14a7 7 0 00-7 7h14a7 7 0 00-7-7z" />
      </svg>
    </div>
  );
  return (
    <div className="w-8 h-8 rounded-lg bg-gradient-to-br from-sky-500 to-blue-600 flex items-center justify-center shadow-lg shadow-sky-500/20">
      <svg className="w-4 h-4 text-white" fill="none" viewBox="0 0 24 24" stroke="currentColor">
        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9.75 17L9 20l-1 1h8l-1-1-.75-3M3 13h18M5 17h14a2 2 0 002-2V5a2 2 0 00-2-2H5a2 2 0 00-2 2v10a2 2 0 002 2z" />
      </svg>
    </div>
  );
}

function RoleLabel({ role }: { role: string }) {
  const labels: Record<string, { name: string; color: string }> = {
    system:    { name: 'System Prompt',   color: 'text-violet-600 dark:text-violet-400' },
    user:      { name: 'User',            color: 'text-emerald-600 dark:text-emerald-400' },
    assistant: { name: 'Assistant',       color: 'text-sky-600 dark:text-sky-400' },
  };
  const cfg = labels[role] || { name: role, color: 'text-muted-foreground' };
  return <span className={cn('font-semibold text-sm', cfg.color)}>{cfg.name}</span>;
}

/** Render a parsed response segment (text / code / sub-call) */
function ResponseSegment({ seg }: { seg: Segment }) {
  const [expanded, setExpanded] = useState(false);

  if (seg.type === 'text') {
    return (
      <pre className="whitespace-pre-wrap font-mono text-foreground/90 text-[12px] leading-relaxed overflow-x-auto">
        {seg.content}
      </pre>
    );
  }

  if (seg.type === 'code') {
    return (
      <div className="my-2 rounded-lg border border-primary/20 overflow-hidden">
        <div className="flex items-center justify-between px-3 py-1.5 bg-primary/8 border-b border-primary/15">
          <div className="flex items-center gap-2">
            <span className="text-[9px] font-mono text-primary/70 uppercase tracking-wider">
              {seg.lang || 'code'}
            </span>
            <Badge className="text-[9px] px-1.5 py-0 h-4 bg-emerald-500/15 text-emerald-600 dark:text-emerald-400 border-emerald-500/30">
              ⟨/⟩ code block
            </Badge>
          </div>
          <CopyButton text={seg.content} />
        </div>
        <pre className="px-3 py-2.5 text-[11px] font-mono leading-relaxed overflow-x-auto text-foreground/90 bg-background/60">
          {expanded || seg.content.length <= 600
            ? seg.content
            : seg.content.slice(0, 600) + '\n…'}
        </pre>
        {seg.content.length > 600 && (
          <button
            onClick={() => setExpanded((e) => !e)}
            className="w-full text-center text-[10px] text-muted-foreground hover:text-primary py-1 border-t border-border/50 transition-colors"
          >
            {expanded ? '▲ collapse' : `▼ show all (${seg.content.length} chars)`}
          </button>
        )}
      </div>
    );
  }

  // sub-call
  const isSub = seg.call === 'rlm_query';
  return (
    <div className="my-2 rounded-lg border border-fuchsia-500/30 bg-fuchsia-500/8 overflow-hidden">
      <div className="flex items-center gap-2 px-3 py-1.5 border-b border-fuchsia-500/20">
        <Badge className="text-[9px] px-1.5 py-0 h-4 bg-fuchsia-500/20 text-fuchsia-600 dark:text-fuchsia-300 border-fuchsia-500/40">
          {isSub ? '◇ rlm_query' : '◆ llm_query'}
        </Badge>
        <span className="text-[9px] font-mono text-fuchsia-600/70 dark:text-fuchsia-400/70">
          {isSub ? 'recursive sub-call → child RLM' : 'plain LM call'}
        </span>
        <CopyButton text={seg.content} />
      </div>
      <pre className="px-3 py-2 text-[11px] font-mono text-fuchsia-700 dark:text-fuchsia-300 leading-relaxed overflow-x-auto">
        {seg.content.length > 300 ? seg.content.slice(0, 300) + '…' : seg.content}
      </pre>
    </div>
  );
}

// ── Main export ─────────────────────────────────────────────────────────────

export function TrajectoryPanel({
  iterations,
  selectedIteration,
}: TrajectoryPanelProps) {
  const currentIteration = iterations[selectedIteration];
  const previousIteration = selectedIteration > 0 ? iterations[selectedIteration - 1] : null;
  const [showRawPrompt, setShowRawPrompt] = useState(false);

  if (!currentIteration) {
    return (
      <div className="h-full flex items-center justify-center text-muted-foreground text-sm">
        No iteration selected
      </div>
    );
  }

  const diffedPrompt = getDiffedPrompt(currentIteration, previousIteration);
  const responseSegments = parseResponse(currentIteration.response);
  const hasSubCalls = responseSegments.some((s) => s.type === 'subcall');
  const codeSegments = responseSegments.filter((s) => s.type === 'code').length;

  return (
    <div className="h-full flex flex-col bg-background overflow-hidden">
      {/* Header */}
      <div className="px-4 py-3 border-b border-border flex items-center justify-between bg-muted/30 flex-shrink-0">
        <div className="flex items-center gap-3">
          <div className="w-8 h-8 rounded-lg bg-gradient-to-br from-sky-500 to-indigo-600 flex items-center justify-center">
            <span className="text-white text-sm font-bold">◈</span>
          </div>
          <div>
            <h2 className="font-semibold text-sm">Conversation</h2>
            <p className="text-[11px] text-muted-foreground">
              Iteration {selectedIteration + 1} of {iterations.length}
            </p>
          </div>
        </div>
        <div className="flex items-center gap-2 flex-wrap">
          {codeSegments > 0 && (
            <Badge variant="secondary" className="text-[10px]">{codeSegments} code</Badge>
          )}
          {hasSubCalls && (
            <Badge className="bg-fuchsia-500/15 text-fuchsia-600 dark:text-fuchsia-400 border-fuchsia-500/30 text-[10px]">
              ◇ sub-calls
            </Badge>
          )}
          {currentIteration.final_answer && (
            <Badge className="bg-emerald-500/15 text-emerald-600 dark:text-emerald-400 border-emerald-500/30 text-[10px]">
              ✓ Answer
            </Badge>
          )}
          {previousIteration && (
            <button
              onClick={() => setShowRawPrompt((r) => !r)}
              className="text-[10px] px-2 py-0.5 rounded border border-border/60 text-muted-foreground hover:text-primary hover:border-primary/40 transition-colors"
            >
              {showRawPrompt ? 'Diff view' : 'Raw view'}
            </button>
          )}
        </div>
      </div>

      {/* Content */}
      <div className="flex-1 min-h-0 overflow-hidden">
        <ScrollArea className="h-full">
          <div className="p-4 space-y-4">

            {/* ── Prompt messages (with diff highlight) ── */}
            {diffedPrompt.map(({ msg, isNew }, idx) => (
              <div
                key={idx}
                className={cn(
                  'rounded-xl border p-4 transition-all',
                  msg.role === 'system'    && 'bg-violet-500/5 border-violet-500/20 dark:bg-violet-500/10',
                  msg.role === 'user'      && !isNew && 'bg-emerald-500/5 border-emerald-500/20',
                  msg.role === 'user'      && isNew  && 'bg-amber-500/10 border-amber-500/40 dark:bg-amber-500/8 ring-1 ring-amber-500/20',
                  msg.role === 'assistant' && 'bg-sky-500/5 border-sky-500/20',
                )}
              >
                {/* Message header */}
                <div className="flex items-center gap-3 mb-3 pb-3 border-b border-border/50">
                  <RoleIcon role={msg.role} />
                  <div className="flex-1">
                    <RoleLabel role={msg.role} />
                    {isNew && !showRawPrompt && (
                      <Badge className="ml-2 text-[9px] px-1.5 py-0 h-4 bg-amber-500/20 text-amber-700 dark:text-amber-400 border-amber-500/40">
                        ✦ NEW in iter {selectedIteration + 1}
                      </Badge>
                    )}
                    {msg.role === 'system' && (
                      <p className="text-[10px] text-muted-foreground mt-0.5">Instructions & context setup</p>
                    )}
                    {msg.role === 'user' && !isNew && idx > 0 && (
                      <p className="text-[10px] text-muted-foreground mt-0.5">Carried from previous iteration</p>
                    )}
                  </div>
                  <CopyButton text={msg.content} />
                </div>

                {/* Message content */}
                <div className={cn(
                  'rounded-lg p-3 border',
                  isNew && !showRawPrompt ? 'bg-amber-500/5 border-amber-500/20' : 'bg-background/60 border-border/50',
                )}>
                  <pre className="whitespace-pre-wrap font-mono text-foreground/90 text-[12px] leading-relaxed overflow-x-auto">
                    {msg.content.length > 3000 ? msg.content.slice(0, 3000) + '\n… [truncated]' : msg.content}
                  </pre>
                </div>
              </div>
            ))}

            {/* ── Model Response — parsed & highlighted ── */}
            {currentIteration.response && (
              <div className="rounded-xl border-2 border-sky-500/40 bg-gradient-to-br from-sky-500/10 to-indigo-500/10 p-4 shadow-lg shadow-sky-500/5">
                {/* Response header */}
                <div className="flex items-center gap-3 mb-3 pb-3 border-b border-sky-500/20">
                  <div className="w-8 h-8 rounded-lg bg-gradient-to-br from-sky-500 to-indigo-600 flex items-center justify-center shadow-lg shadow-sky-500/20">
                    <svg className="w-4 h-4 text-white" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M8 10h.01M12 10h.01M16 10h.01M9 16H5a2 2 0 01-2-2V6a2 2 0 012-2h14a2 2 0 012 2v8a2 2 0 01-2 2h-5l-5 5v-5z" />
                    </svg>
                  </div>
                  <div className="flex-1">
                    <span className="font-semibold text-sm text-sky-600 dark:text-sky-400">Model Response</span>
                    <p className="text-[10px] text-muted-foreground mt-0.5">Iteration {currentIteration.iteration}</p>
                  </div>
                  <div className="flex items-center gap-2">
                    {hasSubCalls && (
                      <Badge className="text-[9px] px-1.5 py-0 h-4 bg-fuchsia-500/20 text-fuchsia-600 dark:text-fuchsia-300 border-fuchsia-500/40">
                        ◇ sub-calls highlighted
                      </Badge>
                    )}
                    <Badge variant="outline" className="text-[10px] border-sky-500/30 text-sky-600 dark:text-sky-400">
                      {currentIteration.response.length.toLocaleString()} chars
                    </Badge>
                    <CopyButton text={currentIteration.response} />
                  </div>
                </div>

                {/* Parsed segments */}
                <div className="bg-background/80 rounded-lg p-3 border border-sky-500/20 space-y-1">
                  {responseSegments.map((seg, idx) => (
                    <ResponseSegment key={idx} seg={seg} />
                  ))}
                </div>
              </div>
            )}

            {/* ── Final answer ── */}
            {currentIteration.final_answer && (
              <div className="rounded-xl border-2 border-emerald-500/50 bg-gradient-to-br from-emerald-500/15 to-green-500/15 p-4 shadow-lg shadow-emerald-500/10">
                <div className="flex items-center gap-3 mb-3">
                  <div className="w-10 h-10 rounded-full bg-gradient-to-br from-emerald-500 to-green-600 flex items-center justify-center shadow-lg shadow-emerald-500/30">
                    <svg className="w-5 h-5 text-white" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2.5} d="M5 13l4 4L19 7" />
                    </svg>
                  </div>
                  <div>
                    <span className="font-bold text-emerald-600 dark:text-emerald-400 text-base">Final Answer</span>
                    <p className="text-[10px] text-muted-foreground">Task completed successfully</p>
                  </div>
                </div>
                <div className="bg-background/80 rounded-lg p-4 border border-emerald-500/30">
                  <p className="text-[15px] font-medium text-foreground leading-relaxed">
                    {extractFinalAnswer(currentIteration.final_answer)}
                  </p>
                </div>
              </div>
            )}

            <div className="h-4" />
          </div>
        </ScrollArea>
      </div>
    </div>
  );
}
