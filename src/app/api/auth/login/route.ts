import { NextResponse } from 'next/server';
import {
  checkRateLimit,
  clearPinAttempts,
  createSessionToken,
  getClientIdentifier,
  getCookieSecurityOptions,
  recordFailedPinAttempt,
  SESSION_COOKIE_NAME,
  verifyPin,
} from '@/lib/auth';

export async function POST(request: Request) {
  const clientId = getClientIdentifier(request);
  const rate = checkRateLimit(clientId);

  if (!rate.allowed) {
    return NextResponse.json(
      {
        error: `Too many failed PIN attempts. Try again in ${rate.retryAfterSeconds}s.`,
      },
      {
        status: 429,
        headers: {
          'Retry-After': String(rate.retryAfterSeconds ?? 60),
          'Cache-Control': 'no-store',
        },
      }
    );
  }

  let body: { pin?: unknown } = {};
  try {
    body = (await request.json()) as { pin?: unknown };
  } catch {
    return NextResponse.json({ error: 'Invalid request body' }, { status: 400 });
  }

  const pin = typeof body.pin === 'string' ? body.pin.trim() : String(body.pin ?? '').trim();
  if (!pin) {
    return NextResponse.json({ error: 'PIN is required' }, { status: 400 });
  }

  if (!verifyPin(pin)) {
    recordFailedPinAttempt(clientId);
    return NextResponse.json({ error: 'Invalid PIN' }, { status: 401 });
  }

  clearPinAttempts(clientId);
  const { token, expiresAt } = createSessionToken();
  const response = NextResponse.json(
    { authenticated: true, expiresAt },
    { headers: { 'Cache-Control': 'no-store' } }
  );

  response.cookies.set(
    SESSION_COOKIE_NAME,
    token,
    getCookieSecurityOptions(request, expiresAt)
  );

  return response;
}

