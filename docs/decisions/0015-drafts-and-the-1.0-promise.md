# 0015: Drafts and the 1.0 promise, and a smaller `DraftState`

Date: 2026-11-15. Status: accepted. Settles items 2 and 3 of [decision 0013](0013-api-review-for-1.0.md).

## Context

Decision 0013 left two items open. Item 2: do the draft helpers (`@holdsend/core/drafts` and the draft exports of `@holdsend/server`) join the 1.0 promise? Item 3: move the log diagnostics of `DraftState` under one field. Item 3 breaks code, so it was tied to item 2. The 1.0 freeze is planned for the end of January 2027, and 0.3 is the last minor release before it, so a breaking change that waits past 0.3 would have to wait for 2.0.

Items 1, 4 and 5 of decision 0013 are done (non-breaking, 2026-11-15).

## Choice

1. **`DraftState` is smaller now, in 0.3.** `count`, `repeats` and `dangling` move under `log: DraftLogInfo`. The top of `DraftState` keeps what a screen acts on: `conflicted`, `heads`, `latest`, `unresolved`, `ids`. `readDraftState` on the server returns the same shape. Nothing else in the drafts API changes.
2. **Drafts join the 1.0 promise only if both of these hold at the freeze:**
   - no change to the drafts API (the `drafts` part of `api/core.api.txt` and the draft exports in `api/server.api.txt`) between 0.3.0 and the freeze, and
   - the final audit before 1.0 covers the drafts code and finds nothing that needs an API change.

   0.3 is planned as the last minor release before the freeze, so the first condition mostly guards against a late change; the audit is the real test.

   Otherwise 1.0 ships them under the same names, and the changelog, the READMEs and docs/drafts.md say the drafts API is outside the semver promise until 1.1. The default, if nobody checks, is outside.

## Why

- Moving the diagnostics now costs users one edit (`state.count` becomes `state.log.count`). After 1.0 it would cost a major version. The drafts helpers are marked early in 0.2.0, so a change in 0.3 is what that label promised.
- We found no app code, in this repository or in the examples, that reads the three diagnostics; only tests and the smoke script did.
- The rule in item 2 is checkable from the API record, not a judgment call at the last minute. It does not depend on an app outside this repository, which we cannot promise by January; an outside app is still a gate for the README to say "ready for production" (docs/production.md), not for the promise on these names.
- Keeping the same names in either case means no app has to change when drafts later join the promise.

## Not decided here

- Pruning old draft updates (every update is kept; docs/drafts.md says so).
- Background sending for drafts.
