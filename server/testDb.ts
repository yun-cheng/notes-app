import { readdirSync, readFileSync } from 'node:fs';
import { DatabaseSync, type StatementSync } from 'node:sqlite';
import type { Database, Statement } from './db';

type Bound = (string | number | null)[];

class SqliteStatement implements Statement {
  constructor(
    private db: DatabaseSync,
    private sql: string,
    private values: Bound = [],
  ) {}
  bind(...values: unknown[]) {
    return new SqliteStatement(this.db, this.sql, values as Bound);
  }
  private get prepared(): StatementSync {
    return this.db.prepare(this.sql);
  }
  execute<T>(): T[] {
    return this.prepared.all(...this.values).map((r) => ({ ...r })) as T[];
  }
  async first<T>() {
    return this.execute<T>()[0] ?? null;
  }
  async all<T>() {
    return { results: this.execute<T>() };
  }
  async run() {
    this.execute();
    return {};
  }
}

/** An in-memory SQLite database with D1's interface and the real migrations applied. */
export function createTestDb(): Database & { raw: DatabaseSync } {
  const raw = new DatabaseSync(':memory:');
  raw.exec('PRAGMA foreign_keys = ON');
  const dir = new URL('../migrations/', import.meta.url);
  for (const file of readdirSync(dir).sort()) raw.exec(readFileSync(new URL(file, dir), 'utf8'));
  return {
    raw,
    prepare: (sql) => new SqliteStatement(raw, sql),
    async batch<T>(statements: Statement[]) {
      raw.exec('BEGIN');
      try {
        const out = statements.map((s) => ({ results: (s as SqliteStatement).execute<T>() }));
        raw.exec('COMMIT');
        return out;
      } catch (err) {
        raw.exec('ROLLBACK');
        throw err;
      }
    },
  };
}
