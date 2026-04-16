import { SessionStats } from './types';

// GPT-4o-mini pricing (per million tokens, USD) — used only for cost comparison display
const CLOUD_INPUT_PRICE_PER_M = 0.15;
const CLOUD_OUTPUT_PRICE_PER_M = 0.6;

export interface ChatTurn {
  role: 'user' | 'assistant';
  content: string;
  inputTokens: number;
  outputTokens: number;
  timestamp: number;
}

interface ChatSession {
  turns: ChatTurn[];
}

// Module-level singleton — persists across requests within the same server process
const session: ChatSession = { turns: [] };

export function appendTurn(turn: ChatTurn): void {
  session.turns.push(turn);
}

export function getSession(): ChatTurn[] {
  return session.turns;
}

export function resetSession(): void {
  session.turns = [];
}

export function computeStats(turns: ChatTurn[]): SessionStats {
  const assistantTurns = turns.filter((t) => t.role === 'assistant');

  const totalInputTokens = assistantTurns.reduce((s, t) => s + t.inputTokens, 0);
  const totalOutputTokens = assistantTurns.reduce((s, t) => s + t.outputTokens, 0);
  const turnCount = assistantTurns.length;

  // Naive recursive cost: each turn i re-reads ALL prior context.
  // Turn 1 input = I1, Turn 2 input = I1+I2, Turn 3 input = I1+I2+I3, etc.
  let naiveRecursiveInputTokens = 0;
  let cumulative = 0;
  for (const t of assistantTurns) {
    cumulative += t.inputTokens;
    naiveRecursiveInputTokens += cumulative;
  }

  const recursiveSavingsEstimate = Math.max(0, naiveRecursiveInputTokens - totalInputTokens);
  const recursiveSavingsPercent =
    naiveRecursiveInputTokens > 0
      ? Math.round((recursiveSavingsEstimate / naiveRecursiveInputTokens) * 100)
      : 0;

  // Local Qwen 2.5 via Ollama = free
  const localCostUsd = 0;

  // Equivalent cloud cost if GPT-4o-mini were used
  const equivalentCloudCostUsd =
    (naiveRecursiveInputTokens / 1_000_000) * CLOUD_INPUT_PRICE_PER_M +
    (totalOutputTokens / 1_000_000) * CLOUD_OUTPUT_PRICE_PER_M;

  return {
    totalInputTokens,
    totalOutputTokens,
    turnCount,
    naiveRecursiveInputTokens,
    recursiveSavingsEstimate,
    recursiveSavingsPercent,
    localCostUsd,
    equivalentCloudCostUsd,
  };
}
