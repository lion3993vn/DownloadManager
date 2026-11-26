// Several links at once: pasted lists and numbered patterns.
//
//   expandLinks("https://a.org/x.zip\nhttps://b.org/y.zip")   -> both URLs
//   expandLinks("https://a.org/ep[01-03].mp4")               -> ep01, ep02, ep03
//   expandLinks("https://a.org/[a-c]/f[1-2].zip")             -> a/f1, a/f2, b/f1 …

/** Most links one paste can turn into. */
export const MAX_LINKS = 1000;

// [01-20] or [a-e]: numbers keep the start's zero padding.
const PATTERN = /\[(?:(\d+)-(\d+)|([a-z])-([a-z]))\]/i;

/** Every value of the first pattern in `url`, or null when it has none. */
function expandOnce(url: string, limit: number): string[] | null {
  const m = PATTERN.exec(url);
  if (!m) return null;
  const before = url.slice(0, m.index);
  const after = url.slice(m.index + m[0].length);
  const out: string[] = [];
  if (m[1] != null && m[2] != null) {
    const a = Number(m[1]);
    const b = Number(m[2]);
    if (b < a) return null;
    const width = m[1].length > 1 && m[1].startsWith("0") ? m[1].length : 0;
    for (let n = a; n <= b && out.length < limit; n++) out.push(before + String(n).padStart(width, "0") + after);
  } else {
    const a = m[3].charCodeAt(0);
    const b = m[4].charCodeAt(0);
    if (b < a) return null;
    for (let c = a; c <= b && out.length < limit; c++) out.push(before + String.fromCharCode(c) + after);
  }
  return out;
}

/** All patterns of `url`, expanded (at most `limit` results). */
function expand(url: string, limit: number): string[] {
  const first = expandOnce(url, limit);
  if (!first) return [url];
  const out: string[] = [];
  for (const u of first) {
    for (const v of expand(u, limit - out.length)) {
      out.push(v);
      if (out.length >= limit) return out;
    }
  }
  return out;
}

/** The http(s) links in `text` (one per line, or separated by spaces), with patterns expanded. */
export function expandLinks(text: string): string[] {
  const seen = new Set<string>();
  for (const raw of text.split(/\s+/)) {
    // Quotes, angle brackets and list punctuation around a pasted link.
    const token = raw.replace(/^["'<(]+/, "").replace(/["'>),;]+$/, "");
    if (!/^https?:\/\/\S+$/i.test(token)) continue;
    for (const u of expand(token, MAX_LINKS - seen.size)) {
      seen.add(u);
      if (seen.size >= MAX_LINKS) return [...seen];
    }
  }
  return [...seen];
}

/** Whether `text` holds more than one download (a list or a pattern). */
export function isBatch(text: string): boolean {
  return expandLinks(text).length > 1;
}

/** "https://a.org/dir/My%20File.zip?x=1" -> "My File.zip" (the host when there is no name). */
export function nameFromUrl(url: string): string {
  try {
    const u = new URL(url);
    const last = u.pathname.split("/").filter(Boolean).pop();
    return last ? decodeURIComponent(last) : u.host;
  } catch {
    return url;
  }
}

/** A folder name made safe on every OS ("A/B: C?" -> "A B C"). */
export function safeFolderName(name: string): string {
  return name
    .replace(/[<>:"/\\|?*\u0000-\u001f]+/g, " ")
    .replace(/\s+/g, " ")
    .trim()
    .replace(/[. ]+$/, "")
    .slice(0, 80);
}

/** Join a folder and a name with the folder's own separator. */
export function joinPath(dir: string, name: string): string {
  if (!dir) return name;
  const sep = dir.includes("\\") && !dir.includes("/") ? "\\" : "/";
  return dir.replace(/[\\/]+$/, "") + sep + name;
}
