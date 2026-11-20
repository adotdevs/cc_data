import { NextResponse } from 'next/server';
import { getAuthSession } from '@/lib/auth';
import {
  addCustomConnection,
  createCustomConnectionEntry,
  deriveLabelFromUri,
  maskMongoUriHost,
  removeCustomConnection,
  validateMongoUri,
} from '@/lib/connection-store';
import {
  getConfiguredConnections,
  removeCachedClient,
  testMongoConnection,
} from '@/lib/mongo-connections';

export async function GET() {
  try {
    const session = await getAuthSession();
    if (!session.authenticated) {
      return NextResponse.json({ error: 'Authentication required' }, { status: 401 });
    }

    const all = await getConfiguredConnections();
    const connections = all.map((c) => ({
      key: c.key,
      label: c.label,
      source: c.source,
      maskedHost: c.maskedHost,
    }));

    return NextResponse.json(
      { connections },
      { headers: { 'Cache-Control': 'no-store' } }
    );
  } catch (err) {
    const message = err instanceof Error ? err.message : 'Failed to list connections';
    return NextResponse.json({ error: message }, { status: 500 });
  }
}

export async function POST(request: Request) {
  try {
    const session = await getAuthSession();
    if (!session.authenticated) {
      return NextResponse.json({ error: 'Authentication required' }, { status: 401 });
    }

    let body: {
      name?: unknown;
      uri?: unknown;
      action?: unknown;
      allowOffline?: unknown;
    } = {};

    try {
      body = (await request.json()) as typeof body;
    } catch {
      return NextResponse.json({ error: 'Invalid JSON request body' }, { status: 400 });
    }

    const rawUri = typeof body.uri === 'string' ? body.uri : '';
    const name = typeof body.name === 'string' ? body.name : undefined;
    const action = body.action === 'test' ? 'test' : 'save';
    const allowOffline = body.allowOffline === true;

    const validated = validateMongoUri(rawUri);
    if (!validated.valid) {
      return NextResponse.json({ error: validated.error }, { status: 400 });
    }

    const uri = validated.uri;
    const labelPreview = name?.trim() || deriveLabelFromUri(uri);
    const maskedHost = maskMongoUriHost(uri);

    if (action === 'test') {
      const testResult = await testMongoConnection(uri);
      return NextResponse.json(
        {
          ...testResult,
          label: labelPreview,
          maskedHost,
        },
        {
          status: testResult.ok ? 200 : 422,
          headers: { 'Cache-Control': 'no-store' },
        }
      );
    }

    // Check duplicates across both .env.local and saved custom connections
    const existing = await getConfiguredConnections();
    const duplicate = existing.find((c) => c.uri.trim() === uri);
    if (duplicate) {
      return NextResponse.json(
        {
          error: `This MongoDB connection string is already configured as "${duplicate.label}".`,
        },
        { status: 409 }
      );
    }

    let testResult = null;
    if (!allowOffline) {
      testResult = await testMongoConnection(uri);
      if (!testResult.ok) {
        return NextResponse.json(
          {
            ok: false,
            canSaveOffline: true,
            error: testResult.error ?? 'Could not connect to MongoDB cluster',
          },
          { status: 422 }
        );
      }
    }

    const entry = createCustomConnectionEntry(name, uri);
    const { storage } = await addCustomConnection(entry);

    return NextResponse.json(
      {
        ok: true,
        storage,
        connection: {
          key: entry.key,
          label: entry.label,
          source: 'custom' as const,
          maskedHost,
        },
        testResult,
      },
      { status: 201, headers: { 'Cache-Control': 'no-store' } }
    );
  } catch (err) {
    const message = err instanceof Error ? err.message : 'Failed to save connection';
    return NextResponse.json({ error: message }, { status: 500 });
  }
}

export async function DELETE(request: Request) {
  try {
    const session = await getAuthSession();
    if (!session.authenticated) {
      return NextResponse.json({ error: 'Authentication required' }, { status: 401 });
    }

    const { searchParams } = new URL(request.url);
    const key = searchParams.get('key')?.trim();
    if (!key) {
      return NextResponse.json({ error: 'Connection key is required' }, { status: 400 });
    }

    const all = await getConfiguredConnections();
    const target = all.find((c) => c.key === key);
    if (target && target.source === 'env') {
      return NextResponse.json(
        { error: 'Connections from .env.local cannot be deleted from the UI.' },
        { status: 400 }
      );
    }

    const removed = await removeCustomConnection(key);
    if (!removed) {
      return NextResponse.json({ error: 'Custom connection not found' }, { status: 404 });
    }

    await removeCachedClient(key);

    return NextResponse.json(
      { deleted: true, key },
      { headers: { 'Cache-Control': 'no-store' } }
    );
  } catch (err) {
    const message = err instanceof Error ? err.message : 'Failed to delete connection';
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
