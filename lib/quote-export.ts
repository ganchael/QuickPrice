// Rates are entered as CNY per USDT, with up to six decimal places.
export function rateUnits(value: string): bigint | null {
  const s = value.trim();
  if (!/^\d{1,6}(?:\.\d{1,6})?$/.test(s)) return null;
  const [whole, fraction = ''] = s.split('.');
  const units = BigInt(whole) * BigInt(1000000) + BigInt(fraction.padEnd(6, '0'));
  return units > BigInt(0) ? units : null;
}

export function usdtAmount(cnyCents: number, rate: string): string | null {
  const units = rateUnits(rate);
  if (units === null || !Number.isSafeInteger(cnyCents) || cnyCents < 0) return null;
  // Integer division with half-up rounding to 0.01 USDT.
  const cents = (BigInt(cnyCents) * BigInt(1000000) * BigInt(2) + units) / (units * BigInt(2));
  return `${(cents / BigInt(100)).toString().replace(/\B(?=(\d{3})+(?!\d))/g, ',')}.${(cents % BigInt(100)).toString().padStart(2, '0')}`;
}

export function quoteFilename(date = new Date()): string {
  const pad = (n: number) => String(n).padStart(2, '0');
  return `多肽报价清单_${date.getFullYear()}年${pad(date.getMonth() + 1)}月${pad(date.getDate())}日_${pad(date.getHours())}时${pad(date.getMinutes())}分.csv`;
}
