// Rates are entered as CNY per USDT, with up to six decimal places.
export function rateUnits(value: string): bigint | null {
  const s = value.trim();
  if (!/^\d{1,6}(?:\.\d{1,6})?$/.test(s)) return null;
  const [whole, fraction = ''] = s.split('.');
  const units = BigInt(whole) * BigInt(1000000) + BigInt(fraction.padEnd(6, '0'));
  return units > BigInt(0) ? units : null;
}

// Half-up to 0.01 USDT. Callers round the CNY unit price with this, then
// multiply by quantity, so a line and the quote total stay reconcilable.
export function usdtCents(cnyCents: number, rate: string): bigint | null {
  const units = rateUnits(rate);
  if (units === null || !Number.isSafeInteger(cnyCents) || cnyCents < 0) return null;
  return (BigInt(cnyCents) * BigInt(1000000) * BigInt(2) + units) / (units * BigInt(2));
}

export function formatUsdtCents(cents: bigint): string {
  const negative = cents < BigInt(0);
  const value = negative ? -cents : cents;
  const whole = (value / BigInt(100)).toString().replace(/\B(?=(\d{3})+(?!\d))/g, ',');
  return `${negative ? '-' : ''}${whole}.${(value % BigInt(100)).toString().padStart(2, '0')}`;
}

export function formatUsdtPlain(cents: bigint): string {
  const negative = cents < BigInt(0);
  const value = negative ? -cents : cents;
  return `${negative ? '-' : ''}${value / BigInt(100)}.${(value % BigInt(100)).toString().padStart(2, '0')}`;
}

export function usdtAmount(cnyCents: number, rate: string): string | null {
  const cents = usdtCents(cnyCents, rate);
  return cents === null ? null : formatUsdtCents(cents);
}

export function quoteFilename(date = new Date(), kind: 'sales' | 'cost' | 'comparison' = 'sales'): string {
  const pad = (n: number) => String(n).padStart(2, '0');
  const title = kind === 'cost' ? '内部成本清单' : kind === 'comparison' ? '内部售价成本对比' : '多肽报价清单';
  return `${title}_${date.getFullYear()}年${pad(date.getMonth() + 1)}月${pad(date.getDate())}日_${pad(date.getHours())}时${pad(date.getMinutes())}分.csv`;
}
