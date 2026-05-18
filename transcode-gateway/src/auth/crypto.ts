import { createHash, randomBytes, timingSafeEqual } from "node:crypto";

// Modeled on blue-claw-network/web-platform/backend/src/crypto.rs.
// API-key prefix differs (tc_ vs bc_) and all randomness goes through
// Node's crypto.randomBytes — never Math.random.

const ALPHABET = "0123456789abcdefghijklmnopqrstuvwxyzABCDEFGHIJKLMNOPQRSTUVWXYZ";

function randomAlphanum(len: number): string {
  const bytes = randomBytes(len);
  let out = "";
  for (let i = 0; i < len; i++) {
    out += ALPHABET[bytes[i]! % ALPHABET.length];
  }
  return out;
}

export function generateApiKey(): string {
  return `tc_${randomAlphanum(48)}`;
}

export function generateSessionToken(): string {
  return `sess_${randomBytes(32).toString("hex")}`;
}

export function generateVerificationToken(): string {
  return randomBytes(32).toString("hex");
}

export function sha256Hex(input: string): string {
  return createHash("sha256").update(input).digest("hex");
}

export function pepperedHash(input: string, pepper: string | undefined): string {
  if (pepper && pepper.length > 0) {
    return createHash("sha256").update(pepper).update("|").update(input).digest("hex");
  }
  return sha256Hex(input);
}

export function hashApiKeyForStorage(rawKey: string, pepper: string | undefined): string {
  return pepperedHash(rawKey, pepper);
}

// When the pepper is set, returns [peppered, plain] so keys issued
// before pepper rotation still validate. When unset, just [plain].
export function apiKeyHashCandidates(rawKey: string, pepper: string | undefined): string[] {
  const plain = sha256Hex(rawKey);
  if (!pepper || pepper.length === 0) return [plain];
  const peppered = pepperedHash(rawKey, pepper);
  return peppered === plain ? [plain] : [peppered, plain];
}

export function keyPrefix(key: string): string {
  return `${key.slice(0, 8)}...`;
}

// Constant-time compare. Falls back to false on length mismatch
// (timingSafeEqual throws on unequal lengths); the only leak is on
// length, which Content-Length already exposes.
export function constantTimeEqual(a: string, b: string): boolean {
  const aBuf = Buffer.from(a, "utf8");
  const bBuf = Buffer.from(b, "utf8");
  if (aBuf.length !== bBuf.length) return false;
  return timingSafeEqual(aBuf, bBuf);
}
