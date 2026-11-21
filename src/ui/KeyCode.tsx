import { useEffect, useState } from 'react';
import { keyCode } from '../crypto/vaultKeys';

/** A public key as the short code its owner and the member compare. */
export function KeyCode({ publicKey }: { publicKey: string }) {
  const [code, setCode] = useState<string | null>(null);
  useEffect(() => {
    let live = true;
    void keyCode(publicKey).then((c) => live && setCode(c));
    return () => {
      live = false;
    };
  }, [publicKey]);
  return <span className="key-code">{code ?? '···· ···· ···· ····'}</span>;
}
