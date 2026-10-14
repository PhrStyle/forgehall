import { readdir, readFile } from "node:fs/promises";
import postgres from "postgres";

export type Sql = postgres.Sql;

export function connect(url = process.env.DATABASE_URL ?? "postgres://forgehall:forgehall_dev@127.0.0.1:5433/forgehall"): Sql {
  return postgres(url, { onnotice: () => {} });
}

/** Applies pending `migrations/*.sql` files in name order, each in its own transaction. */
export async function migrate(sql: Sql): Promise<string[]> {
  await sql`CREATE TABLE IF NOT EXISTS schema_migrations (name text PRIMARY KEY, applied_at timestamptz NOT NULL DEFAULT now())`;
  const dir = new URL("./migrations/", import.meta.url);
  const files = (await readdir(dir)).filter((f) => f.endsWith(".sql")).sort();
  const done = new Set((await sql<{ name: string }[]>`SELECT name FROM schema_migrations`).map((r) => r.name));
  const applied: string[] = [];
  for (const file of files) {
    if (done.has(file)) continue;
    const text = await readFile(new URL(file, dir), "utf8");
    await sql.begin(async (tx) => {
      await tx.unsafe(text);
      await tx`INSERT INTO schema_migrations (name) VALUES (${file})`;
    });
    applied.push(file);
  }
  return applied;
}
