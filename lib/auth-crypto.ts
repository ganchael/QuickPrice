const encoder = new TextEncoder();
export const PASSWORD_ITERATIONS = 100000;
export function hex(bytes: ArrayBuffer | Uint8Array): string {
  return Array.from(bytes instanceof Uint8Array ? bytes : new Uint8Array(bytes), b => b.toString(16).padStart(2, '0')).join('');
}
export async function tokenHash(token: string): Promise<string> {
  return hex(await crypto.subtle.digest('SHA-256', encoder.encode(token)));
}
export async function verifyPassword(password: string, record: string): Promise<boolean> {
  const { salt, hash } = JSON.parse(record) as { salt: string; hash: string };
  if (!/^[a-f0-9]{32}$/.test(salt) || !/^[a-f0-9]{64}$/.test(hash)) throw new Error('Invalid password configuration');
  const key = await crypto.subtle.importKey('raw', encoder.encode(password), 'PBKDF2', false, ['deriveBits']);
  const bits = await crypto.subtle.deriveBits({ name: 'PBKDF2', hash: 'SHA-256', salt: Uint8Array.from(salt.match(/../g)!, b => parseInt(b, 16)), iterations: PASSWORD_ITERATIONS }, key, 256);
  const actual = hex(bits);
  let difference = 0;
  for (let i = 0; i < actual.length; i++) difference |= actual.charCodeAt(i) ^ hash.charCodeAt(i);
  return difference === 0;
}
