// Installs the four packages from the tarballs `npm pack` makes, in an empty
// folder outside this repository, and runs scripts/smoke-node.mjs there.
//
//   npm run build && node scripts/smoke-packed.mjs [--out <dir>] [--no-run]
//
// smoke-node.mjs run in place loads the packages through the workspace
// links, so it tests the build output, not what npm would serve. This script
// tests the tarballs: the files they contain, their exports and subpaths, and
// that `@holdsend/server`, `web` and `react-native` find the `@holdsend/core`
// of the same version (before a release that version is not on npm, so the
// install would fail if a dependency pointed anywhere else).
//
// --out keeps the folder at <dir> (it must not exist yet or be empty), so CI
// can run smoke-node.mjs there again on another Node. --no-run only installs.
import { execFileSync } from "node:child_process";
import { copyFileSync, existsSync, mkdirSync, mkdtempSync, readdirSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, relative, resolve, sep } from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = fileURLToPath(new URL("..", import.meta.url));
const PACKAGES = ["core", "server", "web", "react-native"];

const args = process.argv.slice(2);
const outIndex = args.indexOf("--out");
const run = !args.includes("--no-run");
let dir;
if (outIndex >= 0) {
  if (!args[outIndex + 1]) fail("--out needs a folder");
  dir = resolve(args[outIndex + 1]);
  if (existsSync(dir) && readdirSync(dir).length > 0) fail(`${dir} is not empty`);
  mkdirSync(dir, { recursive: true });
} else {
  dir = mkdtempSync(join(tmpdir(), "holdsend-packed-"));
}
if (!relative(ROOT, dir).startsWith("..")) fail(`${dir} is inside the repository; Node would find the workspace packages`);

function fail(message) {
  console.error(`smoke-packed: ${message}`);
  process.exit(1);
}

function npm(argv, cwd) {
  return execFileSync("npm", argv, { cwd, encoding: "utf8", stdio: ["ignore", "pipe", "inherit"] });
}

// 1. Pack each package as npm would publish it (prepack scripts skipped: the
//    build already ran, and the Release workflow does the same).
const tarballs = [];
const tarballDir = join(dir, "tarballs");
mkdirSync(tarballDir);
for (const pkg of PACKAGES) {
  const where = join(ROOT, "packages", pkg);
  const manifest = JSON.parse(readFileSync(join(where, "package.json"), "utf8"));
  if (!existsSync(join(where, "dist"))) fail(`packages/${pkg}/dist is missing (run npm run build)`);
  const [packed] = JSON.parse(npm(["pack", "--json", "--ignore-scripts", "--pack-destination", tarballDir], where));
  tarballs.push({ name: manifest.name, version: manifest.version, file: join(tarballDir, packed.filename) });
}

// 2. Install them into an empty project, all at once, with the one
//    third-party package the smoke test needs (at the version this
//    repository's lockfile has).
const lock = JSON.parse(readFileSync(join(ROOT, "package-lock.json"), "utf8"));
const fakeIdb = lock.packages["node_modules/fake-indexeddb"]?.version;
if (!fakeIdb) fail("fake-indexeddb is not in package-lock.json");
writeFileSync(join(dir, "package.json"), JSON.stringify({ name: "holdsend-packed-smoke", private: true, type: "module" }, null, 2) + "\n");
npm(["install", "--no-audit", "--no-fund", "--ignore-scripts", "--no-package-lock", ...tarballs.map((t) => t.file), `fake-indexeddb@${fakeIdb}`], dir);

// 3. Every package resolves to the installed copy, at the packed version,
//    and there is exactly one @holdsend/core (no second copy from the
//    registry nested under another package).
const problems = [];
for (const t of tarballs) {
  const installed = join(dir, "node_modules", ...t.name.split("/"));
  const manifestPath = join(installed, "package.json");
  if (!existsSync(manifestPath)) {
    problems.push(`${t.name} is not installed`);
    continue;
  }
  const version = JSON.parse(readFileSync(manifestPath, "utf8")).version;
  if (version !== t.version) problems.push(`${t.name} installed at ${version}, packed ${t.version}`);
  const resolved = execFileSync(process.execPath, ["--input-type=module", "-e", `console.log(import.meta.resolve(${JSON.stringify(t.name)}))`], { cwd: dir, encoding: "utf8" }).trim();
  const path = fileURLToPath(resolved);
  if (!path.startsWith(installed + sep)) problems.push(`${t.name} resolves to ${path}, outside the installed copy`);
  const nested = join(installed, "node_modules", "@holdsend");
  if (existsSync(nested)) problems.push(`${t.name} has its own copy of ${readdirSync(nested).map((n) => "@holdsend/" + n).join(", ")}`);
}
if (problems.length) {
  console.error(`smoke-packed: ${problems.length} problem(s)`);
  for (const p of problems) console.error(`  ${p}`);
  process.exit(1);
}

// 4. Run the smoke test from a copy inside that project.
copyFileSync(join(ROOT, "scripts", "smoke-node.mjs"), join(dir, "smoke-node.mjs"));
if (run) execFileSync(process.execPath, ["smoke-node.mjs"], { cwd: dir, stdio: "inherit" });

const versions = [...new Set(tarballs.map((t) => t.version))].join(", ");
console.log(`smoke-packed: ${tarballs.length} tarballs at ${versions} installed in ${dir}${run ? " and smoke-tested on Node " + process.versions.node : ""}`);
