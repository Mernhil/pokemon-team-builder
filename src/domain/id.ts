/** Showdown-style id: lowercase alphanumerics only. The one definition, shared by the app and the build scripts. */
export const toID = (s: unknown): string =>
  String(s ?? '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '');
