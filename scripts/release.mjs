// One-command release:  pnpm release 0.4.0   (add --dry-run to preview)
//
// 1. Checks: on main, no uncommitted changes to tracked files, version is
//    newer than the current one, CHANGELOG.md (English) and CHANGELOG.vi.md
//    (Vietnamese) both have entries under [Unreleased].
// 2. Bumps the version in Cargo.toml, package.json, tauri.conf.json and the
//    extension manifest (+ Cargo.lock), turns [Unreleased] into [x.y.z] in
//    both changelogs.
// 3. Commits "release: vx.y.z", creates tag vx.y.z, pushes both.
// CI (.github/workflows/build.yml) then builds every platform, attaches the
// installers + extension, writes the release notes and publishes.
import { execFileSync, spawnSync } from "node:child_process";
import { readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";

const root = join(import.meta.dirname, "..");
const args = process.argv.slice(2);
const dry = args.includes("--dry-run");
const next = (args.find((a) => !a.startsWith("--")) || "").replace(/^v/, "");

const die = (msg) => {
  console.error(`✖ ${msg}`);
  process.exit(1);
};
const git = (...a) => execFileSync("git", a, { cwd: root, encoding: "utf8" }).trim();
const read = (p) => readFileSync(join(root, p), "utf8");
const write = (p, s) => (dry ? console.log(`  (dry-run) would write ${p}`) : writeFileSync(join(root, p), s));

if (!/^\d+\.\d+\.\d+$/.test(next)) die("usage: pnpm release <x.y.z> [--dry-run]");

const current = JSON.parse(read("src-tauri/tauri.conf.json")).version;
const newer = (a, b) => {
  const [x, y] = [a, b].map((v) => v.split(".").map(Number));
  for (let i = 0; i < 3; i++) if (x[i] !== y[i]) return x[i] > y[i];
  return false;
};
if (!newer(next, current)) die(`version ${next} must be newer than the current ${current}`);
if (git("rev-parse", "--abbrev-ref", "HEAD") !== "main") die("releases are made from the main branch");
if (git("status", "--porcelain", "--untracked-files=no")) {
  if (dry) console.warn("! uncommitted changes (ignored in dry run)");
  else die("commit or stash your changes first");
}
if (git("tag", "-l", `v${next}`)) die(`tag v${next} already exists`);

// CHANGELOGs: [Unreleased] must have content in both languages; together they
// become the release notes (English first, Vietnamese below).
const CHANGELOGS = ["CHANGELOG.md", "CHANGELOG.vi.md"];
const today = new Date().toISOString().slice(0, 10);
const repo = "https://github.com/lion3993vn/DownloadManager";
const changelogs = CHANGELOGS.map((file) => {
  const text = read(file);
  const m = text.match(/^## \[Unreleased\][^\n]*\n([\s\S]*?)(?=^## \[|^\[[^\]]+\]:\s)/m);
  if (!m || !m[1].trim()) die(`${file}: write the changes under ## [Unreleased] first`);
  let updated = text.replace(/^## \[Unreleased\][^\n]*\n/m, `## [Unreleased]\n\n## [${next}] - ${today}\n`);
  updated = updated.replace(
    /^\[Unreleased\]: .*$/m,
    `[Unreleased]: ${repo}/compare/v${next}...HEAD\n[${next}]: ${repo}/releases/tag/v${next}`,
  );
  return { file, notes: m[1].trim(), updated };
});

console.log(`Releasing v${current} → v${next}${dry ? " (dry run)" : ""}`);
for (const c of changelogs) console.log(`\nRelease notes (${c.file}):\n` + c.notes.replace(/^/gm, "  ") + "\n");

// Version bumps.
const bumpJson = (p) => write(p, read(p).replace(/("version":\s*")[^"]+(")/, `$1${next}$2`));
bumpJson("package.json");
bumpJson("src-tauri/tauri.conf.json");
bumpJson("extension/manifest.json");
write(
  "Cargo.toml",
  read("Cargo.toml").replace(/(\[workspace\.package\][\s\S]*?\nversion = ")[^"]+(")/, `$1${next}$2`),
);
for (const c of changelogs) write(c.file, c.updated);

if (dry) {
  console.log("\n(dry-run) would update Cargo.lock, commit, tag and push.");
  process.exit(0);
}

// Keep Cargo.lock in sync with the new workspace version (best effort).
const cargo = spawnSync("cargo", ["update", "--workspace", "--offline"], { cwd: root, stdio: "inherit" });
if (cargo.status !== 0) console.warn("! could not update Cargo.lock (cargo not found?), continuing");

git("add", "package.json", "src-tauri/tauri.conf.json", "extension/manifest.json", "Cargo.toml", "Cargo.lock", ...CHANGELOGS);
git("commit", "-m", `release: v${next}`);
git("tag", "-a", `v${next}`, "-m", `DownloadManager v${next}`);
git("push", "origin", "main", `v${next}`);

// GitHub refuses to let the workflow token *create* releases in this repo
// (it may still upload to and edit an existing one), so create the draft here
// with the user's gh login. CI needs minutes before it uploads anything.
const notes = execFileSync(process.execPath, [join(root, "scripts", "release-notes.mjs"), next, "--changes-only"], {
  cwd: root,
  encoding: "utf8",
});
// No shell: arguments (the title has a space) must reach gh unsplit.
// GitHub can take a few seconds to see the freshly pushed tag, so retry.
let draft;
for (let attempt = 1; attempt <= 10; attempt++) {
  draft = spawnSync(
    "gh",
    ["release", "create", `v${next}`, "--draft", "--verify-tag", "--title", `DownloadManager v${next}`, "--notes-file", "-"],
    { cwd: root, input: notes, encoding: "utf8" },
  );
  if (draft.status === 0 || draft.error || !/no matches found|not found/i.test(draft.stderr)) break;
  Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, 3000);
}
if (draft.status !== 0) {
  console.warn(
    `! could not create the draft release (${(draft.stderr || "gh not found").trim()}).\n` +
      `  Create it before CI finishes building:  gh release create v${next} --draft --verify-tag`,
  );
}
console.log(`\n✔ Pushed v${next}. CI is building and will publish the release:\n  ${repo}/actions`);
