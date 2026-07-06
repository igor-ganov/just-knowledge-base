export const utf8Encode = (text: string): Uint8Array => new TextEncoder().encode(text);

export const utf8Decode = (bytes: Uint8Array): string => new TextDecoder().decode(bytes);

export const toBase64 = (bytes: Uint8Array): string => {
  let binary = '';
  for (const byte of bytes) binary += String.fromCharCode(byte);
  return btoa(binary);
};

export const fromBase64 = (encoded: string): Uint8Array =>
  Uint8Array.from(atob(encoded), (char) => char.charCodeAt(0));

export const concatBytes = (...parts: ReadonlyArray<Uint8Array>): Uint8Array => {
  const total = parts.reduce((sum, part) => sum + part.length, 0);
  const result = new Uint8Array(total);
  parts.reduce((offset, part) => {
    result.set(part, offset);
    return offset + part.length;
  }, 0);
  return result;
};

/**
 * Copy a view into a fresh, exactly-sized ArrayBuffer. Never use `.buffer` on
 * an incoming view directly: Node/Bun Buffers are views into a shared pool, so
 * their `.buffer` is the whole pool, not the record.
 */
export const exactBuffer = (view: Uint8Array): ArrayBuffer => {
  const copy = new Uint8Array(view.length);
  copy.set(view);
  return copy.buffer;
};

export const sha256Hex = async (bytes: Uint8Array): Promise<string> => {
  const digest = await crypto.subtle.digest('SHA-256', exactBuffer(bytes));
  return [...new Uint8Array(digest)].map((byte) => byte.toString(16).padStart(2, '0')).join('');
};

export const randomBytes = (length: number): Uint8Array =>
  crypto.getRandomValues(new Uint8Array(length));
