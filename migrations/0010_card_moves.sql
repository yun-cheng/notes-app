-- A card moved out of a vault stops reaching that vault's other members when they sync,
-- so each move is noted here: the vault the card left, and the card's seq as it left.
-- A sync then tells a member which of their cards have gone out of their reach.
CREATE TABLE card_moves (
  card_id TEXT NOT NULL REFERENCES cards(id) ON DELETE CASCADE,
  vault_id TEXT NOT NULL,
  seq INTEGER NOT NULL,
  PRIMARY KEY (card_id, seq)
);
CREATE INDEX card_moves_seq ON card_moves(seq);
