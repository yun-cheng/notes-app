import { deviceName } from '../domain/device';
import type { VaultPin } from '../domain/pin';
import type { CardRecord, JSONNode, Vault } from '../domain/types';
import type { PhotoTransport } from '../photos/types';
import { SyncAuthExpired, SyncOffline, type SyncTransport } from './engine';
import type { ConfigResponse, ConnectedApp, LinkPreview, PullResponse, PushResponse, RecentVersionsResponse, SessionInfo, SharedResponse, SignedInAccounts, VersionResponse, VersionsResponse } from './protocol';

let requestAccount: string | null = null;

/**
 * The account this tab's requests are for. A browser can be signed in to several, and the server answers each
 * request as the one it names, so two tabs on different accounts never mix their notes.
 */
export function setRequestAccount(id: string | null) {
  requestAccount = id;
}

/** Calls the API: `SyncOffline` when the server can't be reached, `SyncAuthExpired` when signed out, else the response. */
async function rawRequest(path: string, init?: RequestInit): Promise<Response> {
  const headers = new Headers(init?.headers);
  if (requestAccount) headers.set('X-Account', requestAccount);
  try {
    const res = await fetch(`/api${path}`, { credentials: 'same-origin', ...init, headers });
    if (res.status === 401) throw new SyncAuthExpired('Not signed in');
    return res;
  } catch (err) {
    if (err instanceof SyncAuthExpired) throw err;
    throw new SyncOffline('The server could not be reached');
  }
}

/** A JSON request to the API. Other failures than `rawRequest`'s throw a plain error. */
async function request<T>(path: string, init?: RequestInit): Promise<T> {
  const res = await rawRequest(path, { ...init, headers: { 'content-type': 'application/json', ...init?.headers } });
  if (!res.ok) throw new Error(`Request to ${path} failed with status ${res.status}`);
  return (await res.json()) as T;
}

/** Says which device a request comes from, so history can tell this device's changes from the others'. */
const deviceHeaders = (deviceId: string) => ({
  'content-type': 'application/json',
  'X-Device-Id': deviceId,
  'X-Device-Name': deviceName(navigator.userAgent, navigator.maxTouchPoints),
});

export const httpTransport = (deviceId: () => Promise<string>): SyncTransport => ({
  push: async (records: CardRecord[]) =>
    (await request<PushResponse>('/sync/push', { method: 'POST', headers: deviceHeaders(await deviceId()), body: JSON.stringify({ records }) })).results,
  pull: (since) => request<PullResponse>(`/sync/pull?since=${since}`),
  vaults: async () => (await request<SessionInfo>('/me')).vaults,
  shared: () => request<SharedResponse>('/shared'),
});

export const fetchConfig = () => request<ConfigResponse>('/config');

/** What a web page says about itself, read by the server. The address goes in the body, not the query string. */
export const fetchLinkPreview = (url: string) => request<LinkPreview>('/unfurl', { method: 'POST', body: JSON.stringify({ url }) });

export const signInWithGoogle = (credential: string) =>
  request<SessionInfo>('/auth/google', { method: 'POST', body: JSON.stringify({ credential }) });

/** Signs this tab's account out. Returns the accounts still signed in on this browser. */
export const signOutOfServer = async () => (await request<SignedInAccounts>('/auth/logout', { method: 'POST', body: '{}' })).accounts;

/** The accounts signed in on this browser, newest sign-in first. */
export const fetchSignedInAccounts = async () => (await request<SignedInAccounts>('/auth/accounts')).accounts;

export interface VaultChanges {
  name?: string;
  pin?: VaultPin | null;
  hidden?: boolean;
  ai_access?: Vault['ai_access'];
  encryption?: Vault['encryption'];
}

export const createVault = (input: VaultChanges) => request<Vault>('/vaults', { method: 'POST', body: JSON.stringify(input) });

export const updateVault = (id: string, changes: VaultChanges) =>
  request<Vault>(`/vaults/${encodeURIComponent(id)}`, { method: 'PATCH', body: JSON.stringify(changes) });

export const fetchVersions = async (cardId: string) =>
  (await request<VersionsResponse>(`/cards/${encodeURIComponent(cardId)}/versions`)).versions;

export const fetchVersion = (cardId: string, versionId: number) =>
  request<VersionResponse>(`/cards/${encodeURIComponent(cardId)}/versions/${versionId}`);

/** A page of the newest versions of every card, with what each replaced. `before` is the `next` of the page before. */
export const fetchRecentVersions = (deviceId: string, before?: string | null) =>
  request<RecentVersionsResponse>(`/versions${before ? `?before=${encodeURIComponent(before)}` : ''}`, { headers: deviceHeaders(deviceId) });

/** Closes the card's newest version, so a restore shows up as its own entry. */
export const sealVersions = (cardId: string) => request<unknown>(`/cards/${encodeURIComponent(cardId)}/versions/seal`, { method: 'POST', body: '{}' });

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

export interface VaultPeople {
  members: { user_id: string; name: string; email: string; role: 'owner' | 'editor' | 'viewer' }[];
  invites: { email: string; role: 'editor' | 'viewer' }[];
}

const vaultPath = (id: string) => `/vaults/${encodeURIComponent(id)}`;

export const fetchVaultPeople = (vaultId: string) => request<VaultPeople>(`${vaultPath(vaultId)}/members`);
export const addVaultMember = (vaultId: string, email: string, role: 'editor' | 'viewer') =>
  request<VaultPeople>(`${vaultPath(vaultId)}/members`, { method: 'POST', body: JSON.stringify({ email, role }) });
export const removeVaultMember = (vaultId: string, userId: string) =>
  request<VaultPeople | { ok: true }>(`${vaultPath(vaultId)}/members/${encodeURIComponent(userId)}`, { method: 'DELETE' });
export const cancelVaultInvite = (vaultId: string, email: string) =>
  request<VaultPeople>(`${vaultPath(vaultId)}/invites/${encodeURIComponent(email)}`, { method: 'DELETE' });

export type ShareRole = 'view' | 'comment' | 'edit';

export interface CardShares {
  people: { user_id: string; name: string; email: string; role: ShareRole }[];
  invites: { email: string; role: ShareRole }[];
  vaults: { vault_id: string; name: string; role: ShareRole; members: number }[];
  links: { token: string; created_at: number; expires_at: number | null }[];
}

const cardPath = (id: string) => `/cards/${encodeURIComponent(id)}`;

export const fetchCardShares = (cardId: string) => request<CardShares>(`${cardPath(cardId)}/shares`);
export const shareCard = (cardId: string, target: { email: string } | { vault_id: string }, role: ShareRole) =>
  request<CardShares>(`${cardPath(cardId)}/shares`, { method: 'POST', body: JSON.stringify({ ...target, role }) });
export const unshareCard = (cardId: string, type: 'user' | 'vault' | 'invite', target: string) =>
  request<CardShares>(`${cardPath(cardId)}/shares/${type}/${encodeURIComponent(target)}`, { method: 'DELETE' });
export const createPublicLink = (cardId: string, expiresInDays: number | null) =>
  request<CardShares>(`${cardPath(cardId)}/links`, { method: 'POST', body: JSON.stringify({ expires_in_days: expiresInDays }) });
export const deletePublicLink = (cardId: string, token: string) => request<CardShares>(`${cardPath(cardId)}/links/${encodeURIComponent(token)}`, { method: 'DELETE' });

export interface CardComment {
  id: string;
  author_id: string;
  author: string;
  body: string;
  created_at: number;
  resolved_at: number | null;
}

export const fetchComments = async (cardId: string) => (await request<{ comments: CardComment[] }>(`${cardPath(cardId)}/comments`)).comments;
export const addComment = async (cardId: string, body: string) =>
  (await request<{ comments: CardComment[] }>(`${cardPath(cardId)}/comments`, { method: 'POST', body: JSON.stringify({ body }) })).comments;
export const resolveComment = async (cardId: string, id: string, resolved: boolean) =>
  (await request<{ comments: CardComment[] }>(`${cardPath(cardId)}/comments/${id}`, { method: 'PATCH', body: JSON.stringify({ resolved }) })).comments;
export const deleteComment = async (cardId: string, id: string) =>
  (await request<{ comments: CardComment[] }>(`${cardPath(cardId)}/comments/${id}`, { method: 'DELETE' })).comments;

export interface PublicCard {
  type: 'note' | 'todo' | 'tag';
  title: string;
  content: JSONNode;
  /** The card's back, or null; missing from a server older than card backs. */
  back?: JSONNode | null;
  status: string | null;
  due: string | null;
  /** Missing from a server older than due times. */
  due_time?: string | null;
  updated_at: number;
}

/** No session needed: anyone with the link may read it. */
export async function fetchPublicCard(token: string): Promise<PublicCard | null> {
  let res: Response;
  try {
    res = await fetch(`/api/public/${encodeURIComponent(token)}`);
  } catch {
    throw new SyncOffline('The server could not be reached');
  }
  if (res.status === 404) return null;
  if (!res.ok) throw new Error(`Loading the shared card failed with ${res.status}`);
  return (await res.json()) as PublicCard;
}

/** Removes plaintext versions from an encrypted vault's history on the server. */
export const purgePlaintextHistory = (vaultId: string) => request<unknown>(`/vaults/${encodeURIComponent(vaultId)}/purge-plaintext`, { method: 'POST', body: '{}' });

export const pairingCode = async (pair: string) => (await request<{ code: string }>(`/auth/pair/code?pair=${encodeURIComponent(pair)}`)).code;
export const approvePairing = (pair: string) => request<unknown>('/auth/pair/approve', { method: 'POST', body: JSON.stringify({ pair }) });

/** The server's public key for push, or null when reminders aren't set up there. */
export const pushKey = async () => (await request<{ key: string | null }>('/api/push/key')).key;

/** What this browser's reminders are: where to push them, and when. */
export interface PushSettings {
  /** Minutes before a todo's due time. */
  lead: number;
  /** When a todo with only a date reminds (HH:MM). */
  remindAt: string;
}

export const savePushSubscription = (subscription: PushSubscriptionJSON, settings: PushSettings) =>
  request<{ ok: true }>('/api/push/subscription', {
    method: 'PUT',
    body: JSON.stringify({ ...subscription, ...settings, timeZone: Intl.DateTimeFormat().resolvedOptions().timeZone, locale: navigator.language }),
  });

export const removePushSubscription = (endpoint: string) => request<{ ok: true }>('/api/push/subscription', { method: 'DELETE', body: JSON.stringify({ endpoint }) });

export const sendTestPush = () => request<{ sent: number; browsers: number }>('/api/push/test', { method: 'POST' });
