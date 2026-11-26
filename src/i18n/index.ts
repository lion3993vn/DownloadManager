// UI translations. Every string shown to the user goes through `t(key)`.
//
// - Messages live in `messages/<namespace>.ts`, Vietnamese and English side by
//   side (`defineMessages` makes TypeScript reject a missing translation).
// - The language preference ("auto" | "vi" | "en") is stored in the app
//   settings (`settings.app.language`, so the tray menu and Rust errors follow
//   it) and mirrored in localStorage for the first paint.
// - Components call `const t = useT()`, which re-renders them on a change.
//   Plain helpers (lib/format.ts) call `t` directly.

import { useMemo, useSyncExternalStore } from "react";
import { en, vi, type MessageKey } from "./messages";
import type { Msg, Params } from "./define";

export type { MessageKey } from "./messages";
export type Lang = "vi" | "en";
export type LangPref = "auto" | Lang;

export const LANGUAGES: { value: Lang; label: string }[] = [
  { value: "vi", label: "Tiếng Việt" },
  { value: "en", label: "English" },
];

const TABLES: Record<Lang, Record<MessageKey, Msg>> = { vi, en };
const STORAGE_KEY = "dm.language";

/** The OS / webview language, mapped to a supported one (English otherwise). */
export function systemLang(): Lang {
  return (navigator.language || "").toLowerCase().startsWith("vi") ? "vi" : "en";
}

function readPref(): LangPref {
  try {
    const v = localStorage.getItem(STORAGE_KEY);
    if (v === "auto" || v === "vi" || v === "en") return v;
  } catch {
    /* storage unavailable */
  }
  return "auto";
}

export function normalizePref(v: string | null | undefined): LangPref {
  return v === "vi" || v === "en" ? v : "auto";
}

let pref: LangPref = readPref();
let lang: Lang = pref === "auto" ? systemLang() : pref;
const listeners = new Set<() => void>();
document.documentElement.lang = lang;

export function getLang(): Lang {
  return lang;
}

export function getLanguagePref(): LangPref {
  return pref;
}

export function setLanguagePref(next: LangPref) {
  pref = next;
  try {
    localStorage.setItem(STORAGE_KEY, next);
  } catch {
    /* ignore */
  }
  const resolved = next === "auto" ? systemLang() : next;
  if (resolved === lang) return;
  lang = resolved;
  document.documentElement.lang = lang;
  listeners.forEach((f) => f());
}

/** BCP 47 tag for `toLocaleString` and friends. */
export function locale(l: Lang = lang): string {
  return l === "vi" ? "vi-VN" : "en-US";
}

function translate(l: Lang, key: MessageKey, params?: Params): string {
  const m = TABLES[l][key] ?? TABLES.vi[key] ?? key;
  if (typeof m === "function") return m(params ?? {});
  if (!params) return m;
  return m.replace(/\{(\w+)\}/g, (all, name: string) => (name in params ? String(params[name]) : all));
}

/** Translate with the current language. Components should use `useT()` instead. */
export function t(key: MessageKey, params?: Params): string {
  return translate(lang, key, params);
}

export type TFunction = typeof t;

function subscribe(f: () => void) {
  listeners.add(f);
  return () => listeners.delete(f);
}

/** The current language; re-renders the caller when it changes. */
export function useLang(): Lang {
  return useSyncExternalStore(subscribe, getLang);
}

/** `t` bound to the current language; re-renders the caller when it changes. */
export function useT(): TFunction {
  const l = useLang();
  return useMemo(() => (key: MessageKey, params?: Params) => translate(l, key, params), [l]);
}
