import { Buffer } from 'buffer';

/**
 * isomorphic-git expects a global `Buffer` in the browser; Vite does not
 * polyfill Node globals, so we install the standard `buffer` package once,
 * before any git code runs.
 */
const globalWithBuffer: { Buffer?: typeof Buffer } = globalThis;
globalWithBuffer.Buffer = globalWithBuffer.Buffer ?? Buffer;

export {};
