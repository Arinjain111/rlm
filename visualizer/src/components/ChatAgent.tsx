'use client';

import { useState, useRef, useEffect, useCallback } from 'react';
import { SessionStats } from '@/lib/types';

interface ChatMessage {
  id: string;
  role: 'user' | 'assistant';
  content: string;
  inputTokens?: number;
  outputTokens?: number;
  timestamp: number;
  streaming?: boolean; // true while mid-stream
}

interface ChatAgentProps {
  onSessionUpdate: (stats: SessionStats) => void;
  pendingMessage?: string | null;
  onClearPending?: () => void;
}

const STARTER_CHIPS = [
  'How do I break into AI/ML?',
  'Review my career path',
  'Salary negotiation tips',
  'Should I pivot to product?',
  'What skills are most in demand?',
];

function TypingCursor() {
  return (
    <span
      className="inline-block w-0.5 h-3.5 bg-primary/80 ml-0.5 rounded-full align-middle"
      style={{ animation: 'blink 0.9s step-end infinite' }}
    />
  );
}

function TypingDots() {
  return (
    <div className="flex items-center gap-1 px-3 py-2">
      {[0, 1, 2].map((i) => (
        <span
          key={i}
          className="w-1.5 h-1.5 rounded-full bg-primary/60 animate-bounce"
          style={{ animationDelay: `${i * 150}ms`, animationDuration: '800ms' }}
        />
      ))}
    </div>
  );
}

const THINKING_PHASES = [
  { label: 'Analyzing your query…',         icon: '🔍', detail: 'Parsing intent and context' },
  { label: 'Pulling trained model weights…', icon: '🧠', detail: 'Loading career counsellor context' },
  { label: 'Constructing context history…',  icon: '🗂️', detail: 'Reviewing conversation so far' },
  { label: 'Generating response…',           icon: '✨',  detail: 'Writing your personalised guidance' },
];

function ThinkingPhase({ phase }: { phase: number }) {
  const p = THINKING_PHASES[Math.min(phase, THINKING_PHASES.length - 1)];
  const progress = ((phase + 1) / THINKING_PHASES.length) * 100;
  return (
    <div className="px-3 py-2.5 rounded-xl bg-muted border border-border max-w-[80%]">
      <div className="flex items-center gap-2 mb-2">
        <span className="text-base leading-none">{p.icon}</span>
        <span className="text-xs font-medium text-foreground">{p.label}</span>
        <span className="w-1.5 h-1.5 rounded-full bg-primary/70 animate-pulse ml-auto flex-shrink-0" />
      </div>
      <p className="text-[10px] text-muted-foreground mb-2">{p.detail}</p>
      {/* Progress strip */}
      <div className="h-0.5 rounded-full bg-border overflow-hidden">
        <div
          className="h-full rounded-full bg-primary/60 transition-all duration-700 ease-out"
          style={{ width: `${progress}%` }}
        />
      </div>
      <div className="flex justify-between mt-1 text-[9px] font-mono text-muted-foreground/50">
        <span>step {phase + 1} / {THINKING_PHASES.length}</span>
        <span>{Math.round(progress)}%</span>
      </div>
    </div>
  );
}

export function ChatAgent({ onSessionUpdate, pendingMessage, onClearPending }: ChatAgentProps) {
  const [open, setOpen] = useState(false);
  const [messages, setMessages] = useState<ChatMessage[]>([]);
  const [input, setInput] = useState('');
  const [loading, setLoading] = useState(false);
  const [sessionStats, setSessionStats] = useState<SessionStats | null>(null);
  // -1 = not thinking; 0-3 = cycling through THINKING_PHASES before first token
  const [thinkingPhase, setThinkingPhase] = useState(-1);
  const thinkingIntervalRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const bottomRef = useRef<HTMLDivElement>(null);
  const textareaRef = useRef<HTMLTextAreaElement>(null);
  const pendingFired = useRef<string | null>(null);
  // Track the streaming message id so we can update it in place
  const streamingIdRef = useRef<string | null>(null);

  const startThinking = useCallback(() => {
    setThinkingPhase(0);
    let phase = 0;
    thinkingIntervalRef.current = setInterval(() => {
      phase = Math.min(phase + 1, THINKING_PHASES.length - 1);
      setThinkingPhase(phase);
    }, 900);
  }, []);

  const stopThinking = useCallback(() => {
    if (thinkingIntervalRef.current) {
      clearInterval(thinkingIntervalRef.current);
      thinkingIntervalRef.current = null;
    }
    setThinkingPhase(-1);
  }, []);

  useEffect(() => {
    bottomRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, [messages, loading]);

  useEffect(() => {
    if (open) setTimeout(() => textareaRef.current?.focus(), 120);
  }, [open]);

  const sendMessage = useCallback(
    async (text: string) => {
      const trimmed = text.trim();
      if (!trimmed || loading) return;

      const userMsg: ChatMessage = {
        id: `u_${Date.now()}`,
        role: 'user',
        content: trimmed,
        timestamp: Date.now(),
      };

      setMessages((prev) => [...prev, userMsg]);
      setInput('');
      setLoading(true);
      startThinking(); // start phase animation immediately

      const history = [...messages, userMsg].map((m) => ({ role: m.role, content: m.content }));

      // Create a placeholder streaming message
      const streamId = `a_${Date.now()}`;
      streamingIdRef.current = streamId;
      const streamingMsg: ChatMessage = {
        id: streamId,
        role: 'assistant',
        content: '',
        timestamp: Date.now(),
        streaming: true,
      };
      setMessages((prev) => [...prev, streamingMsg]);

      try {
        const res = await fetch('/api/chat', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ messages: history }),
        });

        if (!res.ok || !res.body) {
          const errText = await res.text().catch(() => `HTTP ${res.status}`);
          throw new Error(errText);
        }

        const reader = res.body.getReader();
        const decoder = new TextDecoder();
        let buffer = '';

        while (true) {
          const { value, done } = await reader.read();
          if (done) break;

          buffer += decoder.decode(value, { stream: true });
          const lines = buffer.split('\n\n');
          buffer = lines.pop() ?? '';

          for (const line of lines) {
            const dataPart = line.replace(/^data:\s*/, '').trim();
            if (!dataPart) continue;

            let parsed: Record<string, unknown>;
            try { parsed = JSON.parse(dataPart) as Record<string, unknown>; }
            catch { continue; }

            if (parsed.error === true) {
              // Server-side error during streaming
              setMessages((prev) =>
                prev.map((m) =>
                  m.id === streamId
                    ? { ...m, content: `⚠️ ${String(parsed.message ?? 'Connection error')}`, streaming: false }
                    : m,
                ),
              );
              return;
            }

            if (typeof parsed.token === 'string') {
              // Stop thinking the moment any real token arrives
              stopThinking();
              // Append token character-by-character to the streaming message
              setMessages((prev) =>
                prev.map((m) =>
                  m.id === streamId ? { ...m, content: m.content + (parsed.token as string) } : m,
                ),
              );
            }

            if (parsed.done === true) {
              // Finalise the message with token counts
              const inputTokens = typeof parsed.inputTokens === 'number' ? parsed.inputTokens : undefined;
              const outputTokens = typeof parsed.outputTokens === 'number' ? parsed.outputTokens : undefined;
              const stats = parsed.sessionStats as SessionStats | undefined;

              setMessages((prev) =>
                prev.map((m) =>
                  m.id === streamId ? { ...m, streaming: false, inputTokens, outputTokens } : m,
                ),
              );

              if (stats) {
                setSessionStats(stats);
                onSessionUpdate(stats);
              }
            }
          }
        }
      } catch (err) {
        stopThinking();
        const errMsg = err instanceof Error ? err.message : 'Unknown error';
        setMessages((prev) =>
          prev.map((m) =>
            m.id === streamId
              ? { ...m, content: `⚠️ Could not reach the counsellor service.\n\n${errMsg}`, streaming: false }
              : m,
          ),
        );
      } finally {
        stopThinking();
        setLoading(false);
        streamingIdRef.current = null;
      }
    },
    [loading, messages, onSessionUpdate],
  );

  // Handle external trigger (topic card click)
  useEffect(() => {
    if (pendingMessage && pendingMessage !== pendingFired.current && !loading) {
      pendingFired.current = pendingMessage;
      setOpen(true);
      setTimeout(() => {
        sendMessage(pendingMessage);
        onClearPending?.();
      }, 200);
    }
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [pendingMessage]);

  const handleKeyDown = (e: React.KeyboardEvent<HTMLTextAreaElement>) => {
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault();
      sendMessage(input);
    }
  };

  const isEmpty = messages.length === 0;

  return (
    <>
      {/* ── Floating Action Button ── */}
      <button
        id="career-chat-toggle"
        onClick={() => setOpen((o) => !o)}
        aria-label="Open Career Counsellor"
        className="fixed bottom-6 right-6 z-50 w-14 h-14 rounded-full flex items-center justify-center shadow-2xl transition-all duration-300 hover:scale-110 active:scale-95"
        style={{
          background: 'linear-gradient(135deg, oklch(0.5 0.18 145), oklch(0.4 0.15 160))',
          animation: 'chatPulse 2.5s ease-in-out infinite',
        }}
      >
        {open ? (
          <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="white" strokeWidth="2.5" strokeLinecap="round">
            <line x1="18" y1="6" x2="6" y2="18" /><line x1="6" y1="6" x2="18" y2="18" />
          </svg>
        ) : (
          <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="white" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
            <path d="M21 15a2 2 0 0 1-2 2H7l-4 4V5a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2z" />
            <path d="M8 10h.01M12 10h.01M16 10h.01" strokeWidth="2.5" />
          </svg>
        )}
      </button>

      {/* ── Chat Panel ── */}
      <div
        id="career-chat-panel"
        className="fixed bottom-24 right-6 z-50 flex flex-col rounded-2xl border border-border shadow-2xl overflow-hidden transition-all duration-300 origin-bottom-right"
        style={{
          width: '440px',
          height: '600px',
          background: 'var(--card)',
          transform: open ? 'scale(1) translateY(0)' : 'scale(0.92) translateY(20px)',
          opacity: open ? 1 : 0,
          pointerEvents: open ? 'auto' : 'none',
          backdropFilter: 'blur(12px)',
        }}
      >
        {/* Header */}
        <div
          className="flex items-center gap-3 px-4 py-3 border-b border-border flex-shrink-0"
          style={{ background: 'oklch(0.45 0.16 145 / 0.12)' }}
        >
          <div className="w-9 h-9 rounded-full flex items-center justify-center flex-shrink-0"
            style={{ background: 'linear-gradient(135deg, oklch(0.5 0.18 145), oklch(0.4 0.15 160))' }}>
            <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="white" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
              <circle cx="12" cy="8" r="4" /><path d="M20 21a8 8 0 1 0-16 0" />
            </svg>
          </div>
          <div className="flex-1 min-w-0">
            <p className="text-sm font-semibold text-foreground">Career Counsellor</p>
            <div className="flex items-center gap-1.5">
              <span className="w-1.5 h-1.5 rounded-full bg-emerald-500 animate-pulse" />
              <span className="text-[10px] text-muted-foreground">
                {thinkingPhase >= 0
                  ? THINKING_PHASES[Math.min(thinkingPhase, THINKING_PHASES.length - 1)].label
                  : loading
                    ? 'Streaming response…'
                    : 'Qwen 2.5 · Local · Free'}
              </span>
            </div>
          </div>
          {sessionStats && (
            <div className="flex-shrink-0 rounded-md px-2 py-1 text-[9px] font-mono border border-primary/30 bg-primary/10 text-primary leading-tight text-right">
              <div>{sessionStats.turnCount} turns</div>
              <div>{sessionStats.totalInputTokens + sessionStats.totalOutputTokens} tok</div>
            </div>
          )}
          <button
            onClick={() => setOpen(false)}
            className="p-1 rounded-md hover:bg-muted/50 text-muted-foreground hover:text-foreground transition-colors"
          >
            <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round">
              <line x1="18" y1="6" x2="6" y2="18" /><line x1="6" y1="6" x2="18" y2="18" />
            </svg>
          </button>
        </div>

        {/* Messages */}
        <div className="flex-1 overflow-y-auto px-4 py-4 space-y-3 min-h-0">
          {/* Welcome */}
          {isEmpty && (
            <div className="flex flex-col gap-3">
              <div className="flex gap-2.5 items-start">
                <div className="w-7 h-7 rounded-full flex-shrink-0 flex items-center justify-center"
                  style={{ background: 'linear-gradient(135deg, oklch(0.5 0.18 145), oklch(0.4 0.15 160))' }}>
                  <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="white" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
                    <circle cx="12" cy="8" r="4" /><path d="M20 21a8 8 0 1 0-16 0" />
                  </svg>
                </div>
                <div className="flex-1 rounded-2xl rounded-tl-sm px-3.5 py-2.5 text-sm text-foreground border border-border"
                  style={{ background: 'var(--muted)' }}>
                  <p className="mb-1 font-medium">Hi! I&apos;m your AI Career Counsellor 👋</p>
                  <p className="text-muted-foreground text-xs leading-relaxed">
                    I&apos;m here to help with job searching, interviews, salary negotiation, skill gaps, and career pivots. Ask me anything — feel free to cross-question or dig deeper!
                  </p>
                </div>
              </div>
              <div className="flex flex-wrap gap-2 pl-9">
                {STARTER_CHIPS.map((chip) => (
                  <button
                    key={chip}
                    onClick={() => sendMessage(chip)}
                    className="text-[11px] px-2.5 py-1 rounded-full border border-primary/40 text-primary hover:bg-primary/10 transition-colors"
                  >
                    {chip}
                  </button>
                ))}
              </div>
            </div>
          )}

          {/* Conversation messages */}
          {messages.map((msg) => (
            <div key={msg.id} className={`flex gap-2.5 items-end ${msg.role === 'user' ? 'flex-row-reverse' : 'flex-row'}`}>
              {msg.role === 'assistant' && (
                <div className="w-7 h-7 rounded-full flex-shrink-0 flex items-center justify-center mb-0.5"
                  style={{ background: 'linear-gradient(135deg, oklch(0.5 0.18 145), oklch(0.4 0.15 160))' }}>
                  <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="white" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
                    <circle cx="12" cy="8" r="4" /><path d="M20 21a8 8 0 1 0-16 0" />
                  </svg>
                </div>
              )}

              <div className={`flex flex-col gap-0.5 max-w-[82%] ${msg.role === 'user' ? 'items-end' : 'items-start'}`}>
                {/* Thinking phase — shown only while we're waiting for the first token */}
                {msg.role === 'assistant' && msg.streaming && !msg.content && thinkingPhase >= 0 ? (
                  <ThinkingPhase phase={thinkingPhase} />
                ) : (
                  <div
                    className={`px-3.5 py-2.5 text-sm leading-relaxed whitespace-pre-wrap ${
                      msg.role === 'user'
                        ? 'rounded-2xl rounded-br-sm text-white'
                        : 'rounded-2xl rounded-tl-sm text-foreground border border-border'
                    }`}
                    style={
                      msg.role === 'user'
                        ? { background: 'linear-gradient(135deg, oklch(0.5 0.18 145), oklch(0.42 0.15 155))' }
                        : { background: 'var(--muted)' }
                    }
                  >
                    {msg.content || (msg.streaming ? <TypingDots /> : '')}
                    {msg.streaming && msg.content && <TypingCursor />}
                  </div>
                )}
                {msg.role === 'assistant' && msg.inputTokens !== undefined && !msg.streaming && (
                  <span className="text-[9px] font-mono text-muted-foreground/60 px-1">
                    ↓ {msg.inputTokens} in · {msg.outputTokens} out
                  </span>
                )}
              </div>
            </div>

          ))}

          <div ref={bottomRef} />
        </div>

        {/* Session stats bar */}
        {sessionStats && sessionStats.turnCount > 0 && (
          <div className="flex-shrink-0 px-4 py-2 border-t border-border flex items-center justify-between flex-wrap gap-x-3 gap-y-1"
            style={{ background: 'oklch(0.45 0.16 145 / 0.06)' }}>
            <span className="text-[9px] font-mono text-muted-foreground">
              {sessionStats.turnCount} turns · {sessionStats.totalInputTokens}↓ {sessionStats.totalOutputTokens}↑ tok
            </span>
            <span className="text-[9px] font-mono text-primary">
              ~{sessionStats.recursiveSavingsPercent}% ctx saved · local: free
            </span>
          </div>
        )}

        {/* Input */}
        <div className="flex-shrink-0 p-3 border-t border-border flex gap-2 items-end">
          <textarea
            ref={textareaRef}
            id="career-chat-input"
            value={input}
            onChange={(e) => setInput(e.target.value)}
            onKeyDown={handleKeyDown}
            placeholder="Ask me about your career… (Enter to send, Shift+Enter for newline)"
            rows={2}
            className="flex-1 resize-none rounded-xl border border-border bg-background px-3 py-2 text-sm placeholder:text-muted-foreground/60 focus:outline-none focus:ring-1 focus:ring-primary/50 transition-all"
            disabled={loading}
          />
          <button
            id="career-chat-send"
            onClick={() => sendMessage(input)}
            disabled={!input.trim() || loading}
            className="w-9 h-9 rounded-xl flex items-center justify-center flex-shrink-0 transition-all hover:scale-105 active:scale-95 disabled:opacity-40 disabled:cursor-not-allowed"
            style={{ background: 'linear-gradient(135deg, oklch(0.5 0.18 145), oklch(0.42 0.15 155))' }}
          >
            <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="white" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
              <line x1="22" y1="2" x2="11" y2="13" /><polygon points="22 2 15 22 11 13 2 9 22 2" />
            </svg>
          </button>
        </div>
      </div>

      {/* Keyframes */}
      <style>{`
        @keyframes chatPulse {
          0%, 100% { box-shadow: 0 0 0 0 oklch(0.5 0.18 145 / 0.55), 0 8px 32px oklch(0.5 0.18 145 / 0.3); }
          50%       { box-shadow: 0 0 0 10px oklch(0.5 0.18 145 / 0), 0 8px 32px oklch(0.5 0.18 145 / 0.3); }
        }
        @keyframes blink {
          0%, 100% { opacity: 1; }
          50% { opacity: 0; }
        }
      `}</style>
    </>
  );
}
