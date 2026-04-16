'use client';

import { useEffect, useState } from 'react';

/**
 * User-friendly architecture diagram for the AI Career Counsellor + RLM system.
 * Designed to be understandable by non-technical users — no jargon, just plain flow.
 */
export function AsciiRLM() {
  const [activeStep, setActiveStep] = useState(0);

  // Cycle through steps so arrows pulse to show data flowing
  useEffect(() => {
    const id = setInterval(() => setActiveStep((s) => (s + 1) % 6), 1200);
    return () => clearInterval(id);
  }, []);

  const active = (step: number) => activeStep === step || activeStep === step + 1;

  return (
    <div className="w-full py-2 px-1 select-none">

      {/* ── Row 1: User → Counsellor → Model ── */}
      <div className="flex items-center justify-between gap-2 flex-wrap">

        {/* 1. User */}
        <FlowCard
          icon="👤"
          title="You"
          desc="Ask a career question"
          color="emerald"
          step={0}
          active={active(0)}
        />

        <AnimatedArrow active={active(0)} label="sends question" />

        {/* 2. AI Career Counsellor */}
        <FlowCard
          icon="🎓"
          title="AI Career Counsellor"
          desc="Understands your goal & context"
          color="sky"
          step={1}
          active={active(1)}
          wide
        />

        <AnimatedArrow active={active(1)} label="guided by" />

        {/* 3. Local AI Model */}
        <FlowCard
          icon="🧠"
          title="Local AI Model"
          desc="Qwen 2.5 — runs on your machine, free"
          color="violet"
          step={2}
          active={active(2)}
          wide
        />
      </div>

      {/* ── Connector down ── */}
      <div className="flex justify-end pr-[calc(25%-16px)] my-3">
        <div className="flex flex-col items-center gap-1">
          <div className={`w-0.5 h-6 rounded-full transition-all duration-500 ${active(2) ? 'bg-primary' : 'bg-border/50'}`} />
          <span className={`text-[9px] font-mono transition-colors duration-500 ${active(2) ? 'text-primary' : 'text-muted-foreground/50'}`}>thinks recursively</span>
          <div className={`w-0.5 h-6 rounded-full transition-all duration-500 ${active(2) ? 'bg-primary' : 'bg-border/50'}`} />
        </div>
      </div>

      {/* ── Row 2: Recursive Reasoning loop ── */}
      <div className="flex items-start gap-3 mb-3 flex-wrap">

        {/* Left: Recursive engine */}
        <div className={`flex-1 min-w-[220px] rounded-xl border-2 p-3 transition-all duration-500 ${active(3) ? 'border-amber-500/60 bg-amber-500/8 shadow-md shadow-amber-500/10' : 'border-border/40 bg-muted/20'}`}>
          <div className="flex items-center gap-2 mb-2">
            <span className="text-lg">🔄</span>
            <div>
              <p className={`text-xs font-semibold transition-colors duration-500 ${active(3) ? 'text-amber-600 dark:text-amber-400' : 'text-foreground/70'}`}>
                Recursive Reasoning Engine
              </p>
              <p className="text-[10px] text-muted-foreground">Breaks complex questions into smaller ones</p>
            </div>
          </div>

          <div className="grid grid-cols-2 gap-2 mt-1">
            <MiniStep icon="🔍" label="Analyse query" />
            <MiniStep icon="📚" label="Load context" />
            <MiniStep icon="💬" label="Think step-by-step" />
            <MiniStep icon="🔁" label="Ask follow-ups" />
          </div>
        </div>

        {/* Middle: arrows */}
        <div className="flex flex-col items-center justify-center gap-1 pt-8 min-w-[60px]">
          <span className={`text-lg transition-all duration-300 ${active(3) ? 'text-primary scale-110' : 'text-muted-foreground/30'}`}>⇅</span>
          <span className="text-[9px] text-muted-foreground/60 text-center">multiple rounds</span>
        </div>

        {/* Right: Live Trace Viewer */}
        <div className={`flex-1 min-w-[220px] rounded-xl border-2 p-3 transition-all duration-500 ${active(4) ? 'border-indigo-500/60 bg-indigo-500/8 shadow-md shadow-indigo-500/10' : 'border-border/40 bg-muted/20'}`}>
          <div className="flex items-center gap-2 mb-2">
            <span className="text-lg">📊</span>
            <div>
              <p className={`text-xs font-semibold transition-colors duration-500 ${active(4) ? 'text-indigo-500 dark:text-indigo-400' : 'text-foreground/70'}`}>
                Live Reasoning Viewer
              </p>
              <p className="text-[10px] text-muted-foreground">See every step the AI took to answer you</p>
            </div>
          </div>

          <div className="grid grid-cols-2 gap-2 mt-1">
            <MiniStep icon="⟳" label="Iteration cards" />
            <MiniStep icon="◇" label="Sub-questions asked" />
            <MiniStep icon="✓" label="Execution timeline" />
            <MiniStep icon="⏱" label="Time per step" />
          </div>
        </div>
      </div>

      {/* ── Row 3: Output ── */}
      <div className="flex items-center justify-center gap-3 flex-wrap mt-1">
        <AnimatedArrow active={active(4)} label="produces" vertical={false} />

        <div className={`flex items-center gap-3 rounded-xl border-2 px-4 py-3 transition-all duration-500 ${active(5) ? 'border-emerald-500/60 bg-emerald-500/10 shadow-lg shadow-emerald-500/10' : 'border-border/40 bg-muted/20'}`}>
          <span className="text-2xl">✨</span>
          <div>
            <p className={`text-sm font-semibold transition-colors duration-500 ${active(5) ? 'text-emerald-600 dark:text-emerald-400' : 'text-foreground/70'}`}>
              Your Career Guidance
            </p>
            <p className="text-[10px] text-muted-foreground">Personalised advice, roadmaps & next steps</p>
          </div>
        </div>

        <AnimatedArrow active={active(5)} label="shown in" vertical={false} />

        <div className={`flex items-center gap-3 rounded-xl border-2 px-4 py-3 transition-all duration-500 ${active(5) ? 'border-sky-500/60 bg-sky-500/10' : 'border-border/40 bg-muted/20'}`}>
          <span className="text-2xl">💬</span>
          <div>
            <p className={`text-sm font-semibold transition-colors duration-500 ${active(5) ? 'text-sky-500 dark:text-sky-400' : 'text-foreground/70'}`}>
              Chat Widget
            </p>
            <p className="text-[10px] text-muted-foreground">Bottom-right of the screen</p>
          </div>
        </div>
      </div>

      {/* ── Privacy / Cost note ── */}
      <div className="mt-4 rounded-lg border border-border/40 bg-muted/20 px-3 py-2 flex items-center gap-3 flex-wrap justify-center">
        <PrivacyBadge icon="🔒" label="100% Private" sub="Runs on your machine" />
        <div className="w-px h-6 bg-border/40 hidden sm:block" />
        <PrivacyBadge icon="⚡" label="Zero Cost" sub="No cloud API fees" />
        <div className="w-px h-6 bg-border/40 hidden sm:block" />
        <PrivacyBadge icon="🌐" label="No Data Sent" sub="Your questions stay local" />
        <div className="w-px h-6 bg-border/40 hidden sm:block" />
        <PrivacyBadge icon="📈" label="GPT-4 Quality" sub="via recursive reasoning" />
      </div>
    </div>
  );
}

// ── Sub-components ──────────────────────────────────────────────────────────

function FlowCard({ icon, title, desc, color, step, active, wide }: {
  icon: string; title: string; desc: string;
  color: 'emerald' | 'sky' | 'violet' | 'amber';
  step: number; active: boolean; wide?: boolean;
}) {
  const colors: Record<string, string> = {
    emerald: 'border-emerald-500/60 bg-emerald-500/8 shadow-emerald-500/10',
    sky:     'border-sky-500/60     bg-sky-500/8     shadow-sky-500/10',
    violet:  'border-violet-500/60  bg-violet-500/8  shadow-violet-500/10',
    amber:   'border-amber-500/60   bg-amber-500/8   shadow-amber-500/10',
  };
  const textColors: Record<string, string> = {
    emerald: 'text-emerald-600 dark:text-emerald-400',
    sky:     'text-sky-600     dark:text-sky-400',
    violet:  'text-violet-600  dark:text-violet-400',
    amber:   'text-amber-600   dark:text-amber-400',
  };

  return (
    <div className={`flex-1 ${wide ? 'min-w-[180px]' : 'min-w-[120px]'} max-w-[220px] rounded-xl border-2 px-3 py-2.5 transition-all duration-500 ${
      active ? `${colors[color]} shadow-md` : 'border-border/40 bg-muted/20'
    }`}>
      <div className="flex items-center gap-2">
        <span className="text-xl">{icon}</span>
        <div className="min-w-0">
          <p className={`text-xs font-semibold leading-tight transition-colors duration-500 ${active ? textColors[color] : 'text-foreground/60'}`}>
            {title}
          </p>
          <p className="text-[10px] text-muted-foreground leading-snug mt-0.5">{desc}</p>
        </div>
      </div>
    </div>
  );
}

function AnimatedArrow({ active, label, vertical = false }: { active: boolean; label: string; vertical?: boolean }) {
  return (
    <div className={`flex flex-col items-center gap-0.5 ${vertical ? 'flex-col' : 'flex-col'} flex-shrink-0`}>
      <p className={`text-[9px] font-mono text-center transition-colors duration-500 ${active ? 'text-primary/80' : 'text-muted-foreground/40'}`}>
        {label}
      </p>
      <span className={`text-lg transition-all duration-300 ${active ? 'text-primary scale-125' : 'text-muted-foreground/30'}`}>→</span>
    </div>
  );
}

function MiniStep({ icon, label }: { icon: string; label: string }) {
  return (
    <div className="flex items-center gap-1.5 rounded-md bg-background/60 border border-border/40 px-2 py-1">
      <span className="text-[11px]">{icon}</span>
      <span className="text-[10px] text-muted-foreground">{label}</span>
    </div>
  );
}

function PrivacyBadge({ icon, label, sub }: { icon: string; label: string; sub: string }) {
  return (
    <div className="flex items-center gap-1.5">
      <span className="text-sm">{icon}</span>
      <div>
        <p className="text-[11px] font-semibold text-foreground/80">{label}</p>
        <p className="text-[9px] text-muted-foreground">{sub}</p>
      </div>
    </div>
  );
}

/** Compact inline diagram for header — kept as fallback */
export function AsciiRLMInline() {
  return (
    <div className="font-mono text-[9px] leading-tight select-none text-muted-foreground flex items-center gap-1 flex-wrap">
      <span className="text-emerald-600 dark:text-emerald-400">You</span>
      <span>→</span>
      <span className="text-sky-600 dark:text-sky-400">Counsellor</span>
      <span>→</span>
      <span className="text-violet-600 dark:text-violet-400">AI Model</span>
      <span>→</span>
      <span className="text-amber-600 dark:text-amber-400">Guidance</span>
    </div>
  );
}
