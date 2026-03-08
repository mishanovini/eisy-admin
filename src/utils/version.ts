/**
 * App version — injected by Vite's `define` at build/serve time from package.json.
 *
 * Uses a `typeof` guard so that stale builds deployed on the eisy device
 * (where Vite's replacement didn't run) won't crash with a ReferenceError.
 * `typeof undeclaredVar` safely returns 'undefined' instead of throwing.
 */
// eslint-disable-next-line no-undef
export const APP_VERSION: string =
  typeof __APP_VERSION__ !== 'undefined' ? __APP_VERSION__ : 'dev';
