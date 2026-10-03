/** The few Cloudflare types the sync Worker uses, written out so the app needn't depend on @cloudflare/workers-types. */

export interface D1Statement {
  bind(...values: unknown[]): D1Statement;
  first<T = unknown>(): Promise<T | null>;
  all<T = unknown>(): Promise<{ results: T[] }>;
  run(): Promise<unknown>;
}
export interface D1Like {
  prepare(sql: string): D1Statement;
  batch<T = unknown>(statements: D1Statement[]): Promise<{ results?: T[] }[]>;
}

export interface Env {
  /** The static assets (the app). */
  ASSETS: { fetch(request: Request): Promise<Response> };
  /** The D1 database. Absent until it has been created and bound (docs/SYNC.md). */
  DB?: D1Like;
  /** The Access team domain, e.g. "myteam.cloudflareaccess.com". */
  ACCESS_TEAM_DOMAIN?: string;
  /** The Access application's audience tag. */
  ACCESS_AUD?: string;
}
