// Fails if a commit carries a company email address as author or committer.
// The address itself is never printed: CI logs are public.
//
//   node scripts/commit-email-check.mjs            every commit on HEAD (main)
//   node scripts/commit-email-check.mjs A..B       a range (pull requests)
//
// Commits already published on main that cannot be fixed without rewriting
// history are listed, by full SHA, in scripts/commit-email-exceptions.txt
// (decision 0017). Only those exact commits are skipped; any new commit with
// a company address still fails. A pull request range never uses the list.
import { execFileSync } from "node:child_process";
import { readFileSync, realpathSync } from "node:fs";
import { fileURLToPath } from "node:url";

const COMPANY = /@zyaku\.com$/i;

export function readExceptions(text) {
  return new Set(
    text
      .split("\n")
      .map((line) => line.replace(/#.*$/, "").trim())
      .filter(Boolean)
      .map((sha) => {
        if (!/^[0-9a-f]{40}$/.test(sha)) throw new Error(`commit-email-check: not a full SHA in the exceptions list: ${sha}`);
        return sha;
      }),
  );
}

export function findCompanyEmails(entries, exceptions) {
  return entries
    .filter(({ author, committer }) => COMPANY.test(author) || COMPANY.test(committer))
    .map(({ sha }) => sha)
    .filter((sha) => !exceptions.has(sha));
}

// Listed SHAs that are not a flagged commit in the checked history: a typo,
// or a line left behind after a rewrite. Either way the list is wrong.
export function staleExceptions(entries, exceptions) {
  const flagged = new Set(
    entries.filter(({ author, committer }) => COMPANY.test(author) || COMPANY.test(committer)).map(({ sha }) => sha),
  );
  return [...exceptions].filter((sha) => !flagged.has(sha));
}

// realpath on both sides: Node resolves symlinks in import.meta.url but not in
// argv[1], and a mismatch here would skip the check and exit 0.
const invoked = process.argv[1] ? realpathSync(process.argv[1]) : "";
if (invoked === realpathSync(fileURLToPath(import.meta.url))) {
  const range = process.argv[2];
  const exceptions = range
    ? new Set()
    : readExceptions(readFileSync(new URL("./commit-email-exceptions.txt", import.meta.url), "utf8"));
  const log = execFileSync("git", ["log", "--format=%H%x00%ae%x00%ce", range ?? "HEAD"], {
    encoding: "utf8",
    maxBuffer: 64 * 1024 * 1024,
  });
  const entries = log
    .split("\n")
    .filter(Boolean)
    .map((line) => {
      const [sha, author, committer] = line.split("\x00");
      return { sha, author, committer };
    });
  const stale = staleExceptions(entries, exceptions);
  if (stale.length > 0) {
    console.error("commit-email-check: these listed exceptions are not a flagged commit in this history. Fix scripts/commit-email-exceptions.txt:");
    for (const sha of stale) console.error(`  ${sha}`);
    process.exit(1);
  }
  const bad = findCompanyEmails(entries, exceptions);
  if (bad.length > 0) {
    console.error(`commit-email-check: ${bad.length} commit(s) use a company email address. Use a GitHub noreply address:`);
    for (const sha of bad) console.error(`  ${sha}`);
    process.exit(1);
  }
  const skipped = entries.length - entries.filter((e) => !exceptions.has(e.sha)).length;
  console.log(`commit-email-check: clean (${entries.length} commit(s), ${skipped} listed exception(s))`);
}
