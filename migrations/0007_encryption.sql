-- End-to-end encryption for private vaults: the vault key, wrapped by the PIN and by a recovery key.
-- JSON the server never reads. Set only on vaults with a PIN.
ALTER TABLE vaults ADD COLUMN encryption TEXT;
