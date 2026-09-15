-- Protocol-major-4 route identity. Existing terminal audit records remain
-- readable without inventing a settlement domain; all new paid routes require
-- one at the gateway boundary.
ALTER TABLE media.paid_operations
  ADD COLUMN settlement_domain_id TEXT
  CHECK (settlement_domain_id ~ '^0x[0-9a-f]{64}$' AND settlement_domain_id <> ('0x' || repeat('0', 64)));
