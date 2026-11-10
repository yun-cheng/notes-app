import type { VaultPin } from '../domain/pin';
import type { CardRecord, Vault } from '../domain/types';
import { SyncAuthExpired, SyncOffline, type SyncTransport } from './engine';
import type { ConfigResponse, PullResponse, PushResponse, SessionInfo, VersionResponse, VersionsResponse } from './protocol';

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
  vaults: async () => (await request<SessionInfo>('/me')).vaults,
};

export const fetchConfig = () => request<ConfigResponse>('/config');

export const signInWithGoogle = (credential: string) =>
  request<SessionInfo>('/auth/google', { method: 'POST', body: JSON.stringify({ credential }) });

export const signOutOfServer = () => request<unknown>('/auth/logout', { method: 'POST', body: '{}' });

export interface VaultChanges {
  name?: string;
  pin?: VaultPin | null;
  hidden?: boolean;
}

export const createVault = (input: VaultChanges) => request<Vault>('/vaults', { method: 'POST', body: JSON.stringify(input) });

export const updateVault = (id: string, changes: VaultChanges) =>
  request<Vault>(`/vaults/${encodeURIComponent(id)}`, { method: 'PATCH', body: JSON.stringify(changes) });

export const fetchVersions = async (cardId: string) =>
  (await request<VersionsResponse>(`/cards/${encodeURIComponent(cardId)}/versions`)).versions;

export const fetchVersion = (cardId: string, versionId: number) =>
  request<VersionResponse>(`/cards/${encodeURIComponent(cardId)}/versions/${versionId}`);
