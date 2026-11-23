# 0019: Running the schema again takes no table lock

Date: 2026-11-20. Status: accepted.

## Context

Reported with a reproduction in issue [#54](https://github.com/zyakuhq/holdsend/issues/54).

The server README runs `postgresSchema()` when the app starts, and its doc comment says the text is safe to run on every deploy. It is idempotent, but two kinds of statement in it lock the table before they find out they have nothing to do: `ALTER TABLE ... ADD COLUMN IF NOT EXISTS` (ACCESS EXCLUSIVE) and `CREATE INDEX IF NOT EXISTS` (SHARE). If a backup, a long read or an unfinished write has the table open, a starting instance waits for it, and every claim that arrives after that queues behind the waiting DDL. Nothing is lost or sent twice, but no request with a key is answered until the old transaction ends. We reproduced it on Postgres 16: with a read transaction open, a claim waited more than a second behind the schema; with the fix it answered at once.

## Choice

- `postgresSchema()` keeps `CREATE TABLE IF NOT EXISTS` (it finds an existing table by name and does not lock it), and puts the column and the three indexes in one `DO` block. Each is looked up first in `pg_attribute` or `pg_index` for that table (`to_regclass` of the quoted name, so a schema-qualified table works), and its statement runs only when it is missing. Catalog reads take no lock on the table.
- Two instances that start at once and both find something missing used to race: `IF NOT EXISTS` does not see the other session's uncommitted catalog rows, so one failed on a catalog unique index (the review reproduced it in 10 of 10 rounds on a fresh database, with the old text too). The text now starts with `pg_advisory_xact_lock` on a key derived from the table name. It is not a table lock, and it lasts until the end of the text, which `pool.query()` and PGlite's `exec()` run as one implicit transaction, so the second instance waits and then finds everything there (0 failures in 20 rounds).
- The text is still one string that can be sent with `pool.query()` or PGlite's `exec()`. It can no longer be split on `;`; the notes example did that and now sends it whole. The README and the doc comment say so.
- The README says what is still true: when something is missing, the statement does lock the table, so such a deploy should run with a short `lock_timeout` or in a migration. It shows `SET LOCAL` in the same text, since a plain `SET` through a pool can land on another connection and stays on the one it lands on.

## What we did not do

- A separate `lock_timeout` inside the text: it would also cut short the first deploy on a busy table, and the right timeout belongs to the app.
- Moving schema setup out of the notes example's start into a migration script. That is what outside pull request #71 proposes; it waits for the project lead's answer to its contributor, and this change does not depend on it.
- The notes example's own `CREATE INDEX IF NOT EXISTS` on `notes` still takes a SHARE lock on that table at every start. It does not touch the idempotency table, so claims are not held up; #71 would move it to a migration anyway.

## Tests

`packages/server/test/schema-locks-real-postgres.test.ts`, against a real Postgres (CI's `postgres` job, which now names this file and expects at least eight passing tests): with a read transaction open on the table, running the schema again under a 500 ms lock timeout succeeds, for a plain and a schema-qualified table name. Both fail on the old text with a lock timeout. A third test, and one in the PGlite contract suite, drop the column and the indexes and check the schema puts them back.

Reviewed by a separate agent: it found that CI did not run the new test, the race between two starting instances, and a pooled-connection trap in the README's lock-timeout advice. All fixed here.
