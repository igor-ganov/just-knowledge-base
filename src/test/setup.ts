import { GlobalRegistrator } from '@happy-dom/global-registrator';

/**
 * Test preload: give bun tests a DOM (Lit components, KeyboardEvent, Element).
 * Node's webcrypto and fs must keep working for the crypto/git suites, so we
 * restore any globals happy-dom would shadow.
 */
const nativeCrypto = globalThis.crypto;
const nativeFetch = globalThis.fetch;

GlobalRegistrator.register();

Object.defineProperty(globalThis, 'crypto', { value: nativeCrypto, configurable: true });
Object.defineProperty(globalThis, 'fetch', { value: nativeFetch, configurable: true, writable: true });
