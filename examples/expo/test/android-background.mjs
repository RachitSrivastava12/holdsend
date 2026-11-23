// On an Android emulator: the Expo example's background task sends a note
// that was written while the server could not be reached, in a process that
// Android started with no screen, and the note is published once.
//
// Run by the "Android emulator" workflow, after it has built the release APK
// with EXPO_PUBLIC_NOTES_URL=http://10.0.2.2:3000 (the emulator's name for
// this computer) and installed it on a booted emulator:
//
//   node examples/expo/test/android-background.mjs
//
// Steps: open the app, write a note while no server listens, leave the app
// and let Android kill its process (as it does for a cached app), start the
// server, ask JobScheduler to run the app's background job now, and check the
// server has the note exactly once. Nothing here proves how often Android
// runs the job on its own: forcing the job only shows that when it runs, it
// sends what was waiting.
import assert from "node:assert/strict";
import { execFile } from "node:child_process";
import { randomBytes } from "node:crypto";
import { createServer } from "node:http";
import { promisify } from "node:util";
import { createNotesApp } from "../../notes/src/app.mjs";

const PACKAGE = process.env.ANDROID_PACKAGE ?? "io.github.zyakuhq.holdsend.notes";
const PORT = 3000; // the APK was built to reach http://10.0.2.2:3000
const run = promisify(execFile);

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const log = (message) => console.log(`[android] ${message}`);

async function adb(...args) {
  const { stdout } = await run("adb", args, { maxBuffer: 32 * 1024 * 1024 });
  return stdout;
}
const shell = (...args) => adb("shell", ...args);

async function waitUntil(check, what, timeoutMs) {
  const end = Date.now() + timeoutMs;
  for (;;) {
    const value = await check();
    if (value) return value;
    if (Date.now() > end) throw new Error(`timed out waiting for ${what}`);
    await sleep(1000);
  }
}

/** The screen's views, from uiautomator: resource id (React Native testID), text and centre. */
async function screen() {
  // A dump sometimes fails (no idle state yet); remove the old file so a
  // failed dump is never read as the current screen, and try again later.
  let xml;
  try {
    await shell("rm", "-f", "/sdcard/holdsend-ui.xml");
    await shell("uiautomator", "dump", "/sdcard/holdsend-ui.xml");
    xml = await shell("cat", "/sdcard/holdsend-ui.xml");
  } catch {
    return [];
  }
  const views = [];
  for (const [node] of xml.matchAll(/<node [^>]*>/g)) {
    const attr = (name) => node.match(new RegExp(` ${name}="([^"]*)"`))?.[1] ?? "";
    const box = attr("bounds").match(/\[(\d+),(\d+)\]\[(\d+),(\d+)\]/);
    if (!box) continue;
    const [x1, y1, x2, y2] = box.slice(1).map(Number);
    views.push({ id: attr("resource-id").replace(/^.*:id\//, ""), text: attr("text"), x: Math.round((x1 + x2) / 2), y: Math.round((y1 + y2) / 2) });
  }
  return views;
}

const find = async (id, text) => (await screen()).find((v) => v.id === id && (text === undefined || v.text === text));
const tap = (view) => shell("input", "tap", String(view.x), String(view.y));
const pid = async () => (await shell("pidof", PACKAGE).catch(() => "")).trim();

/**
 * The app's WorkManager jobs, from JobScheduler's dump. Android 14 prints
 * "JOB androidx.work.systemjobscheduler:u0a141/0: ..." (a namespace, then
 * uid/id); older versions print "JOB #u0a141/0: ...".
 */
async function workJobs() {
  const dump = await shell("dumpsys", "jobscheduler");
  const jobs = new Map();
  for (const line of dump.split("\n")) {
    if (!line.includes(`${PACKAGE}/androidx.work.`)) continue;
    const m = line.match(/^\s*JOB (?:#|([^\s:]+):)u\w+\/(\d+):/);
    if (m) jobs.set(`${m[1] ?? ""}/${m[2]}`, { namespace: m[1], id: m[2] });
  }
  return [...jobs.values()];
}

/** Runs one job now, ignoring its delay and constraints. */
const runJob = (job) =>
  shell("cmd", "jobscheduler", "run", "-f", ...(job.namespace ? ["-n", job.namespace] : []), PACKAGE, job.id).catch((err) => {
    // The job may have finished and been replaced by a new id; the caller retries.
    log(`could not run job ${job.namespace ?? ""}/${job.id}: ${err instanceof Error ? err.message.split("\n")[0] : String(err)}`);
  });

/** Forces the app's jobs until a new POST arrives or `ms` pass. Returns whether one arrived. */
async function forceJobsUntilPost(ms) {
  const seen = posts().length;
  const end = Date.now() + ms;
  while (Date.now() < end) {
    for (const job of await workJobs()) await runJob(job);
    for (let i = 0; i < 20 && Date.now() < end; i++) {
      if (posts().length > seen) return true;
      await sleep(1000);
    }
  }
  return posts().length > seen;
}

/** Is the on-screen keyboard showing? */
const keyboardShown = async () => /mInputShown=true/.test(await shell("dumpsys", "input_method").catch(() => ""));

// Every request the app makes to the server, to show what happened.
const requests = [];
const posts = () => requests.filter((r) => r.method === "POST" && r.url === "/api/notes");
const notes = await createNotesApp({});
const server = createServer((req, res) => {
  requests.push({ method: req.method, url: req.url, owner: req.headers["x-demo-user"], key: req.headers["idempotency-key"], at: new Date().toISOString() });
  notes.app(req, res);
});

let failed = true;
try {
  const text = `background-${randomBytes(4).toString("hex")}`;

  // 1. Open the app with no server listening.
  await shell("am", "force-stop", PACKAGE);
  await shell("monkey", "-p", PACKAGE, "-c", "android.intent.category.LAUNCHER", "1");
  const field = await waitUntil(() => find("text"), "the app's text field", 90_000);
  log("app open");

  // The app registers the background task when it opens.
  const jobs = await waitUntil(async () => {
    const found = await workJobs();
    return found.length > 0 ? found : null;
  }, "the background task to be registered with JobScheduler", 60_000);
  log(`background jobs: ${jobs.map((j) => `${j.namespace ?? "(none)"}/${j.id}`).join(", ")}`);

  // 2. Write a note. Nothing listens on the server's port, so it waits.
  await tap(field);
  await shell("input", "text", text);
  // Close the keyboard so Send is visible. Only when it is showing: BACK with
  // no keyboard would leave the app.
  if (await keyboardShown()) await shell("input", "keyevent", "KEYCODE_BACK");
  await tap(await waitUntil(() => find("send"), "the Send button", 10_000));
  await waitUntil(() => find("note-text", text), "the note in the outbox", 15_000);
  await sleep(3000); // the app tries and fails: nothing listens on the port
  log("note is waiting on the device");

  // 3. Leave the app and kill its process the way Android does for a cached
  // app (not force-stop, which would also cancel its jobs).
  await shell("input", "keyevent", "KEYCODE_HOME");
  await sleep(2000);
  const before = await pid();
  await shell("am", "kill", PACKAGE);
  await waitUntil(async () => (await pid()) === "", "the app's process to end", 15_000);
  log(`process ${before} ended`);

  // 4. The server comes back.
  await new Promise((resolve) => server.listen(PORT, "127.0.0.1", resolve));
  log(`notes server listening on ${PORT}`);

  // 5. Run the background job now, re-forcing it if Android has not
  // started it yet. The log is cleared first, to see why the process starts.
  await adb("logcat", "-c");
  assert.ok(await forceJobsUntilPost(150_000), "the background task sends the note");
  const owner = posts()[0].owner;
  const jobPid = await pid();
  log(`the note arrived; app process ${jobPid}`);

  // 6. Android started the process for the job, not for a screen, and no
  // screen of the app is open.
  const starts = (await adb("logcat", "-d", "-s", "ActivityManager")).split("\n").filter((line) => line.includes(`Start proc`) && line.includes(`:${PACKAGE}/`));
  log(`process starts: ${starts.map((l) => l.trim()).join(" | ")}`);
  assert.equal(starts.length, 1, "the app's process was started once after it was killed");
  // "Start proc 2525:<package>/u0a141 for service {<package>/androidx.work...SystemJobService}";
  // opening a screen says "for next-top-activity {...}" or "for top-activity {...}".
  assert.match(starts[0], / for service \{[^}]*\/androidx\.work\.impl\.background\.systemjob\.SystemJobService\}/, "it was started for WorkManager's job service");
  assert.doesNotMatch(starts[0], / for [\w-]*activity/i, "not for a screen");
  const activities = await shell("dumpsys", "activity", "activities");
  const resumed = activities.split("\n").filter((line) => /mResumedActivity|topResumedActivity/.test(line));
  assert.ok(resumed.length > 0, "found the resumed activity in the dump");
  assert.ok(!resumed.some((line) => line.includes(PACKAGE)), `the app's screen is not open:\n${resumed.join("\n")}`);

  // 7. Published once, with the text that was written, and every attempt
  // used the same key.
  await sleep(5000); // time for any second copy to arrive
  assert.equal(new Set(posts().map((r) => r.key)).size, 1, "every attempt used one idempotency key");
  const published = async () => {
    const res = await fetch(`http://127.0.0.1:${PORT}/api/notes`, { headers: { "x-demo-user": owner } });
    return (await res.json()).notes.map((n) => n.text);
  };
  assert.deepEqual(await published(), [text], "the note is published exactly once");
  log(`published once: ${JSON.stringify(await published())}`);

  // 8. The device knows it was sent: forcing the job again sends nothing.
  assert.ok((await workJobs()).length > 0, "the task is scheduled again, so there is a job to force");
  const sentBefore = posts().length;
  assert.equal(await forceJobsUntilPost(30_000), false, "a second run of the task sends nothing");
  assert.equal(posts().length, sentBefore);
  assert.deepEqual(await published(), [text], "still published once");
  log("a second run of the task sent nothing");
  failed = false;
} finally {
  console.log("[android] requests the server saw:");
  for (const r of requests) console.log(`  ${r.at} ${r.method} ${r.url}${r.key ? ` key ${r.key.slice(0, 8)}...` : ""}`);
  await new Promise((resolve) => (server.listening ? server.close(resolve) : resolve()));
  await notes.close();
  process.exitCode = failed ? 1 : 0;
}
