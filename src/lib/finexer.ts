import { config } from '../config.js';

const BASE = 'https://api.finexer.com';

const getAuth = () =>
  Buffer.from(`${config.finexer.apiKey}:`).toString('base64');

export async function finexerGet(path: string, params?: Record<string, string>) {
  const url = new URL(`${BASE}${path}`);
  if (params) {
    for (const [k, v] of Object.entries(params)) url.searchParams.set(k, v);
  }
  const res = await fetch(url.toString(), {
    headers: {
      Authorization: `Basic ${getAuth()}`,
    },
  });
  if (!res.ok) {
    const text = await res.text().catch(() => '');
    throw new Error(`Finexer GET ${path} → ${res.status}: ${text}`);
  }
  return res.json();
}

export async function finexerPost(path: string, body: [string, string][]) {
  const params = new URLSearchParams();
  for (const [key, value] of body) params.append(key, value);

  const res = await fetch(`${BASE}${path}`, {
    method: 'POST',
    headers: {
      Authorization: `Basic ${getAuth()}`,
      'Content-Type': 'application/x-www-form-urlencoded',
    },
    body: params.toString(),
  });
  if (!res.ok) {
    const text = await res.text().catch(() => '');
    throw new Error(`Finexer POST ${path} → ${res.status}: ${text}`);
  }
  return res.json();
}
