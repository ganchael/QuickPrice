export type SecurityHeader = { name: string; value: string };

// frame-ancestors and X-Frame-Options block embedding. connect-src stays same-origin
// so /api/exchange-rate keeps working. No Strict-Transport-Security: the site stays on HTTP.
export function securityHeaders(env: { nodeEnv?: string } = {}): SecurityHeader[] {
  const dev = (env.nodeEnv ?? 'production') !== 'production';
  const scriptSrc = dev ? "script-src 'self' 'unsafe-inline' 'unsafe-eval'" : "script-src 'self' 'unsafe-inline'";
  const connectSrc = dev ? "connect-src 'self' ws: wss:" : "connect-src 'self'";
  const csp = [
    "default-src 'self'",
    "base-uri 'self'",
    "form-action 'self'",
    "frame-ancestors 'none'",
    "object-src 'none'",
    "img-src 'self' data: blob:",
    "font-src 'self' data:",
    "style-src 'self' 'unsafe-inline'",
    scriptSrc,
    connectSrc,
  ].join('; ');
  return [
    { name: 'Content-Security-Policy', value: csp },
    { name: 'X-Frame-Options', value: 'DENY' },
    { name: 'X-Content-Type-Options', value: 'nosniff' },
    { name: 'Referrer-Policy', value: 'same-origin' },
    { name: 'Cache-Control', value: 'private, no-store' },
    { name: 'Vary', value: 'Cookie' },
  ];
}
