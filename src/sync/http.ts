import type { VaultPin } from '../domain/pin';
import type { CardRecord, Vault } from '../domain/types';
import type { PhotoTransport } from '../photos/types';
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
  ai_access?: Vault['ai_access'];
}

export const createVault = (input: VaultChanges) => request<Vault>('/vaults', { method: 'POST', body: JSON.stringify(input) });

export const updateVault = (id: string, changes: VaultChanges) =>
  request<Vault>(`/vaults/${encodeURIComponent(id)}`, { method: 'PATCH', body: JSON.stringify(changes) });

export const fetchVersions = async (cardId: string) =>
  (await request<VersionsResponse>(`/cards/${encodeURIComponent(cardId)}/versions`)).versions;

export const fetchVersion = (cardId: string, versionId: number) =>
  request<VersionResponse>(`/cards/${encodeURIComponent(cardId)}/versions/${versionId}`);

/** Closes the card's newest version, so a restore shows up as its own entry. */
export const sealVersions = (cardId: string) => request<unknown>(`/cards/${encodeURIComponent(cardId)}/versions/seal`, { method: 'POST', body: '{}' });

export interface ConnectedApp {
  id: string;
  name: string;
  created_at: number;
  last_used_at: number | null;
}

export const fetchOAuthClient = (clientId: string, redirectUri: string) =>
  request<{ name: string; redirect_host: string }>(`/oauth/client?${new URLSearchParams({ client_id: clientId, redirect_uri: redirectUri })}`);

/** Approves or declines an AI app's request. Returns where to send the browser next. */
export const answerOAuth = async (params: Record<string, string>, approve: boolean) =>
  (await request<{ redirect: string }>('/oauth/authorize', { method: 'POST', body: JSON.stringify({ ...params, approve }) })).redirect;

export const listAiApps = async () => (await request<{ apps: ConnectedApp[] }>('/ai/apps')).apps;

export const disconnectAiApp = (id: string) => request<unknown>(`/ai/apps/${encodeURIComponent(id)}`, { method: 'DELETE' });

export interface DriveStatus {
  configured: boolean;
  connected: boolean;
  email: string | null;
}

export const fetchDriveStatus = () => request<DriveStatus>('/drive');

/** Where to send the browser to approve Drive access at Google. */
export const startDriveConnect = async () => (await request<{ url: string }>('/drive/connect', { method: 'POST', body: '{}' })).url;

export const disconnectDrive = () => request<unknown>('/drive', { method: 'DELETE' });

async function rawRequest(path: string, init?: RequestInit): Promise<Response> {
  try {
    const res = await fetch(`/api${path}`, { credentials: 'same-origin', ...init });
    if (res.status === 401) throw new SyncAuthExpired('Not signed in');
    return res;
  } catch (err) {
    if (err instanceof SyncAuthExpired) throw err;
    throw new SyncOffline('The server could not be reached');
  }
}

export const photoTransport: PhotoTransport = {
  async upload(photo) {
    const query = new URLSearchParams({ vault: photo.vaultId });
    if (photo.width) query.set('w', String(photo.width));
    if (photo.height) query.set('h', String(photo.height));
    const res = await rawRequest(`/attachments/${encodeURIComponent(photo.id)}?${query}`, { method: 'PUT', body: photo.blob, headers: { 'content-type': photo.mime } });
    if (res.ok) return 'ok';
    const error = ((await res.json().catch(() => ({}))) as { error?: string }).error;
    if (error === 'drive_not_connected') return 'needs_drive';
    if (error === 'photos_not_configured') return 'not_configured';
    if (res.status >= 500) throw new Error(`Photo upload failed with ${res.status}`);
    return 'rejected';
  },
  async download(id) {
    const res = await rawRequest(`/attachments/${encodeURIComponent(id)}`);
    if (res.ok) return res.blob();
    if (res.status === 404 || res.status === 409 || res.status === 503) return null;
    throw new Error(`Photo download failed with ${res.status}`);
  },
};
