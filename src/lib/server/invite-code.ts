import { createHash, randomBytes } from 'crypto';

export function normalizeInviteCode(code: string): string {
  return code.trim().toUpperCase().replace(/\s+/g, '');
}

export function hashInviteCode(code: string): string {
  return createHash('sha256').update(normalizeInviteCode(code)).digest('hex');
}

export function createInviteCode(brainName: string): string {
  const prefix = brainName.replace(/[^a-z0-9]/gi, '').slice(0, 6).toUpperCase() || 'BRAIN';
  const partA = randomBytes(2).toString('hex').toUpperCase();
  const partB = randomBytes(2).toString('hex').toUpperCase();
  return `${prefix}-${partA}-${partB}`;
}
