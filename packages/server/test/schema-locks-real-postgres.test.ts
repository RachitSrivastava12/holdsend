/**
 * Issue #54: running postgresSchema() again, as an instance does at startup,
 * must not wait for a transaction that has the table open, and so must not
 * queue claims behind it. Needs a real server (PGlite has one connection).
 * Runs when HOLDSEND_PG_URL is set; skipped otherwise.
 */
import pg from "pg";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { postgresSchema } from "../src/index.js";

const url = process.env.HOLDSEND_PG_URL;
const TABLE = "schema_lock_check";
const QUALIFIED = "schema_lock_ns.schema_lock_check";

describe.skipIf(!url)("postgresSchema on a busy table (real Postgres)", () => {
  let holder: pg.Client;
  let booting: pg.Client;

  beforeAll(async () => {
    holder = new pg.Client({ connectionString: url });
    booting = new pg.Client({ connectionString: url });
    await holder.connect();
    await booting.connect();
    await holder.query(`DROP TABLE IF EXISTS ${TABLE}; DROP SCHEMA IF EXISTS schema_lock_ns CASCADE; CREATE SCHEMA schema_lock_ns;`);
  });

  afterAll(async () => {
    await holder?.query(`DROP TABLE IF EXISTS ${TABLE}; DROP SCHEMA IF EXISTS schema_lock_ns CASCADE;`).catch(() => undefined);
    await holder?.end();
    await booting?.end();
  });

  for (const table of [TABLE, QUALIFIED]) {
    it(`runs again without waiting for an open transaction (${table})`, async () => {
      await holder.query(postgresSchema(table));
      await holder.query("BEGIN");
      try {
        // A read is enough: it holds ACCESS SHARE until the transaction ends.
        await holder.query(`SELECT count(*) FROM ${table}`);
        await booting.query("SET lock_timeout = '500ms'");
        // On the old DDL this failed with "canceling statement due to lock timeout".
        await expect(booting.query(postgresSchema(table))).resolves.toBeDefined();
      } finally {
        await holder.query("ROLLBACK");
        await booting.query("RESET lock_timeout");
      }
    });
  }

  it("lets two instances that start at once both succeed on a fresh database", async () => {
    for (let round = 0; round < 5; round += 1) {
      await holder.query(`DROP TABLE IF EXISTS ${TABLE}`);
      // Without the advisory lock, one of the two failed on a catalog unique index almost every round.
      await expect(Promise.all([holder.query(postgresSchema(TABLE)), booting.query(postgresSchema(TABLE))])).resolves.toHaveLength(2);
    }
  });

  it("still adds a missing column and missing indexes to an older table", async () => {
    await holder.query(`DROP TABLE IF EXISTS ${TABLE}`);
    await holder.query(postgresSchema(TABLE));
    const indexes = async () =>
      (await holder.query("SELECT indexname FROM pg_indexes WHERE schemaname = 'public' AND tablename = $1 AND indexname LIKE 'holdsend_%' ORDER BY 1", [TABLE])).rows.map((r) => (r as { indexname: string }).indexname);
    const before = await indexes();
    expect(before).toHaveLength(3);
    await holder.query(`ALTER TABLE ${TABLE} DROP COLUMN result_headers`);
    for (const name of before) await holder.query(`DROP INDEX "${name}"`);
    await booting.query(postgresSchema(TABLE));
    expect(await indexes()).toEqual(before);
    const column = await holder.query("SELECT 1 FROM information_schema.columns WHERE table_schema = 'public' AND table_name = $1 AND column_name = 'result_headers'", [TABLE]);
    expect(column.rows).toHaveLength(1);
  });
});
