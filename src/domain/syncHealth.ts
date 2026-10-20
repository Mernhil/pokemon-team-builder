/**
 * What GET /api/health says about the deployment, and the one line Settings → Sync shows for it.
 * No user data: only whether things are set up, the names of the applied migrations and the server time.
 */

/** Every file in migrations/, without ".sql". A test keeps this in step with the folder. */
export const EXPECTED_MIGRATIONS = ['0001_init', '0002_shares', '0003_devices', '0004_redeem_attempts', '0005_accounts', '0006_claims', '0007_friends'] as const;

export interface HealthResponse {
  /** The D1 binding exists. */
  database: boolean;
  /** Migrations the database has applied (names without ".sql"); null when it couldn't be read. */
  migrations: string[] | null;
  /** Expected migrations that are not applied (empty when none, or when `migrations` is null). */
  missing: string[];
  access: { teamDomain: boolean; audience: boolean };
  /** The app's own accounts (absent on a server from before they existed). Booleans and the mode only. */
  accounts?: { mode: 'access' | 'both' | 'accounts'; pepper: boolean; setupCode: boolean };
  /** Server time, ms since the epoch. */
  time: number;
}

/** "Server ready", "Database migration missing: 0004", … */
export function healthLine(h: HealthResponse): { ok: boolean; text: string } {
  if (!h.database) return { ok: false, text: 'Database not bound: sync cannot store anything (docs/SYNC.md steps 1–2).' };
  if (h.accounts && h.accounts.mode !== 'access' && !h.accounts.pepper) return { ok: false, text: 'PASSWORD_PEPPER not set on the Worker (docs/ACCOUNTS_MANUAL_STEPS.md).' };
  const access = [!h.access.teamDomain && 'ACCESS_TEAM_DOMAIN', !h.access.audience && 'ACCESS_AUD'].filter(Boolean);
  if (access.length) return { ok: false, text: `${access.join(' and ')} not set on the Worker (docs/SYNC.md step 5).` };
  if (h.migrations === null) return { ok: false, text: 'Could not read the database migrations.' };
  if (h.missing.length) return { ok: false, text: `Database migration missing: ${h.missing.map((m) => m.slice(0, 4)).join(', ')}` };
  return { ok: true, text: 'Server ready' };
}
