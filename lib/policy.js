/**
 * dsh-privmask policy decisions.
 *
 * Keeps security decisions separate from detection rules. The default is
 * intentionally balanced: credentials are protected aggressively while
 * semantic entities are handled conservatively to preserve LLM usefulness.
 *
 * @module dsh-privmask/policy
 */

const ALWAYS_PROTECT = new Set([
  'credential',
  'token',
  'password',
  'secret',
  'private_key',
]);

const PRIVACY_DATA = new Set([
  'id_card',
  'bank_card',
  'phone',
  'email',
]);

/**
 * Decide whether a detected category should be masked.
 *
 * Modes:
 * - strict: maximum privacy protection
 * - balanced: protect high-risk data, preserve common context
 * - permissive: only protect secrets
 */
export function shouldRedact(category, mode = 'balanced') {
  if (ALWAYS_PROTECT.has(category)) return true;
  if (mode === 'strict') return true;
  if (mode === 'permissive') return false;
  return PRIVACY_DATA.has(category);
}

/**
 * Return a semantic placeholder label instead of leaking raw categories to the
 * model. This allows future rules to provide useful context without exposing
 * original values.
 */
export function semanticPlaceholder(category, index) {
  const labels = {
    company: 'organization',
    org: 'organization',
    name: 'person',
    address: 'location',
  };
  return `[REDACTED_${labels[category] ?? category}_${index}]`;
}

export const defaultPolicy = {
  mode: 'balanced',
};
