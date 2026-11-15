import { NextResponse } from 'next/server';
import { getAuthSession } from '@/lib/auth';
import { searchUsersAcrossConnections } from '@/lib/mongo-connections';

export async function GET(request: Request) {
  const session = await getAuthSession();
  if (!session.authenticated) {
    return NextResponse.json(
      { error: 'Authentication required. Please enter PIN.' },
      { status: 401, headers: { 'Cache-Control': 'no-store' } }
    );
  }

  try {
    const { searchParams } = new URL(request.url);
    const query = searchParams.get('q') ?? '';
    const connectionKey = searchParams.get('connection') ?? 'all';
    const onlyWithCardParam = searchParams.get('onlyWithCard');
    const onlyWithCard = onlyWithCardParam === null ? true : onlyWithCardParam !== 'false';
    const rawLimit = Number(searchParams.get('limit') ?? '150');
    const limitPerCollection = Number.isFinite(rawLimit)
      ? Math.min(Math.max(Math.trunc(rawLimit), 1), 300)
      : 150;

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

