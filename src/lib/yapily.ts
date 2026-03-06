import { config } from '../config.js';

const BASE = 'https://api.yapily.com';

const getAuth = () =>
  Buffer.from(`${config.yapily.applicationKey}:${config.yapily.applicationSecret}`).toString('base64');

export async function yapilyGet(path: string, consentToken?: string) {
  const headers: Record<string, string> = {
    Authorization: `Basic ${getAuth()}`,
    'Content-Type': 'application/json',
  };
  if (consentToken) headers['Consent'] = consentToken;
  const res = await fetch(`${BASE}${path}`, { headers });
  if (!res.ok) throw new Error(`Yapily ${path} → ${res.status}`);
  return res.json();
}

export async function yapilyPost(path: string, body: object) {
  const res = await fetch(`${BASE}${path}`, {
    method: 'POST',
    headers: {
      Authorization: `Basic ${getAuth()}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify(body),
  });
  if (!res.ok) throw new Error(`Yapily POST ${path} → ${res.status}`);
  return res.json();
}
