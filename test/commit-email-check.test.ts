import { execFileSync, spawnSync } from "node:child_process";
import { copyFileSync, mkdtempSync, symlinkSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
// @ts-expect-error: a plain JavaScript check script, without type declarations.
import { findCompanyEmails, readExceptions } from "../scripts/commit-email-check.mjs";

// Synthetic addresses only. The check matches the company domain; example.com stands in for everyone else.
const A = "a".repeat(40);
const B = "b".repeat(40);
const C = "c".repeat(40);
const ok = "1+someone@users.noreply.github.com";
const company = ["someone", "zyaku.com"].join("@");

describe("commit email check", () => {
  it("fails a company address as author or as committer", () => {
    const entries = [
      { sha: A, author: company, committer: ok },
      { sha: B, author: ok, committer: company.toUpperCase() },
      { sha: C, author: ok, committer: "someone@example.com" },
    ];
    expect(findCompanyEmails(entries, new Set())).toEqual([A, B]);
  });

  it("skips only the exact commits on the exceptions list", () => {
    const entries = [
      { sha: A, author: company, committer: ok },
      { sha: B, author: company, committer: ok },
    ];
    expect(findCompanyEmails(entries, readExceptions(`# note\n${A} # why\n`))).toEqual([B]);
  });

  it("refuses an exceptions list with a short or malformed SHA", () => {
    expect(() => readExceptions("d3bf28d\n")).toThrow(/not a full SHA/);
    expect(() => readExceptions(`${A}x\n`)).toThrow(/not a full SHA/);
  });
});

describe("commit email check, run as a script on a throwaway repository", () => {
  const script = fileURLToPath(new URL("../scripts/commit-email-check.mjs", import.meta.url));

  function repoWith(emails: string[]) {
    const dir = mkdtempSync(join(tmpdir(), "holdsend-email-"));
    const git = (...args: string[]) => execFileSync("git", args, { cwd: dir, encoding: "utf8" }).trim();
    git("init", "-q");
    const shas: string[] = [];
    emails.forEach((email, i) => {
      writeFileSync(join(dir, "f.txt"), String(i));
      git("add", "f.txt");
      execFileSync("git", ["-c", `user.name=Someone`, "-c", `user.email=${email}`, "commit", "-q", "-m", `c${i}`], { cwd: dir });
      shas.push(git("rev-parse", "HEAD"));
    });
    return { dir, shas };
  }

  // The script reads the exceptions list next to itself, so each run gets its own copy of the script.
  function run(dir: string, list: string, range?: string) {
    const copy = join(dir, "check.mjs");
    copyFileSync(script, copy);
    writeFileSync(join(dir, "commit-email-exceptions.txt"), list);
    const r = spawnSync(process.execPath, range ? [copy, range] : [copy], { cwd: dir, encoding: "utf8" });
    return { status: r.status, out: r.stdout + r.stderr };
  }

  it("fails a bad commit, never prints the address, and passes once it is listed", () => {
    const { dir, shas } = repoWith([ok, company, ok]);
    const failed = run(dir, "");
    expect(failed.status).toBe(1);
    expect(failed.out).toContain(shas[1]);
    expect(failed.out).not.toContain(company);
    expect(run(dir, `${shas[1]}\n`).status).toBe(0);
  });

  it("ignores the list for a range, as pull requests use", () => {
    const { dir, shas } = repoWith([ok, company]);
    expect(run(dir, `${shas[1]}\n`, `${shas[0]}..${shas[1]}`).status).toBe(1);
  });

  it("fails on a listed SHA that is not a flagged commit", () => {
    const { dir, shas } = repoWith([ok, ok]);
    expect(run(dir, `${shas[0]}\n`).status).toBe(1);
    expect(run(dir, `${"f".repeat(40)}\n`).status).toBe(1);
  });

  it("still runs when started through a symlinked path", () => {
    const { dir } = repoWith([company]);
    copyFileSync(script, join(dir, "check.mjs"));
    writeFileSync(join(dir, "commit-email-exceptions.txt"), "");
    symlinkSync(dir, `${dir}-link`);
    const r = spawnSync(process.execPath, [join(`${dir}-link`, "check.mjs")], { cwd: dir, encoding: "utf8" });
    expect(r.status).toBe(1);
  });
});
