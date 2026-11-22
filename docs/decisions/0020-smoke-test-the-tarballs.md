# 0020: Smoke-test the tarballs before a release

Date: 2026-11-22. Status: accepted.

## Context

Before a release, three checks look at the packages: `scripts/check-packages.mjs` lists what `npm pack` would put in each tarball and loads each entry point, and `scripts/smoke-node.mjs` runs one lost-answer write through each store on Node 20.0.0. All of them load the packages through this repository's workspace links. The first time anything loads the packages as npm serves them is the last step of [releasing.md](../releasing.md), after the project lead has approved the publish, when a mistake can only be fixed with a new version.

0.3.0 is the next release, and it is the first in which `@holdsend/server` loads `@holdsend/core/drafts` with a changed `DraftState`. A version bump that missed one `@holdsend/core` dependency, or a `files` list that left out a subpath, would install a second, older core or fail at import, and the workspace would not show it.

## Choice

- `scripts/smoke-packed.mjs` (`npm run smoke:packed`): runs `npm pack` for the four packages, installs the tarballs together in an empty folder outside the repository with the `fake-indexeddb` version from the lockfile, and runs a copy of `smoke-node.mjs` there. Before running it checks that each package resolves to its installed copy at the packed version, and that no package has its own nested `@holdsend/*` (which is what a dependency on a different core version produces, since npm then fetches that version from the registry).
- CI's oldest-Node job runs it on Node 22 with `--out`, then runs the same installed copy again on Node 20.0.0.
- releasing.md runs it as step 3, before the manual dry-run of the Release workflow.

It does not replace the check after publishing: only that one loads what npm actually serves, with its signatures.

## Checked against broken packaging

- `@holdsend/core` bumped to 0.3.0 with the other three still on 0.2.0: it fails with three "has its own copy of @holdsend/core" lines (npm fetched core 0.2.0 from the registry under each).
- `files` in `@holdsend/core` narrowed so `dist/drafts.js` is not packed: it fails with `ERR_MODULE_NOT_FOUND` for `@holdsend/core/dist/drafts.js`.

`check-packages.mjs` catches both too, by reading the manifests. This test catches them by installing, so it also catches what that script does not read.

## What we did not do

- Run it in `npm run check`: it needs the registry for `fake-indexeddb`, and the local check should work offline once `npm ci` has run.
- Test on the oldest Node's own npm (9.6): the install runs on Node 22's npm, as it will for most users.
