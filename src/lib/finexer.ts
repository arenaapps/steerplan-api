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
  if (!res.ok) throw new Error(`Finexer GET ${path} → ${res.status}`);
  return res.json();
}

export async function finexerPost(path: string, body: Record<string, string>) {
  const res = await fetch(`${BASE}${path}`, {
    method: 'POST',
    headers: {
      Authorization: `Basic ${getAuth()}`,
      'Content-Type': 'application/x-www-form-urlencoded',
    },
    body: new URLSearchParams(body).toString(),
  });
  if (!res.ok) throw new Error(`Finexer POST ${path} → ${res.status}`);
  return res.json();
}
