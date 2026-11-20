import type { ReminderBrowser } from '../reminders/sealed';
import { deviceName } from '../domain/device';
import type { VaultPin } from '../domain/pin';
import type { StoredAttachment } from '../domain/attachments';
import type { CardRecord, JSONNode, Vault } from '../domain/types';
import type { PhotoRecord, PhotoTransport, UploadResult } from '../photos/types';
import { SyncAuthExpired, SyncOffline, type SyncTransport } from './engine';
import type { Account, AccountSummary, ConfigResponse, DraftChange, DraftsResponse, ConnectedApp, LinkPreview, PullResponse, PushResponse, RecentVersionsResponse, ServerTranscript, ServerTranslation, SessionInfo, SharedResponse, SignedInAccounts, VersionResponse, VersionsResponse } from './protocol';

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

/**
 * A picture on the web, fetched by the server, since most sites don't let a page fetch their pictures. Throws an
 * error that says what went wrong.
 */
export async function fetchWebPicture(url: string): Promise<Blob> {
  const res = await rawRequest('/fetch-image', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ url }) });
  if (res.ok) return res.blob();
  const error = ((await res.json().catch(() => ({}))) as { error?: string }).error;
  throw new Error(error ?? "That picture couldn't be brought in.");
}

/**
 * What an entry's bubble shows, translated by the server into `to`, or into `otherwise` when it's in `to` already.
 * The server turns down an entry in an encrypted vault.
 */
export async function translateOnServer(cardId: string, pieces: string[], to: string, otherwise?: string): Promise<ServerTranslation | { kind: 'limit' }> {
  const res = await rawRequest('/translate', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ cardId, pieces, to, otherwise }) });
  // This account's translations for today are used up.
  if (res.status === 429) return { kind: 'limit' };
  if (!res.ok) throw new Error(`Translating failed with status ${res.status}`);
  return (await res.json()) as ServerTranslation;
}

export const signInWithGoogle = (credential: string) =>
  request<SessionInfo>('/auth/google', { method: 'POST', body: JSON.stringify({ credential }) });

/** Signs this tab's account out. Returns the accounts still signed in on this browser. */
export const signOutOfServer = async () => (await request<SignedInAccounts>('/auth/logout', { method: 'POST', body: '{}' })).accounts;

/** What deleting this account would take, for the confirmation. */
export const fetchAccountSummary = () => request<AccountSummary>('/account/summary');

/** Deletes this account and everything it owns. Gives the accounts still signed in; throws a sentence saying what went wrong. */
export async function deleteAccountOnServer(email: string): Promise<Account[]> {
  const res = await rawRequest('/account/delete', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ email }) });
  if (res.ok) return ((await res.json()) as SignedInAccounts).accounts;
  const error = ((await res.json().catch(() => ({}))) as { error?: string }).error;
  throw new Error(error ?? "The account couldn't be deleted. Try again.");
}

/** The accounts signed in on this browser, newest sign-in first. */
export const fetchSignedInAccounts = async () => (await request<SignedInAccounts>('/auth/accounts')).accounts;

export interface VaultChanges {
  name?: string;
  pin?: VaultPin | null;
  hidden?: boolean;
  ai_access?: Vault['ai_access'];
  encryption?: Vault['encryption'];
  members_need_pin?: boolean;
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


/** A file bigger than this goes up in pieces, which can pick up where they left off; Drive takes up to 5 MB whole. */
const WHOLE_BYTES = 5 * 1024 * 1024;
/** Each piece: a multiple of 256 KB, as Drive wants, small enough for the server to pass on at once. */
const PIECE_BYTES = 8 * 1024 * 1024;

/** What a refused upload means for the rest: Drive to connect, storage not set up, or this one turned down. */
async function refused(res: Response): Promise<UploadResult> {
  const error = ((await res.clone().json().catch(() => ({}))) as { error?: string }).error;
  if (error === 'drive_not_connected') return 'needs_drive';
  if (error === 'photos_not_configured') return 'not_configured';
  if (res.status >= 500) throw new Error(`Upload failed with ${res.status}`);
  return 'rejected';
}

/**
 * A big file, in pieces: the server says where to start (0, or as far as Drive got before), then takes each piece
 * and says where the next starts, until it has it all. An upload Drive has dropped (a week old) starts again.
 */
async function uploadInPieces(photo: PhotoRecord, query: URLSearchParams, sent?: (done: number) => void): Promise<UploadResult> {
  const id = encodeURIComponent(photo.id);
  const size = photo.blob.size;
  query.set('size', String(size));
  for (let tries = 0; tries < 2; tries++) {
    let res = await rawRequest(`/attachments/${id}/upload?${query}`, { method: 'POST', headers: { 'content-type': photo.mime } });
    if (!res.ok) return refused(res);
    let at = ((await res.json()) as { next?: number; id?: string }).next;
    while (typeof at === 'number') {
      sent?.(at / size);
      const end = Math.min(size, at + PIECE_BYTES);
      res = await rawRequest(`/attachments/${id}/upload`, { method: 'PUT', body: photo.blob.slice(at, end), headers: { 'content-range': `bytes ${at}-${end - 1}/${size}` } });
      const body = (await res.clone().json().catch(() => ({}))) as { next?: number; id?: string; error?: string };
      if (res.status === 409 && body.error === 'upload_expired') break;
      if (!res.ok) return refused(res);
      if (body.id) return 'ok';
      at = body.next;
    }
    if (at === undefined) return 'ok';
  }
  throw new Error('The upload kept being dropped');
}

export const photoTransport: PhotoTransport = {
  async upload(photo, sent) {
    const query = new URLSearchParams({ vault: photo.vaultId });
    if (photo.file) {
      query.set('kind', 'file');
      query.set('name', photo.file.name);
    }
    if (photo.width) query.set('w', String(photo.width));
    if (photo.height) query.set('h', String(photo.height));
    if (photo.duration) query.set('d', String(photo.duration));
    if (photo.file && photo.blob.size > WHOLE_BYTES) return uploadInPieces(photo, query, sent);
    const res = await rawRequest(`/attachments/${encodeURIComponent(photo.id)}?${query}`, { method: 'PUT', body: photo.blob, headers: { 'content-type': photo.mime } });
    return res.ok ? 'ok' : refused(res);
  },
  async download(id) {
    const res = await rawRequest(`/attachments/${encodeURIComponent(id)}`);
    if (res.ok) return res.blob();
    if (res.status === 404 || res.status === 409 || res.status === 503) return null;
    throw new Error(`Photo download failed with ${res.status}`);
  },
  address(id) {
    // A player can't send the account's header, so it goes in the address.
    return `/api/attachments/${encodeURIComponent(id)}${requestAccount ? `?account=${encodeURIComponent(requestAccount)}` : ''}`;
  },
};

/** Every photo and file in this account's vaults, as the server keeps them, the Trash's too. */
export const listAttachments = async () => (await request<{ attachments: StoredAttachment[] }>('/attachments')).attachments;

/** Sends photos and files no entry holds to the Trash, and brings back those held again or put back. */
export const markAttachments = (change: { trash: { id: string; from: string | null; name: string | null }[]; keep: string[] }) =>
  request<unknown>('/attachments/state', { method: 'POST', body: JSON.stringify(change) });

/** How deleting one for good went: done, gone already, held by an entry again, or Drive not connected. */
export type DeleteResult = 'ok' | 'gone' | 'in_use' | 'needs_drive' | 'error';

/** Deletes a photo or file in the Trash for good, from Google Drive too. */
export async function deleteAttachment(id: string): Promise<DeleteResult> {
  const res = await rawRequest(`/attachments/${encodeURIComponent(id)}`, { method: 'DELETE' });
  if (res.ok) return 'ok';
  if (res.status === 404) return 'gone';
  const error = ((await res.json().catch(() => ({}))) as { error?: string }).error;
  return error === 'in_use' ? 'in_use' : error === 'drive_not_connected' ? 'needs_drive' : 'error';
}

/** Whether a photo, video or file is shared by its Google Drive link, the link if so, and whether this account may share it. */
export interface DriveLink {
  url: string | null;
  can: boolean;
}

export const fetchDriveLink = (id: string) => request<DriveLink>(`/attachments/${encodeURIComponent(id)}/link`);

/**
 * How sharing one by its Drive link went: the link; Drive refused (a Workspace that forbids links for anyone); one
 * not in a Drive (the demo's); one not uploaded yet, as far as the server knows; Drive not connected; or anything else.
 */
export type ShareLinkResult = { url: string } | { error: 'drive_refused' | 'not_in_drive' | 'not_uploaded' | 'needs_drive' | 'failed' };

/** Lets anyone with its Google Drive link open a photo, video or file, and answers with the link. */
export async function shareDriveLink(id: string): Promise<ShareLinkResult> {
  const res = await rawRequest(`/attachments/${encodeURIComponent(id)}/link`, { method: 'POST' }).catch(() => null);
  const body = ((await res?.json().catch(() => ({}))) ?? {}) as { url?: string; error?: string };
  if (res?.ok && body.url) return { url: body.url };
  const error =
    res?.status === 404
      ? 'not_uploaded'
      : body.error === 'drive_not_connected'
        ? 'needs_drive'
        : body.error === 'drive_refused' || body.error === 'not_in_drive'
          ? body.error
          : 'failed';
  return { error };
}

/** Stops anyone opening it by its Drive link. */
export async function stopDriveLink(id: string): Promise<boolean> {
  const res = await rawRequest(`/attachments/${encodeURIComponent(id)}/link`, { method: 'DELETE' }).catch(() => null);
  return !!res?.ok;
}

/**
 * How transcribing one piece of a voice message went: what the server heard; or it's in an encrypted vault, the day's
 * hour is used up, the server can't transcribe, there's no connection, or anything else.
 */
export type TranscribeResult = ServerTranscript | { error: 'encrypted' | 'limit' | 'not_set_up' | 'offline' | 'failed' };

/** Sends one piece of a voice message (a 16 kHz WAV) to be transcribed, for a vault this account can change. */
export async function transcribePiece(vaultId: string, wav: Uint8Array<ArrayBuffer>): Promise<TranscribeResult> {
  let res: Response;
  try {
    res = await rawRequest(`/transcribe?vault=${encodeURIComponent(vaultId)}`, { method: 'POST', headers: { 'content-type': 'audio/wav' }, body: wav });
  } catch (err) {
    if (err instanceof SyncOffline) return { error: 'offline' };
    throw err;
  }
  if (res.ok) return (await res.json()) as ServerTranscript;
  return { error: res.status === 403 ? 'encrypted' : res.status === 429 ? 'limit' : res.status === 501 ? 'not_set_up' : 'failed' };
}

export interface VaultPeople {
  /** `locked`: whether they've locked the vault with a PIN of their own. */
  members: { user_id: string; name: string; email: string; role: 'owner' | 'editor' | 'viewer'; locked: boolean }[];
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

/** The account's drafts changed on the server after `since` (all of them from 0). */
export const fetchDrafts = (since: number) => request<DraftsResponse>(`/drafts?since=${since}`);
/** Sends drafts as they're typed, or null for one sent or emptied. */
export const sendDrafts = async (drafts: DraftChange[]) => void (await request<unknown>('/drafts', { method: 'PUT', body: JSON.stringify({ drafts }) }));

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
  /** The pages behind the card's front, in order; missing from a server older than them. */
  pages?: JSONNode[];
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
export const pushKey = async () => (await request<{ key: string | null }>('/push/key')).key;

/** What this browser's reminders are: where to push them, and when. */
export interface PushSettings {
  /** Minutes before a todo's due time. */
  lead: number;
  /** When a todo with only a date reminds (HH:MM). */
  remindAt: string;
}

export const savePushSubscription = (subscription: PushSubscriptionJSON, settings: PushSettings) =>
  request<{ ok: true }>('/push/subscription', {
    method: 'PUT',
    body: JSON.stringify({ ...subscription, ...settings, timeZone: Intl.DateTimeFormat().resolvedOptions().timeZone, locale: navigator.language }),
  });

export const removePushSubscription = (endpoint: string) => request<{ ok: true }>('/push/subscription', { method: 'DELETE', body: JSON.stringify({ endpoint }) });

/** This account's browsers with reminders on, to seal an encrypted vault's reminders to (src/reminders/sealed.ts). */
export const fetchReminderBrowsers = async () => (await request<{ subscriptions: ReminderBrowser[] }>('/push/subscriptions')).subscriptions;

/** Replaces the reminders sealed for an encrypted vault's todos. Gives how many the server kept. */
export const putSealedReminders = (vaultId: string, reminders: { card_id: string; subscription_id: string; fire_at: number; body: string }[]) =>
  request<{ kept: number }>(`/vaults/${encodeURIComponent(vaultId)}/sealed-reminders`, { method: 'PUT', body: JSON.stringify({ reminders }) });

export const sendTestPush = () => request<{ sent: number; browsers: number }>('/push/test', { method: 'POST' });
