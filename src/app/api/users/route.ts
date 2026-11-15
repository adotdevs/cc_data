import { NextResponse } from 'next/server';
import { searchUsersAcrossConnections } from '@/lib/mongo-connections';

export async function GET(request: Request) {
  try {
    const { searchParams } = new URL(request.url);
    const query = searchParams.get('q') ?? '';
    const connectionKey = searchParams.get('connection') ?? 'all';
    const onlyWithCardParam = searchParams.get('onlyWithCard');
    const onlyWithCard = onlyWithCardParam === null ? true : onlyWithCardParam !== 'false';
    const rawLimit = Number(searchParams.get('limit') ?? '60');
    const limitPerCollection = Number.isFinite(rawLimit)
      ? Math.min(Math.max(Math.trunc(rawLimit), 1), 200)
      : 60;

    const result = await searchUsersAcrossConnections({
      query,
      connectionKey,
      onlyWithCard,
      limitPerCollection,
    });

    return NextResponse.json(result, {
      headers: {
        'Cache-Control': 'no-store',
      },
    });
  } catch (err) {
    const message = err instanceof Error ? err.message : 'Failed to query MongoDB connections';
    return NextResponse.json({ error: message }, { status: 500 });
  }
}

