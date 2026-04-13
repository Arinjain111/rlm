export const dynamic = 'force-dynamic';

const BENCHMARK_API_BASE = process.env.BENCHMARK_API_BASE ?? 'http://benchmark:8787';

export async function GET(): Promise<Response> {
  try {
    const upstream = await fetch(`${BENCHMARK_API_BASE}/models`, {
      method: 'GET',
      cache: 'no-store',
    });

    if (!upstream.ok) {
      const details = await upstream.text().catch(() => 'Unknown upstream error');
      return Response.json({ models: [], error: details }, { status: 502 });
    }

    const body = await upstream.json();
    return Response.json({ models: Array.isArray(body.models) ? body.models : [] });
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Failed to fetch models';
    return Response.json({ models: [], error: message }, { status: 500 });
  }
}
