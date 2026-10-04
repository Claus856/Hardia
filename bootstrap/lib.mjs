// Fælles hjælpefunktioner til provisionerings- og testscripts. Kører i "tools"-containeren (Node 22, ingen pakker).
export const BASE = process.env.DIRECTUS_URL ?? 'http://directus:8055';

export class ApiError extends Error {
  constructor(method, path, status, body) {
    super(`${method} ${path} -> ${status} ${typeof body === 'string' ? body : JSON.stringify(body?.errors ?? body)}`);
    this.status = status;
    this.body = body;
  }
}

export async function login(email, password) {
  const res = await fetch(`${BASE}/auth/login`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ email, password }),
  });
  const body = await res.json().catch(() => ({}));
  if (!res.ok) throw new ApiError('POST', '/auth/login', res.status, body);
  return body.data.access_token;
}

/** Returnerer en funktion api(method, path, body?) som kaster ApiError ved fejl og giver `data` tilbage. */
export function client(token) {
  return async function api(method, path, body) {
    const res = await fetch(`${BASE}${path}`, {
      method,
      headers: { Authorization: `Bearer ${token}`, ...(body ? { 'Content-Type': 'application/json' } : {}) },
      body: body ? JSON.stringify(body) : undefined,
    });
    if (res.status === 204) return null;
    const text = await res.text();
    let parsed;
    try { parsed = JSON.parse(text); } catch { parsed = text; }
    if (!res.ok) throw new ApiError(method, path, res.status, parsed);
    return parsed?.data ?? parsed;
  };
}

export async function adminClient() {
  const { ADMIN_EMAIL, ADMIN_PASSWORD } = process.env;
  if (!ADMIN_EMAIL || !ADMIN_PASSWORD) throw new Error('ADMIN_EMAIL/ADMIN_PASSWORD mangler (kør via docker compose run tools ...)');
  return client(await login(ADMIN_EMAIL, ADMIN_PASSWORD));
}

export async function exists(api, path) {
  try { await api('GET', path); return true; } catch (e) {
    if (e instanceof ApiError && [403, 404].includes(e.status)) return false;
    throw e;
  }
}

export async function waitForServer(timeoutMs = 120000) {
  const until = Date.now() + timeoutMs;
  while (Date.now() < until) {
    try { if ((await fetch(`${BASE}/server/ping`)).ok) return; } catch { /* prøv igen */ }
    await new Promise((r) => setTimeout(r, 2000));
  }
  throw new Error(`Directus svarer ikke på ${BASE}`);
}
