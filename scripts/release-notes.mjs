// Builds the GitHub release description for a version, in English (first,
// the default) and Vietnamese (below, collapsed).
//
//   node scripts/release-notes.mjs 0.4.0 --changes-only      # CHANGELOG sections only
//   node scripts/release-notes.mjs 0.4.0 --assets <dir>       # full notes from the template,
//                                                             # download table + SHA-256 from <dir>
//
// English comes from CHANGELOG.md, Vietnamese from CHANGELOG.vi.md. Each
// language sits between `<!-- lang:en -->` / `<!-- lang:vi -->` and
// `<!-- /lang -->` (invisible on GitHub); the app's changelog shows only the
// block for its UI language (notesFor in src/lib/format.ts).
//
// Prints Markdown to stdout. No dependencies (Node >= 20).
import { execFileSync } from "node:child_process";
import { createHash } from "node:crypto";
import { readdirSync, readFileSync, statSync } from "node:fs";
import { join } from "node:path";

const root = join(import.meta.dirname, "..");
const REPO = process.env.GITHUB_REPOSITORY || "lion3993vn/DownloadManager";

const args = process.argv.slice(2);
const version = (args[0] || "").replace(/^v/, "");
if (!/^\d+\.\d+\.\d+([-+].+)?$/.test(version)) {
  console.error("usage: release-notes.mjs <version> [--changes-only | --assets <dir>]");
  process.exit(2);
}

/** Body of `## [version]` in CHANGELOG.md (without the heading). */
function changelogSection(text, v) {
  const lines = text.split(/\r?\n/);
  const start = lines.findIndex((l) => new RegExp(`^## \\[${v.replace(/\./g, "\\.")}\\]`).test(l));
  if (start < 0) return null;
  let end = lines.findIndex((l, i) => i > start && (/^## \[/.test(l) || /^\[[^\]]+\]:\s/.test(l)));
  if (end < 0) end = lines.length;
  return lines.slice(start + 1, end).join("\n").trim();
}

const changelog = readFileSync(join(root, "CHANGELOG.md"), "utf8");
const changesEn = changelogSection(changelog, version);
const changesVi = changelogSection(readFileSync(join(root, "CHANGELOG.vi.md"), "utf8"), version);
for (const [file, text] of [
  ["CHANGELOG.md", changesEn],
  ["CHANGELOG.vi.md", changesVi],
]) {
  if (!text) {
    console.error(`${file} has no non-empty section for [${version}]`);
    process.exit(1);
  }
}

if (args.includes("--changes-only")) {
  const notes = [
    "<!-- lang:en -->",
    changesEn,
    "<!-- /lang -->",
    "",
    "<details>",
    "<summary><b>🇻🇳 Tiếng Việt</b></summary>",
    "",
    "<!-- lang:vi -->",
    changesVi,
    "<!-- /lang -->",
    "",
    "</details>",
  ];
  process.stdout.write(notes.join("\n") + "\n");
  process.exit(0);
}

const assetsDir = args[args.indexOf("--assets") + 1];
if (!args.includes("--assets") || !assetsDir) {
  console.error("missing --assets <dir>");
  process.exit(2);
}

// Files users actually download, in display order: [pattern, English, Vietnamese].
const KINDS = [
  [/_x64-setup\.exe$/, "**Windows 10/11** (recommended)", "**Windows 10/11** (khuyên dùng)"],
  [/_x64.*\.msi$/, "Windows (MSI)", "Windows (MSI)"],
  [/_arm64-setup\.exe$/, "Windows ARM64", "Windows ARM64"],
  [/_aarch64\.dmg$/, "**macOS** (Apple Silicon M1–M4)", "**macOS** (Apple Silicon M1–M4)"],
  [/_x64\.dmg$/, "macOS (Intel)", "macOS (Intel)"],
  [/_universal\.dmg$/, "**macOS** (Intel + Apple Silicon)", "**macOS** (Intel + Apple Silicon)"],
  [/_amd64\.deb$/, "**Linux** (Debian/Ubuntu)", "**Linux** (Debian/Ubuntu)"],
  [/\.AppImage$/, "Linux (any distro)", "Linux (mọi distro)"],
  [/\.rpm$/, "Linux (Fedora/openSUSE)", "Linux (Fedora/openSUSE)"],
  [/extension-.*\.zip$/, "Extension (manual install)", "Extension (cài thủ công)"],
];
const files = readdirSync(assetsDir)
  .filter((f) => statSync(join(assetsDir, f)).isFile())
  .sort();
/** Download table rows; `col` 1 = English labels, 2 = Vietnamese. */
const downloads = (col) =>
  KINDS.flatMap((kind) =>
    files
      .filter((f) => kind[0].test(f))
      .map((f) => `| ${kind[col]} | [\`${f}\`](https://github.com/${REPO}/releases/download/v${version}/${encodeURIComponent(f)}) |`),
  ).join("\n") || "| — | — |";
const checksums = files
  .filter((f) => !f.endsWith(".sig") && f !== "latest.json")
  .map((f) => `${createHash("sha256").update(readFileSync(join(assetsDir, f))).digest("hex")}  ${f}`);

// Link to the diff against the previous released version, if any.
const versions = [...changelog.matchAll(/^## \[(\d+\.\d+\.\d+[^\]]*)\]/gm)].map((m) => m[1]);
const prev = versions[versions.indexOf(version) + 1];
const tagExists = (tag) => {
  try {
    return execFileSync("git", ["ls-remote", "--tags", `https://github.com/${REPO}.git`, tag], { encoding: "utf8" }).trim() !== "";
  } catch {
    return false;
  }
};
const compare =
  prev && tagExists(`v${prev}`)
    ? ` · [Compare v${prev}...v${version}](https://github.com/${REPO}/compare/v${prev}...v${version})`
    : "";

const template = readFileSync(join(root, ".github", "release-template.md"), "utf8");
const body = template
  .replaceAll("{{VERSION}}", version)
  .replaceAll("{{REPO}}", REPO)
  .replace("{{CHANGES_EN}}", changesEn)
  .replace("{{CHANGES_VI}}", changesVi)
  .replace("{{DOWNLOADS_EN}}", downloads(1))
  .replace("{{DOWNLOADS_VI}}", downloads(2))
  .replace("{{CHECKSUMS}}", checksums.join("\n"))
  .replace("{{COMPARE}}", compare);
process.stdout.write(body);
