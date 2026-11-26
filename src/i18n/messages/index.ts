// One file per UI area. Keys are prefixed with the namespace ("settings.title").
import type { Msg } from "../define";
import core from "./core";
import app from "./app";
import sidebar from "./sidebar";
import shell from "./shell";
import add from "./add";
import details from "./details";
import settings from "./settings";
import media from "./media";
import wizard from "./wizard";
import changelog from "./changelog";
import stats from "./stats";
import finish from "./finish";

export const vi = {
  ...core.vi,
  ...app.vi,
  ...sidebar.vi,
  ...shell.vi,
  ...add.vi,
  ...details.vi,
  ...settings.vi,
  ...media.vi,
  ...wizard.vi,
  ...changelog.vi,
  ...stats.vi,
  ...finish.vi,
};

export type MessageKey = keyof typeof vi;

export const en: Record<MessageKey, Msg> = {
  ...core.en,
  ...app.en,
  ...sidebar.en,
  ...shell.en,
  ...add.en,
  ...details.en,
  ...settings.en,
  ...media.en,
  ...wizard.en,
  ...changelog.en,
  ...stats.en,
  ...finish.en,
};
