import { NextResponse } from 'next/server';
import { getCookieSecurityOptions, SESSION_COOKIE_NAME } from '@/lib/auth';

export async function POST(request: Request) {
  const response = NextResponse.json(
    { authenticated: false },
    { headers: { 'Cache-Control': 'no-store' } }
  );

  response.cookies.set(SESSION_COOKIE_NAME, '', {
    ...getCookieSecurityOptions(request, 0),
    maxAge: 0,
  });

  return response;
}

