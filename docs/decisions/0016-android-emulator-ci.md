# 0016: The Android background task runs on an emulator in CI

Date: 2026-11-16. Status: accepted.

## Context

Gate 2 to 1.0 ([production.md](../production.md#what-10-needs-before-the-readme-changes)) asks for the Android background task to run on a real phone or an emulator in CI. Until now the Expo example's Android build was never installed anywhere, and `runBackgroundFlush` was checked only by unit tests.

## Choice

A separate workflow, `.github/workflows/android.yml`, on GitHub's standard Linux runner:

- `expo prebuild` generates the Android project in CI (it is not kept in the repository), and Gradle builds a release APK for x86_64 only. Release, so the JavaScript is inside the APK and no Metro server is needed.
- The APK talks to the notes server at `http://10.0.2.2:3000`, the emulator's fixed address for its host. Plain http is allowed by editing the generated manifest in this CI build only; a real app uses https.
- The emulator (Android 14, x86_64, no Google services) is set up with the SDK tools already on the runner, not a third-party action.
- `examples/expo/test/android-background.mjs` drives the app with `adb` and `uiautomator`: write a note while nothing listens on the port, press Home, kill the process with `am kill` (what Android does to a cached app; `force-stop` would cancel its jobs), start the server, force the app's WorkManager job with `cmd jobscheduler run -f`, and check that the note is published exactly once and no screen of the app was opened.
- It runs on pull requests and pushes that change the code it covers, and by hand. It is slow (native build plus emulator boot), so not on every pull request.

## What it found

The first run that got past setup showed the release build crashing at launch: Expo's template turns R8 on, and R8 removed the no-argument constructor of `WorkDatabase_Impl`, which Room creates by reflection. A web build and unit tests could not see this. The example now keeps it with a config plugin (`examples/expo/plugins/keep-work-database.js`), and the READMEs tell people using `expo-background-task` with R8 to check a release build.

Android 14 also prints JobScheduler jobs with a namespace (`JOB androidx.work.systemjobscheduler:u0a141/0`), so the test reads both forms and runs the job with `-n`.

## What it proves and what it does not

- Proves: the task is registered with JobScheduler; when Android runs it, in a process Android started for WorkManager's job service (checked in the system log) with no screen of the app open, it sends what was waiting, every attempt with one key, and the note is published once; a second forced run sends nothing, so the device recorded it as sent.
- Does not prove: how often Android runs the task on its own, behaviour on low battery or after force-stop, or anything on a real phone or on iOS. Those limits stay in the README.

## Reviewed

Reviewed by a separate agent before merge. Fixed: the "no screen" check could pass on an empty dump (now it also checks why the process started), exactly-once leaned on the server alone (now one key per note and a second forced run must send nothing), the path filters missed the server package and the notes example, and closing the keyboard with BACK could leave the app (the emulator now has a hardware keyboard and BACK is sent only when the keyboard shows). The follow-ups it listed (pinning the emulator, caching Gradle, keeping the logs) were done on 2026-11-17; see below.

## Follow-ups (2026-11-17)

- The emulator is pinned to one build (`EMULATOR_BUILD` in the workflow), downloaded from Google and checked against the SHA-1 in Google's download list. Before, `sdkmanager` installed whatever was newest, so a new emulator release could break the job with no change here.
- The system image cannot be pinned through `sdkmanager`. The job prints its revision and shows a warning when it differs from `SYSTEM_IMAGE_REVISION`, so a change is visible before anyone guesses at a failure.
- Gradle's downloads and distribution are cached (`actions/cache`, key from the lockfile, the example's config and its config plugins). Tasks still run every time; there is no Gradle build cache, so a cache hit cannot hide a broken build.
- On failure, `logcat.txt` and the emulator's own log are kept as a workflow artifact for 14 days.
