import { useCallback, useEffect, useState } from 'react';
import { keyCode, vaultKeyCode } from '../crypto/vaultKeys';

/** A code worked out on the device, shown as it comes. */
function Code({ make }: { make: () => Promise<string> }) {
  const [code, setCode] = useState<string | null>(null);
  useEffect(() => {
    let live = true;
    void make().then((c) => live && setCode(c));
    return () => {
      live = false;
    };
  }, [make]);
  return <span className="key-code">{code ?? '···· ···· ···· ····'}</span>;
}

/** A public key as the short code its owner and the member compare before the owner lets them in. */
export function KeyCode({ publicKey }: { publicKey: string }) {
  const make = useCallback(() => keyCode(publicKey), [publicKey]);
  return <Code make={make} />;
}

/** An open vault key as the short code everyone in the vault compares once they're in. */
export function VaultKeyCode({ vaultKey, vaultId }: { vaultKey: CryptoKey; vaultId: string }) {
  const make = useCallback(() => vaultKeyCode(vaultKey, vaultId), [vaultKey, vaultId]);
  return <Code make={make} />;
}
