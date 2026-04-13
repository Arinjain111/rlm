import { NextRequest } from 'next/server';

export const dynamic = 'force-dynamic';

const BENCHMARK_API_BASE = process.env.BENCHMARK_API_BASE ?? 'http://benchmark:8787';

export async function POST(request: NextRequest): Promise<Response> {
  const payload = await request.text();

  const upstream = await fetch(`${BENCHMARK_API_BASE}/run/stream`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Accept: 'text/event-stream',
    },
    body: payload,
    cache: 'no-store',
  });

  if (!upstream.ok || !upstream.body) {
    const details = await upstream.text().catch(() => 'Failed to reach benchmark API');
    return Response.json(
      {
        error: 'Failed to start live run',
        details,
      },
      { status: upstream.status || 500 }
    );
  }

  return new Response(upstream.body, {
    status: 200,
    headers: {
      'Content-Type': 'text/event-stream; charset=utf-8',
      'Cache-Control': 'no-cache, no-transform',
      Connection: 'keep-alive',
    },
  });
}
