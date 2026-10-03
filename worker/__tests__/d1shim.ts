/**
 * A D1 stand-in over Node's built-in SQLite, so the real migration and the real queries run in the
 * tests. It implements only what worker/store.ts uses: prepare/bind/first/all/run and batch (one
 * transaction, results in order).
 */
import { readFileSync } from 'node:fs';
import { DatabaseSync } from 'node:sqlite';
import type { D1Like, D1Statement } from '../types';

type Bound = { sql: string; values: unknown[] };

export function createD1(): D1Like & { raw: DatabaseSync } {
  const db = new DatabaseSync(':memory:');
  for (const file of ['0001_init.sql', '0002_sharing.sql']) db.exec(readFileSync(new URL(`../../migrations/${file}`, import.meta.url), 'utf8'));
  const stmt = (b: Bound): D1Statement & { _b: Bound } => ({
    _b: b,
    bind: (...values) => stmt({ sql: b.sql, values }),
    first: async <T>() => (db.prepare(b.sql).get(...(b.values as never[])) as T | undefined) ?? null,
    all: async <T>() => ({ results: db.prepare(b.sql).all(...(b.values as never[])) as T[] }),
    run: async () => db.prepare(b.sql).run(...(b.values as never[])),
  });
  return {
    raw: db,
    prepare: (sql) => stmt({ sql, values: [] }),
    batch: async <T>(statements: D1Statement[]) => {
      db.exec('BEGIN');
      try {
        const out = statements.map((s) => {
          const b = (s as ReturnType<typeof stmt>)._b;
          return { results: db.prepare(b.sql).all(...(b.values as never[])) as T[] };
        });
        db.exec('COMMIT');
        return out;
      } catch (e) {
        db.exec('ROLLBACK');
        throw e;
      }
    },
  };
}
