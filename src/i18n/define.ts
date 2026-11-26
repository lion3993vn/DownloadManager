export type Params = Record<string, string | number>;
/** A message: text with `{name}` placeholders, or a function (for plurals). */
export type Msg = string | ((p: Params) => string);

/**
 * One namespace of messages, every language side by side. The type makes
 * each language define exactly the keys of the Vietnamese source.
 */
export function defineMessages<T extends Record<string, Msg>>(m: { vi: T; en: { [K in keyof T]: Msg } }) {
  return m;
}

/** English plural helper: `plural(n, "file", "files")` -> "1 file" / "3 files". */
export function plural(n: number | string, one: string, other: string): string {
  return `${n} ${Number(n) === 1 ? one : other}`;
}
