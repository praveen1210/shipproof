import { createHash, randomBytes, timingSafeEqual } from 'node:crypto';

/** Ingest tokens are shown once, stored only as a SHA-256 hash, and compared in constant time. */
export function generateToken(): string {
  return `sp_${randomBytes(24).toString('base64url')}`;
}

export function hashToken(token: string): string {
  return createHash('sha256').update(token, 'utf8').digest('hex');
}

export function verifyToken(presented: string | undefined, storedHash: string | undefined): boolean {
  if (!presented || !storedHash) return false;
  const a = Buffer.from(hashToken(presented), 'hex');
  const b = Buffer.from(storedHash, 'hex');
  return a.length === b.length && timingSafeEqual(a, b);
}
