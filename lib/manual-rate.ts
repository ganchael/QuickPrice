import { rateUnits } from './quote-export.ts';

export const MANUAL_RATE_KEY = 'quickprice:manual-usdt-cny-rate:v1';

type RateStorage = Pick<Storage, 'getItem' | 'setItem' | 'removeItem'>;

function storageOr(storage?: RateStorage): RateStorage | null {
  if (storage) return storage;
  try { return typeof localStorage === 'undefined' ? null : localStorage; } catch { return null; }
}

export function readManualRate(storage?: RateStorage): string | null {
  try {
    const store = storageOr(storage);
    if (!store) return null;
    const value = store.getItem(MANUAL_RATE_KEY);
    if (!value || rateUnits(value) === null) return null;
    return value.trim();
  } catch { return null; }
}

export function writeManualRate(value: string, storage?: RateStorage): void {
  try {
    const store = storageOr(storage);
    if (!store) return;
    if (value.trim() === '') { store.removeItem(MANUAL_RATE_KEY); return; }
    if (rateUnits(value) === null) return;
    store.setItem(MANUAL_RATE_KEY, value.trim());
  } catch { /* Private browsing may deny storage. */ }
}

export function clearManualRate(storage?: RateStorage): void {
  try { storageOr(storage)?.removeItem(MANUAL_RATE_KEY); } catch { /* ignore */ }
}
