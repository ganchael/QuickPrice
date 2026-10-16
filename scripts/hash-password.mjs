import { pbkdf2Sync, randomBytes } from 'node:crypto';
import { readFileSync } from 'node:fs';

// Prints a PBKDF2-SHA256 password record for QUICKPRICE_COST_PASSWORD_RECORD
// or the existing QUICKPRICE_PASSWORD_RECORD. The password is read from stdin
// and is not stored by this script. Do not commit the JSON this prints.

const password = readFileSync(0, 'utf8').replace(/\r?\n$/, '');
if (!password) {
  console.error('Usage: printf %s \'your-password\' | node scripts/hash-password.mjs');
  console.error('Write the JSON into the server environment. Do not commit it.');
  process.exit(1);
}
const salt = randomBytes(16).toString('hex');
const hash = pbkdf2Sync(password, Buffer.from(salt, 'hex'), 100000, 32, 'sha256').toString('hex');
process.stdout.write(`${JSON.stringify({ salt, hash })}\n`);
