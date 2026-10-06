/** The app version (src-tauri/tauri.conf.json), injected by vite.config.ts. */
declare const __APP_VERSION__: string;

/** CHANGELOG.md's latest releases, built by vite.config.ts (src/domain/changelog.ts). */
declare module 'virtual:changelog' {
  const releases: import('./domain/changelog').Release[];
  export default releases;
}
