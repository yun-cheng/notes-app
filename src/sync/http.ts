import type { CardRecord } from '../domain/types';
import { SyncAuthExpired, SyncOffline, type SyncTransport } from './engine';
import type { ConfigResponse, PullResponse, PushResponse, SessionInfo } from './protocol';

async function request<T>(path: string, init?: RequestInit): Promise<T> {
  let res: Response;
  try {
    res = await fetch(`/api${path}`, { credentials: 'same-origin', headers: { 'content-type': 'application/json' }, ...init });
  } catch {
    throw new SyncOffline('The server could not be reached');
  }
  if (res.status === 401) throw new SyncAuthExpired('Not signed in');
  if (!res.ok) throw new Error(`Request to ${path} failed with status ${res.status}`);
  return (await res.json()) as T;
}

export const httpTransport: SyncTransport = {
  push: async (records: CardRecord[]) =>
    (await request<PushResponse>('/sync/push', { method: 'POST', body: JSON.stringify({ records }) })).results,
  pull: (since) => request<PullResponse>(`/sync/pull?since=${since}`),
};

export const fetchConfig = () => request<ConfigResponse>('/config');

export const signInWithGoogle = (credential: string) =>
  request<SessionInfo>('/auth/google', { method: 'POST', body: JSON.stringify({ credential }) });

export const signOutOfServer = () => request<unknown>('/auth/logout', { method: 'POST', body: '{}' });
