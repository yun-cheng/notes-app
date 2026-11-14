import { fromBase64, toBase64 } from '../domain/base64';

function randomBytes(): Uint8Array<ArrayBuffer> {
  return crypto.getRandomValues(new Uint8Array(32));
}

export async function biometricAvailable(): Promise<boolean> {
  try {
    return (await window.PublicKeyCredential?.isUserVerifyingPlatformAuthenticatorAvailable?.()) ?? false;
  } catch {
    return false;
  }
}

/** Registers this device's fingerprint for a vault and returns the credential ID to remember. */
export async function enrollBiometric(label: string): Promise<string> {
  const credential = (await navigator.credentials.create({
    publicKey: {
      rp: { name: 'Notes' },
      user: { id: randomBytes(), name: label, displayName: label },
      challenge: randomBytes(),
      pubKeyCredParams: [
        { type: 'public-key', alg: -7 },
        { type: 'public-key', alg: -257 },
      ],
      authenticatorSelection: { authenticatorAttachment: 'platform', userVerification: 'required', residentKey: 'discouraged' },
      timeout: 60_000,
    },
  })) as PublicKeyCredential | null;
  if (!credential) throw new Error('Fingerprint setup was cancelled');
  return toBase64(new Uint8Array(credential.rawId));
}

/** Resolves true if the device confirmed a fingerprint. Like the PIN, this gates the UI and isn't encryption. */
export async function verifyBiometric(credentialId: string): Promise<boolean> {
  try {
    const result = await navigator.credentials.get({
      publicKey: {
        challenge: randomBytes(),
        allowCredentials: [{ type: 'public-key', id: fromBase64(credentialId) }],
        userVerification: 'required',
        timeout: 60_000,
      },
    });
    return !!result;
  } catch {
    return false;
  }
}

export const biometricKey = (vaultId: string) => `biometric:${vaultId}`;
