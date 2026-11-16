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
  await shell("uiautomator", "dump", "/sdcard/holdsend-ui.xml");
  const xml = await shell("cat", "/sdcard/holdsend-ui.xml");
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

/** Ids of the app's WorkManager jobs, from JobScheduler's dump ("JOB #u0a141/0: 1f2e3d io.example/androidx.work..."). */
async function workJobIds() {
  const dump = await shell("dumpsys", "jobscheduler");
  const lines = dump.split("\n").filter((line) => line.includes(`${PACKAGE}/androidx.work.`) && /JOB #/.test(line));
  return [...new Set(lines.map((line) => line.match(/JOB #[^/\s]+\/(\d+):/)?.[1]).filter(Boolean))];
}

// Every request the app makes to the server, to show what happened.
const requests = [];
const notes = await createNotesApp({});
const server = createServer((req, res) => {
  requests.push({ method: req.method, url: req.url, owner: req.headers["x-demo-user"], at: new Date().toISOString() });
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
    const ids = await workJobIds();
    return ids.length > 0 ? ids : null;
  }, "the background task to be registered with JobScheduler", 60_000);
  log(`background job ids: ${jobs.join(", ")}`);

  // 2. Write a note. Nothing listens on the server's port, so it waits.
  await tap(field);
  await shell("input", "text", text);
  await shell("input", "keyevent", "KEYCODE_BACK"); // close the keyboard so Send is visible
  await tap(await waitUntil(() => find("send"), "the Send button", 10_000));
  await waitUntil(() => find("note-text", text), "the note in the outbox", 15_000);
  await sleep(3000); // at least one failed attempt
  assert.equal(requests.length, 0, "no server is listening yet");
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

  // 5. Run the background job now. Re-run it if Android has not started it
  // yet; running it twice must not publish twice either.
  await waitUntil(async () => {
    for (const id of await workJobIds()) await shell("cmd", "jobscheduler", "run", "-f", PACKAGE, id);
    for (let i = 0; i < 20; i++) {
      if (requests.some((r) => r.method === "POST" && r.url === "/api/notes")) return true;
      await sleep(1000);
    }
    return false;
  }, "the background task to send the note", 150_000);
  const owner = requests.find((r) => r.method === "POST" && r.url === "/api/notes").owner;
  log(`the note arrived; app process ${await pid()} was started without opening the app`);

  // 6. No screen was opened to send it.
  const activities = await shell("dumpsys", "activity", "activities");
  const resumed = activities.split("\n").filter((line) => /mResumedActivity|topResumedActivity/.test(line));
  assert.ok(!resumed.some((line) => line.includes(PACKAGE)), `the app's screen is not open:\n${resumed.join("\n")}`);

  // 7. Published once, with the text that was written.
  await sleep(5000); // time for any second copy to arrive
  const res = await fetch(`http://127.0.0.1:${PORT}/api/notes`, { headers: { "x-demo-user": owner } });
  const published = (await res.json()).notes.map((n) => n.text);
  assert.deepEqual(published, [text], "the note is published exactly once");
  log(`published once: ${JSON.stringify(published)}`);
  failed = false;
} finally {
  console.log("[android] requests the server saw:");
  for (const r of requests) console.log(`  ${r.at} ${r.method} ${r.url}`);
  await new Promise((resolve) => (server.listening ? server.close(resolve) : resolve()));
  await notes.close();
  process.exitCode = failed ? 1 : 0;
}
