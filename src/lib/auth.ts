import { createHash, createHmac, randomBytes, timingSafeEqual } from 'node:crypto';
import { cookies } from 'next/headers';

export const SESSION_COOKIE_NAME = 'cc_auth_session';
const SESSION_TTL_MS = 12 * 60 * 60 * 1000; // 12 hours
const RATE_LIMIT_WINDOW_MS = 5 * 60 * 1000; // 5 minutes
const MAX_FAILED_ATTEMPTS = 10;

interface RateLimitEntry {
  failures: number;
  resetAt: number;
}

const globalForAuth = globalThis as typeof globalThis & {
  __ccAuthRateLimits?: Map<string, RateLimitEntry>;
};

function getRateLimitMap(): Map<string, RateLimitEntry> {
  if (!globalForAuth.__ccAuthRateLimits) {
    globalForAuth.__ccAuthRateLimits = new Map();
  }
  return globalForAuth.__ccAuthRateLimits;
}

function getConfiguredPin(): string {
  return (process.env.ACCESS_PIN ?? '9552').trim();
}

function getSigningSecret(): string {
  const configured = process.env.AUTH_SECRET?.trim();
  if (configured && configured.length >= 16) {
    return configured;
  }
  return createHash('sha256')
    .update(`cc_data_fallback_secret:${getConfiguredPin()}`)
    .digest('hex');
}

function sha256Buffer(value: string): Buffer {
  return createHash('sha256').update(value, 'utf8').digest();
}

export function verifyPin(inputPin: string): boolean {
  const expected = getConfiguredPin();
  if (!expected || !inputPin) return false;
  const a = sha256Buffer(inputPin.trim());
  const b = sha256Buffer(expected);
  return timingSafeEqual(a, b);
}

function signPayload(payload: string): string {
  return createHmac('sha256', getSigningSecret()).update(payload).digest('base64url');
}

export function createSessionToken(now = Date.now()): { token: string; expiresAt: number } {
  const expiresAt = now + SESSION_TTL_MS;
  const nonce = randomBytes(16).toString('base64url');
  const payload = `${now}.${expiresAt}.${nonce}`;
  const signature = signPayload(payload);
  return {
    token: `${payload}.${signature}`,
    expiresAt,
  };
}

export function verifySessionToken(token: string | undefined | null): {
  authenticated: boolean;
  expiresAt?: number;
} {
  if (!token) return { authenticated: false };
  const parts = token.split('.');
  if (parts.length !== 4) return { authenticated: false };

  const [issuedRaw, expiresRaw, nonce, signature] = parts;
  if (!issuedRaw || !expiresRaw || !nonce || !signature) {
    return { authenticated: false };
  }

  const expiresAt = Number(expiresRaw);
  if (!Number.isFinite(expiresAt) || Date.now() > expiresAt) {
    return { authenticated: false };
  }

  const payload = `${issuedRaw}.${expiresRaw}.${nonce}`;
  const expectedSig = signPayload(payload);

  const sigBuf = Buffer.from(signature, 'utf8');
  const expectedBuf = Buffer.from(expectedSig, 'utf8');
  if (sigBuf.length !== expectedBuf.length || !timingSafeEqual(sigBuf, expectedBuf)) {
    return { authenticated: false };
  }

  return { authenticated: true, expiresAt };
}

export async function getAuthSession(): Promise<{
  authenticated: boolean;
  expiresAt?: number;
}> {
  const cookieStore = await cookies();
  const token = cookieStore.get(SESSION_COOKIE_NAME)?.value;
  return verifySessionToken(token);
}

export function getCookieSecurityOptions(request: Request, expiresAt: number) {
  const forwardedProto = request.headers.get('x-forwarded-proto');
  let isHttps = forwardedProto === 'https';
  if (!isHttps) {
    try {
      isHttps = new URL(request.url).protocol === 'https:';
    } catch {
      isHttps = false;
    }
  }

  return {
    httpOnly: true,
    sameSite: 'lax' as const,
    path: '/',
    secure: isHttps,
    expires: new Date(expiresAt),
  };
}

export function getClientIdentifier(request: Request): string {
  const forwarded = request.headers.get('x-forwarded-for');
  if (forwarded) {
    return forwarded.split(',')[0]?.trim() || 'unknown';
  }
  return request.headers.get('x-real-ip') ?? 'local';
}

export function checkRateLimit(clientId: string): {
  allowed: boolean;
  retryAfterSeconds?: number;
} {
  const map = getRateLimitMap();
  const entry = map.get(clientId);
  const now = Date.now();

  if (!entry || now >= entry.resetAt) {
    if (entry) map.delete(clientId);
    return { allowed: true };
  }

  if (entry.failures >= MAX_FAILED_ATTEMPTS) {
    return {
      allowed: false,
      retryAfterSeconds: Math.max(1, Math.ceil((entry.resetAt - now) / 1000)),
    };
  }

  return { allowed: true };
}

export function recordFailedPinAttempt(clientId: string): void {
  const map = getRateLimitMap();
  const now = Date.now();
  const entry = map.get(clientId);
  if (!entry || now >= entry.resetAt) {
    map.set(clientId, { failures: 1, resetAt: now + RATE_LIMIT_WINDOW_MS });
  } else {
    entry.failures += 1;
  }
}

export function clearPinAttempts(clientId: string): void {
  getRateLimitMap().delete(clientId);
}

