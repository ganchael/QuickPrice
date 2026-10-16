export const SALES_ACCOUNT_ID = 'account:888';
export const SALES_ACCOUNT_NAME = '888';
export const COST_ACCOUNT_ID = 'account:111';
export const COST_ACCOUNT_NAME = '111';
export const SHARED_CATALOG_ID = SALES_ACCOUNT_ID;
export const COST_BOOK_ID = 'shared-cost';

export type PriceType = 'sales' | 'cost';

export type AccountUser = {
  userId: string;
  displayName: string;
  priceType: PriceType;
  canEditMaster: boolean;
};

const SALES_USER: AccountUser = { userId: SALES_ACCOUNT_ID, displayName: SALES_ACCOUNT_NAME, priceType: 'sales', canEditMaster: true };
const COST_USER: AccountUser = { userId: COST_ACCOUNT_ID, displayName: COST_ACCOUNT_NAME, priceType: 'cost', canEditMaster: false };

export function accountByName(username: string): AccountUser | null {
  if (username === SALES_ACCOUNT_NAME) return SALES_USER;
  if (username === COST_ACCOUNT_NAME) return COST_USER;
  return null;
}

export function accountById(userId: string): AccountUser | null {
  if (userId === SALES_ACCOUNT_ID) return SALES_USER;
  if (userId === COST_ACCOUNT_ID) return COST_USER;
  return null;
}

export function accountLabel(user: Pick<AccountUser, 'priceType' | 'displayName'>): string {
  return `${user.priceType === 'cost' ? '成本价' : '销售价'} · ${user.displayName}`;
}

/** Login outcome without revealing whether a hash is present in the message text. */
export function loginDecision(username: string, configured: boolean, passwordOk: boolean): 'ok' | 'bad' | 'unconfigured' | 'unknown' {
  const account = accountByName(username);
  if (!account) return 'unknown';
  if (!configured) return account.userId === COST_ACCOUNT_ID ? 'unconfigured' : 'bad';
  return passwordOk ? 'ok' : 'bad';
}
