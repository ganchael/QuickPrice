import { rateUnits } from './quote-export.ts';

export const MANUAL_RATE_KEY = 'quickprice:manual-usdt-cny-rate:v1';
const SALES_ACCOUNT_ID = 'account:888';

type RateStorage = Pick<Storage, 'getItem' | 'setItem' | 'removeItem'>;

export function manualRateStorageKey(accountId?: string) {
  return accountId ? `${MANUAL_RATE_KEY}:${accountId}` : MANUAL_RATE_KEY;
}

function storageOr(storage?: RateStorage): RateStorage | null {
  if (storage) return storage;
  try { return typeof localStorage === 'undefined' ? null : localStorage; } catch { return null; }
}
function readKey(store: RateStorage, key: string) {
  const value = store.getItem(key);
  if (!value || rateUnits(value) === null) return null;
  return value.trim();
}

export function readManualRate(storage?: RateStorage, accountId?: string): string | null {
  try {
    const store = storageOr(storage);
    if (!store) return null;
    if (!accountId) return readKey(store, MANUAL_RATE_KEY);
    const own = readKey(store, manualRateStorageKey(accountId));
    if (own) return own;
    if (accountId !== SALES_ACCOUNT_ID) return null;
    const legacy = readKey(store, MANUAL_RATE_KEY);
    if (!legacy) return null;
    store.setItem(manualRateStorageKey(accountId), legacy);
    store.removeItem(MANUAL_RATE_KEY);
    return legacy;
  } catch { return null; }
}

export function writeManualRate(value: string, storage?: RateStorage, accountId?: string): void {
  try {
    const store = storageOr(storage);
    if (!store) return;
    const key = manualRateStorageKey(accountId);
    if (value.trim() === '') { store.removeItem(key); if (accountId === SALES_ACCOUNT_ID) store.removeItem(MANUAL_RATE_KEY); return; }
    if (rateUnits(value) === null) return;
    store.setItem(key, value.trim());
    if (accountId === SALES_ACCOUNT_ID) store.removeItem(MANUAL_RATE_KEY);
  } catch { /* Private browsing may deny storage. */ }
}

export function clearManualRate(storage?: RateStorage, accountId?: string): void {
  try {
    const store = storageOr(storage);
    if (!store) return;
    store.removeItem(manualRateStorageKey(accountId));
    if (!accountId || accountId === SALES_ACCOUNT_ID) store.removeItem(MANUAL_RATE_KEY);
  } catch { /* ignore */ }
}
