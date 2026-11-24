import { createHash } from 'node:crypto';

/**
 * Step 2 (§6.3): signature = sha1(category-agnostic skeleton + failed step) → first 6 hex chars.
 * Category-agnostic so a user reclassification never changes the signature.
 */
export function signature(skeleton: string, failedStep: string | undefined): string {
  const step = (failedStep ?? '').trim().replace(/\s+/g, ' ').toLowerCase();
  return createHash('sha1').update(`${skeleton}\n${step}`).digest('hex').slice(0, 6);
}

export const SIG_LABEL_PREFIX = 'sp-sig-';

export function signatureLabel(sig: string): string {
  return `${SIG_LABEL_PREFIX}${sig}`;
}
