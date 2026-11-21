import { decryptComment, encryptComment, isEncryptedPayload } from '../crypto/vaultKeys';
import { fetchVaultComments, putVaultComments } from '../sync/http';

/** How many comments go to the server at once. */
const BATCH = 500;

async function put(vaultId: string, comments: { id: string; body: string }[]) {
  for (let i = 0; i < comments.length; i += BATCH) await putVaultComments(vaultId, comments.slice(i, i + BATCH));
}

/** Seals a vault's comments written before it was encrypted, as its cards are, so the server keeps none readable. */
export async function sealComments(vaultId: string, key: CryptoKey): Promise<void> {
  const open = (await fetchVaultComments(vaultId)).filter((k) => !isEncryptedPayload(k.body));
  await put(vaultId, await Promise.all(open.map(async (k) => ({ id: k.id, body: await encryptComment(key, k.body, k.card_id, vaultId) }))));
}

/**
 * Writes out a vault's sealed comments with its key, kept from before, once the vault is readable again and takes
 * them so. One its key doesn't open is left as it is.
 */
export async function writeOutComments(vaultId: string, key: CryptoKey): Promise<void> {
  const sealed = (await fetchVaultComments(vaultId)).filter((k) => isEncryptedPayload(k.body));
  const opened = await Promise.all(sealed.map(async (k) => ({ id: k.id, body: await decryptComment(key, k.body, k.card_id, vaultId) })));
  await put(vaultId, opened.filter((k): k is { id: string; body: string } => k.body !== null));
}
