import { NextResponse, type NextRequest } from 'next/server';
import { securityHeaders } from '@/lib/security-headers';
export function middleware(_request: NextRequest) {
  const response = NextResponse.next();
  for (const header of securityHeaders({ nodeEnv: process.env.NODE_ENV })) response.headers.set(header.name, header.value);
  return response;
}
export const config = { matcher: ['/((?!_next/static|favicon.svg).*)'] };
