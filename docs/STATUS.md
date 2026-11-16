# Status

The project's working memory. Every work session reads this first and updates it last.

Last updated: 2026-11-16 (Android emulator job in CI, decision 0016; R8 crash fixed in the Expo example)

## Done

- Android emulator job in CI (2026-11-16, [#72](https://github.com/zyakuhq/holdsend/pull/72), [decision 0016](decisions/0016-android-emulator-ci.md)): `.github/workflows/android.yml` builds the Expo example as a release APK, boots an Android 14 emulator and runs `examples/expo/test/android-background.mjs`. A note written while the server is unreachable waits, the app's process is killed (`am kill`), the server starts, the WorkManager job is forced, and the test checks: the process was started for the job service, no screen of the app is open, one key per note, the note is published once, and a second forced run sends nothing. Runs when packages or examples change, on main, and by hand. It found a real bug: Expo's template turns R8 on and the release build crashed at launch (WorkManager's database constructor removed); the example now keeps it with `plugins/keep-work-database.js`, and the READMEs warn `expo-background-task` users. Reviewed by a separate agent; its findings fixed (see the decision). Not checked against deliberately broken code; the test cannot pass without a POST from the killed app, which only the job can make. Forcing the job does not show how often Android runs it.
- Decision 0013 settled (2026-11-15, [#69](https://github.com/zyakuhq/holdsend/pull/69), [decision 0015](decisions/0015-drafts-and-the-1.0-promise.md)): breaking, unreleased, for 0.3: `count`, `repeats` and `dangling` of `DraftState` moved under `log` (`DraftLogInfo`). Drafts join the 1.0 promise only if their API does not change after 0.3.0 and the final audit finds nothing needing an API change; otherwise outside until 1.1. Migration guide: [upgrading.md](upgrading.md). The docs site gives headings GitHub-style ids and its test fails on a missing anchor. Reviewed by a separate agent; five findings fixed.
- From an outside review (2026-11-15): `lastAttempt` on every item that left the device without a confirmed outcome (`no_answer`, `server_busy`, `refused`; display only), `outbox.sendNow()` with a test where the first answer is lost after the server created the item (same key twice, one item created), and the README table says per package what is tested and where. The core budget moved to 5.25 KB ([decision 0014](decisions/0014-core-budget-5.25kb.md)). The review's request for a Postgres idempotency store was already met in 0.1.0.
- Path to 1.0 (2026-11-15): [before you ship](production.md), a checklist per package and the four gates before the README may say ready for production. Non-breaking items of decision 0013 done: `AutoFlusher` and `NativeAutoFlusher` are deprecated aliases of `FlushScheduler`, the library's bookkeeping fields and `ItemState`/`ItemStatus` say how to use them, and protocol.md describes the stored item format with its 1.x promise.
- API review for 1.0 (2026-11-14, [#64](https://github.com/zyakuhq/holdsend/pull/64), [decision 0013](decisions/0013-api-review-for-1.0.md), accepted 2026-11-15): read the whole 0.2.0 record. Fixed now, types only: `PoolLike` and `Unsubscribe` exported, `EmergencyOutbox.send` has an explicit return type, draft parameters named, and the API check fails on any type that points into an internal file. Proposed for 1.0: one kick/stop type, a freeze-or-exclude rule for drafts, a smaller `DraftState`, doc comments on the library's own `OutboxItem` fields, better docs for `ItemState` and `ItemStatus`. Not reviewed by a separate agent (no run-time code changed).
- Public API record (2026-11-13, [#62](https://github.com/zyakuhq/holdsend/pull/62), [decision 0012](decisions/0012-api-record.md)): `scripts/api-surface.mjs` writes every entry point's declarations, plus the unexported types they refer to, to `api/*.api.txt`; `npm run check` and CI fail when the build differs. Phase 4 groundwork. Not reviewed by a separate agent (tooling only, no package code).
- **0.2.0 published to npm (2026-11-13)**: all four packages, through trusted publishing and staged publishing, after the project lead's approvals (GitHub `npm-release`, then npm with a security key, core first). A manual dry-run of the Release workflow ran first. Checked by installing all four from npm in an empty folder and running `scripts/smoke-node.mjs` on Node 20.0.0 and 22; `npm audit signatures` verified the attestations of all four.
- Phase 2 audit closed (2026-11-03), except one item that needs a real iPhone: a clock set back after writing now makes an item ask first (every outbox); `write()` refuses a future `writtenAt`, resets its flags when a store retries `decide`, and matches Unicode forms; the iOS multi-recipient SMS link encodes `+`; four more browser tests (service worker background sync, the one-day rule, two people on one browser, HTML shown as text), each checked to fail on broken code. The SMS hand-off record stays in apps for 0.2 ([audit](audits/2026-10-30-phase2-audit.md)).
- Emergency messages, first part (2026-10-29, unreleased): [decision 0007](decisions/0007-emergency-messages.md), `@holdsend/core/emergency` (`EmergencyOutbox`, `smsLink`), and in the core `add({ decide, askAfterMs })` with `held` and `askBy` stored on each item. Reviewed by a separate agent before merge; its eleven findings were fixed, each new test checked to fail without its fix. Guide: [emergency.md](emergency.md).
- Every package exports `./package.json` (2026-10-29, unreleased).
- The notes example has an emergency page at `/emergency` (2026-10-29), with five browser tests: the first message goes by itself and later ones wait for Send all, repeated taps are one message, the SMS hand-off can be undone, and the page opens offline.
- docs/protocol.md has a section on emergency messages: require the key, keep records as long as a phone may retry, keep written time apart from arrival time (2026-10-29).
- `npm run check` includes a secret scan with secretlint from npm, so no session needs to download gitleaks (CI still runs gitleaks on every pull request).
- October report and Show HN post drafted for the project lead (2026-10-29), kept out of the public repo.
- Reference design read and written up in our own words ([reference-notes.md](reference-notes.md)).
- Name, licence, governance files, CI (lint, build, types, tests, size budgets, gitleaks, PII scan with hashed denylist, company-email check on PR commits, real Postgres race tests).
- `@holdsend/core`: outbox rules, `Outbox` runtime with attempt timeouts and abort signals, keys, written-time bounds, protocol, JSON payload checks, flush scheduler.
- `@holdsend/server`: idempotency store for memory and Postgres (any `query()` driver), `handleIdempotent`, tombstones, `forgetOwner`, purge.
- `@holdsend/web`: IndexedDB store (atomic across tabs, reopens closed connections), `SenderLock`, auto-flush, honest Background Sync helpers.
- `@holdsend/react-native`: `KeyValueStore` over AsyncStorage or MMKV (shared update chain, corrupt-data and size guards), native auto-flush.
- Never-twice, never-lost fault-injection suite (fast-check), checked against deliberately broken code ([testing.md](testing.md)).
- First independent audit: 21 findings, all fixed or explained, each with a regression test ([audits/2026-10-25-first-independent-audit.md](audits/2026-10-25-first-independent-audit.md)).
- Second audit pass: 9 new findings (N1 to N9), all fixed or documented, each with a test that fails on the old code. Per-item retry delays, an `unreachable` stop after 24 hours of no answers, growing attempt timeouts, a frozen `hs1:` request fingerprint.
- Decisions 0001 to 0006 (0007 to 0011 are listed with their work).
- React example in [examples/react](../examples/react): copyable hooks (`useOutboxEntries`, `useAutoFlush`, `useOnline`) and the notes app in React, passing the same browser scenarios as the plain page in a development build (StrictMode on). Reviewed independently; findings fixed.
- Docs site at https://zyakuhq.github.io/holdsend/, built from the repository's Markdown by `scripts/build-site.mjs` and published by the Docs site workflow on every push to main. A test checks that every link on it works.
- Expo example in [examples/expo](../examples/expo): the notes app on Android and iOS over `@holdsend/react-native` (AsyncStorage store, NetInfo and AppState auto-flush, `expo-crypto` keys). Its web build runs five browser scenarios in CI, and since 2026-11-16 its Android release build runs on an emulator in CI (background task only). Nothing runs on iOS or a real phone. Reviewed independently; findings fixed.
- Release preparation: all packages at 0.1.0 with publish metadata (public access, provenance, licence in each package), `scripts/check-packages.mjs` in `npm run check` (only build output, README and LICENSE may be published), CHANGELOG, issue and pull request templates, the Release workflow (tag `v*` publishes; manual runs can dry-run) and [releasing.md](releasing.md). The `@holdsend` npm organisation and the `NPM_TOKEN` secret exist (2026-10-26).
- **0.1.1 published to npm (2026-10-27)**, the first release through trusted publishing and staged publishing: the workflow staged all four packages with no token, and the project lead approved them in GitHub and then on npmjs.com with 2FA. Checked by installing all four from npm and running `scripts/smoke-node.mjs` on Node 20.0.0 and 22. npm now shows the trusted publisher as Valid (checked on `@holdsend/core`).
- Independent source review of 0.1.0 (2026-10-27): six risks, HS-001 to HS-006. Two reproduced and fixed with tests (payload copy at `add()`, a real Postgres purge-during-request test), three documented as guarantee boundaries, one already handled by design ([audits/2026-10-27-source-review.md](audits/2026-10-27-source-review.md)).
- Third independent audit before 0.1.0: 31 findings across core and server, web and React Native, and docs, examples and the release workflow. Every "before 0.1.0" item is fixed or decided, with regression tests ([audits/2026-10-26-third-audit.md](audits/2026-10-26-third-audit.md)).
- **0.1.0 published to npm (2026-10-26)**: `@holdsend/core`, `@holdsend/server`, `@holdsend/web` and `@holdsend/react-native`, each with provenance, after the project lead's approval. The first attempt stopped because the token asked for a one-time password; a token that allows automation fixed it. Checked by installing all four in an empty project and loading each with import and require.
- Example: a notes app (Express + Postgres or PGlite, plain browser page, service worker) in [examples/notes](../examples/notes), with browser tests in CI for airplane mode, a lost answer, two tabs, arrival ordering and the offline feed. Reviewed independently; the review's findings were fixed (background sync waits for a busy tab, the worker sends only the signed-in person's notes, keys are required, the outbox actions report what happened).

- Phase 2 audit by two separate reviewers (2026-10-30): first fixes merged (held-by-old-message bug, SMS number check, doc corrections); the rest is listed in [audits/2026-10-30-phase2-audit.md](audits/2026-10-30-phase2-audit.md).
- SMS hand-off persistence in the notes example (2026-10-31): handed-off messages are kept on the device, shown again after a closed page, and can be put back or marked sent. The phone number is not stored (CodeQL flagged it); the person types it again. Library-level state is not decided ([audit](audits/2026-10-30-phase2-audit.md)).

- Notes example service worker (2026-11-02): cache lookups ignore query strings, cache write failures are swallowed, the timer is cleared, the worker registers before the first await. Browser test added, checked to fail without the fix.

- Flush order (2026-11-01): [decision 0008](decisions/0008-flush-order.md). A flush tries items oldest written first; a retry does not hold later items back, so order is not guaranteed. Pinned by a test, written in [emergency.md](emergency.md). No core code changed (the core is at its size budget).

- Release prep for 0.2.0 (2026-11-12, [#57](https://github.com/zyakuhq/holdsend/pull/57), [decision 0011](decisions/0011-what-0.2.0-ships.md)): 0.2.0 ships the draft helpers too, marked early for 0.3 in the changelog and READMEs (before, they were not mentioned anywhere). `scripts/smoke-node.mjs` loads `./emergency`, `./drafts`, the server draft helpers and `runBackgroundFlush`, and checks a retried draft update is a replay; CI runs it on Node 20.0.0. [releasing.md](releasing.md) step 5 runs a copy against the npm packages. Reviewed by a separate agent; six findings fixed.

- CI browser job (2026-11-11): Chromium is installed from Playwright's download first; its Ubuntu system packages are tried twice and the tests decide if they were needed (two runs had failed on unreachable mirrors before any test ran).

## In progress

- Phase 3, low-end devices (unreleased, 2026-11-10): measured `KeyValueStore` on long queues. Writes per item are steady at three but each write rewrites the whole queue, so data written grows with the square of the queue (1,000 small items wrote about 900 MB). Written up in [low-end.md](low-end.md) with advice (keep queues short, no files in payloads); a test pins writes per item. Not measured on a real phone. A per-item store is not built; no one needs it yet.

- Phase 3, Android background task (unreleased, 2026-11-09): `runBackgroundFlush` in `@holdsend/react-native`, one time-limited flush for the callback of a background task library, with six unit tests (checked to fail on broken code) and README guidance with the honest limits. Since 2026-11-11 the Expo example registers it on Android with `expo-background-task` ([#55](https://github.com/zyakuhq/holdsend/pull/55), [decision 0010](decisions/0010-android-background-task.md)); reading that library's Android source showed it ignores the task's return value, so the guidance to return `Failed` when `retryLater` was corrected. Helper and example reviewed by a separate agent (nothing that can lose or double-send; five wording findings fixed). Since 2026-11-16 it runs on an Android 14 emulator in CI (decision 0016); not on a real Android phone.

- Phase 3, one draft on two devices (unreleased): `readDraft` (2026-11-04) and the server helper (2026-11-05: `acceptDraftUpdate`, `MemoryDraftLog`, `PostgresDraftLog`), reviewed by a separate agent, findings fixed ([guide](drafts.md), [decision 0009](decisions/0009-two-device-drafts.md)). Before 0.3, `@holdsend/server` must depend on a core release that has `./drafts` (0.2.0 does this, decision 0011). Device-side helpers `editLinks` and `resolveLinks` added 2026-11-06 (small pure functions, not yet reviewed by a separate agent). Conflict screen added 2026-11-07 in the notes example at `/drafts` (four browser tests, reviewed by a separate agent, findings fixed). Whole-feature audit by a separate reviewer done 2026-11-08, findings fixed with tests that fail on the old code ([decision 0009](decisions/0009-two-device-drafts.md)); `resolveLinks` now takes the ids on screen and throws on a non-head. Still to do: re-read by a second reviewer is not needed unless the API changes again.

- Phase 3 design note for one draft on two devices: [decision 0009](decisions/0009-two-device-drafts.md), proposed, no code yet (2026-11-03).

- Phase 2, the emergency module (v0.2): code, docs, example and audit done. The core is at 5,216 of its 5,376-byte budget (decision 0014).

## Next tasks

The four gates to 1.0 are in [production.md](production.md#what-10-needs-before-the-readme-changes). In order:

1. Real phones for the SMS links (the emulator job for the background task is done, decision 0016): the [SMS link check](tools/sms-check.html) page is on the docs site (2026-11-15); the project lead runs it on an iPhone and an Android phone and pastes the result.
2. Release 0.3.0 (project lead's approvals in GitHub and npm), then the final audit by reviewers who did not write the code, then 1.0.0 after the project lead's go-ahead and two approvals.
3. At least one app outside this repository on a release (Show HN, after the project lead's yes, is the way to find one).

## After that

- Android CI follow-ups from the review: pin the emulator version, cache Gradle, save logcat as an artifact on failure.

- Conflict handling for one draft edited on two devices (append-only updates with a reason). This is the hard part; say so.

## Blockers

- The Show HN post waits for the project lead's yes.
- The nightly engineering run on 27 and 28 October stopped because it could not download gitleaks. Fixed on 2026-10-29: `npm run check` now runs secretlint, and the task's prompt allows that.

## Resolved

- 2026-10-25: security@zyaku.com receives mail (confirmed by the project lead).
- 2026-10-25: `zyakuhq/holdsend` created by the project lead.
- 2026-10-25: private vulnerability reporting is enabled on the repository (confirmed by the project lead).
- 2026-10-25: at the project lead's request, `main` was rewritten so every commit uses the noreply author address; file contents are unchanged. Old branches and pull-request refs still point at the earlier commits until they are deleted.

## Open questions for the project lead

- None.

## Notes for maintainers

- The never-twice soak at 3000 runs needs `--testTimeout=600000` (the default 30 s is too short for the slow-store case).
- Never put Zyaku code, data, names or configuration in this repository. Write everything fresh; do not write reference code from memory either (see the audit's clean-room note). Run `npm run check` and gitleaks before every push.
- Merge by fast-forwarding `main` to the tested pull-request commit (not GitHub's squash merge, which stamps the account email).
- Repository secret `PII_DENYLIST` (comma-separated plaintext terms) can extend the denylist in CI without publishing it.
