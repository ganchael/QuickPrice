import { NextResponse, type NextRequest } from 'next/server';
export function middleware(_request: NextRequest) {
  const response = NextResponse.next();
  response.headers.set('Cache-Control', 'private, no-store');
  response.headers.set('Vary', 'Cookie');
  response.headers.set('X-Content-Type-Options', 'nosniff');
  response.headers.set('Referrer-Policy', 'same-origin');
  return response;
}
export const config = { matcher: ['/((?!_next/static|favicon.svg).*)'] };
