/**
 * dsh-privmask secure mapping vault.
 *
 * Stores placeholder -> original value mappings behind an authenticated
 * encryption boundary. This is intentionally independent from the masking
 * engine so existing behaviour can keep the same API surface.
 *
 * @module dsh-privmask/vault
 */

import { createCipheriv, createDecipheriv, createHash, randomBytes } from 'node:crypto';

const ALGORITHM = 'aes-256-gcm';

function deriveKey(secret) {
  return createHash('sha256').update(String(secret)).digest();
}

/** Encrypt a single vault value. */
export function encryptValue(value, secret) {
  const iv = randomBytes(12);
  const key = deriveKey(secret);
  const cipher = createCipheriv(ALGORITHM, key, iv);
  const ciphertext = Buffer.concat([cipher.update(String(value), 'utf8'), cipher.final()]);
  const tag = cipher.getAuthTag();

  return {
    iv: iv.toString('base64'),
    tag: tag.toString('base64'),
    data: ciphertext.toString('base64'),
  };
}

/** Decrypt a vault value. */
export function decryptValue(payload, secret) {
  const key = deriveKey(secret);
  const decipher = createDecipheriv(
    ALGORITHM,
    key,
    Buffer.from(payload.iv, 'base64'),
  );
  decipher.setAuthTag(Buffer.from(payload.tag, 'base64'));
  return Buffer.concat([
    decipher.update(Buffer.from(payload.data, 'base64')),
    decipher.final(),
  ]).toString('utf8');
}

/**
 * Small bounded in-memory vault.
 *
 * It deliberately avoids persistence. Callers decide whether a session
 * requires persistence and where the encryption key comes from.
 */
export class MappingVault {
  constructor({ secret = randomBytes(32).toString('hex'), maxEntries = 10000 } = {}) {
    this.secret = secret;
    this.maxEntries = maxEntries;
    this.store = new Map();
  }

  set(placeholder, value) {
    if (this.store.size >= this.maxEntries && !this.store.has(placeholder)) {
      const first = this.store.keys().next().value;
      this.store.delete(first);
    }
    this.store.set(placeholder, encryptValue(value, this.secret));
  }

  get(placeholder) {
    const item = this.store.get(placeholder);
    return item ? decryptValue(item, this.secret) : undefined;
  }

  entries() {
    return [...this.store.entries()].map(([key]) => [key, this.get(key)]);
  }

  clear() {
    this.store.clear();
  }

  get size() {
    return this.store.size;
  }
}
