import { NextRequest } from 'next/server';
import { ChatOllama } from '@langchain/ollama';
import { HumanMessage, SystemMessage, AIMessage, BaseMessage } from '@langchain/core/messages';
import { appendTurn, getSession, computeStats } from '@/lib/chat-store';

export const dynamic = 'force-dynamic';

const OLLAMA_BASE_URL = process.env.OLLAMA_BASE_URL ?? 'http://localhost:11434';
// Match whichever model variant Ollama has pulled (defaults to the same as the benchmark)
const OLLAMA_CHAT_MODEL = process.env.OLLAMA_CHAT_MODEL ?? 'qwen2.5:0.5b';

const SYSTEM_PROMPT = `You are a warm, empathetic AI Career Counsellor. You specialise in helping people navigate their careers in the technology industry — covering job searching, resume advice, interview preparation, salary negotiation, identifying skill gaps, building learning roadmaps, and making career pivots.

Important guidelines:
- You are a COUNSELLOR, not a programmer. Never write code or technical scripts.
- Respond in plain, friendly, conversational language — like a trusted mentor.
- Ask clarifying questions when the user's situation needs more context.
- Keep answers focused, actionable, and encouraging.
- When the user cross-questions you or asks for clarification, naturally reference what they said earlier in the conversation.
- If someone seems anxious or uncertain about their career, acknowledge their feelings before giving advice.
- Never make salary or job guarantees — frame advice as guidance, not promises.`;

function estimateTokens(text: string): number {
  return Math.ceil(text.split(/\s+/).length * 1.3);
}

interface ChatMessage {
  role: 'user' | 'assistant' | 'system';
  content: string;
}

interface RequestBody {
  messages: ChatMessage[];
}

function sseChunk(data: Record<string, unknown>): Uint8Array {
  return new TextEncoder().encode(`data: ${JSON.stringify(data)}\n\n`);
}

export async function POST(request: NextRequest): Promise<Response> {
  const body = (await request.json()) as RequestBody;
  const { messages } = body;

  if (!Array.isArray(messages) || messages.length === 0) {
    return Response.json({ error: 'messages array is required' }, { status: 400 });
  }

  const llm = new ChatOllama({
    baseUrl: OLLAMA_BASE_URL,
    model: OLLAMA_CHAT_MODEL,
    temperature: 0.7,
  });

  // Build the LangChain message chain
  const langchainMessages: BaseMessage[] = [new SystemMessage(SYSTEM_PROMPT)];
  for (const msg of messages) {
    if (msg.role === 'user') langchainMessages.push(new HumanMessage(msg.content));
    else if (msg.role === 'assistant') langchainMessages.push(new AIMessage(msg.content));
  }

  // Create a streaming response — each token is sent as an SSE chunk
  const stream = new ReadableStream({
    async start(controller) {
      let fullReply = '';
      let promptTokens = 0;
      let completionTokens = 0;

      try {
        const streamIter = await llm.stream(langchainMessages);

        for await (const chunk of streamIter) {
          const token = typeof chunk.content === 'string' ? chunk.content : '';
          fullReply += token;

          // Pick up token counts from metadata if Ollama provides them
          if (chunk.response_metadata) {
            const meta = chunk.response_metadata as Record<string, unknown>;
            if (typeof meta.prompt_eval_count === 'number') promptTokens = meta.prompt_eval_count;
            if (typeof meta.eval_count === 'number') completionTokens = meta.eval_count;
          }

          controller.enqueue(sseChunk({ token }));
        }

        // Fallback token counting if Ollama didn't provide metadata
        if (promptTokens === 0) {
          promptTokens = estimateTokens(messages.map((m) => m.content).join(' '));
        }
        if (completionTokens === 0) {
          completionTokens = estimateTokens(fullReply);
        }

        // Record turn in session store
        const userMsg = messages[messages.length - 1];
        appendTurn({ role: 'user', content: userMsg?.content ?? '', inputTokens: 0, outputTokens: 0, timestamp: Date.now() });
        appendTurn({ role: 'assistant', content: fullReply, inputTokens: promptTokens, outputTokens: completionTokens, timestamp: Date.now() });

        const sessionStats = computeStats(getSession());

        // Final metadata event
        controller.enqueue(sseChunk({ done: true, inputTokens: promptTokens, outputTokens: completionTokens, sessionStats }));
      } catch (err) {
        const message = err instanceof Error ? err.message : 'Unknown error';
        console.error('[/api/chat] Ollama stream error:', message);
        controller.enqueue(
          sseChunk({
            error: true,
            message: `Failed to reach Ollama: ${message} — tried ${OLLAMA_BASE_URL} with model ${OLLAMA_CHAT_MODEL}`,
          }),
        );
      } finally {
        controller.close();
      }
    },
  });

  return new Response(stream, {
    headers: {
      'Content-Type': 'text/event-stream',
      'Cache-Control': 'no-cache',
      Connection: 'keep-alive',
    },
  });
}
