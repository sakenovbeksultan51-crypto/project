import { neon } from '@neondatabase/serverless';

type QueryResult = { rows: Record<string, unknown>[]; rowCount: number };

function createDatabase() {
  const connectionString = process.env.DATABASE_URL || process.env.POSTGRES_URL;
  const query = connectionString ? neon(connectionString, { fullResults: true }) : null;
  let schemaReady: Promise<unknown> | undefined;

  const requireDatabase = () => {
    if (!query) {
      throw new Error('Set DATABASE_URL in the Vercel project and connect a Neon database.');
    }
    schemaReady ??= query.query(
      'CREATE TABLE IF NOT EXISTS workspaces (key TEXT PRIMARY KEY, payload TEXT NOT NULL, revision INTEGER NOT NULL DEFAULT 1, updated_at BIGINT NOT NULL)',
    );
    return schemaReady;
  };

  return {
    prepare(statement: string) {
      let values: unknown[] = [];
      const prepared = {
        bind(...boundValues: unknown[]) {
          values = boundValues;
          return prepared;
        },
        async first<T>() {
          await requireDatabase();
          let nextParameter = 1;
          const sql = statement.replace(/\?/g, () => `$${nextParameter++}`);
          const result = (await query!.query(sql, values)) as unknown as QueryResult;
          return (result.rows[0] as T | undefined) ?? null;
        },
        async all<T>() {
          await requireDatabase();
          let nextParameter = 1;
          const sql = statement.replace(/\?/g, () => `$${nextParameter++}`);
          const result = (await query!.query(sql, values)) as unknown as QueryResult;
          return { results: result.rows as T[], success: true };
        },
        async run() {
          await requireDatabase();
          let nextParameter = 1;
          const sql = statement.replace(/\?/g, () => `$${nextParameter++}`);
          const result = (await query!.query(sql, values)) as unknown as QueryResult;
          return { meta: { changes: result.rowCount } };
        },
      };
      return prepared;
    },
  } as unknown as D1Database;
}

export const env = {
  ...process.env,
  DB: createDatabase(),
};
