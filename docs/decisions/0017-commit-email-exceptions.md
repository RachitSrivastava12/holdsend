# 0017: Known commits with a company address do not keep main red

Date: 2026-11-18. Status: accepted.

## Context

CI fails when any commit uses a company email address as author or committer: on a pull request it checks the pull request's commits, on `main` the whole history. On 2026-11-15 pull request #68 was merged with GitHub's merge button, and that merge commit (`d3bf28d`) took the account's company address as author. From then on the "Secret and PII scan" job failed on every push to `main` (every push since), while every pull request passed, because their range never includes that commit. A red `main` that nobody can fix hides the next real failure.

The address can only leave the history by rewriting `main` and force-pushing it, as was done once on 2026-10-25. That rewrites every commit after it, breaks open pull requests and forks (outside pull request #71 is already based on pre-rewrite history), and is the project lead's decision, not a CI change.

## Choice

- The check moves into `scripts/commit-email-check.mjs`, with unit tests (`test/commit-email-check.test.ts`, synthetic addresses), and runs in `npm run check` as well as CI.
- On `main` it skips only the exact commits listed by full SHA in `scripts/commit-email-exceptions.txt`, each with a date and a reason. Today that is one commit. A short or malformed SHA fails the check, and so does a listed SHA that is not a flagged commit in the history (a typo, or a line left after a rewrite). The script compares real paths before running, so starting it through a symlink cannot skip the check.
- Pull requests never use the list, so a new commit with a company address still fails exactly as before.
- Addresses are still never printed.

## Consequences

- `main` is green again, and the guard for new commits is unchanged.
- The address in `d3bf28d` stays public until the project lead decides to rewrite `main`. If that happens, the line is removed from the list.
- To avoid a repeat: merge by fast-forwarding `main` to the tested commit (the maintainers' note in STATUS), or make sure the GitHub account's commit email is the noreply address before using the merge button. The merge of #78 on 2026-11-18 already used the noreply address.
