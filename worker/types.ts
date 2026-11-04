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
  /** "access" (default: Cloudflare Access only), "both" (accounts next to Access) or "accounts" (docs/ACCOUNTS_PLAN.md section 7.3). */
  AUTH_MODE?: string;
  /** Secret mixed into every password hash; losing it locks everyone out (docs/ACCOUNTS_MANUAL_STEPS.md). */
  PASSWORD_PEPPER?: string;
  /** Secret that lets the very first account (the admin) sign up while there are no users. */
  SETUP_CODE?: string;
  /** Extra webview origins the device routes answer, comma separated (local development only, e.g. http://localhost:1420 in .dev.vars; never set in production). */
  DEVICE_EXTRA_ORIGINS?: string;
}
