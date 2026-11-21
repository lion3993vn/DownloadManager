import type { ComponentType, SVGProps } from "react";
import { fileExt, fileKind, KIND_COLORS, type FileKind } from "../lib/format";
import { AppIcon, ArchiveIcon, DocIcon, FileIcon, ImageIcon, MusicIcon, VideoIcon } from "./Icons";

export const KIND_ICON: Record<FileKind, ComponentType<SVGProps<SVGSVGElement>>> = {
  video: VideoIcon,
  audio: MusicIcon,
  archive: ArchiveIcon,
  document: DocIcon,
  program: AppIcon,
  image: ImageIcon,
  other: FileIcon,
};

/** Colored square with the file-type glyph and extension label. */
export function FileTile({ name, size = "md" }: { name: string; size?: "md" | "lg" }) {
  const kind = fileKind(name);
  const Icon = KIND_ICON[kind];
  const ext = fileExt(name).slice(0, 4).toUpperCase();
  const box = size === "lg" ? "h-14 w-14 rounded-2xl" : "h-10 w-10 rounded-xl";
  const glyph = size === "lg" ? "h-6 w-6" : "h-[18px] w-[18px]";
  return (
    <div className={`relative flex shrink-0 flex-col items-center justify-center ${box} ${KIND_COLORS[kind]}`}>
      <Icon className={glyph} />
      {ext && (
        <span className={`font-semibold tracking-wide ${size === "lg" ? "mt-0.5 text-[10px]" : "text-[8px] leading-[10px]"}`}>
          {ext}
        </span>
      )}
    </div>
  );
}
