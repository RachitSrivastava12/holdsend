# 0014: Core size budget 5.25 KB

Date: 2026-11-15. Status: accepted.

## Context

The core's CI budget was 5,120 bytes minified and gzipped, and the core was at 5,113. Two requests came in from a review: store why the last attempt of an item did not finish (`lastAttempt`: `no_answer`, `server_busy` or `refused`), so a screen can say "it may already be on the server", and a `sendNow()` for the person's "Send now" button that does not wait for backoff. Together they add about 100 bytes.

## Choice

The budget moves to 5,376 bytes (5.25 KB). Both features go in the core, not a subpath: `lastAttempt` is set inside `settle` and `claim`, which only the core runs, and `sendNow` belongs on `Outbox` next to `flush`.

## Why

- The budget exists so the core stays small enough to add to any app without a second thought. 5.25 KB still does that.
- Both features answer questions every app with a send button has: "did my post go?" and "send it now". Leaving them to each app means each app rebuilds them from internal fields, which decision 0013 asks apps not to touch.
- A budget that never moves stops being a design tool. It moves only with a decision like this one, which says what the bytes bought.
