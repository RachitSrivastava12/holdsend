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
