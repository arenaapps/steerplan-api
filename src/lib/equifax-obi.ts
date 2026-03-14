import { config } from '../config.js';

// ── Token cache ──
let tokenCache: { token: string; expiresAt: number } | null = null;

export async function getOBIToken(): Promise<string> {
  // Use static token for sandbox testing if provided
  if (config.equifax.staticToken) {
    return config.equifax.staticToken;
  }

  if (tokenCache && Date.now() < tokenCache.expiresAt) {
    return tokenCache.token;
  }

  const res = await fetch(`${config.equifax.obiBaseUrl}/security/token`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({
      grant_type: 'client_credentials',
      client_id: config.equifax.clientId,
      client_secret: config.equifax.clientSecret,
    }),
  });

  if (!res.ok) {
    const body = await res.text().catch(() => '');
    throw new Error(`OBI token request failed: ${res.status} ${body.slice(0, 500)}`);
  }

  const data = await res.json();
  tokenCache = {
    token: data.access_token,
    expiresAt: Date.now() + (data.expires_in - 60) * 1000, // refresh 60s early
  };
  return tokenCache.token;
}

async function obiRequest(method: string, path: string, body?: object) {
  const token = await getOBIToken();
  const res = await fetch(`${config.equifax.obiBaseUrl}${path}`, {
    method,
    headers: {
      Authorization: `Bearer ${token}`,
      'Content-Type': 'application/json',
    },
    ...(body ? { body: JSON.stringify(body) } : {}),
  });

  if (!res.ok) {
    const text = await res.text().catch(() => '');
    throw new Error(`OBI ${method} ${path} → ${res.status}: ${text.slice(0, 500)}`);
  }

  return res.json();
}

// ── Transform Yapily data to Equifax schema ──

interface YapilyAccount {
  id: string;
  accountIdentifications?: { type: string; identification: string }[];
  balance?: number;
  currency?: string;
  nickname?: string;
  description?: string;
  accountNames?: { name: string }[];
}

interface YapilyTransaction {
  id: string;
  date: string;
  amount?: number;
  transactionAmount?: { amount: number; currency: string };
  currency?: string;
  transactionInformation?: string;
  reference?: string;
}

export function transformYapilyToEquifax(
  accounts: YapilyAccount[],
  transactions: YapilyTransaction[],
) {
  return {
    accounts: accounts.map((acc) => {
      const sortCode = acc.accountIdentifications?.find((i) => i.type === 'SORT_CODE')?.identification;
      const accountNumber = acc.accountIdentifications?.find((i) => i.type === 'ACCOUNT_NUMBER')?.identification;
      return {
        accountId: acc.id,
        sortCode: sortCode || undefined,
        accountNumber: accountNumber || undefined,
        balance: acc.balance ?? 0,
        currency: acc.currency || 'GBP',
        accountName: acc.nickname || acc.description || acc.accountNames?.[0]?.name || 'Account',
      };
    }),
    transactions: transactions.map((tx) => {
      const rawAmount = tx.amount ?? tx.transactionAmount?.amount ?? 0;
      return {
        transactionId: tx.id,
        amount: rawAmount,
        description: String(tx.transactionInformation || tx.reference || ''),
        postDate: tx.date,
        currency: tx.currency || tx.transactionAmount?.currency || 'GBP',
      };
    }),
  };
}

// ── API methods ──

export async function createAndEnrich(data: {
  customerName: string;
  customerEmail: string;
  accounts: ReturnType<typeof transformYapilyToEquifax>['accounts'];
  transactions: ReturnType<typeof transformYapilyToEquifax>['transactions'];
}): Promise<string> {
  const response = await obiRequest('POST', '/enrich/createAndEnrich', {
    customer: {
      name: data.customerName,
      email: data.customerEmail,
    },
    accounts: data.accounts,
    transactions: data.transactions,
  });
  return response.customerId;
}

export async function getFinancialHealthIndex(
  customerId: string,
  months: number = 3,
): Promise<{ fhiScore: number; flags: { flag: string; description: string; level: string }[] }> {
  const response = await obiRequest(
    'GET',
    `/consumer/${customerId}/financialHealthIndex/${months}`,
  );
  return {
    fhiScore: response.fhiScore ?? response.score ?? 0,
    flags: (response.flags || []).map((f: any) => ({
      flag: f.flag || f.name,
      description: f.description || '',
      level: f.level || 'info',
    })),
  };
}

export async function getIncomeVerification(
  customerId: string,
  months: number = 3,
  salary?: number,
): Promise<{ grade: string; verifiedIncome?: number }> {
  let path = `/consumer/${customerId}/automatedIncomeVerification/${months}`;
  if (salary) path += `?salary=${salary}`;
  const response = await obiRequest('GET', path);
  return {
    grade: response.grade || response.incomeGrade || 'F',
    verifiedIncome: response.verifiedIncome ?? response.income,
  };
}

export async function getCustomerCalculations(
  customerId: string,
): Promise<{
  totalIncome: number;
  totalExpenditure: number;
  disposableIncome: number;
}> {
  const response = await obiRequest('GET', `/consumer/${customerId}/customerCalculations`);
  return {
    totalIncome: response.totalIncome ?? 0,
    totalExpenditure: response.totalExpenditure ?? 0,
    disposableIncome: response.disposableIncome ?? 0,
  };
}
