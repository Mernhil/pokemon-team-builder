/** GET /api/health: is this deployment set up for sync? Booleans, migration names and the clock; nothing about any account. */
import { EXPECTED_MIGRATIONS, type HealthResponse } from '../src/domain/syncHealth';
import type { Env } from './types';

/** The table each migration creates, for a database whose migrations were pasted into the D1 console (no d1_migrations table). */
const MIGRATION_TABLE: Record<(typeof EXPECTED_MIGRATIONS)[number], string> = {
  '0001_init': 'documents',
  '0002_shares': 'shares',
  '0003_devices': 'devices',
  '0004_redeem_attempts': 'redeem_attempts',
  '0005_accounts': 'users',
  '0006_claims': 'account_claims',
};

async function appliedMigrations(db: NonNullable<Env['DB']>): Promise<string[] | null> {
  try {
    const rows = await db.prepare('SELECT name FROM d1_migrations').all<{ name: string }>();
    return rows.results.map((r) => r.name.replace(/\.sql$/, ''));
  } catch {
    /* wrangler's bookkeeping table is missing: look at the tables instead */
  }
  try {
    const tables = new Set((await db.prepare("SELECT name FROM sqlite_master WHERE type = 'table'").all<{ name: string }>()).results.map((r) => r.name));
    return EXPECTED_MIGRATIONS.filter((m) => tables.has(MIGRATION_TABLE[m]));
  } catch {
    return null;
  }
}

export async function health(env: Env, now: number): Promise<HealthResponse> {
  const migrations = env.DB ? await appliedMigrations(env.DB) : null;
  return {
    database: Boolean(env.DB),
    migrations,
    missing: migrations ? EXPECTED_MIGRATIONS.filter((m) => !migrations.includes(m)) : [],
    access: { teamDomain: Boolean(env.ACCESS_TEAM_DOMAIN), audience: Boolean(env.ACCESS_AUD) },
    accounts: { mode: env.AUTH_MODE === 'both' || env.AUTH_MODE === 'accounts' ? env.AUTH_MODE : 'access', pepper: Boolean(env.PASSWORD_PEPPER), setupCode: Boolean(env.SETUP_CODE) },
    time: now,
  };
}
